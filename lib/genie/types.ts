/**
 * TypeScript types for Databricks Genie Spaces integration.
 *
 * Covers the REST API payloads (serialized_space v2 format), the
 * recommendation engine output, the Genie Engine configuration,
 * pass output types, and the local tracking model.
 */

import type { QuestionComplexity } from "@/lib/settings";
import type { QualityPreset } from "@/lib/genie/quality-presets";
import type { SemanticAssetManifest } from "@/lib/semantic-assets/types";
export type { QuestionComplexity } from "@/lib/settings";
export type { QualityPreset } from "@/lib/genie/quality-presets";

// ---------------------------------------------------------------------------
// Genie Engine Configuration (customer-editable)
// ---------------------------------------------------------------------------

export interface GlossaryEntry {
  term: string;
  definition: string;
  synonyms: string[];
}

export interface ColumnOverride {
  tableFqn: string;
  columnName: string;
  hidden?: boolean;
  displayName?: string;
  description?: string;
  synonyms?: string[];
}

export interface CustomSqlExpression {
  name: string;
  sql: string;
  synonyms: string[];
  instructions: string;
}

export interface TableGroupOverride {
  tableFqn: string;
  targetDomain: string;
}

export interface JoinOverride {
  leftTable: string;
  rightTable: string;
  joinSql: string;
  relationshipType: "many_to_one" | "one_to_many" | "one_to_one";
  enabled: boolean;
}

export interface ClarificationRule {
  topic: string;
  missingDetails: string[];
  clarificationQuestion: string;
}

export interface EntityMatchingOverride {
  tableFqn: string;
  columnName: string;
  enabled: boolean;
}

export interface BenchmarkInput {
  question: string;
  expectedSql: string;
  alternatePhrasings: string[];
}

/**
 * Validated SQL from an existing space, used to ground LLM passes during
 * fix/improve workflows where no pipeline use cases are available.
 */
export interface ReferenceSqlExample {
  name: string;
  question: string;
  sql: string;
}

export interface GenieEngineConfig {
  glossary: GlossaryEntry[];
  columnOverrides: ColumnOverride[];

  customMeasures: CustomSqlExpression[];
  customFilters: CustomSqlExpression[];
  customDimensions: CustomSqlExpression[];

  fiscalYearStartMonth: number;
  autoTimePeriods: boolean;
  timePeriodDateColumns: string[];

  tableGroupOverrides: TableGroupOverride[];
  maxTablesPerSpace: number;
  maxAutoSpaces: number;
  joinOverrides: JoinOverride[];

  entityMatchingMode: "auto" | "manual" | "off";
  entityMatchingOverrides: EntityMatchingOverride[];

  clarificationRules: ClarificationRule[];
  summaryInstructions: string;
  globalInstructions: string;

  benchmarkQuestions: BenchmarkInput[];

  generateMetricViews: boolean;
  generateTrustedAssets: boolean;
  generateBenchmarks: boolean;
  llmRefinement: boolean;
  /** Skip the LLM planning pre-pass for metric views (faster, less precise). */
  skipMetricViewPlanning: boolean;

  questionComplexity: QuestionComplexity;

  /** Controls speed vs richness trade-off. Determines generation budgets, review surfaces, and domain concurrency. */
  qualityPreset: QualityPreset;
}

export function defaultGenieEngineConfig(): GenieEngineConfig {
  return {
    glossary: [],
    columnOverrides: [],
    customMeasures: [],
    customFilters: [],
    customDimensions: [],
    fiscalYearStartMonth: 1,
    autoTimePeriods: true,
    timePeriodDateColumns: [],
    tableGroupOverrides: [],
    maxTablesPerSpace: 25,
    maxAutoSpaces: 0,
    joinOverrides: [],
    entityMatchingMode: "auto",
    entityMatchingOverrides: [],
    clarificationRules: [],
    summaryInstructions: "",
    globalInstructions: "",
    benchmarkQuestions: [],
    generateMetricViews: true,
    generateTrustedAssets: true,
    generateBenchmarks: true,
    llmRefinement: true,
    skipMetricViewPlanning: true,
    questionComplexity: "simple",
    qualityPreset: "balanced",
  };
}

// ---------------------------------------------------------------------------
// Engine Pass Outputs
// ---------------------------------------------------------------------------

// Canonical definitions live in lib/metric-views/types.ts; imported here for
// use in local interfaces and re-exported for backward compatibility.
import type {
  ColumnEnrichment as _ColumnEnrichment,
  EnrichedSqlSnippetMeasure as _EnrichedSqlSnippetMeasure,
  EnrichedSqlSnippetDimension as _EnrichedSqlSnippetDimension,
  JoinSource as _JoinSource,
  JoinConfidence as _JoinConfidence,
  JoinSpecInput as _JoinSpecInput,
  MetricViewProposal as _MetricViewProposal,
  MetricViewClassification as _MetricViewClassification,
} from "@/lib/metric-views/types";

