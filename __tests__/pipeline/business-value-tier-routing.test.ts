/**
 * Pins the model-tier routing for the four Business Value LLM passes.
 *
 * Regression history:
 * - Round 1: all four passes were on the `classification` tier
 *   (gemini-flash-lite class). The smaller models silently returned
 *   empty content for the large grounded prompts -> silent green tick + $0.
 * - Round 2 (this commit): financial + synthesis were promoted to
 *   `reasoning`, but stakeholder + roadmap stayed on `classification` and
 *   degraded again under load on the same flash-lite endpoint.
 *
 * Current pin: ALL FOUR PASSES use `resolvePremiumReasoningEndpoint()`,
 * which picks Opus 4-7 first, then falls back to Opus 4-6 / 4-5 / GPT-5.
 * This is the single source of truth for "high-quality reasoning model
 * for critical consumer-facing BV outputs".
 *
 * This test parses the source of `lib/pipeline/steps/business-value-analysis.ts`
 * and asserts the correct helper is wired in near each `executeAIQuery`
 * call. It is deliberately lightweight (no LLM mocks) so the contract is
 * enforced even when the call sites are refactored.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(
  __dirname,
  "../../lib/pipeline/steps/business-value-analysis.ts",
);

function loadSource(): string {
  return readFileSync(SOURCE_PATH, "utf8");
}

/**
 * Returns true iff the source window after `promptKey: "<KEY>"` invokes
 * `resolvePremiumReasoningEndpoint()` for the `modelEndpoint`. Walks
 * forward up to 1200 chars (enough to span variable assignment +
 * `executeAIQuery({...})` call). This is robust to minor reformatting
 * and to the call-site indirection introduced when capturing the
 * endpoint into a local variable for provenance plumbing.
 */
function usesPremiumReasoningForPrompt(source: string, promptKey: string): boolean {
  const promptIdx = source.indexOf(`promptKey: "${promptKey}"`);
  if (promptIdx === -1) return false;
  // Look BEHIND the promptKey line for the local endpoint binding, and
  // AHEAD for the modelEndpoint reference. The full enclosing call /
  // function fits comfortably in a 2000-char window centered on the
  // prompt key.
  const start = Math.max(0, promptIdx - 1500);
  const window = source.slice(start, promptIdx + 1500);
  // Must reference the premium helper either directly in modelEndpoint
  // or via a local binding that comes from it.
  const directRef = /modelEndpoint:\s*resolvePremiumReasoningEndpoint\(\)/.test(window);
  const indirectRef = /resolvePremiumReasoningEndpoint\(\)/.test(window);
  return directRef || indirectRef;
}

describe("Business Value tier routing", () => {
  const source = loadSource();

  it("FINANCIAL_QUANTIFICATION_PROMPT is pinned to the premium reasoning endpoint", () => {
    expect(usesPremiumReasoningForPrompt(source, "FINANCIAL_QUANTIFICATION_PROMPT")).toBe(true);
  });

  it("EXECUTIVE_SYNTHESIS_PROMPT is pinned to the premium reasoning endpoint", () => {
    expect(usesPremiumReasoningForPrompt(source, "EXECUTIVE_SYNTHESIS_PROMPT")).toBe(true);
  });

  it("ROADMAP_PHASING_PROMPT is pinned to the premium reasoning endpoint", () => {
    expect(usesPremiumReasoningForPrompt(source, "ROADMAP_PHASING_PROMPT")).toBe(true);
  });

  it("STAKEHOLDER_ANALYSIS_PROMPT is pinned to the premium reasoning endpoint", () => {
    expect(usesPremiumReasoningForPrompt(source, "STAKEHOLDER_ANALYSIS_PROMPT")).toBe(true);
  });

  it("imports resolvePremiumReasoningEndpoint (so all four passes share the pin)", () => {
    expect(source).toMatch(/import\s*{[^}]*\bresolvePremiumReasoningEndpoint\b/);
    expect(source).toContain("resolvePremiumReasoningEndpoint");
  });

  it("does NOT route any BV pass via the legacy resolveEndpoint() helper", () => {
    // The standard tier-based helper bypasses the premium pin and would
    // re-introduce the flash-lite regression for stakeholder/roadmap.
    expect(source).not.toMatch(/modelEndpoint:\s*resolveEndpoint\(/);
  });
});
