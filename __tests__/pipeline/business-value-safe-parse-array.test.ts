/**
 * Regression test for the silent "0 stakeholders generated" failure mode.
 *
 * The BV array passes (financial-quantification, roadmap-phasing,
 * stakeholder-analysis) ask the LLM for a top-level JSON array in their
 * prompts, but the LLM call is made with `responseFormat: "json_object"`,
 * which lets the model legitimately wrap the array in an object like
 * `{"stakeholders": [...]}`.
 *
 * In production (forge-bv, run 09a4786e, May 21 2026), Opus 4-7 returned
 * 21KB of valid JSON for the stakeholder pass and GPT-5.4 returned 27KB on
 * the fallback attempt — both wrapped in `{"stakeholders": [...]}`. The
 * old `safeParse<RawProfile[]>` returned an object cast as an array, `.length`
 * came back undefined, both attempts were flagged as `llm_empty`, and the
 * step degraded with 0 profiles. The two other array passes happened to be
 * served raw arrays by Opus on the same run, so the bug was latent.
 *
 * `safeParseArray<T>` accepts either a raw array, a top-level object with a
 * known wrapper key, or any single-array-valued object as a last resort. It
 * is exported for this test only.
 */

import { describe, it, expect } from "vitest";
import { safeParseArray } from "@/lib/pipeline/steps/business-value-analysis";

type Profile = { role: string };

describe("safeParseArray", () => {
  it("returns a top-level array unchanged", () => {
    const raw = JSON.stringify([{ role: "CFO" }, { role: "COO" }]);
    expect(safeParseArray<Profile>(raw)).toEqual([{ role: "CFO" }, { role: "COO" }]);
  });

  it("unwraps the canonical {stakeholders: [...]} shape that triggered the bug", () => {
    const raw = JSON.stringify({
      stakeholders: [{ role: "CDO" }, { role: "VP Marketing" }],
    });
    expect(safeParseArray<Profile>(raw)).toEqual([
      { role: "CDO" },
      { role: "VP Marketing" },
    ]);
  });

  it("unwraps {profiles: [...]} (alternate Opus phrasing)", () => {
    const raw = JSON.stringify({ profiles: [{ role: "CMO" }] });
    expect(safeParseArray<Profile>(raw)).toEqual([{ role: "CMO" }]);
  });

  it("unwraps {estimates: [...]} for the financial-quantification pass", () => {
    const raw = JSON.stringify({
      estimates: [{ value_low: 1 }, { value_low: 2 }],
    });
    expect(safeParseArray<{ value_low: number }>(raw)).toEqual([
      { value_low: 1 },
      { value_low: 2 },
    ]);
  });

  it("unwraps {phases: [...]} for the roadmap-phasing pass", () => {
    const raw = JSON.stringify({ phases: [{ phase: "quick_wins" }] });
    expect(safeParseArray<{ phase: string }>(raw)).toEqual([{ phase: "quick_wins" }]);
  });

  it("falls back to first array-valued field on an unknown wrapper key", () => {
    const raw = JSON.stringify({
      notes: "some preamble",
      records: [{ role: "VP Ops" }],
    });
    expect(safeParseArray<Profile>(raw)).toEqual([{ role: "VP Ops" }]);
  });

  it("returns [] for null/undefined/empty input", () => {
    expect(safeParseArray<Profile>(null)).toEqual([]);
    expect(safeParseArray<Profile>(undefined)).toEqual([]);
    expect(safeParseArray<Profile>("")).toEqual([]);
  });

  it("returns [] for an object with no array-valued fields", () => {
    const raw = JSON.stringify({ summary: "hello", count: 3 });
    expect(safeParseArray<Profile>(raw)).toEqual([]);
  });

  it("returns [] for unparseable JSON", () => {
    expect(safeParseArray<Profile>("not json at all")).toEqual([]);
  });

  it("strips ```json fences before parsing", () => {
    const raw = "```json\n[{\"role\":\"CIO\"}]\n```";
    expect(safeParseArray<Profile>(raw)).toEqual([{ role: "CIO" }]);
  });

  it("strips ```json fences around a wrapped object", () => {
    const raw = "```json\n{\"stakeholders\":[{\"role\":\"CIO\"}]}\n```";
    expect(safeParseArray<Profile>(raw)).toEqual([{ role: "CIO" }]);
  });
});