export type ColumnEnrichment = _ColumnEnrichment;
export type EnrichedSqlSnippetMeasure = _EnrichedSqlSnippetMeasure;
export type EnrichedSqlSnippetDimension = _EnrichedSqlSnippetDimension;
export type JoinSource = _JoinSource;
export type JoinConfidence = _JoinConfidence;
export type JoinSpecInput = _JoinSpecInput;
export type MetricViewProposal = _MetricViewProposal;
export type MetricViewClassification = _MetricViewClassification;

export interface EntityMatchingCandidate {
  tableFqn: string;
  columnName: string;
  sampleValues: string[];
  distinctCount: number;
  confidence: "high" | "medium" | "low";
  conversationalMappings: string[];
}

export interface EnrichedSqlSnippetFilter {
  name: string;
  sql: string;
  synonyms: string[];
  instructions: string;
  isTimePeriod: boolean;
}

export interface TrustedAssetQuery {
  question: string;
  sql: string;
  parameters: TrustedAssetParameter[];
}

export interface TrustedAssetParameter {
  name: string;
  type: "String" | "Date" | "Numeric";
  comment: string;
  defaultValue: string | null;
}

/** @deprecated SQL functions are no longer generated for Genie spaces. Retained for backward-compatible deserialization of persisted data. */
export interface TrustedAssetFunction {
  name: string;
  ddl: string;
  description: string;
}

export interface JoinDiagnostic {
  status: "accepted" | "rejected";
  source: JoinSource;
  confidence: JoinConfidence;
  leftTable?: string;
  rightTable?: string;
  sql?: string;
  reason: string;
}

/** Aggregated output from all engine passes for a single domain. */
export interface GenieEnginePassOutputs {
  domain: string;
  subdomains: string[];
  tables: string[];
  metricViews: string[];
  columnEnrichments: ColumnEnrichment[];
  entityMatchingCandidates: EntityMatchingCandidate[];
  measures: EnrichedSqlSnippetMeasure[];
  filters: EnrichedSqlSnippetFilter[];
  dimensions: EnrichedSqlSnippetDimension[];
  trustedQueries: TrustedAssetQuery[];
  trustedFunctions: TrustedAssetFunction[];
  textInstructions: string[];
  sampleQuestions: string[];
  benchmarkQuestions: BenchmarkInput[];
  metricViewProposals: MetricViewProposal[];
  /** Versioned, governed semantic assets produced after metric-view validation. */
  semanticAssetManifest?: SemanticAssetManifest;
  joinSpecs: Array<{
    leftTable: string;
    rightTable: string;
    sql: string;
    relationshipType: "many_to_one" | "one_to_many" | "one_to_one";
    source?: JoinSource;
    confidence?: JoinConfidence;
  }>;
  joinDiagnostics?: JoinDiagnostic[];
}

// ---------------------------------------------------------------------------
// Genie REST API Types
// ---------------------------------------------------------------------------

/** Top-level response from List / Get / Create / Update endpoints. */
export interface GenieSpaceResponse {
  space_id: string;
  title: string;
  description?: string;
  warehouse_id?: string;
  serialized_space?: string; // JSON string -- only in Get / Create / Update
}

export interface GenieListResponse {
  spaces: GenieSpaceResponse[];
  next_page_token?: string;
}

// ---------------------------------------------------------------------------
// Serialized Space (v2 format)
// ---------------------------------------------------------------------------

/** Parsed serialized_space JSON (v2 format). Use Record<string, any> for flexible traversal. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SpaceJson = Record<string, any>;

export interface SerializedSpace {
  version: 2;
  config: SerializedSpaceConfig;
  data_sources: SerializedDataSources;
  instructions: SerializedInstructions;
  benchmarks?: SerializedBenchmarks;
}

export interface SerializedSpaceConfig {
  sample_questions: SampleQuestion[];
}

export interface SampleQuestion {
  id: string;
  question: string[];
}

export interface SerializedDataSources {
  tables: DataSourceTable[];
  metric_views?: DataSourceMetricView[];
}

export interface DataSourceColumnConfig {
  column_name: string;
  description?: string[];
  synonyms?: string[];
  enable_entity_matching?: boolean;
  enable_format_assistance?: boolean;
}

export interface DataSourceTable {
  identifier: string; // catalog.schema.table
  description?: string[];
  column_configs?: DataSourceColumnConfig[];
}

export interface DataSourceMetricView {
  identifier: string; // catalog.schema.metric_view
  description?: string[];
}

export interface SerializedInstructions {
  text_instructions: TextInstruction[];
  example_question_sqls: ExampleQuestionSql[];
  sql_functions?: SqlFunction[];
  join_specs: JoinSpec[];
  sql_snippets: SqlSnippets;
}

export interface TextInstruction {
  id: string;
  content: string[];
}

export interface ExampleQuestionSql {
  id: string;
  question: string[];
  sql: string[];
  usage_guidance?: string[];
}

/** @deprecated SQL functions are no longer deployed to Genie spaces. Retained for backward-compatible deserialization. */
export interface SqlFunction {
  id: string;
  identifier: string;
}

