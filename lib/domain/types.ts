/**
 * Core domain types for Databricks Forge.
 *
 * These types are shared across the entire application: API routes,
 * pipeline steps, UI components, and persistence.
 */

import type { CommentOutputLanguage } from "@/lib/ai/comment-engine/types";

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export enum PipelineStep {
  BusinessContext = "business-context",
  MetadataExtraction = "metadata-extraction",
  AssetDiscovery = "asset-discovery",
  TableFiltering = "table-filtering",
  UsecaseGeneration = "usecase-generation",
  DomainClustering = "domain-clustering",
  Scoring = "scoring",
  SqlGeneration = "sql-generation",
  BusinessValueAnalysis = "business-value-analysis",
  GenieRecommendations = "genie-recommendations",
}

export type RunStatus = "pending" | "queued" | "running" | "completed" | "failed" | "cancelled";

export type Operation = "Discover Usecases" | "Re-generate SQL" | "Generate Sample Result";

export const BUSINESS_PRIORITIES = [
  "Increase Revenue",
  "Reduce Cost",
  "Optimize Operations",
  "Mitigate Risk",
  "Empower Talent",
  "Enhance Experience",
  "Drive Innovation",
  "Achieve ESG",
  "Protect Revenue",
  "Execute Strategy",
] as const;

export type BusinessPriority = (typeof BUSINESS_PRIORITIES)[number];

export const GENERATION_OPTIONS = [
  "SQL Code",
  "PDF Catalog",
  "Presentation",
  "dashboards",
  "Unstructured Data Usecases",
] as const;

export type GenerationOption = (typeof GENERATION_OPTIONS)[number];

export const DISCOVERY_DEPTHS = ["focused", "balanced", "comprehensive"] as const;
export type DiscoveryDepth = (typeof DISCOVERY_DEPTHS)[number];

/** Direction a lineage walk traverses from seed tables. */
export const LINEAGE_DIRECTIONS = ["upstream", "both", "downstream"] as const;
export type LineageDirection = (typeof LINEAGE_DIRECTIONS)[number];

/** Tunable parameters for a single discovery depth level. */
export interface DiscoveryDepthConfig {
  batchTargetMin: number;
  batchTargetMax: number;
  qualityFloor: number;
  adaptiveCap: number;
  lineageDepth: number;
  /**
   * Whether to walk lineage at all during a scan. Default true. Optional for
   * back-compat with settings persisted before this field existed.
   */
  lineageEnabled?: boolean;
  /**
   * Lineage walk direction. Defaults to "upstream" so scans discover a table's
   * data sources without fanning out across every downstream consumer (which
   * blows scope when a shared sample dataset is in scope). Optional for
   * back-compat with settings persisted before this field existed.
   */
  lineageDirection?: LineageDirection;
}

/** Factory defaults -- used when no user override is stored. */
export const DEFAULT_DEPTH_CONFIGS: Record<DiscoveryDepth, DiscoveryDepthConfig> = {
  focused: {
    batchTargetMin: 8,
    batchTargetMax: 12,
    qualityFloor: 0.4,
    adaptiveCap: 75,
    lineageDepth: 3,
    lineageEnabled: true,
    lineageDirection: "upstream",
  },
  balanced: {
    batchTargetMin: 12,
    batchTargetMax: 18,
    qualityFloor: 0.3,
    adaptiveCap: 150,
    lineageDepth: 5,
    lineageEnabled: true,
    lineageDirection: "upstream",
  },
  comprehensive: {
    batchTargetMin: 15,
    batchTargetMax: 22,
    qualityFloor: 0.2,
    adaptiveCap: 250,
    lineageDepth: 10,
    lineageEnabled: true,
    lineageDirection: "upstream",
  },
};

// ---------------------------------------------------------------------------
// Pipeline Run
// ---------------------------------------------------------------------------

