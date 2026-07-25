/**
 * Deterministic evaluator functions for the Genie Space Health Check engine.
 *
 * Each evaluator is a pure function that inspects a serialized space JSON
 * against a check definition and returns a pass/fail result.
 */

import type { CheckDefinition, CheckResult } from "./types";
import {
  reviewBatch as defaultReviewBatch,
  type BatchReviewItem,
  type BatchReviewResult,
} from "@/lib/ai/sql-reviewer";
import { isReviewEnabled as defaultIsReviewEnabled } from "@/lib/dbx/client";
import type { SpaceJson } from "@/lib/genie/types";

// ---------------------------------------------------------------------------
// Injectable dependencies for portability
// ---------------------------------------------------------------------------

export type ReviewBatchFn = (
  items: BatchReviewItem[],
  surface?: string,
  schemaContext?: string,
) => Promise<BatchReviewResult[]>;

export type IsReviewEnabledFn = (surface?: string) => boolean;

let _reviewBatchFn: ReviewBatchFn = defaultReviewBatch;
let _isReviewEnabledFn: IsReviewEnabledFn = defaultIsReviewEnabled;

/**
 * Override the SQL review implementation used by the health check engine.
 * Call before `runHealthCheck()` + `enrichReportWithSqlQuality()` to
 * inject an alternative review backend or a test stub.
 */
export function setHealthCheckReviewFn(fn: ReviewBatchFn): void {
  _reviewBatchFn = fn;
}

/**
 * Override the review-enabled gate function.
 */
export function setHealthCheckReviewEnabledFn(fn: IsReviewEnabledFn): void {
  _isReviewEnabledFn = fn;
}

/**
 * Reset to default Databricks implementations.
 */
export function resetHealthCheckDeps(): void {
  _reviewBatchFn = defaultReviewBatch;
  _isReviewEnabledFn = defaultIsReviewEnabled;
}

/**
 * Resolve a dot-notation path (with optional `[*]` array wildcards) against
 * the space JSON. Returns an array of resolved values.
 */
export function resolvePath(obj: SpaceJson, path: string): unknown[] {
  if (!path || !obj) return [];

  const segments = path.split(".");
  let current: unknown[] = [obj];

  for (const seg of segments) {
    const next: unknown[] = [];
    const arrayMatch = seg.match(/^(.+)\[\*\]$/);

    for (const item of current) {
      if (item == null || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;

      if (arrayMatch) {
        const key = arrayMatch[1];
        const arr = record[key];
        if (Array.isArray(arr)) {
          next.push(...arr);
        }
      } else {
        if (seg in record) {
          next.push(record[seg]);
        }
      }
    }
    current = next;
  }

  return current;
}

function resolveArray(obj: SpaceJson, path: string): unknown[] {
  const values = resolvePath(obj, path);
  if (values.length === 1 && Array.isArray(values[0])) {
    return values[0] as unknown[];
  }
  return values;
}

function collectAllIds(space: SpaceJson): string[] {
  const ids: string[] = [];

  const walk = (obj: unknown) => {
    if (obj == null) return;
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item);
      return;
    }
    if (typeof obj === "object") {
      const record = obj as Record<string, unknown>;
      if ("id" in record && typeof record.id === "string") {
        ids.push(record.id);
      }
      for (const val of Object.values(record)) {
        walk(val);
      }
    }
  };

  walk(space);
  return ids;
}

function hasNonEmptyField(item: unknown, field: string): boolean {
  if (item == null || typeof item !== "object") return false;
  const record = item as Record<string, unknown>;
  const val = record[field];
  if (val == null) return false;
  if (typeof val === "boolean") return val === true;
  if (typeof val === "string") return val.trim().length > 0;
  if (Array.isArray(val))
    return val.length > 0 && val.some((v) => v != null && String(v).trim().length > 0);
  return true;
}

function buildResult(check: CheckDefinition, passed: boolean, detail?: string): CheckResult {
  return {
    id: check.id,
    category: check.category,
    description: check.description,
    passed,
    severity: check.severity,
    detail,
    fixable: check.fixable,
    fixStrategy: check.fix_strategy,
  };
}

