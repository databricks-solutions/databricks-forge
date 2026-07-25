/**
 * Types for the Genie Space Health Check engine.
 */

export type Severity = "critical" | "warning" | "info";

export type EvaluatorType =
  | "count"
  | "range"
  | "exists"
  | "length"
  | "ratio"
  | "nested_ratio"
  | "pattern"
  | "unique"
  | "no_empty_field"
  | "conditional_count"
  | "jsonpath"
  | "llm_qualitative"
  | "sql_quality"
  | "instruction_quality"
  | "casing_consistency"
  | "maturity_tier";

export type FixStrategy =
  | "column_intelligence"
  | "semantic_expressions"
  | "join_inference"
  | "trusted_assets"
  | "instruction_generation"
  | "benchmark_generation"
  | "entity_matching"
  | "sample_questions"
  | "delete_bad_synonyms"
  | "delete_bad_measures"
  | "delete_bad_joins"
  | "delete_bad_examples"
  | "replace_instructions";

export interface CategoryDefinition {
  label: string;
  weight: number;
}

export interface CheckDefinition {
  id: string;
  category: string;
  description: string;
  severity: Severity;
  fixable: boolean;
  fix_strategy?: FixStrategy;
  evaluator: EvaluatorType;
  path?: string;
  paths?: string[];
  field?: string;
  params: Record<string, unknown>;
  quick_win?: string;
  /** For conditional_count evaluator */
  condition_path?: string;
  condition_min?: number;
  /** Whether the check is enabled (default true) */
  enabled?: boolean;
  /** For llm_qualitative evaluator: the criterion to evaluate */
  quality_prompt?: string;
}

export interface CheckResult {
  id: string;
  category: string;
  description: string;
  passed: boolean;
  severity: Severity;
  detail?: string;
  fixable: boolean;
  fixStrategy?: FixStrategy;
}

export interface CategoryScore {
  label: string;
  weight: number;
  score: number;
  passed: number;
  total: number;
}

export type Grade = "A" | "B" | "C" | "D" | "F";

/**
 * Customer-facing maturity tier of a Genie Space, derived from per-check results.
 *
 * - `not_ready`        -- the space is missing critical configuration
 * - `ready_to_optimize` -- functional but not polished; safe to use carefully
 * - `trusted`          -- fully described, benchmarked, no critical findings
 *
 * Mirrors upstream `databricks-genie-workbench` IQ Scanner tiering.
 */
export type MaturityTier = "not_ready" | "ready_to_optimize" | "trusted";

export type FindingCategory = "best_practice" | "warning" | "suggestion";

export interface Finding {
  category: FindingCategory;
  severity: Severity;
  description: string;
  recommendation: string;
  reference?: string;
}

export type AssessmentCategory = "good_to_go" | "quick_wins" | "foundation_needed";

export interface CompensatingStrength {
  coveringSection: string;
  coveredSection: string;
  explanation: string;
}

export interface SynthesisResult {
  assessment: AssessmentCategory;
  assessmentRationale: string;
  compensatingStrengths: CompensatingStrength[];
  celebrationPoints: string[];
  topQuickWins: string[];
}

export interface SpaceHealthReport {
  overallScore: number;
  grade: Grade;
  /**
   * High-level customer-facing tier. Surfaced above the letter grade so users
   * can quickly answer "is this safe to deploy?".
   */
  maturityTier: MaturityTier;
  categories: Record<string, CategoryScore>;
  checks: CheckResult[];
  quickWins: string[];
  fixableCount: number;
  findings: Finding[];
  synthesis?: SynthesisResult;
}

export interface UserCheckOverride {
  checkId: string;
  enabled?: boolean;
  params?: Record<string, unknown>;
  severity?: Severity;
}

export interface UserCustomCheck {
  id: string;
  category: string;
  description: string;
  severity: Severity;
  evaluator: EvaluatorType;
  path: string;
  field?: string;
  params: Record<string, unknown>;
  quick_win?: string;
}

export interface DefaultChecksYaml {
  categories: Record<string, { label: string; weight: number }>;
  checks: Array<Record<string, unknown>>;
}
