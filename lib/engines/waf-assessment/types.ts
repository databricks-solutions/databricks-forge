/**
 * WAF (Well-Architected Framework) Assessment — types.
 *
 * The assessment engine evaluates a Databricks workspace against the
 * Databricks WAF (7 pillars). Four pillars (governance, reliability,
 * cost, performance) have deterministic SQL queries over `system.*`.
 * The other three (interoperability/usability, operational excellence,
 * security/compliance/privacy) are catalog-only today and will gain
 * automatic + qualitative evaluation in a follow-up phase.
 */

export type WafPillar =
  | "governance"
  | "interoperability_usability"
  | "operational_excellence"
  | "security_compliance_privacy"
  | "reliability"
  | "performance_efficiency"
  | "cost_optimisation";

/** All 7 pillars, in display order. */
export const WAF_PILLARS: readonly WafPillar[] = [
  "governance",
  "interoperability_usability",
  "operational_excellence",
  "security_compliance_privacy",
  "reliability",
  "performance_efficiency",
  "cost_optimisation",
] as const;

/** Subset of pillars that have a deterministic SQL query today. */
export const WAF_PILLARS_WITH_QUERIES = [
  "governance",
  "interoperability_usability",
  "operational_excellence",
  "security_compliance_privacy",
  "reliability",
  "cost_optimisation",
  "performance_efficiency",
] as const satisfies readonly WafPillar[];

export const PILLAR_LABEL: Record<WafPillar, string> = {
  governance: "Data and AI Governance",
  interoperability_usability: "Interoperability and Usability",
  operational_excellence: "Operational Excellence",
  security_compliance_privacy: "Security, Compliance and Privacy",
  reliability: "Reliability",
  performance_efficiency: "Performance Efficiency",
  cost_optimisation: "Cost Optimisation",
};

/** Evaluation method for a control: automatic via SQL, or qualitative via questionnaire. */
export type WafEvaluationType = "automatic" | "qualitative";

/** Possible answers for a qualitative control. `not_applicable` excludes from scoring. */
export type WafQualitativeAnswer = "yes" | "partial" | "no" | "not_applicable";

/** Workspace-level qualitative response — one row per waf_id, reused across runs. */
export interface WafQualitativeResponse {
  wafId: string;
  response: WafQualitativeAnswer;
  notes: string | null;
  respondedBy: string | null;
  updatedAt: string;
}

/** Map a qualitative answer to its score (or null when N/A — excluded from totals). */
export const QUALITATIVE_SCORE: Record<WafQualitativeAnswer, number | null> = {
  yes: 100,
  partial: 50,
  no: 0,
  not_applicable: null,
};

/** Threshold applied to qualitative controls (must answer "yes" to count as met). */
export const QUALITATIVE_THRESHOLD = 100;

/** Workspace exclusion for a control (or a specific resource within a control). */
export interface WafIgnoredResource {
  id: string;
  wafId: string;
  resourceType: string | null;
  resourceId: string | null;
  reason: string;
  ignoredBy: string | null;
  createdAt: string;
}

/** Catalog entry — the curated description and recommendation for a control. */
export interface WafControl {
  wafId: string;
  pillar: WafPillar;
  pillarName: string;
  principle: string;
  bestPractice: string;
  capabilities: string | null;
  details: string | null;
  /** null for qualitative controls — score is derived from the questionnaire response. */
  thresholdPercentage: number | null;
  metricDefinition: string | null;
  recommendationIfNotMet: string | null;
  fixActionEngine: string | null;
  fixActionParamsJson: string | null;
  evaluationType: WafEvaluationType;
}

/** Per-control evaluation produced by running a pillar query. */
export interface WafControlResult {
  wafId: string;
  pillar: WafPillar;
  scorePercentage: number;
  thresholdPercentage: number;
  thresholdMet: boolean;
}

/** Assessment summary returned by the API. */
export interface WafAssessmentSummary {
  assessmentId: string;
  ownerEmail: string | null;
  status: "pending" | "running" | "completed" | "failed";
  scope: string | null;
  triggeredBy: string | null;
  governanceScore: number | null;
  iuScore: number | null;
  oeScore: number | null;
  scpScore: number | null;
  reliabilityScore: number | null;
  costScore: number | null;
  performanceScore: number | null;
  overallScore: number | null;
  totalControls: number;
  metControls: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** Full assessment with per-control results joined to the catalog. */
export interface WafAssessmentDetail extends WafAssessmentSummary {
  results: Array<WafControlResult & { control: WafControl }>;
}