// ---------------------------------------------------------------------------
// Evaluator implementations
// ---------------------------------------------------------------------------

function evaluateCount(space: SpaceJson, check: CheckDefinition): CheckResult {
  const arr = resolveArray(space, check.path!);
  const count = arr.length;
  const min = (check.params.min as number | undefined) ?? 0;
  const max = check.params.max as number | undefined;

  const passesMin = count >= min;
  const passesMax = max == null || count <= max;
  const passed = passesMin && passesMax;

  let detail = `Found ${count}`;
  if (!passesMin) detail += `, need at least ${min}`;
  if (!passesMax) detail += `, exceeds maximum of ${max}`;

  return buildResult(check, passed, detail);
}

function evaluateRange(space: SpaceJson, check: CheckDefinition): CheckResult {
  const arr = resolveArray(space, check.path!);
  const count = arr.length;
  const min = (check.params.min as number | undefined) ?? 0;
  const max = (check.params.max as number | undefined) ?? Infinity;
  const warnAbove = check.params.warn_above as number | undefined;

  const inRange = count >= min && count <= max;
  const belowWarn = warnAbove == null || count <= warnAbove;
  const passed = inRange && belowWarn;

  let detail = `Found ${count} (range: ${min}-${max})`;
  if (warnAbove != null && count > warnAbove) detail += `, exceeds recommended ${warnAbove}`;
  if (!inRange) detail += ` -- outside allowed range`;

  return buildResult(check, passed, detail);
}

function evaluateExists(space: SpaceJson, check: CheckDefinition): CheckResult {
  const values = resolvePath(space, check.path!);
  const passed = values.length > 0 && values.some((v) => v != null);
  return buildResult(check, passed, passed ? "Present" : "Missing");
}

function evaluateLength(space: SpaceJson, check: CheckDefinition): CheckResult {
  const values = resolvePath(space, check.path!);
  const min = (check.params.min as number | undefined) ?? 0;
  const max = check.params.max as number | undefined;

  let totalLength = 0;
  for (const v of values) {
    if (typeof v === "string") totalLength += v.length;
    else if (Array.isArray(v)) totalLength += v.join(" ").length;
  }

  const passesMin = totalLength >= min;
  const passesMax = max == null || totalLength <= max;
  const passed = passesMin && passesMax;

  return buildResult(check, passed, `Length: ${totalLength} chars`);
}

function evaluateRatio(space: SpaceJson, check: CheckDefinition): CheckResult {
  const arr = resolveArray(space, check.path!);
  const field = check.field!;
  const minRatio = (check.params.min_ratio as number) ?? 0;

  if (arr.length === 0) {
    return buildResult(check, true, "No items to evaluate (vacuously passes)");
  }

  const withField = arr.filter((item) => hasNonEmptyField(item, field)).length;
  const ratio = withField / arr.length;
  const passed = ratio >= minRatio;

  return buildResult(
    check,
    passed,
    `${withField}/${arr.length} (${Math.round(ratio * 100)}%) have ${field}, need ${Math.round(minRatio * 100)}%`,
  );
}

function evaluateNestedRatio(space: SpaceJson, check: CheckDefinition): CheckResult {
  const resolved = resolvePath(space, check.path!);
  const field = check.field!;
  const minRatio = (check.params.min_ratio as number) ?? 0;

  // Flatten: resolvePath may return arrays of arrays for paths like
  // `tables[*].column_configs` -- we need the individual items.
  const items: unknown[] = [];
  for (const val of resolved) {
    if (Array.isArray(val)) items.push(...val);
    else items.push(val);
  }

  if (items.length === 0) {
    return buildResult(check, true, "No items to evaluate (vacuously passes)");
  }

  const withField = items.filter((item) => hasNonEmptyField(item, field)).length;
  const ratio = withField / items.length;
  const passed = ratio >= minRatio;

  return buildResult(
    check,
    passed,
    `${withField}/${items.length} (${Math.round(ratio * 100)}%) have ${field}, need ${Math.round(minRatio * 100)}%`,
  );
}