export interface JoinSpec {
  id: string;
  left: { identifier: string; alias?: string };
  right: { identifier: string; alias?: string };
  sql: string[];
  comment?: string[];
}

export interface SqlSnippets {
  measures: SqlSnippetMeasure[];
  filters: SqlSnippetFilter[];
  expressions: SqlSnippetExpression[];
}

export interface SqlSnippetMeasure {
  id: string;
  alias: string;
  sql: string[];
  synonyms?: string[];
  display_name?: string;
  comment?: string[];
}

export interface SqlSnippetFilter {
  id: string;
  sql: string[];
  display_name: string;
  synonyms?: string[];
  comment?: string[];
}

export interface SqlSnippetExpression {
  id: string;
  alias: string;
  sql: string[];
  synonyms?: string[];
  display_name?: string;
  instruction?: string[];
}

export interface SerializedBenchmarks {
  questions: BenchmarkQuestion[];
}

export interface BenchmarkQuestion {
  id: string;
  question: string[];
  answer?: { format: string; content: string[] }[];
}

// ---------------------------------------------------------------------------
// Recommendation Engine Output
// ---------------------------------------------------------------------------

export interface GenieSpaceRecommendation {
  domain: string;
  subdomains: string[];
  title: string;
  description: string;
  tableCount: number;
  metricViewCount: number;
  useCaseCount: number;
  sqlExampleCount: number;
  joinCount: number;
  measureCount: number;
  filterCount: number;
  dimensionCount: number;
  benchmarkCount: number;
  instructionCount: number;
  sampleQuestionCount: number;
  sqlFunctionCount: number;
  tables: string[];
  metricViews: string[];
  serializedSpace: string; // JSON string ready for the Create API
  /** "new" (default), "enhancement" (existing space found), or "replacement" */
  recommendationType?: "new" | "enhancement" | "replacement";
  /** Space ID of the existing asset when recommendationType is "enhancement" */
  existingAssetId?: string;
  /** Human-readable summary of what changed vs the existing space */
  changeSummary?: string;
  /** Quality diagnostics surfaced in generation preview. */
  quality?: {
    promptVersion?: string;
    titleSource: "llm" | "fallback";
    instructionChars: number;
    joinsCount: number;
    sampleQueriesCount: number;
    degradedReasons: string[];
    score: number;
    gateDecision?: "allow" | "warn" | "block";
    gateReasons?: string[];
    joinDiagnostics?: JoinDiagnostic[];
  };
}

// ---------------------------------------------------------------------------
// Tracking (local Lakebase persistence)
// ---------------------------------------------------------------------------

export type GenieSpaceStatus = "created" | "updated" | "trashed";

export interface TrackedGenieSpace {
  id: string;
  spaceId: string;
  runId: string | null;
  domain: string;
  title: string;
  status: GenieSpaceStatus;
  /** @deprecated `functions` is always empty — function deployment has been removed. */
  deployedAssets?: {
    functions: string[];
    metricViews: string[];
    metadata?: { promptVersion?: string; gateDecision?: "allow" | "warn" | "block" };
  } | null;
  /** Auth mode used when the space was created ("obo" = user token, "sp" = service principal). Null for legacy rows. */
  authMode?: "obo" | "sp" | null;
  /** Owner email for per-user isolation. Null for legacy rows. */
  ownerEmail?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Extended Recommendation (engine-generated)
// ---------------------------------------------------------------------------

export interface GenieEngineRecommendation extends GenieSpaceRecommendation {
  benchmarks: string | null;
  columnEnrichments: string | null;
  metricViewProposals: string | null;
  semanticAssetManifest: string | null;
  /** @deprecated Preserved only when deserializing legacy trusted-function arrays. */
  trustedFunctions: string | null;
  engineConfigVersion: number;
}

// ---------------------------------------------------------------------------
// Sample Data Cache (structured data for entity extraction)
// ---------------------------------------------------------------------------

export interface SampleDataEntry {
  columns: string[];
  columnTypes: string[];
  rows: unknown[][];
}

export type SampleDataCache = Map<string, SampleDataEntry>;
