/**
 * Field-level optimization engine for Genie Spaces.
 *
 * - generateOptimizations(): LLM-powered field-level suggestions from benchmark feedback
 * - mergeOptimizations(): deterministic config merge by field path
 */

import { resolveEndpoint, isReviewEnabled } from "@/lib/dbx/client";
import { chatCompletion } from "@/lib/dbx/model-serving";
import { reviewSql } from "@/lib/ai/sql-reviewer";
import { DATABRICKS_SQL_RULES_COMPACT } from "@/lib/toolkit/sql-rules";
import { logger } from "@/lib/logger";
import type { FeedbackEntry } from "./benchmark-feedback";
import type { SpaceJson } from "./types";
import "@/lib/skills/content";
import { resolveForGeniePass, formatContextSections } from "@/lib/skills/resolver";

export interface OptimizationSuggestion {
  fieldPath: string;
  currentValue: unknown;
  suggestedValue: unknown;
  rationale: string;
  priority: "high" | "medium" | "low";
  category: string;
  checklistReference?: string;
}

export interface OptimizationResult {
  suggestions: OptimizationSuggestion[];
  summary: string;
}

const OPTIMIZATION_PROMPT = `You are an expert at optimizing Databricks Genie Space configurations to improve answer accuracy.

## Task
Analyze the Genie Space configuration and labeling feedback to generate specific, field-level optimization suggestions.

## Genie Space Configuration
\`\`\`json
{CONFIG_JSON}
\`\`\`

## Labeling Feedback
{FEEDBACK_TEXT}

## Instructions

Generate optimization suggestions that will improve Genie's accuracy, especially for INCORRECT questions.

**Constraints:**
1. Only suggest modifications to EXISTING fields -- do not add new tables or array items
2. Use exact JSON paths with NUMERIC indices (e.g., "instructions.text_instructions[0].content", "data_sources.tables[0].column_configs[2].description")
3. Prioritize suggestions that directly address incorrect benchmark questions
4. Limit to 10-15 most impactful suggestions
5. Suggested values MUST match schema types. Fields like description, content, question, sql, instruction, synonyms must be arrays of strings
6. Reference actual array indices from the configuration (0-indexed)

**API Constraints:**
- At most 1 text_instruction per space
- SQL fields in filters, expressions, measures must not be empty
- All IDs must be unique

**Valid categories:** instruction, sql_example, filter, expression, measure, synonym, join_spec, description

**Priority levels:**
- high: Directly addresses an incorrect benchmark question
- medium: Improves general accuracy based on patterns
- low: Minor enhancement for clarity

Output JSON:
{
  "suggestions": [
    {
      "field_path": "exact.json.path[index].field",
      "current_value": null,
      "suggested_value": null,
      "rationale": "Why this change helps",
      "priority": "high",
      "category": "instruction",
      "checklist_reference": "optional-check-id"
    }
  ],
  "summary": "Brief optimization strategy summary"
}`;

/**
 * Extract a lightweight schema context from the Genie Space config JSON.
 * Lists tables and their column configs for the reviewer.
 */
function buildSpaceSchemaContext(space: SpaceJson): string {
  const dataSources = space.data_sources;
  if (!dataSources?.tables || !Array.isArray(dataSources.tables)) return "";

  const lines: string[] = [];
  for (const table of dataSources.tables) {
    const fqn = table.table_fqn ?? table.name ?? "";
    if (!fqn) continue;
    lines.push(`### ${fqn}`);
    const cols = table.column_configs ?? table.columns ?? [];
    if (Array.isArray(cols)) {
      for (const col of cols) {
        const name = col.column_name ?? col.name ?? "";
        const type = col.data_type ?? col.type ?? "";
        if (name) lines.push(`  - ${name}${type ? ` (${type})` : ""}`);
      }
    }
  }
  return lines.join("\n");
}

