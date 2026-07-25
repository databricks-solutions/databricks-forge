/**
 * Research Engine types.
 *
 * Defines inputs, deps, result, and all intermediate analysis types
 * produced by the analytical passes.
 */

import type { LLMClient } from "@/lib/ports/llm-client";
import type { Logger } from "@/lib/ports/logger";
import type {
  DemoScope,
  ResearchPreset,
  ResolvedDemoScope,
  ParsedDocument,
  ResearchSource,
  DataNarrative,
} from "../types";

// ---------------------------------------------------------------------------
// Engine Input & Deps
// ---------------------------------------------------------------------------

export interface ResearchEngineInput {
  customerName: string;
  /** Optional -- used for embedding sourceId and cleanup. Falls back to customerName. */
  sessionId?: string;
  /** Optional -- auto-detected from sources via Pass 3.25 if blank. */
  industryId?: string;
  preset?: ResearchPreset;
  scope?: DemoScope;
  websiteUrl?: string;
  uploadedDocuments?: ParsedDocument[];
  pastedContext?: string;
  signal?: AbortSignal;
  onProgress?: (phase: ResearchPhase, percent: number, detail?: string) => void;
  onSourceReady?: (source: ResearchSource) => void;
  deps?: ResearchEngineDeps;
  /**
   * Email of the user who initiated the research. Required when the research
   * job runs in a fire-and-forget background closure so isolation rules and
   * embedding metadata stay correct.
   */
  ownerEmail?: string | null;
  /** OBO token (Databricks user OAuth) captured at request time for SP-blocked APIs. */
  oboToken?: string | null;
}

