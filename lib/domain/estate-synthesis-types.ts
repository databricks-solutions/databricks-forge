/**
 * Types for the consultant-grade estate synthesis ("State of the Nation").
 *
 * The `Evidence` / `EvidenceTier` shapes mirror the Demo Research Engine
 * (`lib/demo/research-engine/types.ts`) verbatim so the UI evidence renderer and
 * the "no naked claims" contract are shared across features. They are redefined
 * here (not imported) to keep the estate domain layer decoupled from the demo
 * engine. See docs/ESTATE_INTELLIGENCE_DESIGN.md.
 */

/**
 * Tiered evidence backing a claim.
 * - sourced: a verbatim quote from a concrete artifact (table comment, lineage,
 *   history) with a locator.
 * - benchmark: a labelled industry-typical range from the master repo / outcome map.
 * - inferred: an LLM conclusion from estate metadata with a short rationale.
 */
export type EvidenceTier = "sourced" | "benchmark" | "inferred";

export interface Evidence {
  tier: EvidenceTier;
  /** Short claim text that this evidence supports. */
  claim?: string;
  // --- sourced ---
  quote?: string;
  /** Locator for the source (e.g. a table FQN, an insight id, or a URL). */
  sourceUrl?: string;
  sourceTitle?: string;
  // --- benchmark ---
  benchmarkRange?: string;
  benchmarkLabel?: string;
  // --- inferred ---
  rationale?: string;
}

/** Estate-level executive brief (Situation / Complication / Resolution). */
export interface ExecutiveBrief {
  /** 2-3 sentence shape-of-the-estate narrative. */
  estateShape: string;
  /** Top strengths in plain language. */
  strengths: string;
  /** The most critical risks. */
  criticalRisks: string;
  /** Quick wins available now. */
  quickWins: string;
  /** Strategic recommendations. */
  strategicRecommendations: string;
  situationComplicationResolution: {
    situation: string;
    complication: string;
    resolution: string;
  };
  evidence: Evidence[];
}

/** The Forge engine a finding routes to. */
export type EstateActionEngine =
  | "opportunities"
  | "comments"
  | "genie"
  | "data-gap"
  | "waf"
  | "business-value";

export interface EstateAction {
  engine: EstateActionEngine;
  /** Button label, e.g. "Document this domain". */
  label: string;
  /** Relative href the CTA navigates to. */
  href: string;
  /** Optional structured params (e.g. domain, scanId) for the target surface. */
  params?: Record<string, string | number | boolean | null>;
}

export type EstateFindingKind =
  | "opportunity"
  | "documentation_gap"
  | "query_ready_domain"
  | "coverage_gap"
  | "well_architected_gap"
  | "value_quantification"
  | "governance_risk"
  | "freshness_risk"
  | "fragmentation";

export type EstateFindingSeverity = "critical" | "high" | "medium" | "low" | "positive";

export interface EstateFinding {
  id: string;
  kind: EstateFindingKind;
  severity: EstateFindingSeverity;
  title: string;
  summary: string;
  evidence: Evidence[];
  action: EstateAction;
}

/** The six consultant sub-scores plus the overall readiness. */
export interface EstateScores {
  governance: number;
  quality: number;
  freshness: number;
  documentation: number;
  analyticsMaturity: number;
  cost: number;
  overall: number;
  band: "leading" | "established" | "developing" | "nascent";
}

export interface EstateValueAtRisk {
  low: number;
  mid: number;
  high: number;
  /** Currency code, default USD. */
  currency: string;
}

/** The full synthesis result persisted to ForgeEstateSynthesis. */
export interface EstateSynthesisResult {
  brief: ExecutiveBrief;
  findings: EstateFinding[];
  scores: EstateScores;
  valueAtRisk: EstateValueAtRisk | null;
  passResults: Record<string, "success" | "failed" | "skipped">;
}

export function readinessBandForScore(score: number): EstateScores["band"] {
  if (score >= 80) return "leading";
  if (score >= 60) return "established";
  if (score >= 40) return "developing";
  return "nascent";
}