export interface PipelineRunConfig {
  businessName: string;
  ucMetadata: string;
  excludedScope: string;
  exclusionPatterns: string;
  operation: Operation;
  businessDomains: string;
  businessPriorities: BusinessPriority[];
  strategicGoals: string;
  additionalContext: string;
  customerMaturity: "nascent" | "developing" | "advanced";
  riskPosture: "conservative" | "balanced" | "aggressive";
  transformationHorizon: "quarter" | "half-year" | "year-plus";
  generationOptions: GenerationOption[];
  generationPath: string;
  languages: string[];
  aiModel: string;
  modelPool?: string[]; // optional list of endpoint names in the pool (for UI display)
  sampleRowsPerTable: number; // 0 = disabled, 5-50 = rows to sample per table for discovery & SQL gen
  industry: string; // industry outcome map id, empty = not selected
  discoveryDepth: DiscoveryDepth; // controls generation volume, quality floor, and adaptive cap
  depthConfig?: DiscoveryDepthConfig; // resolved parameters for the selected depth (from settings or defaults)
  estateScanEnabled: boolean; // run estate scan (environment intelligence enrichment) during metadata extraction
  assetDiscoveryEnabled: boolean; // discover existing analytics assets (Genie spaces, dashboards, metric views)
  fabricScanId?: string | null; // linked Fabric/Power BI scan for PBI-aware generation
  sourceScanId?: string | null; // when set, seed metadata from this estate scan instead of live UC extraction (Workstream C: decoupled discovery)
  largeSchemaMode?: boolean; // deprecated: adaptive column budgeting is always on
  businessValueEnabled: boolean; // run business value analysis (step 8) during pipeline execution
  outputLanguage?: CommentOutputLanguage; // natural-language output for AI-generated content (comments, use cases). Defaults to "en"
}

/** Per-step timing and metadata logged during pipeline execution. */
export interface StepLogEntry {
  step: PipelineStep;
  startedAt: string; // ISO timestamp
  completedAt?: string; // ISO timestamp
  durationMs?: number;
  error?: string;
  honestyScores?: Record<string, number>; // promptKey -> score
  itemCount?: number; // items produced/processed in this step
}

export interface PipelineRun {
  runId: string;
  config: PipelineRunConfig;
  status: RunStatus;
  currentStep: PipelineStep | null;
  progressPct: number;
  statusMessage: string | null;
  businessContext: BusinessContext | null;
  errorMessage: string | null;
  appVersion: string | null;
  promptVersions: Record<string, string> | null; // promptKey -> SHA-256 hash
  stepLog: StepLogEntry[];
  industryAutoDetected: boolean; // true when the industry was set by auto-detection, not user
  contextSources: RunContextSources | null;
  createdBy: string | null; // email of the user who created this run
  ownerEmail: string | null; // canonical owner for isolation; mirrors createdBy at create time
  createdAt: string; // ISO timestamp
  completedAt: string | null;
}

/** Enrichment provenance recorded across pipeline steps. */
export interface RunContextSources {
  benchmarks: {
    strategy: string;
    recordIds: string[];
    chunkCount: number;
  };
  outcomeMap: {
    industryId: string | null;
    sections: string[];
  };
  documents: {
    sourceIds: string[];
    kinds: string[];
    chunkCount: number;
  };
  fabric?: {
    scanId: string | null;
    datasetCount: number;
    measureCount: number;
    reportCount: number;
  };
  steps: string[];
}

// ---------------------------------------------------------------------------
// Business Context
// ---------------------------------------------------------------------------

export interface BusinessContext {
  industries: string;
  strategicGoals: string;
  businessPriorities: string;
  strategicInitiative: string;
  valueChain: string;
  revenueModel: string;
  additionalContext: string;
}

// ---------------------------------------------------------------------------
// Score Rationale & Consulting Scorecard
// ---------------------------------------------------------------------------

export interface PriorityFactors {
  roi: number;
  strategic_alignment: number;
  time_to_value: number;
  reusability: number;
}

export interface FeasibilityFactors {
  data_availability: number;
  data_accessibility: number;
  architecture_fitness: number;
  team_skills: number;
  domain_knowledge: number;
  people_allocation: number;
  budget_allocation: number;
  time_to_production: number;
}

export interface ScoreRationale {
  priority: { rationale: string; factors: PriorityFactors };
  feasibility: { rationale: string; factors: FeasibilityFactors };
  impact: { rationale: string };
}

export interface ConsultingScorecard {
  strategicAlignment: number;
  measurableValue: number;
  implementationFeasibility: number;
  evidenceStrength: number;
  novelty: number;
  boardroomDefensibility: number;
  blendedScore: number;
}

