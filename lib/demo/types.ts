/**
 * Shared types for the Demo Mode feature.
 *
 * Used by both the Research Engine and Data Engine, plus the wizard UI
 * and API routes. Types specific to each engine live in their own
 * `types.ts` module.
 */

// ---------------------------------------------------------------------------
// Research Quality Presets
// ---------------------------------------------------------------------------

export type ResearchPreset = "quick" | "balanced" | "full";

export interface ResearchBudget {
  /** Which source-gathering passes to run. */
  sources: ("website" | "strategic-crawl" | "ir-discovery" | "sec-edgar" | "user-docs")[];
  /** Which analytical passes to run (empty for quick -- uses quick-synthesis instead). */
  analyticalPasses: (
    | "industry-landscape"
    | "company-deep-dive"
    | "data-strategy-mapping"
    | "demo-narrative"
    | "strategy-and-narrative"
    | "quick-synthesis"
    | "key-quotes-extraction"
    | "source-summaries"
    | "persona-talk-track"
    | "evidence-linking"
  )[];
  /** Max output tokens per analytical pass. */
  maxTokensPerPass: number;
  /** LLM tier for analytical passes -- controls speed vs quality trade-off. */
  modelTier: "reasoning" | "generation" | "classification";
  /** Estimated wall-clock seconds (min/max). */
  estimatedSeconds: { min: number; max: number };
}

// Quick: synthesis + best-effort RAG evidence-linking (no LLM).
const QUICK_BUDGET: ResearchBudget = {
  sources: ["website"],
  analyticalPasses: ["quick-synthesis", "evidence-linking"],
  maxTokensPerPass: 8_192,
  modelTier: "classification",
  estimatedSeconds: { min: 25, max: 55 },
};

// Balanced: Phase-1 fan-out (landscape || key-quotes || source-summaries)
// then strategy-and-narrative, then Phase-5 fan-out (persona || evidence-linking).
const BALANCED_BUDGET: ResearchBudget = {
  sources: ["strategic-crawl", "ir-discovery"],
  analyticalPasses: [
    "industry-landscape",
    "key-quotes-extraction",
    "source-summaries",
    "strategy-and-narrative",
    "persona-talk-track",
    "evidence-linking",
  ],
  maxTokensPerPass: 16_000,
  modelTier: "generation",
  estimatedSeconds: { min: 75, max: 180 },
};

// Full: Phase-1 fan-out, deep-dive, data-strategy, demo-narrative, Phase-5 fan-out.
const FULL_BUDGET: ResearchBudget = {
  sources: ["strategic-crawl", "ir-discovery", "sec-edgar", "user-docs"],
  analyticalPasses: [
    "industry-landscape",
    "key-quotes-extraction",
    "source-summaries",
    "company-deep-dive",
    "data-strategy-mapping",
    "demo-narrative",
    "persona-talk-track",
    "evidence-linking",
  ],
  maxTokensPerPass: 32_000,
  modelTier: "reasoning",
  estimatedSeconds: { min: 180, max: 300 },
};

const RESEARCH_BUDGETS: Record<ResearchPreset, ResearchBudget> = {
  quick: QUICK_BUDGET,
  balanced: BALANCED_BUDGET,
  full: FULL_BUDGET,
};

export function resolveResearchBudget(preset: ResearchPreset): ResearchBudget {
  return RESEARCH_BUDGETS[preset];
}

// ---------------------------------------------------------------------------
// Demo Data Bands
// ---------------------------------------------------------------------------

/** Default row count band for standard demo runs (per fact table). */
export const DEMO_STANDARD_ROW_BAND = { min: 2_000, max: 10_000 } as const;

/** Default table count band for standard demo runs. */
export const DEMO_STANDARD_TABLE_BAND = { min: 8, max: 12 } as const;

/**
 * Row count band when Genie Mode is on. Higher cardinality gives Genie more
 * data to group / slice / aggregate, which makes the demo feel production-grade.
 */
export const DEMO_GENIE_ROW_BAND = { min: 8_000, max: 50_000 } as const;

/**
 * Table count band when Genie Mode is on. Richer star schemas (more dimensions
 * + multiple facts) let Genie show off joins, drill-downs, and role-playing
 * dimensions.
 */
export const DEMO_GENIE_TABLE_BAND = { min: 12, max: 18 } as const;

// ---------------------------------------------------------------------------
// Demo Scope
// ---------------------------------------------------------------------------

