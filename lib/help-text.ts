/**
 * Centralised tooltip / help-text strings.
 *
 * Keeping copy here (rather than inline in components) makes future
 * localisation straightforward and ensures consistent wording.
 */

// ── Dashboard KPIs ──────────────────────────────────────────────────
export const DASHBOARD = {
  totalRuns: "Total discovery pipeline runs across all configurations.",
  useCases: "Unique AI, statistical, and geospatial use cases generated across all completed runs.",
  avgScore:
    "Mean composite score (0–100) across feasibility, business value, innovation, and data readiness.",
  domains: "Distinct business domains identified by the AI across all use cases.",
  successRate: "Percentage of pipeline runs that completed all 8 steps without failure.",
} as const;

// ── Configure (config form) ─────────────────────────────────────────
export const CONFIG = {
  discoveryDepth:
    "Controls batch sizes, quality thresholds, and how aggressively the AI explores your metadata.",
  businessName:
    "The AI uses this to infer your industry, value chain, and revenue model for tailored recommendations.",
  industry:
    "Selecting an industry loads curated KPIs, strategic context, and reference use cases into the prompts.",
  ucMetadata:
    "Catalog or catalog.schema references that define the scope of tables the pipeline will analyse.",
  priorities:
    "Selected priorities boost the scores of aligned use cases. Unselected priorities still contribute with lower weight.",
  domains:
    "Constrain domain clustering to these domains. Leave empty and the AI will auto-detect domains from your metadata.",
  strategicGoals:
    "Free-text goals injected into the business context prompt. Leave empty for AI-generated goals.",
  estateScan:
    "Runs 8 additional LLM intelligence passes: domain classification, PII detection, redundancy, relationships, data tiers, governance, and health scoring.",
  assetDiscovery:
    "Discovers existing Genie spaces, AI/BI dashboards, and metric views in the workspace. Results are used to avoid duplicate recommendations, identify coverage gaps, and suggest improvements to existing assets.",
} as const;

// ── Runs list ───────────────────────────────────────────────────────
export const RUNS_LIST = {
  businessName: "The organisation name used as context for this discovery run.",
  ucMetadata: "The Unity Catalog catalogs and schemas scanned for this run.",
  status: "Pipeline status: pending, running, completed, or failed.",
  progress: "Percentage of the 8 pipeline steps completed.",
  useCases: "Total use cases generated after deduplication and scoring.",
  activity: "Current pipeline step or status message.",
  created: "When the pipeline run was started.",
} as const;

// ── Run detail ──────────────────────────────────────────────────────
export const RUN_DETAIL = {
  totalUseCases: "Unique use cases after deduplication, scoring, and quality filtering.",
  domainCount: "Business domains identified by the AI clustering step.",
  aiUseCases: "Use cases involving machine learning, NLP, or predictive analytics.",
  avgScore: "Mean composite score across all 4 scoring dimensions.",
  tabOverview: "Charts, scores, and business context for this run.",
  tabUseCases: "Browse, filter, and edit the generated use cases.",
  tabGenie: "AI-generated Databricks Genie Spaces for natural language SQL exploration.",
  tabDashboards: "AI-generated dashboard recommendations for BI visualisation.",
  tabOutcomeMap: "Industry outcome map alignment: coverage, gaps, and data onboarding priorities.",
  tabObservability: "Prompt logs, token usage, and LLM performance metrics for this run.",
} as const;

// ── Pipeline steps ──────────────────────────────────────────────────
export const PIPELINE_STEPS = {
  "business-context":
    "Generates industry context, value chain, and revenue model from your business name using the LLM.",
  "metadata-extraction":
    "Queries information_schema to discover tables, columns, and foreign keys in your selected catalogs.",
  "asset-discovery":
    "Discovers existing Genie spaces, AI/BI dashboards, and metric views in the workspace to avoid duplicates and identify gaps.",
  "table-filtering":
    "Classifies each table as business-relevant or technical/system using the LLM.",
  "usecase-generation":
    "Generates use cases in parallel batches, grounded in your metadata and business context.",
  "domain-clustering": "Assigns business domains and subdomains to each use case using the LLM.",
  scoring:
    "Scores use cases on 4 dimensions, deduplicates similar ones, and applies quality calibration.",
  "sql-generation":
    "Generates bespoke SQL for each use case, validated against your actual table schemas.",
  "business-value-analysis":
    "Quantifies financial value, builds implementation roadmap, generates executive synthesis, and identifies stakeholders.",
} as const;