// ---------------------------------------------------------------------------
// Use Case
// ---------------------------------------------------------------------------

export type UseCaseType = "AI" | "Statistical" | "Geospatial";

export interface UseCase {
  id: string;
  runId: string;
  useCaseNo: number;
  name: string;
  type: UseCaseType;
  analyticsTechnique: string;
  statement: string;
  solution: string;
  businessValue: string;
  beneficiary: string;
  sponsor: string;
  domain: string;
  subdomain: string;
  tablesInvolved: string[]; // FQNs
  priorityScore: number;
  feasibilityScore: number;
  impactScore: number;
  overallScore: number;
  /** User-adjusted scores (null = user hasn't overridden system score) */
  userPriorityScore: number | null;
  userFeasibilityScore: number | null;
  userImpactScore: number | null;
  userOverallScore: number | null;
  scoreRationale: ScoreRationale | null;
  consultingScorecard: ConsultingScorecard | null;
  sqlCode: string | null;
  sqlStatus: string | null;
  feedback: "accepted" | "rejected" | "dismissed" | null;
  feedbackAt: string | null;
  enrichmentTags: string[] | null;
  /**
   * Canonical source-system names attributed to this use case (Phase 3.1).
   * Populated after use case generation by walking `ForgeTableLineage`
   * upstream from each `tablesInvolved` FQN to the deepest external root,
   * then pattern-matching the FQN parts + comments against the canonical
   * tech-to-system map. Null when never resolved (e.g. legacy runs or
   * runs without a scan + no opportunistic walk).
   */
  sourceSystems: string[] | null;
  /**
   * Provenance of the source-systems attribution. Used by the UI to
   * communicate confidence on derived chips:
   *   - "lineage"  — at least one entry came from walking system.access.table_lineage
   *   - "naming"   — derived purely from FQN tokens (catalog/schema/table)
   *   - "comment"  — derived from table comments
   *   - "mixed"    — combination of the above
   * Null when `sourceSystems` is null.
   */
  sourceSystemsOrigin: "lineage" | "naming" | "comment" | "mixed" | null;
  /**
   * Aggregate downstream blast-radius summary (Phase 3.2). Populated after
   * scoring by walking `ForgeTableLineage` downstream from each
   * `tablesInvolved` FQN and counting distinct downstream consumer tables
   * grouped by `LineageEdge.entityType`. Drives the "blast radius" badge
   * on use case cards and the BV stakeholder "high visibility" flag.
   *
   * Null when never resolved or when the use case touches no tables.
   */
  blastRadius: BlastRadiusSummary | null;
  /**
   * Verbatim copy of the closest matching master-repository use case title
   * for this run's industry. Provides a hard FK from the customer's LLM-
   * generated UC into the master-repo namespace so the Data Gap engine
   * (and any future surface) can join on equality instead of name-based
   * fuzzy matching.
   *
   * Populated by:
   *   - Use case generation: the LLM emits this in the same JSON response.
   *   - Lazy backfill: when Data Gap is opened on a legacy run that has no
   *     value yet, a one-shot LLM call maps every UC and persists the
   *     result here.
   *
   * Null when the LLM judged no master-repo UC was a meaningful match, or
   * when neither populator has run yet.
   */
  referenceUseCaseName: string | null;
  /**
   * Timestamp of the last time `referenceUseCaseName` was written. Used by
   * the Data Gap cache invalidator to discard caches that pre-date a
   * backfill so the next compute serves fresh dollars and coverage.
   */
  referenceUseCaseResolvedAt: string | null;
}

/**
 * Aggregate downstream blast-radius summary for a use case.
 *
 * Currently counts distinct downstream *tables* per entity-type. Dashboard
 * / query-only consumers (where the lineage edge has a non-table target)
 * are not captured today because the lineage query filters out edges with
 * `target_table_full_name IS NULL`. The `dashboardCount` slot is reserved
 * for the future extension that lifts that filter.
 */
