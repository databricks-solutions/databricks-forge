/**
 * Category-Based Enhancement Analysis -- provides LLM-driven, per-category
 * analysis of benchmark failures with two-step prompting (learn from all
 * benchmarks first, then diagnose failures) and token-aware config slicing.
 *
 * Each category receives only the relevant config slice and the full benchmark
 * context, producing targeted fix recommendations.
 */

import { cachedChatCompletion } from "@/lib/toolkit/llm-cache";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { resolveEndpoint } from "@/lib/dbx/client";
import { mapWithConcurrency } from "@/lib/toolkit/concurrency";
import { logger } from "@/lib/logger";
import type { EvalResultDetail } from "./benchmark-runner";
import type { ScoreReason } from "./eval-types";
import { SCORE_REASON_LABELS } from "./eval-types";
import type { SpaceJson } from "./types";
import type { FixStrategy } from "./health-checks/types";

// ---------------------------------------------------------------------------
// Config Slicing
// ---------------------------------------------------------------------------

export type ConfigCategory =
  | "instructions"
  | "measures_filters"
  | "joins"
  | "examples"
  | "synonyms"
  | "benchmarks";

/**
 * Extract only the relevant config section for a given category.
 * Reduces token usage by sending each analysis prompt only the data it needs.
 */
export function sliceConfigForCategory(space: SpaceJson, category: ConfigCategory): string {
  const MAX_CHARS = 8_000;

  switch (category) {
    case "instructions": {
      const instructions = space.instructions?.text_instructions ?? [];
      return JSON.stringify({ text_instructions: instructions }, null, 2).slice(0, MAX_CHARS);
    }
    case "measures_filters": {
      const snippets = space.instructions?.sql_snippets ?? {};
      return JSON.stringify(
        { measures: snippets.measures ?? [], filters: snippets.filters ?? [] },
        null,
        2,
      ).slice(0, MAX_CHARS);
    }
    case "joins": {
      const joins = space.instructions?.join_specs ?? [];
      return JSON.stringify({ join_specs: joins }, null, 2).slice(0, MAX_CHARS);
    }
    case "examples": {
      const examples = space.instructions?.example_question_sqls ?? [];
      return JSON.stringify({ example_question_sqls: examples }, null, 2).slice(0, MAX_CHARS);
    }
    case "synonyms": {
      const tables = (space.data_sources?.tables ?? []) as SpaceJson[];
      const slim = tables.map((t: SpaceJson) => ({
        identifier: t.identifier,
        column_configs: ((t.column_configs ?? []) as SpaceJson[]).map((c: SpaceJson) => ({
          column_name: c.column_name ?? c.name,
          synonyms: c.synonyms,
          description: c.description,
        })),
      }));
      return JSON.stringify({ tables: slim }, null, 2).slice(0, MAX_CHARS);
    }
    case "benchmarks": {
      const benchmarks = space.benchmarks?.questions ?? [];
      return JSON.stringify({ benchmark_questions: benchmarks }, null, 2).slice(0, MAX_CHARS);
    }
  }
}

/**
 * Map fix strategies to the config categories they need for analysis.
 */
export function strategyToConfigCategory(strategy: FixStrategy): ConfigCategory {
  switch (strategy) {
    case "instruction_generation":
    case "replace_instructions":
      return "instructions";
    case "semantic_expressions":
    case "delete_bad_measures":
      return "measures_filters";
    case "join_inference":
    case "delete_bad_joins":
      return "joins";
    case "trusted_assets":
    case "delete_bad_examples":
      return "examples";
    case "column_intelligence":
    case "delete_bad_synonyms":
      return "synonyms";
    case "benchmark_generation":
      return "benchmarks";
    default:
      return "instructions";
  }
}

// ---------------------------------------------------------------------------
// Two-Step Category Analysis
// ---------------------------------------------------------------------------

export interface CategoryAnalysis {
  category: ConfigCategory;
  targetStrategies: FixStrategy[];
  diagnosis: string;
  recommendations: string[];
  affectedQuestions: string[];
}

/**
 * Build the benchmark context block shared across all category analyses.
 * Includes both passing and failing questions so the LLM can learn patterns.
 */