export interface DemoScope {
  /** Business division or subsidiary. E.g. "Aluminium Division", "Wealth Management". */
  division?: string;
  /** Sub-vertical from the industry outcome map. E.g. "Retail Banking", "Digital / Neobank". */
  subVertical?: string;
  /** Functional focus areas (multi-select). Filters data assets by assetFamily. */
  functionalFocus?: string[];
  /** Specific departments the demo targets (free text tags). */
  departments?: string[];
  /** Free-text description of what the demo should emphasise. */
  demoObjective?: string;
}

export interface ResolvedDemoScope extends DemoScope {
  /** Asset families resolved from departments + functionalFocus. */
  resolvedAssetFamilies: string[];
  /** Divisions/subsidiaries discovered from source material (Pass 5). */
  suggestedDivisions?: string[];
}

// ---------------------------------------------------------------------------
// Source & Document Types
// ---------------------------------------------------------------------------

export type ResearchSourceType = "website" | "investor-doc" | "sec-filing" | "upload" | "paste";

export interface ResearchSource {
  type: ResearchSourceType;
  title: string;
  url?: string;
  charCount: number;
  status: "pending" | "fetching" | "ready" | "failed";
  error?: string;
  /** ISO 8601 publication/last-modified timestamp, if detected. */
  publishedAt?: string;
  /** 4-digit publication year shortcut (mirrors publishedAt). */
  publishedYear?: number;
  /** How confident we are in the detected date.
   *  high    - structured signal (sitemap lastmod, SEC filingDate, meta tags, JSON-LD)
   *  medium  - URL / filename year regex
   *  low     - text-body scan of first 500 chars
   *  unknown - no signal available */
  dateConfidence?: "high" | "medium" | "low" | "unknown";
}

export interface ParsedDocument {
  filename: string;
  mimeType: string;
  text: string;
  charCount: number;
  category: "strategy" | "data-architecture" | "rfp" | "annual-report" | "other";
}

// ---------------------------------------------------------------------------
// Demo Session (matches ForgeDemoSession in Prisma)
// ---------------------------------------------------------------------------

export type DemoSessionStatus =
  | "draft"
  | "researching"
  | "designing"
  | "generating"
  | "completed"
  | "failed";

export interface DemoSessionSummary {
  sessionId: string;
  customerName: string;
  industryId: string;
  researchPreset: ResearchPreset;
  catalogName: string;
  schemaName: string;
  status: DemoSessionStatus;
  tablesCreated: number;
  totalRows: number;
  durationMs: number;
  createdAt: string;
  completedAt: string | null;
  ownerEmail?: string | null;
}

// ---------------------------------------------------------------------------
// Data Narratives & Table Design
// ---------------------------------------------------------------------------

export interface DataNarrative {
  title: string;
  description: string;
  affectedTables: string[];
  pattern: "spike" | "trend" | "anomaly" | "seasonal" | "correlation";
}

export interface TableColumn {
  name: string;
  dataType: string;
  description: string;
  role: "pk" | "fk" | "measure" | "dimension" | "timestamp" | "flag";
  fkTarget?: string;
}

export interface TableDesign {
  name: string;
  assetId: string;
  description: string;
  tableType: "dimension" | "fact";
  columns: TableColumn[];
  rowTarget: number;
  creationOrder: number;
  narrativeLinks: string[];
}

// ---------------------------------------------------------------------------
// Data Engine Per-Table Phase Tracking
// ---------------------------------------------------------------------------

export type TablePhase =
  | "pending"
  | "generating-sql"
  | "executing"
  | "retrying"
  | "validating"
  | "completed"
  | "failed";

export interface TableGenerationStatus {
  tableName: string;
  phase: TablePhase;
  rowCount: number;
  error?: string;
  retryCount: number;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  tableName: string;
  rowCount: number;
  fkIntegrity: { valid: boolean; orphanCount: number };
  distributionQuality: "good" | "acceptable" | "poor";
  issues: string[];
  /** Date-coverage probe for fact tables with a date/timestamp column. */
  dateCoverage?: {
    columnName: string;
    /** ISO YYYY-MM-DD. */
    minDate: string;
    /** ISO YYYY-MM-DD. */
    maxDate: string;
    rowsLast90d: number;
    /** True when the coverage is outside the configured demo window. */
    stale: boolean;
  };
}

export interface ValidationSummary {
  totalTables: number;
  passedTables: number;
  totalRows: number;
  issues: string[];
  /** Per-table validation details, surfaced to the UI and auto-fix loop. */
  results?: ValidationResult[];
}