function evaluatePattern(space: SpaceJson, check: CheckDefinition): CheckResult {
  const regexStr = check.params.regex as string;
  const regex = new RegExp(regexStr);

  const values =
    check.path === "__all_ids__"
      ? collectAllIds(space)
      : resolvePath(space, check.path!).filter((v): v is string => typeof v === "string");

  if (values.length === 0) {
    return buildResult(check, true, "No values to check");
  }

  const invalid = (values as string[]).filter((v) => !regex.test(v));
  const passed = invalid.length === 0;

  return buildResult(
    check,
    passed,
    passed
      ? `All ${values.length} values match pattern`
      : `${invalid.length} invalid: ${invalid
          .slice(0, 3)
          .map((v) => `"${v}"`)
          .join(", ")}${invalid.length > 3 ? "..." : ""}`,
  );
}

function evaluateUnique(space: SpaceJson, check: CheckDefinition): CheckResult {
  const values =
    check.path === "__all_ids__"
      ? collectAllIds(space)
      : resolvePath(space, check.path!).filter((v): v is string => typeof v === "string");

  if (values.length === 0) {
    return buildResult(check, true, "No values to check");
  }

  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const v of values as string[]) {
    if (seen.has(v)) duplicates.push(v);
    else seen.add(v);
  }

  const passed = duplicates.length === 0;
  return buildResult(
    check,
    passed,
    passed
      ? `All ${values.length} values unique`
      : `${duplicates.length} duplicate(s): ${[...new Set(duplicates)]
          .slice(0, 3)
          .map((v) => `"${v}"`)
          .join(", ")}`,
  );
}

function evaluateNoEmptyField(space: SpaceJson, check: CheckDefinition): CheckResult {
  const paths = check.paths ?? (check.path ? [check.path] : []);
  let emptyCount = 0;
  let totalChecked = 0;

  for (const p of paths) {
    const items = resolvePath(space, p);
    for (const item of items) {
      totalChecked++;
      if (item == null) {
        emptyCount++;
      } else if (Array.isArray(item)) {
        if (item.length === 0 || item.every((v) => !v || String(v).trim() === "")) emptyCount++;
      } else if (typeof item === "string" && item.trim() === "") {
        emptyCount++;
      }
    }
  }

  const passed = emptyCount === 0;
  return buildResult(
    check,
    passed,
    passed ? `All ${totalChecked} SQL fields populated` : `${emptyCount} empty SQL field(s) found`,
  );
}

function evaluateConditionalCount(space: SpaceJson, check: CheckDefinition): CheckResult {
  const conditionPath = check.condition_path!;
  const conditionMin = check.condition_min ?? 1;

  const conditionArr = resolveArray(space, conditionPath);
  if (conditionArr.length < conditionMin) {
    return buildResult(
      check,
      true,
      `Condition not met (${conditionArr.length} < ${conditionMin}), skipped`,
    );
  }

  return evaluateCount(space, check);
}

/**
 * LLM qualitative evaluator -- returns a placeholder result.
 * Actual LLM evaluation is handled by runLlmQualitativeChecks() in synthesis.ts.
 * This is registered so the evaluator name is valid and registry validation passes.
 * When deep analysis is not requested, qualitative checks are skipped.
 */
function evaluateLlmQualitative(_space: SpaceJson, check: CheckDefinition): CheckResult {
  return buildResult(check, true, "Qualitative check (requires deep analysis mode)");
}

function evaluateJsonpath(space: SpaceJson, check: CheckDefinition): CheckResult {
  const path = check.path;
  if (!path) return buildResult(check, false, "No path specified for jsonpath evaluator");

  const values = resolvePath(space, path);
  const minCount = (check.params.min as number | undefined) ?? 1;

  if (values.length >= minCount) {
    return buildResult(check, true, `JSONPath resolved ${values.length} value(s)`);
  }
  return buildResult(
    check,
    false,
    `JSONPath resolved ${values.length} value(s), need at least ${minCount}`,
  );
}

