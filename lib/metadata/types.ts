/**
 * Shared Schema Context types.
 *
 * Zero Forge-specific dependencies -- these types describe enriched Unity
 * Catalog metadata and can be consumed by any feature (Comment Engine,
 * Genie Engine, Ask Forge, data quality, documentation generation).
 *
 * @module metadata/types
 */

// ---------------------------------------------------------------------------
// Table & Column Roles
// ---------------------------------------------------------------------------

export type TableRole =
  | "fact"
  | "dimension"
  | "staging"
  | "lookup"
  | "bridge"
  | "audit"
  | "config"
  | "snapshot"
  | "unknown";

export type ColumnRole = "pk" | "fk" | "timestamp" | "flag" | "measure" | "code" | "free_text";

export type WriteFrequency =
  | "streaming"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "stale"
  | "unknown";

export type DataTier = "bronze" | "silver" | "gold" | "unknown";

// ---------------------------------------------------------------------------
// Naming Analysis
// ---------------------------------------------------------------------------

export interface NamingSignals {
  /** Tier inferred from schema or table prefix (e.g., bronze_, stg_). */
  prefixTier: DataTier | null;
  /** Role inferred from table prefix (e.g., dim_, fact_, vw_). */
  prefixRole: TableRole | null;
  /** Detected naming convention. */
  convention: "snake_case" | "camelCase" | "PascalCase" | "mixed";
}

export interface SchemaNamingProfile {
  dominantConvention: "snake_case" | "camelCase" | "PascalCase" | "mixed";
  commonPrefixes: string[];
  commonSuffixes: string[];
  hasMedallionPattern: boolean;
}

// ---------------------------------------------------------------------------
// Enriched Column
// ---------------------------------------------------------------------------

export interface EnrichedColumn {
  name: string;
  dataType: string;
  ordinalPosition: number;
  isNullable: boolean;
  comment: string | null;
  /** Deterministic role inference (pk, fk, timestamp, flag, measure, code). */
  inferredRole: ColumnRole | null;
  /** If inferredRole is "fk", the likely target (e.g., "catalog.schema.customers.customer_id"). */
  inferredFkTarget: string | null;
}

// ---------------------------------------------------------------------------
// Enriched Table
// ---------------------------------------------------------------------------

export interface EnrichedTable {
  fqn: string;
  catalog: string;
  schema: string;
  tableName: string;
  columns: EnrichedColumn[];
  comment: string | null;
  tableType: string;
  format: string | null;
  tags: string[];
  owner: string | null;
  sizeInBytes: number | null;
  writeFrequency: WriteFrequency | null;
  lastModified: string | null;

  /* --- LLM classifications (populated by classifier) --- */
  domain: string | null;
  role: TableRole | null;
  tier: DataTier | null;
  dataAssetId: string | null;
  dataAssetName: string | null;
  relatedTableFqns: string[];

  /* --- Deterministic signals --- */
  namingSignals: NamingSignals;
}

// ---------------------------------------------------------------------------
// Inferred Relationship
// ---------------------------------------------------------------------------

export interface InferredRelationship {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  confidence: "high" | "medium" | "low";
  basis: "naming_pattern" | "fk_constraint" | "llm_inferred";
}

// ---------------------------------------------------------------------------
// Schema Context (the main reusable output)
// ---------------------------------------------------------------------------

export interface SchemaContext {
  tables: EnrichedTable[];
  relationships: InferredRelationship[];
  /** Lineage edges from system.access.table_lineage (empty if unavailable). */
  lineageEdges: Array<{
    sourceTableFqn: string;
    targetTableFqn: string;
  }>;
  /** Foreign keys from information_schema (empty if unavailable). */
  foreignKeys: Array<{
    tableFqn: string;
    columnName: string;
    referencedTableFqn: string;
    referencedColumnName: string;
  }>;
  namingConventions: SchemaNamingProfile;
  /** Compact text summary (one line per table) suitable for prompt injection. */
  schemaSummary: string;
}

// ---------------------------------------------------------------------------
// Builder Options
// ---------------------------------------------------------------------------

/** Structured counters for the metadata fetch progress. */
export interface MetadataFetchCounters {
  tablesFound?: number;
  columnsFound?: number;
  lineageEdgesFound?: number;
  enrichedCount?: number;
  enrichTotal?: number;
}

export interface SchemaContextOptions {
  industryId?: string;
  /** Reference Data Assets to guide classification (from industry outcome maps). */
  dataAssetNames?: Array<{
    id: string;
    name: string;
    description: string;
    assetFamily: string;
    systemLocation?: string;
    systemKind?: string;
  }>;
  includeLineage?: boolean;
  includeHistory?: boolean;
  signal?: AbortSignal;
  onProgress?: (phase: string, pct: number, detail?: string) => void;
  /** Structured counter updates for downstream progress trackers. */
  onMetadataCounters?: (counters: MetadataFetchCounters) => void;
}

export interface MetadataScope {
  catalogs: string[];
  schemas?: string[];
  tables?: string[];
  /** Explicitly excluded schema paths (e.g. "catalog.schema"). */
  excludedSchemas?: string[];
  /** Explicitly excluded table FQNs (e.g. "catalog.schema.table"). */
  excludedTables?: string[];
  /** Glob patterns matched against names at every level (catalog, schema, table). */
  exclusionPatterns?: string[];
  /** Glob patterns a table must match (any segment) to be kept. Empty = keep all. */
  inclusionPatterns?: string[];
}
