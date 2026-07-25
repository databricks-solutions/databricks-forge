/**
 * Tests for the `/runs` polling predicate.
 *
 * The polling effect in `RunsContent` watches a derived primitive
 * `hasActiveRuns` (computed from this helper) so the `setInterval` is
 * only torn down when active-status presence flips. The prior bug was
 * that the effect depended on the entire `runs` array reference -- so
 * every poll re-created the interval, multiplying load and amplifying
 * the heavy-payload serialization that caused the original "Maximum
 * call stack size exceeded" symptom.
 *
 * These tests pin down:
 *   1. Which statuses count as "active" (the polling trigger).
 *   2. That the predicate is stable: structurally different arrays with
 *      the same active/inactive mix produce the same boolean -- which
 *      is what keeps the polling effect dep stable across renders.
 */

import { describe, it, expect } from "vitest";
import { hasActiveRunStatuses } from "@/components/runs/active-status";

describe("hasActiveRunStatuses", () => {
  it("returns false for an empty list", () => {
    expect(hasActiveRunStatuses([])).toBe(false);
  });

  it.each([
    ["running"],
    ["pending"],
    ["queued"],
  ])("returns true when a run has status %s", (status) => {
    expect(hasActiveRunStatuses([{ status }])).toBe(true);
  });

  it.each([
    ["completed"],
    ["failed"],
    ["cancelled"],
    ["unknown"],
  ])("returns false when the only run has terminal status %s", (status) => {
    expect(hasActiveRunStatuses([{ status }])).toBe(false);
  });

  it("returns true when any one of many runs is active", () => {
    expect(
      hasActiveRunStatuses([
        { status: "completed" },
        { status: "completed" },
        { status: "running" },
      ]),
    ).toBe(true);
  });

  it("is stable across renders: different array references with the same active mix yield the same boolean", () => {
    // Simulates two consecutive polls. The Prisma row order may differ
    // and one of the statuses may have updated its statusMessage, but
    // the active/inactive shape is identical -- so the boolean must
    // be identical, which keeps the polling effect's dep stable.
    const poll1 = [
      { status: "completed", runId: "a" },
      { status: "running", runId: "b" },
    ];
    const poll2 = [
      { status: "running", runId: "b" },
      { status: "completed", runId: "a" },
    ];
    expect(hasActiveRunStatuses(poll1)).toBe(hasActiveRunStatuses(poll2));
  });

  it("flips to false only when no run is active anymore", () => {
    const beforeRunFinishes = [{ status: "running" }, { status: "completed" }];
    const afterRunFinishes = [{ status: "completed" }, { status: "completed" }];
    expect(hasActiveRunStatuses(beforeRunFinishes)).toBe(true);
    expect(hasActiveRunStatuses(afterRunFinishes)).toBe(false);
  });
});