// ── Export formats ──────────────────────────────────────────────────
export const EXPORT = {
  excel: "Multi-sheet workbook with use cases, scores, domains, and SQL.",
  pptx: "Executive-ready slides with charts and top use cases.",
  pdf: "Printable report with scoring breakdown and recommendations.",
  csv: "Flat file for programmatic consumption or BI tools.",
  json: "Structured data for API integration or custom processing.",
  notebooks:
    "Creates SQL notebooks in your Databricks workspace with generated SQL for each use case.",
  briefing: "Combined estate scan + discovery PPTX for stakeholder presentations.",
} as const;

// ── Settings ────────────────────────────────────────────────────────
export const SETTINGS = {
  sampleRows:
    "Number of sample rows fetched per table for column profiling. Higher values improve LLM accuracy but increase query time. Set to 0 for metadata only.",
  exportFormat: "Pre-selected format when exporting from a completed run.",
  notebookPath: "Workspace path prefix for deployed SQL notebooks.",
  defaultDepth: "Default depth for new runs. Can be overridden per-run in the configure form.",
  batchTarget:
    "Target number of use cases per LLM batch. Higher values mean fewer API calls but may reduce quality.",
  qualityFloor: "Minimum composite score (0–100) a use case must reach to be kept after scoring.",
  adaptiveCap: "Maximum total use cases. The pipeline stops generating once this cap is reached.",
  lineageDepth:
    "How many hops to walk in the lineage graph from each table. Higher values discover more upstream/downstream context.",
  lineageEnabled:
    "Walk the lineage graph during a scan to discover related tables. Turn off to scan only the tables you selected (recommended for shared sample datasets like samples.bakehouse).",
  lineageDirection:
    "Which way to follow lineage edges. Upstream finds a table's data sources; downstream finds its consumers (can fan out widely for shared datasets); both walks in both directions.",
  genieEngine:
    "The Genie Engine analyses your use cases and metadata to produce ready-to-deploy Databricks Genie Spaces with natural language SQL access.",
  maxTables: "Upper limit of data objects (tables + metric views) in a single Genie Space.",
  fiscalYear:
    "Month your fiscal year begins. Affects auto-generated time period filters in Genie Spaces.",
  entityMatching:
    "Controls how the engine matches entity names to table data for parameterised queries.",
  maxAutoSpaces: "Maximum number of Genie Spaces to auto-generate. Set to 0 for manual control.",
  qualityPreset:
    "Controls the speed vs richness trade-off. Speed produces lean spaces quickly with fewer LLM calls. Balanced is the recommended default. Premium generates the richest output with all review passes enabled.",
} as const;

// ── Compare page ────────────────────────────────────────────────────
export const COMPARE = {
  metricComparison:
    "Side-by-side comparison of key metrics: use case count, average score, domain count, and type distribution.",
  useCaseOverlap:
    "Identifies semantically similar use cases across the two runs based on title and description matching.",
  configDiff: "Side-by-side comparison of the configuration parameters used for each run.",
  stepComparison: "Compares step-level execution times and output counts between the two runs.",
} as const;

// ── Environment page ────────────────────────────────────────────────
export const ENVIRONMENT = {
  dataMaturity:
    "Composite score (0–100) reflecting governance, documentation, freshness, and structural quality across your data estate.",
  executiveSummary:
    "AI-generated narrative summarising key findings, risks, and recommendations from the estate scan.",
  erdView:
    "Entity-relationship diagram showing foreign key relationships and lineage connections between tables.",
  lineageEnabled:
    "Walk the lineage graph to discover related tables during this scan. Turn off to scan only the tables you selected — recommended for shared sample datasets like samples.bakehouse, which fan out across the whole metastore.",
  lineageDirection:
    "Upstream finds a table's data sources; downstream finds its consumers (can pull in far more tables for shared datasets); both walks in both directions.",
} as const;

// ── Outcomes page ───────────────────────────────────────────────────
export const OUTCOMES = {
  pageDescription:
    "Industry outcome maps define reference KPIs, strategic use cases, and domain priorities. When an industry is selected during configuration, its outcome map enriches the prompts with curated context.",
  ingestDescription:
    "Upload or paste a markdown-formatted outcome map. The AI will parse it into structured KPIs, use cases, and priorities.",
} as const;