export interface ResearchEngineDeps {
  llm?: LLMClient;
  logger?: Logger;
  /** Injectable for testing (mock HTTP). */
  fetchFn?: typeof fetch;
  /** Injectable for testing (mock PDF parsing). */
  parsePdf?: (buffer: Buffer) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

export type ResearchPhase =
  | "source-collection"
  | "website-scrape"
  | "ir-discovery"
  | "doc-parsing"
  | "embedding"
  | "industry-classification"
  | "quick-synthesis"
  | "key-quotes-extraction"
  | "source-summaries"
  | "industry-landscape"
  | "strategy-and-narrative"
  | "company-deep-dive"
  | "data-strategy-mapping"
  | "demo-narrative"
  | "persona-talk-track"
  | "evidence-linking"
  | "complete";

// ---------------------------------------------------------------------------
// Tiered Evidence Model
// ---------------------------------------------------------------------------

/**
 * A tiered evidence object attached to a claim.
 *
 * - sourced: a verbatim quote from a ready research source with URL + title.
 * - benchmark: a labelled industry-typical range (e.g. "+15-25%") from the
 *   industry outcome map or master repo.
 * - inferred: an LLM-drawn conclusion from context with a short rationale.
 */
export type EvidenceTier = "sourced" | "benchmark" | "inferred";

export interface Evidence {
  tier: EvidenceTier;
  /** Short claim text that this evidence supports (optional -- some passes carry it). */
  claim?: string;
  // --- sourced ---
  quote?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  /** ISO 8601 publication date of the source (when known). */
  sourcePublishedAt?: string;
  /** 4-digit publication year (shortcut). */
  sourcePublishedYear?: number;
  // --- benchmark ---
  benchmarkRange?: string;
  benchmarkLabel?: string;
  // --- inferred ---
  rationale?: string;
}

// ---------------------------------------------------------------------------
// Pass B: Key Quotes
// ---------------------------------------------------------------------------

export type KeyQuoteTag =
  | "strategy"
  | "priorities"
  | "pain"
  | "risk"
  | "technology"
  | "customer"
  | "regulatory"
  | "financial";

export interface KeyQuote {
  quote: string;
  sourceUrl: string;
  sourceTitle: string;
  tags: KeyQuoteTag[];
}

// ---------------------------------------------------------------------------
// Pass C: Source Summaries
// ---------------------------------------------------------------------------

export interface SourceSummary {
  sourceUrl: string;
  sourceTitle: string;
  twoSentenceSummary: string;
  keyTakeaways: string[];
}

// ---------------------------------------------------------------------------
// Executive Brief (from expanded company-deep-dive / strategy-and-narrative)
// ---------------------------------------------------------------------------

export interface ExecutiveBrief {
  /** 2-3 sentence narrative about who the company is. */
  whoTheyAre: string;
  /** 2-3 sentences summarising top priorities in their own language. */
  whatTheyCareAbout: string;
  /** 2-3 sentences on specific gaps and friction points. */
  whatsLikelyBroken: string;
  /** 2-3 sentences on urgency signals (regulatory deadlines, competitive moves, M&A, etc). */
  whyNow: string;
  /** 2-3 sentences on the wedge: where Databricks wins first. */
  whereWeWin: string;
  situationComplicationResolution: {
    situation: string;
    complication: string;
    resolution: string;
  };
  evidence: Evidence[];
}

// ---------------------------------------------------------------------------
// Persona Talk Tracks (NEW -- replaces client-side hardcoded personas)
// ---------------------------------------------------------------------------

export interface TalkTrackObjection {
  objection: string;
  response: string;
  proofToUse: Evidence;
}

export interface PersonaTalkTrack {
  personaId: "ceo" | "coo" | "cio-cto" | "head-digital" | "risk-compliance" | string;
  label: string;
  caresAbout: string[];
  provocativeOpening: string;
  whatToSay: string;
  threeObjections: TalkTrackObjection[];
  discoveryTrack: string[];
  closeSignal: string;
  evidence: Evidence[];
}

// ---------------------------------------------------------------------------
// Pass 3.25: Industry Classification
// ---------------------------------------------------------------------------

export interface IndustryClassification {
  industryId: string;
  industryName: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Pass 4: Industry Landscape Analysis
// ---------------------------------------------------------------------------

export interface MarketForce {
  force: string;
  description: string;
  urgency: "accelerating" | "stable" | "emerging";
  benchmarkCitation?: string;
  impactOnSubVertical?: string;
}

export interface IndustryLandscapeAnalysis {
  marketForces: MarketForce[];
  competitiveDynamics: string;
  regulatoryPressures: string;
  technologyDisruptors: string;
  keyBenchmarks: Array<{
    metric: string;
    impact: string;
    source: string;
    kpiTarget?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Pass 5: Company Strategic Profile
// ---------------------------------------------------------------------------

export interface CompanyStrategicProfile {
  statedPriorities: Array<{ priority: string; source: string; evidence?: Evidence }>;
  inferredPriorities: Array<{ priority: string; evidence: string; evidenceObj?: Evidence }>;
  strategicGaps: Array<{ gap: string; opportunity: string; evidence?: Evidence }>;
  divisionContext?: {
    products: string[];
    markets: string[];
    challenges: string[];
    teamStructure?: string;
  };
  urgencySignals: Array<{ signal: string; date?: string; type: string }>;
  executiveLanguage: Record<string, string>;
  suggestedDivisions?: string[];
  swotSummary: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };
}

// ---------------------------------------------------------------------------
// Pass 6: Data Strategy Map
// ---------------------------------------------------------------------------

export interface DataAssetDetail {
  id: string;
  relevance: number;
  rationale: string;
  quickWin: boolean;
  criticality: "MC" | "VA";
  linkedUseCases: string[];
  benchmarkImpact?: string;
}

export interface DataStrategyMap {
  matchedDataAssetIds: string[];
  assetDetails: DataAssetDetail[];
  nomenclature: Record<string, string>;
  dataMaturityAssessment: "data-native" | "data-transforming" | "data-aspirational";
  dataMaturityEvidence: string;
  prioritisedUseCases: Array<{
    name: string;
    benchmarkImpact?: string;
    kpiTarget?: string;
    dataAssetIds: string[];
  }>;
}

// ---------------------------------------------------------------------------
// Pass 7: Demo Narrative Design
// ---------------------------------------------------------------------------

export interface QuantifiedImpact {
  low: string;
  mid: string;
  high: string;
  unit: string;
}

export interface KillerMoment {
  title: string;
  scenario: string;
  insightStatement: string;
  dataStory: string;
  expectedReaction: string;
  linkedAssets: string[];
  benchmarkCitation?: string;
  // --- Consultant-grade expansions ---
  /** Crisp problem statement in the customer's language. */
  problemStatement?: string;
  /** 3-4 sub-hypotheses that would unlock the opportunity. */
  hypothesisTree?: string[];
  /** Low / mid / high impact with unit (e.g. "$2M", "2.5M", "4M", "annualised margin"). */
  quantifiedImpact?: QuantifiedImpact;
  /** Target KPI delta (e.g. "Reduce time-to-insight from 7d to 24h"). */
  kpiDelta?: string;
  /** Required data asset IDs for this moment (subset of linkedAssets). */
  requiredDataAssets?: string[];
  /** What happens if the customer does nothing (1-2 sentences). */
  riskOfInaction?: string;
  /** 4-5 discovery questions the seller should ask. */
  discoveryQuestions?: string[];
  /** How the customer will know this worked -- the measurable signal. */
  measureOfSuccess?: string;
  /** Tiered evidence backing the quantified claim(s). */
  evidence?: Evidence[];
  /** Ideal buyer persona label (e.g. "CFO", "Head of Operations"). */
  idealBuyerPersona?: string;
  /** Time-to-value band. */
  timeToValue?: "< 90 days" | "1-2 quarters" | "strategic";
}

export interface DemoNarrativeDesign {
  killerMoments: KillerMoment[];
  demoFlow: Array<{
    step: number;
    assetId: string;
    moment: string;
    talkingPoint: string;
    transitionToNext: string;
  }>;
  executiveTalkingPoints: Array<{
    assetId: string;
    headline: string;
    benchmarkTieIn: string;
  }>;
  competitorAngles: Array<{
    competitor: string;
    theirMove: string;
    yourOpportunity: string;
  }>;
  recommendedTableOrder: string[];
  dataNarratives: DataNarrative[];
}

// ---------------------------------------------------------------------------
// Aggregated Result
// ---------------------------------------------------------------------------

export interface ResearchEngineResult {
  customerName: string;
  industryId: string;
  scope: ResolvedDemoScope;

  industryLandscape: IndustryLandscapeAnalysis | null;
  companyProfile: CompanyStrategicProfile | null;
  dataStrategy: DataStrategyMap | null;
  demoNarrative: DemoNarrativeDesign | null;

  /** Populated by all presets -- the minimum the Data Engine needs. */
  matchedDataAssetIds: string[];
  nomenclature: Record<string, string>;
  dataNarratives: DataNarrative[];

  // --- Consultant-grade additions (all optional for backward compat) ---
  /** LLM-generated 5-section exec brief. Null on Quick preset or when pass fails. */
  executiveBrief?: ExecutiveBrief | null;
  /** Per-persona talk tracks. Null on Quick preset. */
  personaTalkTracks?: PersonaTalkTrack[] | null;
  /** Per-source summaries (Sources tab). */
  sourceSummaries?: SourceSummary[];
  /** Flat bag of source-grounded key quotes used by evidence-linking. */
  keyQuotes?: KeyQuote[];

  sources: ResearchSource[];
  confidence: number;
  passTimings: Record<string, number>;
}
