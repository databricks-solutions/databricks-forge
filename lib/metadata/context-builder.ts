/**
 * Schema Context Builder -- top-level orchestrator.
 *
 * Combines the metadata fetcher, deterministic analysis, and LLM
 * classifier into a single `buildSchemaContext()` call that produces
 * a fully enriched SchemaContext.
 *
 * This is the main reusable entry point for any feature that needs
 * to understand a Unity Catalog schema holistically.
 *
 * Also exports `buildSchemaContextFromIntelligence()` -- an adapter
 * that builds a SchemaContext from data already fetched by the
 * environment intelligence layer, avoiding redundant UC queries.
 *
 * @module metadata/context-builder
 */

import { fetchEnrichedMetadata } from "./fetcher";
import {
  detectNamingSignals,
  enrichColumns,
  inferRelationshipsFromNaming,
  buildSchemaNamingProfile,
  analyzeWriteFrequency,
} from "./deterministic";
import { classifySchema, type ClassifierInput } from "./classifier";
import { logger } from "@/lib/logger";
import type {
  SchemaContext,
  EnrichedTable,
  InferredRelationship,
  MetadataScope,
  SchemaContextOptions,
} from "./types";
import type {
  DataDomain,
  ForeignKey,
  LineageGraph,
  TableDetail,
  TableHistorySummary,
} from "@/lib/domain/types";

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function buildSchemaContext(
  scope: MetadataScope,
  options: SchemaContextOptions = {},
): Promise<SchemaContext> {
  const { signal, onProgress, onMetadataCounters } = options;

  // --- Phase 0a: Fetch raw metadata ---
  onProgress?.("schema-context", 0, "Fetching metadata...");

  const fetched = await fetchEnrichedMetadata(scope, {
    includeLineage: options.includeLineage ?? true,
    includeHistory: options.includeHistory ?? true,
    signal,
    onProgress: (phase, pct, detail) => {
      onProgress?.(phase, Math.round(pct * 0.4), detail);
    },
    onCounters: (c) => {
      onMetadataCounters?.(c);
    },
  });

  if (fetched.tables.length === 0) {
    logger.warn("[context-builder] No tables found, returning empty context");
    return emptyContext();
  }

  if (signal?.aborted) throw new Error("Cancelled");

  // --- Phase 0b: Deterministic analysis ---
  onProgress?.("schema-context", 40, "Analyzing naming patterns...");

  const allFqns = fetched.tables.map((t) => t.fqn);

  // Group columns by table
  const columnsByTable = new Map<string, typeof fetched.columns>();
  for (const col of fetched.columns) {
    const key = col.tableFqn.toLowerCase();
    if (!columnsByTable.has(key)) columnsByTable.set(key, []);
    columnsByTable.get(key)!.push(col);
  }

  // Build enriched tables with deterministic signals
  const enrichedTables: EnrichedTable[] = fetched.tables.map((table) => {
    const cols = columnsByTable.get(table.fqn.toLowerCase()) ?? [];
    const namingSignals = detectNamingSignals(table.schema, table.tableName);
    const enrichedCols = enrichColumns(
      cols.map((c) => ({
        name: c.columnName,
        dataType: c.dataType,
        ordinalPosition: c.ordinalPosition,
        isNullable: c.isNullable,
        comment: c.comment,
      })),
      table.fqn,
      allFqns,
    );

    const detail = fetched.tableDetails.get(table.fqn);
    const history = fetched.tableHistory.get(table.fqn);

    return {
      fqn: table.fqn,
      catalog: table.catalog,
      schema: table.schema,
      tableName: table.tableName,
      columns: enrichedCols,
      comment: table.comment ?? fetched.tableComments.get(table.fqn) ?? null,
      tableType: table.tableType,
      format: detail?.format ?? table.dataSourceFormat ?? null,
      tags: fetched.tableTags.get(table.fqn) ?? [],
      owner: detail?.owner ?? null,
      sizeInBytes: detail?.sizeInBytes ?? null,
      writeFrequency: history
        ? analyzeWriteFrequency(
            history.lastWriteTimestamp,
            history.totalWriteOps + history.totalStreamingOps,
          )
        : null,
      lastModified: detail?.lastModified ?? null,
      // LLM fields -- populated in Phase 1
      domain: null,
      role: namingSignals.prefixRole,
      tier: namingSignals.prefixTier,
      dataAssetId: null,
      dataAssetName: null,
      relatedTableFqns: [],
      namingSignals,
    };
  });

  // Release raw column data -- it's now fully represented in enrichedTables.
  // On large schemas (12k+ tables) this frees ~90 MB of duplicate ColumnInfo[].
  columnsByTable.clear();
  (fetched as { columns: unknown }).columns = [];

  // Infer relationships from naming patterns
  const namingRelationships = inferRelationshipsFromNaming(
    enrichedTables.map((t) => ({
      fqn: t.fqn,
      columns: t.columns.map((c) => ({ name: c.name, dataType: c.dataType })),
    })),
  );

  // Merge FK constraints into relationships
  const fkRelationships: InferredRelationship[] = fetched.foreignKeys.map((fk) => ({
    sourceTable: fk.tableFqn,
    sourceColumn: fk.columnName,
    targetTable: fk.referencedTableFqn,
    targetColumn: fk.referencedColumnName,
    confidence: "high" as const,
    basis: "fk_constraint" as const,
  }));

  const allRelationships = deduplicateRelationships([...fkRelationships, ...namingRelationships]);

  // Build schema naming profile
  const namingProfile = buildSchemaNamingProfile(
    enrichedTables.map((t) => ({
      tableName: t.tableName,
      columns: t.columns.map((c) => ({ name: c.name })),
    })),
  );

  if (signal?.aborted) throw new Error("Cancelled");

  // --- Phase 1: LLM Classification ---
  onProgress?.("schema-context", 55, "Classifying tables with LLM...");

  const classifierInputs: ClassifierInput[] = enrichedTables.map((t) => ({
    fqn: t.fqn,
    columns: t.columns.map((c) => ({ name: c.name, dataType: c.dataType })),
    comment: t.comment,
    tags: t.tags,
    namingSignals: t.namingSignals,
  }));

  try {
    const classifications = await classifySchema(classifierInputs, {
      dataAssets: options.dataAssetNames,
      signal,
      onProgress: (pct, detail) => {
        onProgress?.("schema-context", 55 + Math.round(pct * 0.35), detail);
      },
    });

    // Merge LLM classifications back into enriched tables
    const classMap = new Map(classifications.map((c) => [c.fqn.toLowerCase(), c]));
    for (const table of enrichedTables) {
      const classification = classMap.get(table.fqn.toLowerCase());
      if (classification) {
        table.domain = classification.domain;
        table.role = classification.role !== "unknown" ? classification.role : table.role;
        table.tier = classification.tier !== "unknown" ? classification.tier : table.tier;
        table.dataAssetId = classification.dataAssetId;
        table.dataAssetName = classification.dataAssetName;
        table.relatedTableFqns = classification.relatedTableFqns;
      }
    }

    // Add LLM-inferred relationships
    for (const c of classifications) {
      for (const relatedFqn of c.relatedTableFqns) {
        const exists = allRelationships.some(
          (r) =>
            (r.sourceTable.toLowerCase() === c.fqn.toLowerCase() &&
              r.targetTable.toLowerCase() === relatedFqn.toLowerCase()) ||
            (r.targetTable.toLowerCase() === c.fqn.toLowerCase() &&
              r.sourceTable.toLowerCase() === relatedFqn.toLowerCase()),
        );
        if (!exists) {
          allRelationships.push({
            sourceTable: c.fqn,
            sourceColumn: "",
            targetTable: relatedFqn,
            targetColumn: "",
            confidence: "low",
            basis: "llm_inferred",
          });
        }
      }
    }
  } catch (err) {
    logger.warn("[context-builder] LLM classification failed, using deterministic only", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  onProgress?.("schema-context", 95, "Building schema summary...");

  // --- Build schema summary ---
  const schemaSummary = buildSchemaSummaryText(enrichedTables, allRelationships);

  // Lineage edges
  const lineageEdges = fetched.lineageEdges;

  // FK edges
  const foreignKeys = fetched.foreignKeys.map((fk) => ({
    tableFqn: fk.tableFqn,
    columnName: fk.columnName,
    referencedTableFqn: fk.referencedTableFqn,
    referencedColumnName: fk.referencedColumnName,
  }));

  onProgress?.("schema-context", 100, `${enrichedTables.length} tables classified`);

  return {
    tables: enrichedTables,
    relationships: allRelationships,
    lineageEdges,
    foreignKeys,
    namingConventions: namingProfile,
    schemaSummary,
  };
}

// ---------------------------------------------------------------------------
// Adapter: build SchemaContext from intelligence layer data (no UC re-fetch)
// ---------------------------------------------------------------------------

/**
 * Input shape matching the environment intelligence layer's `TableInput`.
 * Defined here to avoid a circular import from environment-intelligence.ts.
 */
export interface IntelligenceTableInput {
  fqn: string;
  columns: Array<{ name: string; type: string; comment: string | null }>;
  comment: string | null;
  tags: string[];
  detail: TableDetail | null;
  history: TableHistorySummary | null;
}

/**
 * Build a SchemaContext from data the intelligence layer has already fetched.
 *
 * This avoids a second round-trip to Unity Catalog. It performs deterministic
 * analysis (naming signals, column roles, FK inference, write-frequency) and
 * applies domain classifications from Pass 1 of the intelligence layer.
 *
 * LLM classification is skipped (domains are already assigned by the
 * intelligence layer; tiers use deterministic inference only).
 */
export function buildSchemaContextFromIntelligence(
  tables: IntelligenceTableInput[],
  lineageGraph: LineageGraph,
  domains: DataDomain[],
  foreignKeys: ForeignKey[],
): SchemaContext {
  if (tables.length === 0) return emptyContext();

  const allFqns = tables.map((t) => t.fqn);

  // Build domain lookup: fqn -> { domain, subdomain }
  const domainByFqn = new Map<string, { domain: string; subdomain: string }>();
  for (const d of domains) {
    for (const fqn of d.tables) {
      domainByFqn.set(fqn.toLowerCase(), { domain: d.domain, subdomain: d.subdomain });
    }
  }

  const enrichedTables: EnrichedTable[] = tables.map((t) => {
    const parts = t.fqn.split(".");
    const catalog = parts[0] ?? "";
    const schema = parts[1] ?? "";
    const tableName = parts[2] ?? "";

    const namingSignals = detectNamingSignals(schema, tableName);
    const enrichedCols = enrichColumns(
      t.columns.map((c, idx) => ({
        name: c.name,
        dataType: c.type,
        ordinalPosition: idx + 1,
        isNullable: true,
        comment: c.comment,
      })),
      t.fqn,
      allFqns,
    );

    const domainInfo = domainByFqn.get(t.fqn.toLowerCase());

    return {
      fqn: t.fqn,
      catalog,
      schema,
      tableName,
      columns: enrichedCols,
      comment: t.comment,
      tableType: t.detail?.tableType ?? "TABLE",
      format: t.detail?.format ?? null,
      tags: t.tags,
      owner: t.detail?.owner ?? null,
      sizeInBytes: t.detail?.sizeInBytes ?? null,
      writeFrequency: t.history
        ? analyzeWriteFrequency(
            t.history.lastWriteTimestamp,
            t.history.totalWriteOps + t.history.totalStreamingOps,
          )
        : null,
      lastModified: t.detail?.lastModified ?? null,
      domain: domainInfo?.domain ?? null,
      role: namingSignals.prefixRole,
      tier: namingSignals.prefixTier,
      dataAssetId: null,
      dataAssetName: null,
      relatedTableFqns: [],
      namingSignals,
    };
  });

  // Infer relationships from naming patterns
  const namingRelationships = inferRelationshipsFromNaming(
    enrichedTables.map((t) => ({
      fqn: t.fqn,
      columns: t.columns.map((c) => ({ name: c.name, dataType: c.dataType })),
    })),
  );

  // FK constraints -> relationships
  const fkRelationships: InferredRelationship[] = foreignKeys.map((fk) => ({
    sourceTable: fk.tableFqn,
    sourceColumn: fk.columnName,
    targetTable: fk.referencedTableFqn,
    targetColumn: fk.referencedColumnName,
    confidence: "high" as const,
    basis: "fk_constraint" as const,
  }));

  const allRelationships = deduplicateRelationships([...fkRelationships, ...namingRelationships]);

  const namingProfile = buildSchemaNamingProfile(
    enrichedTables.map((t) => ({
      tableName: t.tableName,
      columns: t.columns.map((c) => ({ name: c.name })),
    })),
  );

  const lineageEdges = lineageGraph.edges.map((e) => ({
    sourceTableFqn: e.sourceTableFqn,
    targetTableFqn: e.targetTableFqn,
  }));

  const fkEdges = foreignKeys.map((fk) => ({
    tableFqn: fk.tableFqn,
    columnName: fk.columnName,
    referencedTableFqn: fk.referencedTableFqn,
    referencedColumnName: fk.referencedColumnName,
  }));

  const schemaSummary = buildSchemaSummaryText(enrichedTables, allRelationships);

  logger.info("[context-builder] Built SchemaContext from intelligence layer data", {
    tables: enrichedTables.length,
    relationships: allRelationships.length,
    lineageEdges: lineageEdges.length,
    domainsApplied: domainByFqn.size,
  });

  return {
    tables: enrichedTables,
    relationships: allRelationships,
    lineageEdges,
    foreignKeys: fkEdges,
    namingConventions: namingProfile,
    schemaSummary,
  };
}

// ---------------------------------------------------------------------------
// Schema Summary Text Builder
// ---------------------------------------------------------------------------

/**
 * Produce a compact text summary of the schema suitable for injection
 * into LLM prompts. One line per table, includes domain, role, tier,
 * data asset mapping, key relationships, and column count.
 */
const MAX_SCHEMA_SUMMARY_TABLES = 2000;

function buildSchemaSummaryText(
  tables: EnrichedTable[],
  relationships: InferredRelationship[],
): string {
  const schemaCount = new Set(tables.map((t) => t.schema)).size;
  const capped = tables.length > MAX_SCHEMA_SUMMARY_TABLES;

  const lines = [
    "### SCHEMA OVERVIEW",
    `${tables.length} tables across ${schemaCount} schema(s)${capped ? ` (showing first ${MAX_SCHEMA_SUMMARY_TABLES})` : ""}`,
    "",
  ];

  // Pre-index relationships by FQN for O(1) lookup instead of O(R) per table
  const relsByFqn = new Map<string, InferredRelationship[]>();
  for (const r of relationships) {
    const src = r.sourceTable.toLowerCase();
    const tgt = r.targetTable.toLowerCase();
    if (!relsByFqn.has(src)) relsByFqn.set(src, []);
    relsByFqn.get(src)!.push(r);
    if (src !== tgt) {
      if (!relsByFqn.has(tgt)) relsByFqn.set(tgt, []);
      relsByFqn.get(tgt)!.push(r);
    }
  }

  // Group by domain for readability
  const byDomain = new Map<string, EnrichedTable[]>();
  for (const t of tables) {
    const domain = t.domain ?? "Unclassified";
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain)!.push(t);
  }

  let tableCount = 0;
  for (const [domain, domainTables] of byDomain) {
    if (tableCount >= MAX_SCHEMA_SUMMARY_TABLES) break;
    lines.push(`**${domain}** (${domainTables.length} tables)`);

    for (const t of domainTables) {
      if (tableCount >= MAX_SCHEMA_SUMMARY_TABLES) break;
      tableCount++;
      const parts = [`  - ${t.fqn}`];

      const attrs: string[] = [];
      if (t.role && t.role !== "unknown") attrs.push(t.role);
      if (t.tier && t.tier !== "unknown") attrs.push(t.tier);
      if (t.dataAssetId) attrs.push(`asset:${t.dataAssetId}`);
      if (t.writeFrequency && t.writeFrequency !== "unknown") attrs.push(t.writeFrequency);
      attrs.push(`${t.columns.length} cols`);

      parts.push(`[${attrs.join(", ")}]`);

      const rels = relsByFqn.get(t.fqn.toLowerCase()) ?? [];
      if (rels.length > 0) {
        const relTargets = rels
          .map((r) => {
            const other =
              r.sourceTable.toLowerCase() === t.fqn.toLowerCase() ? r.targetTable : r.sourceTable;
            return other.split(".").pop();
          })
          .slice(0, 5);
        parts.push(`-> ${relTargets.join(", ")}`);
      }

      lines.push(parts.join(" "));
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deduplicateRelationships(rels: InferredRelationship[]): InferredRelationship[] {
  const seen = new Set<string>();
  const result: InferredRelationship[] = [];

  for (const r of rels) {
    const key = [
      r.sourceTable.toLowerCase(),
      r.sourceColumn.toLowerCase(),
      r.targetTable.toLowerCase(),
      r.targetColumn.toLowerCase(),
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(r);
  }

  return result;
}

function emptyContext(): SchemaContext {
  return {
    tables: [],
    relationships: [],
    lineageEdges: [],
    foreignKeys: [],
    namingConventions: {
      dominantConvention: "mixed",
      commonPrefixes: [],
      commonSuffixes: [],
      hasMedallionPattern: false,
    },
    schemaSummary: "",
  };
}