/**
 * SQL quality evaluator -- reviews SQL snippets at the specified paths
 * via the dedicated review endpoint. Returns pass when the average quality
 * score meets the configured min_score threshold.
 *
 * Since this requires an async LLM call, it stores a pending promise.
 * The health check runner resolves async evaluator results separately.
 * As a synchronous fallback (when the review endpoint is not configured),
 * it returns a pass-through result.
 */
let _pendingSqlQualityChecks: Array<{
  check: CheckDefinition;
  items: BatchReviewItem[];
}> = [];

export function clearPendingSqlQualityChecks() {
  _pendingSqlQualityChecks = [];
}

export async function resolveSqlQualityChecks(_space: SpaceJson): Promise<CheckResult[]> {
  const pending = [..._pendingSqlQualityChecks];
  _pendingSqlQualityChecks = [];
  if (pending.length === 0) return [];

  const results: CheckResult[] = [];
  for (const { check, items } of pending) {
    if (items.length === 0) {
      results.push(buildResult(check, true, "No SQL snippets to review"));
      continue;
    }

    const batchResults = await _reviewBatchFn(items, "health-check-sql-quality");
    const scores = batchResults.map((r) => r.result.qualityScore);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const failCount = batchResults.filter((r) => r.result.verdict === "fail").length;
    const minScore = (check.params.min_score as number) ?? 60;
    const passed = avgScore >= minScore && failCount === 0;

    results.push(
      buildResult(
        check,
        passed,
        `Avg quality: ${Math.round(avgScore)}/100 across ${items.length} snippets (${failCount} failures, threshold: ${minScore})`,
      ),
    );
  }
  return results;
}

function evaluateSqlQuality(space: SpaceJson, check: CheckDefinition): CheckResult {
  if (!_isReviewEnabledFn("health-check-sql-quality")) {
    return buildResult(check, true, "SQL quality review not enabled (no review endpoint)");
  }

  const paths = check.paths ?? (check.path ? [check.path] : []);
  const items: BatchReviewItem[] = [];
  let idx = 0;
  for (const p of paths) {
    const values = resolvePath(space, p);
    for (const v of values) {
      if (typeof v === "string" && v.trim().length > 5) {
        items.push({ id: `sql-${idx++}`, sql: v });
      }
    }
  }

  _pendingSqlQualityChecks.push({ check, items });
  return buildResult(check, true, `Queued ${items.length} SQL snippets for review (async)`);
}

// ---------------------------------------------------------------------------
// Instruction quality evaluator
// ---------------------------------------------------------------------------

interface InstructionQualityScore {
  specificity: number;
  structure: number;
  clarity: number;
  total: number;
}

const VAGUE_TERMS = [
  "appropriate",
  "relevant",
  "proper",
  "suitable",
  "correctly",
  "as needed",
  "if necessary",
  "when applicable",
  "etc",
  "and so on",
  "various",
  "certain",
  "some",
  "things",
  "stuff",
];