export async function generateOptimizations(
  space: SpaceJson,
  feedback: FeedbackEntry[],
): Promise<OptimizationResult> {
  const endpoint = resolveEndpoint("classification");

  const incorrect = feedback.filter((f) => f.assessment !== "GOOD");
  const correct = feedback.filter((f) => f.assessment === "GOOD");

  const feedbackLines = feedback.map((f, i) => {
    const status = f.assessment === "GOOD" ? "GOOD" : f.assessment;
    let line = `${i + 1}. [${status}] ${f.question}`;
    if (f.feedbackText) line += `\n   Feedback: ${f.feedbackText}`;
    if (f.assessmentReasons.length > 0) line += `\n   Reasons: ${f.assessmentReasons.join(", ")}`;
    return line;
  });

  const feedbackText = [
    `The user labeled ${feedback.length} benchmark questions:`,
    `- ${correct.length} answered correctly by Genie (GOOD)`,
    `- ${incorrect.length} answered incorrectly or needing review by Genie`,
    "",
    ...feedbackLines,
  ].join("\n");

  const configJson = JSON.stringify(space, null, 2).slice(0, 30_000);

  const optSkills = resolveForGeniePass("instructions", { contextBudget: 2500 });
  const optSkillBlock = formatContextSections(optSkills.contextSections);
  const skillSection = optSkillBlock
    ? `\n\n## Genie Best Practices\n${optSkillBlock}\n\n## SQL Quality Rules\n${DATABRICKS_SQL_RULES_COMPACT}`
    : "";

  const prompt =
    OPTIMIZATION_PROMPT.replace("{CONFIG_JSON}", configJson).replace(
      "{FEEDBACK_TEXT}",
      feedbackText,
    ) + skillSection;

  try {
    const response = await chatCompletion({
      endpoint,
      messages: [{ role: "user", content: prompt }],
      responseFormat: "json_object",
      maxTokens: 8192,
    });

    const parsed = JSON.parse(response.content);

    const suggestions: OptimizationSuggestion[] = (parsed.suggestions ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) => ({
        fieldPath: s.field_path ?? "",
        currentValue: s.current_value,
        suggestedValue: s.suggested_value,
        rationale: s.rationale ?? "",
        priority: s.priority ?? "medium",
        category: s.category ?? "description",
        checklistReference: s.checklist_reference ?? undefined,
      }),
    );

    // Review SQL in suggestions that contain SQL fields before returning
    const SQL_CATEGORIES = new Set(["sql_example", "filter", "expression", "measure"]);
    if (isReviewEnabled("genie-optimize") && suggestions.length > 0) {
      // Build schema context from the space config for the reviewer
      const spaceSchemaCtx = buildSpaceSchemaContext(space);
      const reviewed = await Promise.all(
        suggestions.map(async (s) => {
          if (!SQL_CATEGORIES.has(s.category)) return s;
          const sqlValue = typeof s.suggestedValue === "string" ? s.suggestedValue : null;
          if (!sqlValue || sqlValue.length < 5) return s;
          const review = await reviewSql(sqlValue, {
            schemaContext: spaceSchemaCtx || undefined,
            surface: "genie-optimize",
          });
          if (review.verdict === "fail") {
            logger.info("Optimize: rejecting suggestion with failed SQL review", {
              fieldPath: s.fieldPath,
              category: s.category,
              qualityScore: review.qualityScore,
            });
            return null;
          }
          return s;
        }),
      );
      const filtered = reviewed.filter((s): s is NonNullable<typeof s> => s !== null);
      return {
        suggestions: filtered,
        summary: parsed.summary ?? "",
      };
    }

    return {
      suggestions,
      summary: parsed.summary ?? "",
    };
  } catch (err) {
    logger.error("Optimization LLM call failed", { error: String(err) });
    throw new Error(`Optimization failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Parse a field path like "instructions.text_instructions[0].content" into segments.
 * Returns an array of string keys and numeric indices.
 */
function parseFieldPath(fieldPath: string): Array<string | number> {
  const segments: Array<string | number> = [];
  for (const part of fieldPath.split(".")) {
    const match = part.match(/^(.+?)\[(\d+)\]$/);
    if (match) {
      segments.push(match[1]);
      segments.push(parseInt(match[2], 10));
    } else {
      segments.push(part);
    }
  }
  return segments;
}

/**
 * Apply a single suggestion at its field path.
 * Navigates into the object following string keys and array indices,
 * creating intermediate objects/arrays as needed.
 */
function applySuggestion(config: SpaceJson, fieldPath: string, value: unknown): boolean {
  const segments = parseFieldPath(fieldPath);
  if (segments.length === 0) return false;

  let current: unknown = config;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (typeof seg === "number") {
      if (!Array.isArray(current) || seg >= (current as unknown[]).length) return false;
      current = (current as unknown[])[seg];
    } else {
      if (current == null || typeof current !== "object") return false;
      const record = current as Record<string, unknown>;
      if (!(seg in record)) {
        const nextSeg = segments[i + 1];
        record[seg] = typeof nextSeg === "number" ? [] : {};
      }
      current = record[seg];
    }
  }

  const finalKey = segments[segments.length - 1];
  if (typeof finalKey === "number") {
    if (!Array.isArray(current)) return false;
    while ((current as unknown[]).length <= finalKey) (current as unknown[]).push(null);
    (current as unknown[])[finalKey] = value;
  } else {
    if (current == null || typeof current !== "object") return false;
    (current as Record<string, unknown>)[finalKey] = value;
  }

  return true;
}

/**
 * Merge selected optimization suggestions into a space config.
 * Returns a deep copy with the suggestions applied.
 */
export function mergeOptimizations(
  space: SpaceJson,
  suggestions: OptimizationSuggestion[],
): { mergedSpace: SpaceJson; appliedCount: number; failedPaths: string[] } {
  const merged = JSON.parse(JSON.stringify(space)) as SpaceJson;
  let appliedCount = 0;
  const failedPaths: string[] = [];

  for (const suggestion of suggestions) {
    const success = applySuggestion(merged, suggestion.fieldPath, suggestion.suggestedValue);
    if (success) {
      appliedCount++;
    } else {
      failedPaths.push(suggestion.fieldPath);
      logger.warn("Failed to apply optimization suggestion", { fieldPath: suggestion.fieldPath });
    }
  }

  return { mergedSpace: merged, appliedCount, failedPaths };
}