export interface BlastRadiusSummary {
  /** Total distinct downstream tables reached from this use case's tables. */
  downstreamTableCount: number;
  /** Count of edges grouped by `LineageEdge.entityType`. */
  byEntityType: {
    job: number;
    notebook: number;
    pipeline: number;
    dashboard: number;
    other: number;
  };
  /** Sum of `LineageEdge.eventCount` across all downstream edges. */
  totalEventCount: number;
  /**
   * The additive boost applied to `feasibilityScore` (and propagated into
   * `overallScore` via re-blending). In [0, 0.15]. Stored so the UI can
   * show "boosted by lineage proof" tooltips without re-computing.
   */
  feasibilityBoost: number;
}

export type UseCaseFeedback = "accepted" | "rejected" | "dismissed";

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export interface TableInfo {
  catalog: string;
  schema: string;
  tableName: string;
  fqn: string; // catalog.schema.table
  tableType: string;
  dataSourceFormat?: string | null;
  comment: string | null;
  discoveredVia?: "selected" | "lineage";
}

export interface ColumnInfo {
  tableFqn: string;
  columnName: string;
  dataType: string;
  ordinalPosition: number;
  isNullable: boolean;
  comment: string | null;
}

export interface ForeignKey {
  constraintName: string;
  tableFqn: string;
  columnName: string;
  referencedTableFqn: string;
  referencedColumnName: string;
}

export interface MetricViewInfo {
  catalog: string;
  schema: string;
  name: string;
  fqn: string; // catalog.schema.metric_view
  comment: string | null;
}

export interface MetadataSnapshot {
  cacheKey: string;
  ucPath: string;
  tables: TableInfo[];
  columns: ColumnInfo[];
  foreignKeys: ForeignKey[];
  metricViews: MetricViewInfo[];
  /** @deprecated No longer eagerly computed. Use buildSchemaMarkdown() on demand. */
  schemaMarkdown?: string;
  tableCount: number;
  columnCount: number;
  cachedAt: string; // ISO timestamp
  lineageDiscoveredFqns: string[];
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type ExportFormat = "excel" | "pdf" | "pptx" | "notebooks" | "csv" | "json";

export interface ExportRecord {
  exportId: string;
  runId: string;
  format: ExportFormat;
  filePath: string;
  createdAt: string; // ISO timestamp
}

// ---------------------------------------------------------------------------
// Pipeline Step Context (passed between steps)
// ---------------------------------------------------------------------------

export interface PipelineContext {
  run: PipelineRun;
  metadata: MetadataSnapshot | null;
  filteredTables: string[]; // FQNs of business-relevant tables
  useCases: UseCase[];
  lineageGraph: LineageGraph | null;
  /** Cached sample rows from data sampling, keyed by table FQN. Used by Genie Engine for entity extraction. */
  sampleData: import("@/lib/genie/types").SampleDataCache | null;
  /** Existing analytics assets discovered in the workspace (null when asset discovery is disabled). */
  discoveryResult: import("@/lib/discovery/types").DiscoveryResult | null;
  /** Abort signal for pipeline cancellation. Checked between steps and before LLM calls. */
  signal?: AbortSignal;
  /** Scoped logger carrying origin/task/runId context. Injected by the pipeline engine. */
  logger?: import("@/lib/logger").ScopedLogger;
  /**
   * Owner of this run, used by background passes for ACL-aware retrieval
   * and per-user fairness accounting (Phase 5b/5c). Mirrors `run.ownerEmail`
   * but is also threaded through to long-running engines so the user
   * context survives across spawned tasks.
   */
  ownerEmail?: string | null;
  /**
   * On-behalf-of OAuth access token captured at run start. Required by
   * Genie Conversation API and any other call that must run as the user.
   * Null when running purely with service-principal credentials (e.g.
   * scheduled background work).
   */
  oboToken?: string | null;
}

// ---------------------------------------------------------------------------
// Environment Scan — enriched metadata intelligence
// ---------------------------------------------------------------------------

/** Extended table metadata from DESCRIBE DETAIL + enrichment. */
export interface TableDetail {
  /** Core identity (same as TableInfo) */
  catalog: string;
  schema: string;
  tableName: string;
  fqn: string;
  tableType: string;
  comment: string | null;