function scoreInstructionQuality(instructionText: string): InstructionQualityScore {
  if (!instructionText || instructionText.trim().length === 0) {
    return { specificity: 0, structure: 0, clarity: 0, total: 0 };
  }

  const text = instructionText.toLowerCase();
  const words = text.split(/\s+/);
  const wordCount = words.length;

  // Specificity (40 points): table/column references, SQL keywords, concrete examples
  let specificity = 0;
  const fqnPattern = /\w+\.\w+\.\w+/g;
  const fqnMatches = text.match(fqnPattern)?.length ?? 0;
  specificity += Math.min(15, fqnMatches * 3);

  const sqlKeywords = [
    "select",
    "where",
    "join",
    "group by",
    "order by",
    "sum(",
    "count(",
    "avg(",
    "date_trunc",
    "case when",
  ];
  const sqlHits = sqlKeywords.filter((kw) => text.includes(kw)).length;
  specificity += Math.min(15, sqlHits * 3);

  const backtickRefs = text.match(/`[^`]+`/g)?.length ?? 0;
  specificity += Math.min(10, backtickRefs * 2);

  specificity = Math.min(40, specificity);

  // Structure (30 points): headers, lists, bold, code blocks, line breaks
  let structure = 0;
  if (/^#+\s/m.test(instructionText)) structure += 8;
  if (/^[-*]\s/m.test(instructionText) || /^\d+\.\s/m.test(instructionText)) structure += 8;
  if (/\*\*[^*]+\*\*/.test(instructionText)) structure += 5;
  if (/`[^`]+`/.test(instructionText)) structure += 5;
  const lineCount = instructionText.split("\n").filter((l) => l.trim()).length;
  if (lineCount >= 5) structure += 4;

  structure = Math.min(30, structure);

  // Clarity (30 points): absence of vague terms, action verbs, length
  let clarity = 20;
  const vagueCount = VAGUE_TERMS.filter((t) => text.includes(t)).length;
  clarity -= Math.min(15, vagueCount * 3);

  const actionVerbs = [
    "use",
    "always",
    "never",
    "ensure",
    "include",
    "exclude",
    "prefer",
    "avoid",
    "apply",
  ];
  const actionHits = actionVerbs.filter((v) => text.includes(v)).length;
  clarity += Math.min(5, actionHits);

  if (wordCount >= 50) clarity += 3;
  if (wordCount >= 200) clarity += 2;

  // Smart SQL-in-prose detection (anchor + density). A single offender
  // is forgiven, but ≥ 2 lines of clear inline SQL drop clarity sharply.
  const sqlOffenders = detectSqlInProse(instructionText);
  if (sqlOffenders.length >= 2) {
    clarity -= Math.min(10, (sqlOffenders.length - 1) * 5);
  }

  clarity = Math.max(0, Math.min(30, clarity));

  const total = specificity + structure + clarity;
  return { specificity, structure, clarity, total };
}

function evaluateInstructionQuality(space: SpaceJson, check: CheckDefinition): CheckResult {
  const textInstructions = resolveArray(space, "instructions.text_instructions");
  if (textInstructions.length === 0) {
    return buildResult(check, false, "No instructions found");
  }

  const allContent: string[] = [];
  for (const instr of textInstructions) {
    if (instr && typeof instr === "object" && "content" in (instr as Record<string, unknown>)) {
      const content = (instr as Record<string, unknown>).content;
      if (Array.isArray(content)) {
        allContent.push((content as string[]).join(" "));
      } else if (typeof content === "string") {
        allContent.push(content);
      }
    }
  }

  const fullText = allContent.join("\n");
  const score = scoreInstructionQuality(fullText);
  const minScore = (check.params.min_score as number) ?? 40;
  const passed = score.total >= minScore;

  const grade =
    score.total >= 80
      ? "A"
      : score.total >= 60
        ? "B"
        : score.total >= 40
          ? "C"
          : score.total >= 20
            ? "D"
            : "F";

  const suggestions: string[] = [];
  if (score.specificity < 20) suggestions.push("Add table/column references and SQL examples");
  if (score.structure < 15) suggestions.push("Use headers, bullet lists, and formatting");
  if (score.clarity < 15) suggestions.push("Replace vague terms with specific guidance");

  return buildResult(
    check,
    passed,
    `Quality: ${grade} (${score.total}/100) — Specificity: ${score.specificity}/40, Structure: ${score.structure}/30, Clarity: ${score.clarity}/30${suggestions.length > 0 ? `. Improve: ${suggestions.join("; ")}` : ""}`,
  );
}

/** Exposed for testing. */
export { scoreInstructionQuality, type InstructionQualityScore };

// ---------------------------------------------------------------------------
// Smart SQL-in-prose detection
// ---------------------------------------------------------------------------

/**
 * Detect SQL embedded in prose instructions (anchored variant).
 *
 * Mirrors upstream `iq_scanner.detect_sql_in_prose`:
 * - require an *anchor* (`SELECT ... FROM`, fenced code block, or `> SELECT`),
 * - require minimum SQL keyword density (≥ 3 SQL keywords on the same line),
 * - explicitly skip fenced blocks marked `\`\`\`sql ... \`\`\`` (those are
 *   intentional examples, not prose drift).
 *
 * Returns the list of offending excerpts (max 5). Empty array means clean.
 */
