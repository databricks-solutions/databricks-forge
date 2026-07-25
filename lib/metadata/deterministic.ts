/**
 * Deterministic metadata analysis -- zero LLM calls.
 *
 * Pure functions that extract signal from naming conventions, column
 * patterns, and schema structure. Results are used both standalone and
 * as hints to ground the LLM classifier.
 *
 * @module metadata/deterministic
 */

import type {
  ColumnRole,
  DataTier,
  EnrichedColumn,
  InferredRelationship,
  NamingSignals,
  SchemaNamingProfile,
  TableRole,
  WriteFrequency,
} from "./types";

// ---------------------------------------------------------------------------
// Tier detection from schema / table prefixes
// ---------------------------------------------------------------------------

const TIER_PREFIXES: Array<{ pattern: RegExp; tier: DataTier }> = [
  { pattern: /^(bronze|raw|landing|ingest|stg|staging)([_.]|$)/i, tier: "bronze" },
  { pattern: /^(silver|cleansed|curated|enriched|conform)([_.]|$)/i, tier: "silver" },
  { pattern: /^(gold|business|presentation|mart|reporting|analytics)([_.]|$)/i, tier: "gold" },
];

export function detectTierFromName(schemaName: string, tableName: string): DataTier | null {
  for (const { pattern, tier } of TIER_PREFIXES) {
    if (pattern.test(schemaName) || pattern.test(tableName)) return tier;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Role detection from table prefixes
// ---------------------------------------------------------------------------

const ROLE_PREFIXES: Array<{ pattern: RegExp; role: TableRole }> = [
  { pattern: /^(dim|dimension)_/i, role: "dimension" },
  { pattern: /^(fact|fct)_/i, role: "fact" },
  { pattern: /^(stg|staging|tmp|temp)_/i, role: "staging" },
  { pattern: /^(lkp|lookup|ref)_/i, role: "lookup" },
  { pattern: /^(bridge|brdg|link|xref)_/i, role: "bridge" },
  { pattern: /^(audit|log|event)_/i, role: "audit" },
  { pattern: /^(cfg|config|setting)_/i, role: "config" },
  { pattern: /^(snap|snapshot)_/i, role: "snapshot" },
  { pattern: /^vw_/i, role: "dimension" },
];

export function detectRoleFromName(tableName: string): TableRole | null {
  for (const { pattern, role } of ROLE_PREFIXES) {
    if (pattern.test(tableName)) return role;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Naming convention detection
// ---------------------------------------------------------------------------

function detectConvention(name: string): "snake_case" | "camelCase" | "PascalCase" | "mixed" {
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(name)) return "snake_case";
  if (/^[a-z][a-zA-Z0-9]*$/.test(name)) return "camelCase";
  if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) return "PascalCase";
  return "mixed";
}

export function detectNamingSignals(schemaName: string, tableName: string): NamingSignals {
  return {
    prefixTier: detectTierFromName(schemaName, tableName),
    prefixRole: detectRoleFromName(tableName),
    convention: detectConvention(tableName),
  };
}

// ---------------------------------------------------------------------------
// Column role inference
// ---------------------------------------------------------------------------

const COLUMN_ROLE_RULES: Array<{ pattern: RegExp; role: ColumnRole }> = [
  // Primary keys
  { pattern: /^(id|pk|key)$/i, role: "pk" },
  { pattern: /^(row_id|surrogate_key|sk)$/i, role: "pk" },
  // Foreign keys (most specific patterns first)
  { pattern: /_id$/i, role: "fk" },
  { pattern: /_key$/i, role: "fk" },
  { pattern: /_fk$/i, role: "fk" },
  { pattern: /_code$/i, role: "code" },
  // Timestamps
  { pattern: /_at$/i, role: "timestamp" },
  { pattern: /_ts$/i, role: "timestamp" },
  { pattern: /_date$/i, role: "timestamp" },
  { pattern: /_time$/i, role: "timestamp" },
  {
    pattern:
      /^(created|updated|modified|deleted|inserted|processed|ingested)_(at|on|date|time|ts|timestamp)$/i,
    role: "timestamp",
  },
  { pattern: /^(timestamp|event_time|load_time)$/i, role: "timestamp" },
  // Flags / booleans
  { pattern: /^(is|has|can|should|was|did|allow|enable)_/i, role: "flag" },
  { pattern: /_flag$/i, role: "flag" },
  { pattern: /_ind$/i, role: "flag" },
  { pattern: /_yn$/i, role: "flag" },
  // Measures (numeric quantities)
  { pattern: /_amount$/i, role: "measure" },
  { pattern: /_amt$/i, role: "measure" },
  { pattern: /_qty$/i, role: "measure" },
  { pattern: /_quantity$/i, role: "measure" },
  { pattern: /_count$/i, role: "measure" },
  { pattern: /_cnt$/i, role: "measure" },
  { pattern: /_total$/i, role: "measure" },
  { pattern: /_sum$/i, role: "measure" },
  { pattern: /_avg$/i, role: "measure" },
  { pattern: /_pct$/i, role: "measure" },
  { pattern: /_rate$/i, role: "measure" },
  { pattern: /_price$/i, role: "measure" },
  { pattern: /_cost$/i, role: "measure" },
  { pattern: /_balance$/i, role: "measure" },
  { pattern: /_revenue$/i, role: "measure" },
  { pattern: /_weight$/i, role: "measure" },
  { pattern: /_score$/i, role: "measure" },
];

export function inferColumnRole(columnName: string, dataType: string): ColumnRole | null {
  const lower = columnName.toLowerCase();

  // Boolean types are always flags
  if (/^bool/i.test(dataType)) return "flag";

  // Timestamp/date types with generic names
  if (/^(timestamp|date)/i.test(dataType) && !/_id$/i.test(lower)) return "timestamp";

  for (const { pattern, role } of COLUMN_ROLE_RULES) {
    if (pattern.test(lower)) {
      // Don't mark _id columns as FK if the column IS the table's natural primary key
      // (e.g., "id" alone, or the table_name + _id pattern)
      if (role === "fk" && /^(id|pk|key)$/i.test(lower)) return "pk";
      return role;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// FK target inference from column naming
// ---------------------------------------------------------------------------

/**
 * Attempt to infer a FK target table from a column name across all known tables.
 *
 * For a column like `customer_id` on table `orders`, looks for a table whose
 * name matches "customer" or "customers" in the same catalog/schema.
 */
export function inferFkTarget(
  columnName: string,
  sourceTableFqn: string,
  allTableFqns: string[],
): string | null {
  const lower = columnName.toLowerCase();

  // Only attempt for _id, _key, _fk suffixed columns
  const match = lower.match(/^(.+?)_(id|key|fk)$/);
  if (!match) return null;

  const entityHint = match[1]; // e.g., "customer" from "customer_id"
  const sourceParts = sourceTableFqn.toLowerCase().split(".");
  const sourceCatalog = sourceParts[0];
  const sourceSchema = sourceParts[1];

  // Don't self-reference (e.g., customer.customer_id -> customers is fine, but customer.id shouldn't)
  const sourceTable = sourceParts[2];
  if (entityHint === sourceTable || entityHint === sourceTable?.replace(/s$/, "")) {
    return null;
  }

  // Search for matching tables, prefer same schema
  const candidates: Array<{ fqn: string; priority: number }> = [];

  for (const fqn of allTableFqns) {
    const parts = fqn.toLowerCase().split(".");
    if (parts.length < 3) continue;
    const [cat, sch, tbl] = parts;
    const tblBase = tbl.replace(/^(dim_|fact_|stg_|vw_|ref_)/, "");

    const isMatch =
      tblBase === entityHint ||
      tblBase === entityHint + "s" ||
      tblBase === entityHint.replace(/ies$/, "y") ||
      tblBase === entityHint.replace(/s$/, "");

    if (!isMatch) continue;

    let priority = 0;
    if (cat === sourceCatalog && sch === sourceSchema) priority = 3;
    else if (cat === sourceCatalog) priority = 2;
    else priority = 1;

    candidates.push({ fqn, priority });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0].fqn;
}

// ---------------------------------------------------------------------------
// Relationship inference across all tables
// ---------------------------------------------------------------------------

export function inferRelationshipsFromNaming(
  tables: Array<{ fqn: string; columns: Array<{ name: string; dataType: string }> }>,
): InferredRelationship[] {
  const allFqns = tables.map((t) => t.fqn);
  const relationships: InferredRelationship[] = [];
  const seen = new Set<string>();

  for (const table of tables) {
    for (const col of table.columns) {
      const role = inferColumnRole(col.name, col.dataType);
      if (role !== "fk") continue;

      const target = inferFkTarget(col.name, table.fqn, allFqns);
      if (!target) continue;

      const key = `${table.fqn}.${col.name}->${target}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Try to find the target column (look for id, pk, or matching _id column)
      const targetTable = tables.find((t) => t.fqn.toLowerCase() === target.toLowerCase());
      const targetCol = targetTable?.columns.find(
        (c) =>
          c.name.toLowerCase() === "id" ||
          c.name.toLowerCase() === col.name.toLowerCase() ||
          c.name.toLowerCase() === "pk",
      );

      relationships.push({
        sourceTable: table.fqn,
        sourceColumn: col.name,
        targetTable: target,
        targetColumn: targetCol?.name ?? "id",
        confidence: targetCol ? "high" : "medium",
        basis: "naming_pattern",
      });
    }
  }

  return relationships;
}

// ---------------------------------------------------------------------------
// Write frequency from history analysis
// ---------------------------------------------------------------------------

export function analyzeWriteFrequency(
  lastWriteTimestamp: string | null,
  writeCount?: number,
  oldestWriteTimestamp?: string | null,
): WriteFrequency {
  if (!lastWriteTimestamp) return "unknown";

  const now = Date.now();
  const lastWrite = new Date(lastWriteTimestamp).getTime();
  const hoursSinceLastWrite = (now - lastWrite) / (1000 * 60 * 60);

  if (hoursSinceLastWrite > 24 * 90) return "stale";

  if (writeCount && oldestWriteTimestamp) {
    const oldest = new Date(oldestWriteTimestamp).getTime();
    const spanHours = Math.max(1, (now - oldest) / (1000 * 60 * 60));
    const writesPerHour = writeCount / spanHours;

    if (writesPerHour > 1) return "streaming";
    if (writesPerHour > 0.04) return "hourly"; // > 1/day
    if (writesPerHour > 0.006) return "daily"; // > 1/week
    if (writesPerHour > 0.0014) return "weekly"; // > 1/month
    return "monthly";
  }

  if (hoursSinceLastWrite < 2) return "hourly";
  if (hoursSinceLastWrite < 48) return "daily";
  if (hoursSinceLastWrite < 24 * 14) return "weekly";
  return "monthly";
}

// ---------------------------------------------------------------------------
// Enriched column builder
// ---------------------------------------------------------------------------

export function enrichColumns(
  columns: Array<{
    name: string;
    dataType: string;
    ordinalPosition: number;
    isNullable: boolean;
    comment: string | null;
  }>,
  sourceTableFqn: string,
  allTableFqns: string[],
): EnrichedColumn[] {
  return columns.map((col) => ({
    name: col.name,
    dataType: col.dataType,
    ordinalPosition: col.ordinalPosition,
    isNullable: col.isNullable,
    comment: col.comment,
    inferredRole: inferColumnRole(col.name, col.dataType),
    inferredFkTarget: inferFkTarget(col.name, sourceTableFqn, allTableFqns),
  }));
}

// ---------------------------------------------------------------------------
// Schema-wide naming profile
// ---------------------------------------------------------------------------

export function buildSchemaNamingProfile(
  tables: Array<{ tableName: string; columns: Array<{ name: string }> }>,
): SchemaNamingProfile {
  const conventions = new Map<string, number>();
  const prefixes = new Map<string, number>();
  const suffixes = new Map<string, number>();

  for (const t of tables) {
    const conv = detectConvention(t.tableName);
    conventions.set(conv, (conventions.get(conv) ?? 0) + 1);

    // Extract prefixes
    const prefixMatch = t.tableName.match(/^([a-z]+)_/i);
    if (prefixMatch) {
      const p = prefixMatch[1].toLowerCase() + "_";
      prefixes.set(p, (prefixes.get(p) ?? 0) + 1);
    }

    // Extract column suffixes
    for (const col of t.columns) {
      const suffixMatch = col.name.match(/_([a-z]+)$/i);
      if (suffixMatch) {
        const s = "_" + suffixMatch[1].toLowerCase();
        suffixes.set(s, (suffixes.get(s) ?? 0) + 1);
      }
    }
  }

  const sortedConventions = Array.from(conventions.entries()).sort((a, b) => b[1] - a[1]);
  const dominantConvention = (sortedConventions[0]?.[0] ??
    "mixed") as SchemaNamingProfile["dominantConvention"];

  const minPrefixCount = Math.max(2, tables.length * 0.05);
  const commonPrefixes = Array.from(prefixes.entries())
    .filter(([, count]) => count >= minPrefixCount)
    .sort((a, b) => b[1] - a[1])
    .map(([prefix]) => prefix);

  const minSuffixCount = Math.max(3, tables.length * 0.1);
  const commonSuffixes = Array.from(suffixes.entries())
    .filter(([, count]) => count >= minSuffixCount)
    .sort((a, b) => b[1] - a[1])
    .map(([suffix]) => suffix);

  const hasMedallionPattern =
    commonPrefixes.some((p) => /^(bronze|raw|landing|stg)_$/.test(p)) ||
    commonPrefixes.some((p) => /^(silver|cleansed|curated)_$/.test(p)) ||
    commonPrefixes.some((p) => /^(gold|business|mart)_$/.test(p));

  return { dominantConvention, commonPrefixes, commonSuffixes, hasMedallionPattern };
}

// ---------------------------------------------------------------------------
// Struct / Map field extraction (Gap 8)
// ---------------------------------------------------------------------------

export interface StructField {
  path: string;
  dataType: string;
}

/**
 * Parse a STRUCT or MAP type string to extract nested field paths up to
 * `maxDepth` levels. Returns an array of {path, dataType} pairs.
 *
 * Examples:
 *   "STRUCT<city:STRING, zip:INT>" → [{path:"city", dataType:"STRING"}, {path:"zip", dataType:"INT"}]
 *   "STRUCT<address:STRUCT<line1:STRING, line2:STRING>>" with maxDepth=2 →
 *     [{path:"address", dataType:"STRUCT<line1:STRING, line2:STRING>"},
 *      {path:"address.line1", dataType:"STRING"},
 *      {path:"address.line2", dataType:"STRING"}]
 */
export function parseStructFields(fullDataType: string, maxDepth = 2): StructField[] {
  const results: StructField[] = [];
  if (maxDepth <= 0) return results;

  const trimmed = fullDataType.trim();
  const structMatch = trimmed.match(/^STRUCT\s*<(.+)>$/i);
  if (!structMatch) return results;

  const inner = structMatch[1];
  const fields = splitStructFields(inner);

  for (const field of fields) {
    const colonIdx = field.indexOf(":");
    if (colonIdx < 0) continue;
    const name = field.slice(0, colonIdx).trim();
    const type = field.slice(colonIdx + 1).trim();
    if (!name) continue;

    results.push({ path: name, dataType: type });

    if (maxDepth > 1 && /^STRUCT\s*</i.test(type)) {
      const nested = parseStructFields(type, maxDepth - 1);
      for (const n of nested) {
        results.push({ path: `${name}.${n.path}`, dataType: n.dataType });
      }
    }
  }

  return results;
}

/**
 * Split top-level struct fields, respecting nested angle brackets.
 */
function splitStructFields(inner: string): string[] {
  const fields: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "<") depth++;
    else if (ch === ">") depth--;
    else if (ch === "," && depth === 0) {
      fields.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = inner.slice(start).trim();
  if (last) fields.push(last);
  return fields;
}