function buildBenchmarkContext(results: EvalResultDetail[]): string {
  const passing = results.filter((r) => r.assessment === "GOOD");
  const failing = results.filter((r) => r.assessment !== "GOOD");

  const lines: string[] = [];
  lines.push(`## Benchmark Results: ${passing.length} passed, ${failing.length} failed\n`);

  if (passing.length > 0) {
    lines.push("### Passing Questions (what works):");
    for (const r of passing.slice(0, 10)) {
      lines.push(`- Q: "${r.question}"`);
      if (r.expectedSql) lines.push(`  Expected: ${r.expectedSql.slice(0, 200)}`);
      if (r.actualSql) lines.push(`  Actual: ${r.actualSql.slice(0, 200)}`);
    }
    lines.push("");
  }

  if (failing.length > 0) {
    lines.push("### Failing Questions (what's broken):");
    for (const r of failing) {
      const reasonLabels = r.assessmentReasons
        .map((reason) => SCORE_REASON_LABELS[reason])
        .join(", ");
      lines.push(`- Q: "${r.question}" [${r.assessment}]`);
      if (reasonLabels) lines.push(`  Reasons: ${reasonLabels}`);
      if (r.expectedSql) lines.push(`  Expected: ${r.expectedSql.slice(0, 200)}`);
      if (r.actualSql) lines.push(`  Actual: ${r.actualSql.slice(0, 200)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

const CATEGORY_PROMPTS: Record<ConfigCategory, string> = {
  instructions: `Analyze the text instructions. Are they specific enough? Do they cover the patterns seen in failing questions? Are there vague terms, missing business rules, or incorrect conventions that could mislead Genie?`,
  measures_filters: `Analyze the measures and filters. Are there missing aggregations that failing questions need? Are any existing measures using wrong formulas? Are filters too restrictive or missing time-based patterns?`,
  joins: `Analyze the join specifications. Are there missing joins between tables that failing questions need? Are existing joins using wrong columns or relationship types? Are there self-joins or invalid references?`,
  examples: `Analyze the example SQL queries. Do they cover the patterns in failing questions? Are any examples using wrong SQL that could teach Genie bad patterns? Are there duplicates or outdated examples?`,
  synonyms: `Analyze column synonyms and descriptions. Are there missing synonyms for terms used in failing questions? Are any synonyms ambiguous (matching multiple columns)? Are descriptions inaccurate?`,
  benchmarks: `Analyze the benchmark questions themselves. Are expected SQL answers correct? Are questions clear and unambiguous? Are there coverage gaps for important query patterns?`,
};

/**
 * Run two-step category analysis for a specific category.
 *
 * Step 1: LLM reviews ALL benchmark results to understand patterns.
 * Step 2: LLM analyzes failures in the context of the specific config category.
 */
async function analyzeCategory(
  category: ConfigCategory,
  configSlice: string,
  benchmarkContext: string,
  scoreReasons: ScoreReason[],
): Promise<CategoryAnalysis> {
  const endpoint = resolveEndpoint("classification");
  const categoryPrompt = CATEGORY_PROMPTS[category];

  const reasonLabels = [...new Set(scoreReasons)]
    .map((r) => SCORE_REASON_LABELS[r])
    .join(", ");

  const messages = [
    {
      role: "system" as const,
      content: `You are an expert Databricks Genie Space optimizer. You will analyze benchmark results and a specific section of a Genie Space configuration to diagnose why questions are failing and recommend targeted fixes.

Use a two-step approach:
1. First, understand the FULL benchmark landscape -- what patterns pass and what fails.
2. Then, analyze the specific configuration section to identify what needs to change.

Be specific and actionable. Reference exact config items (by name/content) when possible.

Return JSON: {
  "diagnosis": "1-3 sentence summary of the root cause",
  "recommendations": ["specific actionable fix 1", "specific actionable fix 2", ...],
  "affectedQuestions": ["question text that this category can help fix", ...]
}`,
    },
    {
      role: "user" as const,
      content: `${benchmarkContext}

### Assessment Reasons Present: ${reasonLabels}

### Current Configuration (${category}):
${configSlice}

### Analysis Focus:
${categoryPrompt}

Analyze this configuration section in light of the benchmark results above.`,
    },
  ];

  try {
    const result = await cachedChatCompletion({
      endpoint,
      messages,
      temperature: 0.2,
      maxTokens: 2048,
      responseFormat: "json_object",
    });

    const parsed = parseLLMJson(result.content ?? "{}", "category-analysis") as Record<
      string,
      unknown
    >;
    return {
      category,
      targetStrategies: mapCategoryToStrategies(category),
      diagnosis: String(parsed.diagnosis ?? ""),
      recommendations: Array.isArray(parsed.recommendations)
        ? (parsed.recommendations as string[]).filter((r) => typeof r === "string")
        : [],
      affectedQuestions: Array.isArray(parsed.affectedQuestions)
        ? (parsed.affectedQuestions as string[]).filter((q) => typeof q === "string")
        : [],
    };
  } catch (err) {
    logger.warn("Category analysis failed", { category, error: String(err) });
    return {
      category,
      targetStrategies: mapCategoryToStrategies(category),
      diagnosis: "Analysis unavailable",
      recommendations: [],
      affectedQuestions: [],
    };
  }
}

function mapCategoryToStrategies(category: ConfigCategory): FixStrategy[] {
  switch (category) {
    case "instructions":
      return ["replace_instructions", "instruction_generation"];
    case "measures_filters":
      return ["delete_bad_measures", "semantic_expressions"];
    case "joins":
      return ["delete_bad_joins", "join_inference"];
    case "examples":
      return ["delete_bad_examples", "trusted_assets"];
    case "synonyms":
      return ["delete_bad_synonyms", "column_intelligence"];
    case "benchmarks":
      return ["benchmark_generation"];
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Determine which config categories are relevant based on score reasons.
 */
function relevantCategories(scoreReasons: ScoreReason[]): ConfigCategory[] {
  const cats = new Set<ConfigCategory>();

  for (const reason of scoreReasons) {
    switch (reason) {
      case "LLM_JUDGE_MISSING_JOIN":
      case "LLM_JUDGE_MISSING_OR_INCORRECT_JOIN":
        cats.add("joins");
        break;
      case "LLM_JUDGE_MISSING_OR_INCORRECT_FILTER":
      case "LLM_JUDGE_WRONG_FILTER":
      case "LLM_JUDGE_MISSING_OR_INCORRECT_AGGREGATION":
      case "LLM_JUDGE_WRONG_AGGREGATION":
      case "LLM_JUDGE_INCORRECT_METRIC_CALCULATION":
      case "SINGLE_CELL_DIFFERENCE":
        cats.add("measures_filters");
        break;
      case "LLM_JUDGE_WRONG_COLUMNS":
      case "LLM_JUDGE_INCORRECT_TABLE_OR_FIELD_USAGE":
      case "RESULT_MISSING_COLUMNS":
      case "RESULT_EXTRA_COLUMNS":
      case "COLUMN_TYPE_DIFFERENCE":
        cats.add("synonyms");
        cats.add("instructions");
        break;
      case "LLM_JUDGE_INSTRUCTION_COMPLIANCE_OR_MISSING_BUSINESS_LOGIC":
      case "LLM_JUDGE_MISINTERPRETATION_OF_USER_REQUEST":
      case "LLM_JUDGE_SEMANTIC_ERROR":
      case "LLM_JUDGE_FORMATTING_ERROR":
      case "LLM_JUDGE_INCOMPLETE_OR_PARTIAL_OUTPUT":
        cats.add("instructions");
        break;
      case "LLM_JUDGE_INCORRECT_FUNCTION_USAGE":
      case "LLM_JUDGE_SYNTAX_ERROR":
        cats.add("examples");
        break;
      case "RESULT_MISSING_ROWS":
      case "RESULT_EXTRA_ROWS":
      case "EMPTY_RESULT":
        cats.add("measures_filters");
        cats.add("examples");
        break;
      case "EMPTY_GOOD_SQL":
        cats.add("benchmarks");
        break;
      case "LLM_JUDGE_OTHER":
        cats.add("instructions");
        cats.add("measures_filters");
        cats.add("examples");
        break;
    }
  }

  if (cats.size === 0) {
    cats.add("instructions");
    cats.add("measures_filters");
    cats.add("examples");
  }

  return [...cats];
}

/**
 * Run two-step category analysis for all relevant categories based on
 * eval results. Returns per-category diagnoses and recommendations.
 */
export async function runCategoryAnalysis(
  space: SpaceJson,
  evalResults: EvalResultDetail[],
): Promise<CategoryAnalysis[]> {
  const failing = evalResults.filter((r) => r.assessment !== "GOOD");
  if (failing.length === 0) return [];

  const scoreReasons = failing.flatMap((r) => r.assessmentReasons);

  const categories = relevantCategories(scoreReasons);
  const benchmarkContext = buildBenchmarkContext(evalResults);

  logger.info("Running category analysis", {
    categories,
    failureCount: failing.length,
    scoreReasons: [...new Set(scoreReasons)],
  });

  const tasks = categories.map((cat) => () => {
    const configSlice = sliceConfigForCategory(space, cat);
    return analyzeCategory(cat, configSlice, benchmarkContext, scoreReasons);
  });

  const analyses = await mapWithConcurrency(tasks, 3);

  const withRecommendations = analyses.filter((a) => a.recommendations.length > 0);
  logger.info("Category analysis complete", {
    total: analyses.length,
    withRecommendations: withRecommendations.length,
    strategies: withRecommendations.flatMap((a) => a.targetStrategies),
  });

  return analyses;
}

/**
 * Convert category analyses into fix strategy check IDs for the space fixer.
 * Only returns strategies for categories that have actionable recommendations.
 */
export function analysesToCheckIds(analyses: CategoryAnalysis[]): string[] {
  const checkIds = new Set<string>();

  for (const analysis of analyses) {
    if (analysis.recommendations.length === 0) continue;
    for (const strategy of analysis.targetStrategies) {
      switch (strategy) {
        case "instruction_generation":
        case "replace_instructions":
          checkIds.add("text-instruction-exists");
          break;
        case "semantic_expressions":
        case "delete_bad_measures":
          checkIds.add("measures-defined");
          checkIds.add("filters-defined");
          break;
        case "join_inference":
        case "delete_bad_joins":
          checkIds.add("join-specs-for-multi-table");
          break;
        case "trusted_assets":
        case "delete_bad_examples":
          checkIds.add("example-sqls-minimum");
          break;
        case "column_intelligence":
        case "delete_bad_synonyms":
          checkIds.add("columns-have-descriptions");
          break;
        case "benchmark_generation":
          checkIds.add("benchmarks-exist");
          break;
      }
    }
  }

  return [...checkIds];
}