export function detectSqlInProse(text: string): string[] {
  if (!text || typeof text !== "string") return [];

  const SQL_KEYWORDS = [
    "select",
    "from",
    "where",
    "join",
    "group by",
    "order by",
    "having",
    "case when",
    "with",
    "union",
    "limit",
  ];

  const offenders: string[] = [];

  // Strip explicit ```sql fences -- those are sanctioned examples.
  const sanitized = text.replace(/```sql[\s\S]*?```/gi, "");

  const lines = sanitized.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("```")) continue;
    if (line.length < 30) continue;

    const lower = line.toLowerCase();
    const hasAnchor =
      /\bselect\b[\s\S]*\bfrom\b/.test(lower) ||
      lower.startsWith("> select") ||
      lower.startsWith("- select") ||
      lower.startsWith("* select");
    if (!hasAnchor) continue;

    const density = SQL_KEYWORDS.filter((kw) => lower.includes(kw)).length;
    if (density < 3) continue;

    offenders.push(line.length > 160 ? `${line.slice(0, 157)}...` : line);
    if (offenders.length >= 5) break;
  }

  return offenders;
}

// ---------------------------------------------------------------------------
// Casing-consistency evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate dominant casing consistency across the space's text instructions
 * + sample columns. Mirrors upstream `iq_scanner.evaluate_casing_consistency`.
 *
 * The check passes when the mix of casing styles for proper-noun-like content
 * (column synonyms, sample question text, instructions) does not contain too
 * many disagreeing styles. We sample tokenized words and bucket them as
 * uppercase / lowercase / titlecase / mixed, flagging when more than one
 * non-trivial style accounts for ≥ 25% of tokens.
 *
 * Note: this is a *space-level* heuristic. For column-sample casing
 * (data values), use `lib/metadata/casing-profile.ts`.
 */
