/**
 * DAX → Databricks SQL translator.
 *
 * Strategy:
 *   1. Simple patterns (SUM, COUNT, COUNTROWS, AVERAGE, MIN, MAX, DISTINCTCOUNT)
 *      get deterministic template translations.
 *   2. Complex DAX (CALCULATE, time intelligence, iterators, VAR/RETURN)
 *      goes through the LLM with DATABRICKS_SQL_RULES.
 *   3. Each translation gets a confidence score:
 *      - "high"   — deterministic template match
 *      - "medium" — LLM translation, syntactically plausible
 *      - "low"    — LLM translation, complex patterns or warnings
 *
 * All translated SQL references the deployed Gold tables, not PBI tables.
 */

import { chatCompletion } from "@/lib/dbx/model-serving";
import { resolveEndpoint, isReviewEnabled } from "@/lib/dbx/client";
import { DATABRICKS_SQL_RULES_COMPACT } from "@/lib/toolkit/sql-rules";
import { reviewBatch, type BatchReviewItem } from "@/lib/ai/sql-reviewer";
import "@/lib/skills/content";
import { resolveForPipelineStep, formatContextSections } from "@/lib/skills/resolver";
import { normalizeIdentifier } from "./name-normalizer";
import { logger } from "@/lib/logger";
import type { NameMapping } from "./name-normalizer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConfidenceLevel = "high" | "medium" | "low";

export interface DaxTranslation {
  measureName: string;
  daxExpression: string;
  sqlExpression: string;
  confidence: ConfidenceLevel;
  warnings: string[];
  method: "template" | "llm";
}

// ---------------------------------------------------------------------------
// Simple pattern templates
// ---------------------------------------------------------------------------

const SIMPLE_PATTERNS: Array<{
  regex: RegExp;
  translate: (match: RegExpMatchArray, resolveCol: (ref: string) => string) => string;
}> = [
  {
    regex: /^\s*SUM\s*\(\s*(\w+)\[(\w[\w\s]*)\]\s*\)\s*$/i,
    translate: (m, resolve) => `SUM(${resolve(`${m[1]}.${m[2]}`)})`,
  },
  {
    regex: /^\s*AVERAGE\s*\(\s*(\w+)\[(\w[\w\s]*)\]\s*\)\s*$/i,
    translate: (m, resolve) => `AVG(${resolve(`${m[1]}.${m[2]}`)})`,
  },
  {
    regex: /^\s*MIN\s*\(\s*(\w+)\[(\w[\w\s]*)\]\s*\)\s*$/i,
    translate: (m, resolve) => `MIN(${resolve(`${m[1]}.${m[2]}`)})`,
  },
  {
    regex: /^\s*MAX\s*\(\s*(\w+)\[(\w[\w\s]*)\]\s*\)\s*$/i,
    translate: (m, resolve) => `MAX(${resolve(`${m[1]}.${m[2]}`)})`,
  },
  {
    regex: /^\s*COUNT\s*\(\s*(\w+)\[(\w[\w\s]*)\]\s*\)\s*$/i,
    translate: (m, resolve) => `COUNT(${resolve(`${m[1]}.${m[2]}`)})`,
  },
  {
    regex: /^\s*COUNTROWS\s*\(\s*(\w+)\s*\)\s*$/i,
    translate: (m, resolve) => `COUNT(*) /* from ${resolve(m[1])} */`,
  },
  {
    regex: /^\s*DISTINCTCOUNT\s*\(\s*(\w+)\[(\w[\w\s]*)\]\s*\)\s*$/i,
    translate: (m, resolve) => `COUNT(DISTINCT ${resolve(`${m[1]}.${m[2]}`)})`,
  },
  {
    regex: /^\s*DIVIDE\s*\(\s*\[(\w[\w\s]*)\]\s*,\s*\[(\w[\w\s]*)\]\s*(?:,\s*(\d+))?\s*\)\s*$/i,
    translate: (m) => {
      const fallback = m[3] ?? "NULL";
      const num = normalizeIdentifier(m[1]);
      const denom = normalizeIdentifier(m[2]);
      return `CASE WHEN ${denom} = 0 THEN ${fallback} ELSE ${num} / ${denom} END`;
    },
  },
];

// ---------------------------------------------------------------------------
// Column reference resolver
// ---------------------------------------------------------------------------

