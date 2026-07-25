/**
 * Types for the Metric View engine.
 *
 * These types were originally defined in lib/genie/types.ts and are now the
 * canonical location. The Genie module re-exports them for backward
 * compatibility.
 */

// Re-export the canonical IR so existing imports from this module remain valid.
export * from "./definition";

// ---------------------------------------------------------------------------
// Shared input types (used by both Genie engine and standalone paths)
// ---------------------------------------------------------------------------

export interface ColumnEnrichment {
  tableFqn: string;
  columnName: string;
  description: string | null;
  synonyms: string[];
  hidden: boolean;
  entityMatchingCandidate: boolean;
}

export interface EnrichedSqlSnippetMeasure {
  name: string;
  sql: string;
  synonyms: string[];
  instructions: string;
}

export interface EnrichedSqlSnippetDimension {
  name: string;
  sql: string;
  synonyms: string[];
  instructions: string;
  isTimePeriod: boolean;
}

export type JoinSource = "fk" | "override" | "sql_mined" | "llm" | "heuristic";
export type JoinConfidence = "high" | "medium" | "low";

export interface JoinSpecInput {
  leftTable: string;
  rightTable: string;
  sql: string;
  relationshipType?: string;
  source?: JoinSource;
  confidence?: JoinConfidence;
}

// ---------------------------------------------------------------------------
// Classification (reuse / improve / new)
// ---------------------------------------------------------------------------

export type MetricViewClassification = "reuse" | "improve" | "new";

// ---------------------------------------------------------------------------
// Existing metric view detail (from deep discovery)
// ---------------------------------------------------------------------------

export interface ExistingMetricViewDetail {
  fqn: string;
  name: string;
  comment: string | null;
  yaml: string | null;
  sourceTable: string | null;
  dimensions: string[];
  measures: string[];
  joinTargets: string[];
}

// ---------------------------------------------------------------------------
// Proposal (engine output)
// ---------------------------------------------------------------------------

export interface MetricViewProposal {
  name: string;
  description: string;
  /**
   * Typed source of truth persisted as definitionJson for new proposals.
   * Adapted lazily in memory for readable legacy rows; absent when legacy YAML
   * cannot be parsed.
   */
  definition?: import("./definition").MetricViewDefinition;
  yaml: string;
  ddl: string;
  sourceTables: string[];
  hasJoins: boolean;
  hasFilteredMeasures: boolean;
  hasWindowMeasures: boolean;
  hasMaterialization: boolean;
  validationStatus: "valid" | "warning" | "error" | "unverified";
  validationIssues: string[];
  /** Version of the runtime probe validator; absent for legacy proposals. */
  validatorVersion?: string;
  /** Structured create/probe/cleanup evidence; never contains result rows. */
  validationEvidence?: import("@/lib/validation/evidence").ValidationEvidence[];
  /** ISO timestamp recorded after runtime validation completes. */
  validatedAt?: string;
  /** Set by the new metric view engine; absent for legacy proposals. */
  classification?: MetricViewClassification;
  /** LLM-generated rationale for why this proposal exists (reuse/improve/new). */
  rationale?: string;
  /** For "reuse" and "improve" proposals, the FQN of the existing view. */
  existingFqn?: string;
  /** Additive-only typed plan for an in-place improvement. */
  improveDiff?: import("./improve-diff").MetricViewImproveDiff;
  /** Immutable original definition bound by improveDiff.baseFingerprint. */
  improveBaseDefinition?: import("./definition").MetricViewDefinition;
  /** Subdomain this proposal was generated for. */
  subdomain?: string;
}

// ---------------------------------------------------------------------------
// Engine input / output
// ---------------------------------------------------------------------------

export interface MetricViewEngineInput {
  domain: string;
  subdomain?: string;
  tableFqns: string[];
  metadata: import("@/lib/domain/types").MetadataSnapshot;
  allowlist: import("@/lib/genie/schema-allowlist").SchemaAllowlist;
  useCases: import("@/lib/domain/types").UseCase[];
  measures: EnrichedSqlSnippetMeasure[];
  dimensions: EnrichedSqlSnippetDimension[];
  joinSpecs: JoinSpecInput[];
  columnEnrichments: ColumnEnrichment[];
  existingMetricViews?: ExistingMetricViewDetail[];
  businessContext?: string;
  industryContext?: string;
  endpoint: string;
  signal?: AbortSignal;
}

export interface MetricViewEngineOutput {
  proposals: MetricViewProposal[];
}

// ---------------------------------------------------------------------------
// Lightweight seed
// ---------------------------------------------------------------------------

export interface LightweightSeedResult {
  measures: EnrichedSqlSnippetMeasure[];
  dimensions: EnrichedSqlSnippetDimension[];
  columnEnrichments: ColumnEnrichment[];
}
