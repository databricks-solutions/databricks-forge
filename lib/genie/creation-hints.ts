/**
 * Creation-time hints sourced from Unity Catalog system tables.
 *
 * Used by Schema Scan and Requirements flows to enrich the engine input
 * with signals the user can't readily volunteer:
 *
 *   - `system.query.history`        -> commonly co-joined column pairs
 *   - `system.access.table_lineage` -> upstream/downstream table importance
 *   - `system.access.column_tags`   -> PII / sensitivity tags (where granted)
 *
 * All three queries are best-effort: they fail open with an empty hint set
 * if the caller lacks permissions or the system table isn't available in
 * this region, so the creation flow never blocks on them.
 *
 * Lineage already runs at estate-scan time (see `lib/queries/lineage.ts`).
 * This module reuses `walkLineage` so we don't duplicate that logic.
 */

import { executeSQL } from "@/lib/dbx/sql";
import { walkLineage } from "@/lib/queries/lineage";
import { validateIdentifier } from "@/lib/validation";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ColumnJoinHint {
  /** Left side `catalog.schema.table.column`. */
  left: string;
  /** Right side `catalog.schema.table.column`. */
  right: string;
  /** How many distinct queries used this join in the lookback window. */
  occurrences: number;
}

export interface TableImportanceHint {
  fqn: string;
  /**
   * Sum of upstream + downstream lineage edges. A higher value means the
   * table participates in more pipelines.
   */
  edgeCount: number;
}

export interface SensitivityTagHint {
  /** `catalog.schema.table.column`. */
  qualifiedColumn: string;
  /** Tag value (e.g. PII, SENSITIVE, PHI). */
  tag: string;
}

export interface CreationHints {
  joinHints: ColumnJoinHint[];
  tableImportance: TableImportanceHint[];
  sensitivityTags: SensitivityTagHint[];
}

