/**
 * Centralised registration of in-code prompt defaults for the Genie passes.
 *
 * Imported once at module load (via `lib/genie/passes/index.ts` re-export).
 * Every pass that wants to be customer-overridable calls
 * `getPromptSync("genie.passes.<name>")` to read its template; if Lakebase
 * has an `active=true` `ForgePromptVersion` row for that key, the override
 * is used. Otherwise the in-code default below is the source of truth.
 *
 * The plan's key principle:
 *   > Initially the in-code defaults are still source of truth; Lakebase
 *   > only kicks in when an admin uploads a v2.
 *
 * Adding a new prompt:
 *   1. Register the canonical text below with `registerDefaultPrompt`.
 *   2. In the pass, replace the template literal with `getPromptSync(key)`.
 *   3. Add a snapshot test that asserts the registered template matches.
 */

import { registerDefaultPrompt } from "@/lib/ai/prompt-registry";

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export const PROMPT_KEYS = {
  benchmarkAlignmentRuntimeHint: "genie.passes.benchmark_alignment.runtime_hint",
  instructionGslSystem: "genie.passes.instruction_generation.gsl_system",
} as const;

// ---------------------------------------------------------------------------
// Defaults (v1)
// ---------------------------------------------------------------------------

registerDefaultPrompt(
  PROMPT_KEYS.benchmarkAlignmentRuntimeHint,
  1,
  [
    "BENCHMARK ALIGNMENT REVIEW.",
    "Question: {{question}}",
    "Decide whether the SQL above is the most DIRECT query that answers this question.",
    "If not, rewrite it tighter using the simplest possible SELECT/WHERE/GROUP BY.",
    'If you cannot reasonably tighten it, leave the verdict as "pass" with no fixed_sql.',
    'If you believe the question is unanswerable from the schema, return verdict "fail" with no fixed_sql.',
  ].join("\n"),
  "Runtime hint passed to reviewSql for benchmark-alignment rewriting.",
);

registerDefaultPrompt(
  PROMPT_KEYS.instructionGslSystem,
  1,
  [
    "You are writing the canonical text instruction block for a Databricks Genie space.",
    "Follow the GSL schema below EXACTLY. Output the markdown block only -- no preamble, no code fences.",
  ].join("\n"),
  "GSL system message used when generating canonical instruction blocks.",
);