  /** DESCRIBE DETAIL fields + statistics */
  sizeInBytes: number | null;
  numFiles: number | null;
  numRows: number | null; // from DESCRIBE TABLE EXTENDED Statistics, or spark.sql.statistics.numRows fallback
  format: string | null; // delta, parquet, csv, etc.
  partitionColumns: string[];
  clusteringColumns: string[];
  location: string | null;
  owner: string | null;
  provider: string | null;
  isManaged: boolean; // heuristic from DESCRIBE DETAIL; overridden by isManagedLocation when available
  deltaMinReaderVersion: number | null;
  deltaMinWriterVersion: number | null;
  createdAt: string | null; // ISO timestamp
  lastModified: string | null; // ISO timestamp
  tableProperties: Record<string, string>;

  /** DESCRIBE TABLE EXTENDED fields */
  createdBy: string | null;
  lastAccess: string | null; // raw value from UC, may be "UNKNOWN"
  isManagedLocation: boolean | null; // ground truth from UC (replaces isManaged heuristic)

  /** How this table was found */
  discoveredVia: "selected" | "lineage";

  /** LLM-derived fields (filled by intelligence layer) */
  dataDomain: string | null;
  dataSubdomain: string | null;
  dataTier: DataTier | null;
  /** LLM rationale for the assigned tier (previously discarded). */
  tierReasoning?: string | null;
  generatedDescription: string | null;
  sensitivityLevel: SensitivityLevel | null;
  governancePriority: GovernancePriority | null;
  /**
   * The LLM GovernanceGap.overallScore for this table (0-100). NOT the
   * rule-based health score. Filled by the intelligence layer / persisted from
   * governance_gap insights. See docs/ESTATE_INTELLIGENCE_DESIGN.md bug 1.
   */
  governanceScore?: number | null;
  /** Industry Master Repo data-asset mapping (enables estate-scope data-gap). */
  dataAssetId?: string | null;
  dataAssetName?: string | null;
}

export type DataTier = "bronze" | "silver" | "gold" | "system";
export type SensitivityLevel = "public" | "internal" | "confidential" | "restricted";
export type GovernancePriority = "critical" | "high" | "medium" | "low";

/** Aggregated history insights derived from DESCRIBE HISTORY. */
export interface TableHistorySummary {
  tableFqn: string;
  lastWriteTimestamp: string | null;
  lastWriteOperation: string | null;
  lastWriteRows: number | null; // numOutputRows from the latest write's operationMetrics
  lastWriteBytes: number | null; // numOutputBytes from the latest write's operationMetrics
  totalWriteOps: number;
  totalStreamingOps: number;
  totalOptimizeOps: number;
  totalVacuumOps: number;
  totalMergeOps: number;
  lastOptimizeTimestamp: string | null;
  lastVacuumTimestamp: string | null;
  hasStreamingWrites: boolean;
  historyDays: number;
  topOperations: Record<string, number>;
}

/** A single lineage edge from system.access.table_lineage. */
export interface LineageEdge {
  sourceTableFqn: string;
  targetTableFqn: string;
  sourceType: string; // TABLE, VIEW, STREAMING_TABLE, etc.
  targetType: string;
  lastEventTime: string | null;
  entityType: string | null; // JOB, NOTEBOOK, PIPELINE, etc.
  eventCount: number;
}

/** Full lineage context for a scan. */
export interface LineageGraph {
  edges: LineageEdge[];
  seedTables: string[];
  discoveredTables: string[];
  upstreamDepth: number;
  downstreamDepth: number;
  /** Seed tables skipped (e.g. shared sample catalogs) and never walked from. */
  skippedSeeds?: string[];
}

/** A Unity Catalog table tag. */
export interface TableTag {
  tableFqn: string;
  tagName: string;
  tagValue: string;
}

/** A Unity Catalog column tag. */
export interface ColumnTag {
  tableFqn: string;
  columnName: string;
  tagName: string;
  tagValue: string;
}

// ---------------------------------------------------------------------------
// LLM Intelligence Types
// ---------------------------------------------------------------------------

/** A business domain assigned to a group of tables. */
export interface DataDomain {
  domain: string;
  subdomain: string;
  tables: string[]; // FQNs
  description: string;
}

/** PII/sensitive data classification per column. */
export interface SensitivityClassification {
  tableFqn: string;
  columnName: string;
  classification: "PII" | "Financial" | "Health" | "Authentication" | "Internal" | "Public";
  confidence: "high" | "medium" | "low";
  reason: string;
  regulation: string | null; // GDPR, HIPAA, PCI-DSS, etc.
}

/** Inferred foreign key from column naming patterns. */
export interface ImplicitRelationship {
  sourceTableFqn: string;
  sourceColumn: string;
  targetTableFqn: string;
  targetColumn: string;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

/** Two tables that appear to be duplicates or near-duplicates. */
export interface RedundancyPair {
  tableA: string;
  tableB: string;
  similarityPercent: number;
  sharedColumns: string[];
  reason: string;
  recommendation: "consolidate" | "archive" | "investigate";
}

/** A logical grouping of tables forming a data product. */
export interface DataProduct {
  productName: string;
  description: string;
  tables: string[];
  primaryDomain: string;
  maturityLevel: "raw" | "curated" | "productised";
  ownerHint: string | null;
}

/** Per-table governance gap assessment. */
export interface GovernanceGap {
  tableFqn: string;
  overallScore: number; // 0-100
  gaps: Array<{
    category:
      | "documentation"
      | "ownership"
      | "sensitivity"
      | "access_control"
      | "maintenance"
      | "lineage"
      | "tagging";
    severity: "critical" | "high" | "medium" | "low";
    detail: string;
    recommendation: string;
  }>;
}

/** Analytics maturity assessment from LLM pass 9. */
export interface AnalyticsMaturityAssessment {
  overallScore: number;
  level: "nascent" | "developing" | "established" | "advanced";
  dimensions: {
    coverage: { score: number; summary: string };
    depth: { score: number; summary: string };
    freshness: { score: number; summary: string };
    completeness: { score: number; summary: string };
  };
  uncoveredDomains: string[];
  topRecommendations: Array<{
    priority: number;
    action: string;
    impact: "high" | "medium" | "low";
    effort: "high" | "medium" | "low";
  }>;
}

// ---------------------------------------------------------------------------
// Estate Ontology (Workstream B): canonical entities + relationships
// ---------------------------------------------------------------------------

/**
 * A canonical business entity (e.g. "Well", "Cargo", "Trade") synthesised
 * from the physical tables that represent it. The ontology layer that the
 * C-level Estate Overview renders: domain -> data product -> entity -> table.
 */
export interface CanonicalEntity {
  /** Canonical entity name, e.g. "Well", "Cargo", "Refinery Unit". */
  name: string;
  /** Business domain this entity belongs to (from domain categorisation). */
  domain: string;
  /** One-line plain-language description for an executive audience. */
  description: string;
  /** Physical table FQNs that represent this entity. */
  tables: string[];
  /** Best-effort medallion tier mix across the entity's tables. */
  tierMix?: Partial<Record<DataTier, number>>;
  /** 0-100 readiness score (tier + governance + freshness blend). */
  readinessScore?: number;
  readiness?: "ready" | "needs_work" | "missing";
}

/** A relationship between two canonical entities (derived, not per-table). */
export interface EntityRelationship {
  sourceEntity: string;
  targetEntity: string;
  /** How the relationship was established. */
  via: "foreign_key" | "lineage" | "inferred";
  /** Number of underlying table-level links supporting this edge. */
  edgeCount: number;
}

/** A business glossary term surfaced from the estate. */
export interface BusinessGlossaryTerm {
  term: string;
  definition: string;
  /** Related canonical entity names, if any. */
  relatedEntities?: string[];
}

/** Result of the estate ontology pass. */
export interface EstateOntology {
  entities: CanonicalEntity[];
  relationships: EntityRelationship[];
  glossary: BusinessGlossaryTerm[];
}

/** Per-table health insight (rule-based, not LLM). */
export interface TableHealthInsight {
  tableFqn: string;
  healthScore: number; // 0-100
  issues: string[];
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// Environment Scan Record
// ---------------------------------------------------------------------------

/** Top-level scan record linking all enrichment data. */
export interface EnvironmentScan {
  scanId: string;
  runId: string | null; // null for standalone scans
  ucPath: string;
  /** Scope exclusions used for this scan (persisted for reproducibility). */
  excludedScope?: string | null;
  exclusionPatterns?: string | null;
  /** Inclusion glob patterns used for this scan (persisted for reproducibility). */
  inclusionPatterns?: string | null;
  /** Provenance for cross-team / cross-workspace portfolio roll-up (V2). */
  workspaceId?: string | null;
  teamLabel?: string | null;
  scannedAt: string; // ISO timestamp
  tableCount: number;
  totalSizeBytes: number;
  totalFiles: number;
  totalRows: number; // sum of numRows across all tables (where available)
  tablesWithStreaming: number;
  tablesWithCDF: number;
  tablesNeedingOptimize: number;
  tablesNeedingVacuum: number;
  lineageDiscoveredCount: number;
  domainCount: number;
  piiTablesCount: number;
  redundancyPairsCount: number;
  dataProductCount: number;
  avgGovernanceScore: number;
  genieSpaceCount: number;
  dashboardCount: number;
  metricViewCount: number;
  analyticsCoveragePercent: number;
  scanDurationMs: number;
  passResults: Record<string, "success" | "failed" | "skipped">;
  /**
   * Optional estate-level rollup persisted as scan_summary_json: metadata
   * quality coverage, tier distribution, entity/relationship counts, and
   * the overall readiness band. Drives the C-level Estate Overview.
   */
  scanSummary?: EstateScanSummary | null;
  /**
   * Durability status. `running` = an in-progress checkpoint, `failed` = the
   * scan crashed mid-flight, `complete` = fully saved. Only `complete` scans
   * count toward estate aggregates, Excel, Portfolio, and reconstitution.
   * Legacy rows (written before this column) default to `complete`.
   */
  scanStatus?: "running" | "complete" | "failed";
}

/** Estate-level rollup stored in ForgeEnvironmentScan.scanSummaryJson. */
export interface EstateScanSummary {
  qualityCoverage?: {
    tableCount: number;
    tablesWithCommentPct: number;
    columnsWithCommentPct: number;
    tablesWithTagsPct: number;
    tablesWithOwnerPct: number;
    tablesWithTierPct: number;
    tablesWithDomainPct: number;
  };
  tierDistribution?: {
    bronze: number;
    silver: number;
    gold: number;
    system?: number;
    unknown: number;
  };
  ontology?: {
    entityCount: number;
    relationshipCount: number;
    glossaryTermCount: number;
  };
  /** Deployed estate assets beyond tables — key C-level signals. */
  assets?: {
    models: number;
    functions: number;
    genieSpaces: number;
    dashboards: number;
    metricViews: number;
  };
  /** Overall estate readiness (0-100) and band. */
  readinessScore?: number;
  readiness?: "ready" | "needs_work" | "missing";
}

/** Aggregated results from all intelligence passes. */
export interface IntelligenceResult {
  domains: DataDomain[];
  sensitivities: SensitivityClassification[];
  generatedDescriptions: Map<string, string>; // fqn -> description
  redundancies: RedundancyPair[];
  implicitRelationships: ImplicitRelationship[];
  tierAssignments: Map<string, { tier: DataTier; reasoning: string }>;
  dataProducts: DataProduct[];
  governanceGaps: GovernanceGap[];
  analyticsMaturity: AnalyticsMaturityAssessment | null;
  passResults: Record<string, "success" | "failed" | "skipped">;
}

// ---------------------------------------------------------------------------
// ERD Types
// ---------------------------------------------------------------------------

/** A table node in the ERD graph. */
export interface ERDNode {
  tableFqn: string;
  displayName: string;
  description: string | null;
  columns: Array<{
    name: string;
    type: string;
    description: string | null;
    isPK: boolean;
    isFK: boolean;
  }>;
  domain: string | null;
  tier: DataTier | null;
  hasPII: boolean;
  size: number | null;
  rowCount: number | null;
  x: number;
  y: number;
}

/** A relationship edge in the ERD graph. */
export interface ERDEdge {
  id: string;
  source: string; // table FQN
  target: string; // table FQN
  edgeType: "fk" | "implicit" | "lineage";
  sourceColumn?: string;
  targetColumn?: string;
  label: string;
  confidence?: "high" | "medium" | "low";
  entityType?: string; // for lineage: JOB, NOTEBOOK, etc.
}

/** Complete ERD graph. */
export interface ERDGraph {
  nodes: ERDNode[];
  edges: ERDEdge[];
  domains: string[];
  stats: {
    fkCount: number;
    implicitCount: number;
    lineageCount: number;
  };
}

// ---------------------------------------------------------------------------
// Business Value Types
// ---------------------------------------------------------------------------

export type ValueType = "cost_savings" | "revenue_uplift" | "risk_reduction" | "efficiency_gain";
export type ValueConfidence = "low" | "medium" | "high";
export type RoadmapPhase = "quick_wins" | "foundation" | "transformation";
export type EffortEstimate = "xs" | "s" | "m" | "l" | "xl";
export type TrackingStage = "discovered" | "planned" | "in_progress" | "delivered" | "measured";
export type StrategyGapType = "supported" | "partial" | "blocked" | "unmatched";

export interface ValueEstimate {
  id: string;
  runId: string;
  useCaseId: string;
  valueLow: number;
  valueMid: number;
  valueHigh: number;
  currency: string;
  valueType: ValueType;
  confidence: ValueConfidence;
  rationale: string | null;
  assumptions: string[];
  industryBenchmark: string | null;
  // Optional Master Repository v2 economic-pattern grounding.
  economicPatternName: string | null;
  economicImpactCategory: string | null;
  economicFormulaVars: Record<string, number | string> | null;
}

export interface RoadmapPhaseAssignment {
  id: string;
  runId: string;
  useCaseId: string;
  phase: RoadmapPhase;
  phaseOrder: number;
  effortEstimate: EffortEstimate | null;
  dependencies: string[];
  enablers: string[];
  rationale: string | null;
  manualOverride: boolean;
}

export interface UseCaseTrackingEntry {
  id: string;
  runId: string;
  useCaseId: string;
  stage: TrackingStage;
  assignedOwner: string | null;
  plannedDate: string | null;
  startedDate: string | null;
  deliveredDate: string | null;
  measuredDate: string | null;
  notes: Array<{ text: string; author?: string; createdAt: string }>;
}

export interface ValueCaptureEntry {
  id: string;
  runId: string;
  useCaseId: string;
  captureDate: string;
  valueType: ValueType;
  amount: number;
  currency: string;
  evidence: string | null;
  capturedBy: string | null;
}

export interface StrategyInitiative {
  index: number;
  name: string;
  description: string;
  expectedOutcomes: string[];
  dataRequirements: string[];
}

export interface StrategyDocument {
  id: string;
  title: string;
  rawContent: string;
  parsedInitiatives: StrategyInitiative[];
  alignmentScore: number | null;
  status: "draft" | "analyzed" | "archived";
}

export interface StrategyAlignmentEntry {
  id: string;
  strategyId: string;
  runId: string;
  initiativeIndex: number;
  useCaseId: string | null;
  confidence: number;
  gapType: StrategyGapType | null;
  notes: string | null;
}

export interface StakeholderProfile {
  id: string;
  runId: string;
  role: string;
  department: string;
  useCaseCount: number;
  totalValue: number;
  domains: string[];
  useCaseTypes: Record<string, number>;
  useCaseIds: string[];
  changeComplexity: "low" | "medium" | "high" | null;
  isChampion: boolean;
  isSponsor: boolean;
  championRationale: string | null;
  complexityRationale: string | null;
  keyRisks: string[];
}

export interface ExecutiveSynthesis {
  keyFindings: Array<{
    title: string;
    description: string;
    domain: string | null;
    severity: "opportunity" | "risk" | "insight";
  }>;
  strategicRecommendations: Array<{
    title: string;
    description: string;
    priority: "high" | "medium" | "low";
  }>;
  riskCallouts: Array<{
    title: string;
    description: string;
    impact: "high" | "medium" | "low";
  }>;
  totalEstimatedValue: {
    low: number;
    mid: number;
    high: number;
    currency: string;
  };
  quickWinCount: number;
  topDomain: string | null;
}

/** Portfolio-level aggregation across all runs. */
export interface BusinessValuePortfolio {
  totalUseCases: number;
  totalEstimatedValue: { low: number; mid: number; high: number; currency: string };
  byStage: Record<TrackingStage, number>;
  byPhase: Record<RoadmapPhase, { count: number; valueMid: number }>;
  byDomain: Array<{
    domain: string;
    useCaseCount: number;
    valueMid: number;
    avgFeasibility: number;
    avgScore: number;
  }>;
  deliveredValue: number;
  latestSynthesis: ExecutiveSynthesis | null;
}