export interface CreationHintsInput {
  catalog: string;
  schema?: string;
  /** When omitted, every table in the schema is considered. */
  tableFqns?: string[];
  /** Lookback days for `system.query.history`. Default 30. */
  queryHistoryDays?: number;
  /** Top-N join hints to keep. Default 25. */
  topJoinPairs?: number;
  /** Top-N most-important tables to keep. Default 25. */
  topTables?: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const DEFAULT_QUERY_HISTORY_DAYS = 30;
const DEFAULT_TOP_JOIN_PAIRS = 25;
const DEFAULT_TOP_TABLES = 25;

/**
 * Gather all three hint sets in parallel. Each individual query is gated
 * by a try/catch and contributes an empty array on failure.
 */
export async function gatherCreationHints(input: CreationHintsInput): Promise<CreationHints> {
  const [joinHints, tableImportance, sensitivityTags] = await Promise.all([
    fetchJoinHintsFromQueryHistory(input).catch((err) => {
      logger.warn("[creation-hints] join hints failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [] as ColumnJoinHint[];
    }),
    fetchTableImportance(input).catch((err) => {
      logger.warn("[creation-hints] table importance failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [] as TableImportanceHint[];
    }),
    fetchSensitivityTags(input).catch((err) => {
      logger.warn("[creation-hints] sensitivity tags failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [] as SensitivityTagHint[];
    }),
  ]);
  return { joinHints, tableImportance, sensitivityTags };
}

/**
 * Mine `system.query.history` for the most common join column pairs that
 * reference at least one of the input tables. Heuristic: regex out
 * `<a>.<col1> = <b>.<col2>` patterns from the SQL text. Coarse, but good
 * enough as a hint -- the engine still validates with `EXPLAIN`.
 */
export async function fetchJoinHintsFromQueryHistory(
  input: CreationHintsInput,
): Promise<ColumnJoinHint[]> {
  const days = input.queryHistoryDays ?? DEFAULT_QUERY_HISTORY_DAYS;
  const topN = input.topJoinPairs ?? DEFAULT_TOP_JOIN_PAIRS;
  const safeCatalog = validateIdentifier(input.catalog, "catalog");
  const schemaPredicate = input.schema
    ? `AND query_text ILIKE '%${validateIdentifier(input.schema, "schema")}.%'`
    : "";
  const sql = `
    SELECT statement_text AS query_text
    FROM system.query.history
    WHERE start_time >= current_timestamp() - INTERVAL ${Math.min(days, 365)} DAYS
      AND statement_type = 'SELECT'
      AND statement_text ILIKE '%${safeCatalog}.%'
      ${schemaPredicate}
    LIMIT 5000
  `;
  let rows: { query_text?: string }[] = [];
  try {
    const result = await executeSQL(sql);
    rows = result.rows.map((r) => ({ query_text: r[0] ?? "" }));
  } catch (err) {
    logger.warn("[creation-hints] query.history not accessible, returning empty hints", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const counts = new Map<string, number>();
  const joinPattern =
    /([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*)/g;
  for (const row of rows) {
    const text = row.query_text ?? "";
    let m: RegExpExecArray | null;
    while ((m = joinPattern.exec(text)) !== null) {
      const [a, b] = [m[1], m[2]].map((x) => x.toLowerCase()).sort();
      const key = `${a}|${b}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const filterFqns = input.tableFqns?.map((f) => f.toLowerCase());
  const ranked: ColumnJoinHint[] = [...counts.entries()]
    .filter(([k]) => {
      if (!filterFqns || filterFqns.length === 0) return true;
      const [left, right] = k.split("|");
      const leftTable = left.split(".").slice(0, 3).join(".");
      const rightTable = right.split(".").slice(0, 3).join(".");
      return filterFqns.includes(leftTable) || filterFqns.includes(rightTable);
    })
    .map(([k, occurrences]) => {
      const [left, right] = k.split("|");
      return { left, right, occurrences };
    })
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, topN);

  return ranked;
}

/**
 * Score table importance from `system.access.table_lineage` by counting
 * upstream + downstream edges. Falls back to an empty list if lineage is
 * unavailable in this region or the caller lacks permissions.
 */
export async function fetchTableImportance(
  input: CreationHintsInput,
): Promise<TableImportanceHint[]> {
  const seedTables =
    input.tableFqns && input.tableFqns.length > 0 ? input.tableFqns : [`${input.catalog}.${input.schema ?? ""}`];
  const top = input.topTables ?? DEFAULT_TOP_TABLES;

  const counts = new Map<string, number>();
  for (const seed of seedTables) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(seed)) continue;
    if (seed.split(".").length !== 3) continue;
    try {
      const graph = await walkLineage([seed], {
        maxDepth: 1,
        skipSharedCatalogSeeds: false,
      });
      for (const e of graph.edges) {
        const a = (e.sourceTableFqn ?? "").toLowerCase();
        const b = (e.targetTableFqn ?? "").toLowerCase();
        if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
        if (b) counts.set(b, (counts.get(b) ?? 0) + 1);
      }
    } catch (err) {
      logger.warn("[creation-hints] lineage walk failed for seed", {
        seed,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return [...counts.entries()]
    .map(([fqn, edgeCount]) => ({ fqn, edgeCount }))
    .sort((a, b) => b.edgeCount - a.edgeCount)
    .slice(0, top);
}

/**
 * Pull tag-based sensitivity hints from `system.information_schema.column_tags`.
 * Common tags: PII, SENSITIVE, PHI. Returns at most 200 entries.
 */
export async function fetchSensitivityTags(
  input: CreationHintsInput,
): Promise<SensitivityTagHint[]> {
  const safeCatalog = validateIdentifier(input.catalog, "catalog");
  const schemaPredicate = input.schema
    ? `AND ct.schema_name = '${validateIdentifier(input.schema, "schema")}'`
    : "";
  const sql = `
    SELECT ct.catalog_name, ct.schema_name, ct.table_name, ct.column_name, ct.tag_name, ct.tag_value
    FROM \`${safeCatalog}\`.information_schema.column_tags ct
    WHERE ct.tag_name ILIKE 'pii%'
       OR ct.tag_name ILIKE '%sensitive%'
       OR ct.tag_name ILIKE 'phi%'
       OR ct.tag_name ILIKE 'gdpr%'
       OR ct.tag_value ILIKE 'pii%'
       OR ct.tag_value ILIKE '%sensitive%'
       OR ct.tag_value ILIKE 'phi%'
    ${schemaPredicate}
    LIMIT 200
  `;
  try {
    const result = await executeSQL(sql);
    return result.rows.map((r) => ({
      qualifiedColumn: `${r[0]}.${r[1]}.${r[2]}.${r[3]}`,
      tag: r[5] ? `${r[4]}=${r[5]}` : r[4] ?? "",
    }));
  } catch (err) {
    logger.warn("[creation-hints] column_tags not accessible, returning empty hints", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