function evaluateCasingConsistency(space: SpaceJson, check: CheckDefinition): CheckResult {
  const samples: string[] = [];

  const tables = (space?.data_sources?.tables ?? []) as Array<{
    column_configs?: Array<{ synonyms?: unknown }>;
  }>;
  for (const t of tables) {
    for (const c of t.column_configs ?? []) {
      const syn = c?.synonyms;
      if (Array.isArray(syn)) {
        for (const s of syn) if (typeof s === "string") samples.push(s);
      }
    }
  }

  const sampleQs = (space?.config?.sample_questions ?? []) as unknown[];
  for (const q of sampleQs) if (typeof q === "string") samples.push(q);

  const eqs = (space?.instructions?.example_question_sqls ?? []) as Array<{
    question?: unknown;
  }>;
  for (const eq of eqs) {
    if (typeof eq?.question === "string") samples.push(eq.question);
  }

  if (samples.length < 5) {
    return buildResult(check, true, "Not enough material to evaluate casing consistency");
  }

  let upper = 0;
  let lower = 0;
  let title = 0;
  let mixed = 0;
  for (const s of samples) {
    const tokens = s.split(/\s+/).filter((t) => /^[A-Za-z][A-Za-z0-9_'-]*$/.test(t));
    for (const tok of tokens) {
      if (tok.length < 2) continue;
      if (tok === tok.toUpperCase()) upper += 1;
      else if (tok === tok.toLowerCase()) lower += 1;
      else if (tok[0] === tok[0]?.toUpperCase() && tok.slice(1) === tok.slice(1).toLowerCase()) {
        title += 1;
      } else {
        mixed += 1;
      }
    }
  }
  const total = upper + lower + title + mixed;
  if (total < 10) {
    return buildResult(check, true, "Not enough tokens to evaluate casing consistency");
  }

  const minDominance = (check.params.min_dominance as number) ?? 0.6;
  const ratios = [
    { name: "uppercase", value: upper / total },
    { name: "lowercase", value: lower / total },
    { name: "titlecase", value: title / total },
    { name: "mixed", value: mixed / total },
  ].sort((a, b) => b.value - a.value);

  const dominantRatio = ratios[0]?.value ?? 0;
  const passed = dominantRatio >= minDominance;
  const breakdown = ratios.map((r) => `${r.name}=${(r.value * 100).toFixed(0)}%`).join(", ");
  const detail = passed
    ? `Dominant casing: ${ratios[0]?.name} (${(dominantRatio * 100).toFixed(0)}%); ${breakdown}`
    : `No dominant casing style (top: ${ratios[0]?.name} ${(dominantRatio * 100).toFixed(0)}%); ${breakdown}`;
  return buildResult(check, passed, detail);
}

// ---------------------------------------------------------------------------
// Maturity-tier evaluator
// ---------------------------------------------------------------------------

/**
 * Lightweight evaluator that surfaces the customer-facing maturity tier as a
 * pass/fail check. Passes when the tier meets or exceeds `params.min_tier`
 * (default `ready_to_optimize`).
 *
 * This is structural-only (no LLM) and uses the same logic as the report-level
 * `maturityTier` field.
 */
function evaluateMaturityTier(space: SpaceJson, check: CheckDefinition): CheckResult {
  const TIER_RANK: Record<string, number> = {
    not_ready: 0,
    ready_to_optimize: 1,
    trusted: 2,
  };
  const minTier = ((check.params.min_tier as string) ?? "ready_to_optimize").toLowerCase();
  const minRank = TIER_RANK[minTier] ?? 1;

  const tables = (space?.data_sources?.tables ?? []) as unknown[];
  const measures = (space?.instructions?.sql_snippets?.measures ?? []) as unknown[];
  const trustedAssets = (space?.instructions?.example_question_sqls ?? []) as Array<{
    sql?: unknown;
  }>;
  const tablesDescribed = ((space?.data_sources?.tables ?? []) as Array<{
    description?: unknown;
  }>).filter((t) => {
    const d = t.description;
    if (Array.isArray(d)) return d.some((s) => typeof s === "string" && s.trim().length > 0);
    return typeof d === "string" && d.trim().length > 0;
  }).length;
  const trustedWithSql = trustedAssets.filter((t) => {
    const s = t.sql;
    if (Array.isArray(s)) return s.some((x) => typeof x === "string" && x.trim().length > 0);
    return typeof s === "string" && s.trim().length > 0;
  }).length;

  let tier: "not_ready" | "ready_to_optimize" | "trusted" = "not_ready";
  if (tablesDescribed >= 4 && measures.length >= 3 && trustedWithSql >= 5) {
    tier = "trusted";
  } else if (tables.length >= 1 && (measures.length >= 1 || trustedWithSql >= 1)) {
    tier = "ready_to_optimize";
  }

  const passed = (TIER_RANK[tier] ?? 0) >= minRank;
  return buildResult(check, passed, `Tier: ${tier} (required: ${minTier})`);
}

// ---------------------------------------------------------------------------
// Evaluator registry
// ---------------------------------------------------------------------------

const EVALUATORS: Record<string, (space: SpaceJson, check: CheckDefinition) => CheckResult> = {
  count: evaluateCount,
  range: evaluateRange,
  exists: evaluateExists,
  length: evaluateLength,
  ratio: evaluateRatio,
  nested_ratio: evaluateNestedRatio,
  pattern: evaluatePattern,
  unique: evaluateUnique,
  no_empty_field: evaluateNoEmptyField,
  conditional_count: evaluateConditionalCount,
  jsonpath: evaluateJsonpath,
  llm_qualitative: evaluateLlmQualitative,
  sql_quality: evaluateSqlQuality,
  instruction_quality: evaluateInstructionQuality,
  casing_consistency: evaluateCasingConsistency,
  maturity_tier: evaluateMaturityTier,
};

/**
 * Run a single check against a serialized space JSON.
 * Returns null if the evaluator type is unrecognized.
 */
export function runEvaluator(space: SpaceJson, check: CheckDefinition): CheckResult | null {
  const evaluator = EVALUATORS[check.evaluator];
  if (!evaluator) return null;
  return evaluator(space, check);
}

/** Returns the set of registered evaluator type names. */
export function getRegisteredEvaluators(): Set<string> {
  return new Set(Object.keys(EVALUATORS));
}