function buildResolver(nameMapping: NameMapping[]): (ref: string) => string {
  const map = new Map<string, string>();
  for (const m of nameMapping) {
    if (m.source === "column") {
      map.set(m.original.toLowerCase(), m.normalized);
    } else if (m.source === "table") {
      map.set(m.original.toLowerCase(), m.normalized);
    }
  }

  return (ref: string): string => {
    const clean = ref.replace(/[\[\]]/g, "").trim();
    const mapped = map.get(clean.toLowerCase());
    if (mapped) return mapped;
    return normalizeIdentifier(clean);
  };
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * Translate a batch of DAX measures to Databricks SQL.
 */
export async function translateDaxMeasures(
  measures: Array<{
    name: string;
    expression: string;
    tableName: string;
  }>,
  nameMapping: NameMapping[],
  options?: { batchSize?: number },
): Promise<DaxTranslation[]> {
  const resolve = buildResolver(nameMapping);
  const results: DaxTranslation[] = [];
  const llmBatch: Array<{ index: number; name: string; expression: string; tableName: string }> =
    [];

  for (let i = 0; i < measures.length; i++) {
    const m = measures[i];
    const templateResult = tryTemplate(m.expression, resolve);
    if (templateResult) {
      results.push({
        measureName: m.name,
        daxExpression: m.expression,
        sqlExpression: templateResult,
        confidence: "high",
        warnings: [],
        method: "template",
      });
    } else {
      results.push(null as unknown as DaxTranslation); // placeholder
      llmBatch.push({ index: i, name: m.name, expression: m.expression, tableName: m.tableName });
    }
  }

  if (llmBatch.length > 0) {
    const batchSize = options?.batchSize ?? 10;
    for (let i = 0; i < llmBatch.length; i += batchSize) {
      const batch = llmBatch.slice(i, i + batchSize);
      const llmResults = await translateBatchWithLLM(batch, nameMapping);
      for (let j = 0; j < batch.length; j++) {
        results[batch[j].index] = llmResults[j];
      }
    }
  }

  // LLM review: batch-review all LLM-translated expressions
  if (isReviewEnabled("dax-to-sql")) {
    const reviewItems: BatchReviewItem[] = results
      .filter((r) => r.method === "llm" && r.confidence !== "low")
      .map((r) => ({
        id: r.measureName,
        sql: r.sqlExpression,
        context: `DAX translation of: ${r.daxExpression}`,
      }));
    if (reviewItems.length > 0) {
      const reviewResults = await reviewBatch(reviewItems, "dax-to-sql");
      const reviewMap = new Map(reviewResults.map((r) => [r.id, r.result]));
      for (const r of results) {
        const review = reviewMap.get(r.measureName);
        if (review) {
          if (review.verdict === "fail") {
            r.confidence = "low";
            r.warnings.push(...review.issues.map((i) => `Review: ${i.message}`));
          } else if (review.verdict === "warn" && r.confidence === "high") {
            r.confidence = "medium";
            r.warnings.push(
              ...review.issues
                .filter((i) => i.severity !== "info")
                .map((i) => `Review: ${i.message}`),
            );
          }
        }
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Template matcher
// ---------------------------------------------------------------------------

function tryTemplate(dax: string, resolve: (ref: string) => string): string | null {
  for (const pattern of SIMPLE_PATTERNS) {
    const match = dax.match(pattern.regex);
    if (match) return pattern.translate(match, resolve);
  }
  return null;
}

// ---------------------------------------------------------------------------
// LLM translation
// ---------------------------------------------------------------------------

async function translateBatchWithLLM(
  batch: Array<{ index: number; name: string; expression: string; tableName: string }>,
  nameMapping: NameMapping[],
): Promise<DaxTranslation[]> {
  const tableMappings = nameMapping
    .filter((m) => m.source === "table")
    .map((m) => `${m.original} → ${m.normalized}`)
    .join("\n");

  const columnMappings = nameMapping
    .filter((m) => m.source === "column")
    .slice(0, 100)
    .map((m) => `${m.original} → ${m.normalized}`)
    .join("\n");

  const measuresText = batch
    .map(
      (m, i) => `${i + 1}. Measure: ${m.name}\n   Table: ${m.tableName}\n   DAX: ${m.expression}`,
    )
    .join("\n\n");

  const daxSkills = resolveForPipelineStep("sql-generation", { contextBudget: 1500 });
  const daxSkillBlock = formatContextSections(daxSkills.contextSections);

  const prompt = `Translate these Power BI DAX measures to Databricks SQL expressions.

${DATABRICKS_SQL_RULES_COMPACT}
${daxSkillBlock ? `\n## Databricks SQL Patterns\n${daxSkillBlock}\n` : ""}
Name mapping (PBI → UC):
Tables:
${tableMappings}

Columns (sample):
${columnMappings}

Measures to translate:
${measuresText}

For each measure, return:
- "sql": the Databricks SQL expression (referencing UC table/column names, not PBI names)
- "confidence": "high" if straightforward, "medium" if some interpretation needed, "low" if complex/uncertain
- "warnings": array of strings noting any concerns

Return a JSON array of objects with fields: name, sql, confidence, warnings.
Return ONLY valid JSON.`;

  try {
    const response = await chatCompletion({
      endpoint: resolveEndpoint("sql"),
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      maxTokens: 8192,
      responseFormat: "json_object",
    });

    const content = response.content ?? "[]";
    let parsed: Array<{ name: string; sql: string; confidence: string; warnings?: string[] }>;
    try {
      const obj = JSON.parse(content);
      parsed = Array.isArray(obj) ? obj : (obj.measures ?? obj.translations ?? obj.results ?? []);
    } catch {
      const match = content.match(/\[[\s\S]*\]/);
      parsed = match ? JSON.parse(match[0]) : [];
    }

    return batch.map((m, i) => {
      const result = parsed[i];
      if (!result?.sql) {
        return {
          measureName: m.name,
          daxExpression: m.expression,
          sqlExpression: `/* TODO: Manual translation needed for ${m.name} */`,
          confidence: "low" as ConfidenceLevel,
          warnings: ["LLM did not return a translation for this measure"],
          method: "llm" as const,
        };
      }
      return {
        measureName: m.name,
        daxExpression: m.expression,
        sqlExpression: result.sql,
        confidence: (result.confidence ?? "medium") as ConfidenceLevel,
        warnings: result.warnings ?? [],
        method: "llm" as const,
      };
    });
  } catch (err) {
    logger.warn("[dax-to-sql] LLM batch translation failed", {
      error: err instanceof Error ? err.message : String(err),
      batchSize: batch.length,
    });
    return batch.map((m) => ({
      measureName: m.name,
      daxExpression: m.expression,
      sqlExpression: `/* ERROR: Translation failed for ${m.name} */`,
      confidence: "low" as ConfidenceLevel,
      warnings: ["LLM translation failed: " + (err instanceof Error ? err.message : String(err))],
      method: "llm" as const,
    }));
  }
}
