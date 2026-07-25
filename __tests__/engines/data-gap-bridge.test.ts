/**
 * Tests for `bridgeEstimatesToMasterRepo`, the helper that aligns customer
 * BV estimate names with master-repo UC titles before the value-at-risk
 * aggregators run.
 *
 * Three properties enforced:
 *
 *   1. **Rename via fuzzy match** -- a customer estimate whose name is a
 *      Jaccard-tier match (not exact) for a master-repo UC is rewritten to
 *      carry the master-repo `name`. This is the property that the
 *      production bug violated.
 *   2. **Sum on collision** -- two customer estimates that both match the
 *      same master-repo UC produce ONE aggregated entry whose low/mid/high
 *      are the arithmetic sum. We never silently drop the second one.
 *   3. **Passthrough on no match** -- a customer estimate with no fuzzy
 *      match for any master-repo UC is emitted unchanged so the engine can
 *      still hit it via the original-name lookup (rare in production but a
 *      correctness guarantee).
 *
 * Pure-function tests, no Prisma / network mocking needed.
 */

import { describe, it, expect } from "vitest";

import { bridgeEstimatesToMasterRepo } from "@/lib/engines/data-gap-analysis/economic-value";
import type { MasterRepoUseCase } from "@/lib/domain/industry-outcomes/master-repo-types";

const REF: MasterRepoUseCase[] = [
  {
    name: "Customer Lifetime Value Modeling",
    description: "",
    dataAssetIds: ["A01"],
    dataAssetCriticality: { A01: "MC" },
  },
  {
    name: "Real-Time Fraud Detection",
    description: "",
    dataAssetIds: ["A02"],
    dataAssetCriticality: { A02: "MC" },
  },
];

function makeEstimate(overrides: {
  useCaseId: string;
  name: string;
  valueLow?: number;
  valueMid?: number;
  valueHigh?: number;
  referenceUseCaseName?: string | null;
}) {
  return {
    useCaseId: overrides.useCaseId,
    name: overrides.name,
    valueLow: overrides.valueLow ?? 100_000,
    valueMid: overrides.valueMid ?? 500_000,
    valueHigh: overrides.valueHigh ?? 1_000_000,
    economicImpactCategory: "Cost" as const,
    referenceUseCaseName: overrides.referenceUseCaseName ?? null,
  };
}

describe("bridgeEstimatesToMasterRepo", () => {
  it("renames a Jaccard-matched customer name to the master-repo name", () => {
    // Customer name shares the meaningful tokens {customer, lifetime, value}
    // with "Customer Lifetime Value Modeling" -> Jaccard tier match.
    const bridged = bridgeEstimatesToMasterRepo(
      [
        makeEstimate({
          useCaseId: "uc-1",
          name: "Customer Lifetime Value Prediction Engine",
        }),
      ],
      REF,
    );
    expect(bridged).toHaveLength(1);
    expect(bridged[0]!.name).toBe("Customer Lifetime Value Modeling");
    expect(bridged[0]!.useCaseId).toBe("uc-1");
    expect(bridged[0]!.valueMid).toBe(500_000);
  });

  it("sums low/mid/high when two customer estimates collide on the same master-repo UC", () => {
    const bridged = bridgeEstimatesToMasterRepo(
      [
        makeEstimate({
          useCaseId: "uc-a",
          name: "Customer Lifetime Value Prediction Engine",
          valueLow: 100_000,
          valueMid: 500_000,
          valueHigh: 1_000_000,
        }),
        makeEstimate({
          useCaseId: "uc-b",
          name: "Lifetime Value Customer Scoring Model",
          valueLow: 50_000,
          valueMid: 250_000,
          valueHigh: 600_000,
        }),
      ],
      REF,
    );
    expect(bridged).toHaveLength(1);
    expect(bridged[0]!.name).toBe("Customer Lifetime Value Modeling");
    expect(bridged[0]!.valueLow).toBe(150_000);
    expect(bridged[0]!.valueMid).toBe(750_000);
    expect(bridged[0]!.valueHigh).toBe(1_600_000);
    // The first matching estimate's useCaseId/economicImpactCategory are
    // preserved on the aggregated row (informational only).
    expect(bridged[0]!.useCaseId).toBe("uc-a");
  });

  it("passes through estimates that fuzzy-match nothing", () => {
    const bridged = bridgeEstimatesToMasterRepo(
      [
        makeEstimate({
          useCaseId: "uc-z",
          name: "Completely Unrelated Logistics Optimization",
        }),
      ],
      REF,
    );
    expect(bridged).toHaveLength(1);
    expect(bridged[0]!.name).toBe("Completely Unrelated Logistics Optimization");
    expect(bridged[0]!.useCaseId).toBe("uc-z");
  });

  it("no-ops when the customer name already exactly matches a master-repo name", () => {
    const bridged = bridgeEstimatesToMasterRepo(
      [makeEstimate({ useCaseId: "uc-x", name: "Real-Time Fraud Detection" })],
      REF,
    );
    expect(bridged).toHaveLength(1);
    expect(bridged[0]!.name).toBe("Real-Time Fraud Detection");
    expect(bridged[0]!.useCaseId).toBe("uc-x");
  });

  it("returns an empty array for empty input", () => {
    const bridged = bridgeEstimatesToMasterRepo([], REF);
    expect(bridged).toEqual([]);
  });

  // ---------------------------------------------------------------------
  // Persisted FK: `referenceUseCaseName` preferred over fuzzy `name`
  // ---------------------------------------------------------------------

  it("prefers `referenceUseCaseName` over the fuzzy ladder on the `name` field", () => {
    // `name` has zero meaningful tokens in common with any master-repo UC,
    // so the fuzzy ladder WOULD return null. The persisted FK saves the day.
    const bridged = bridgeEstimatesToMasterRepo(
      [
        makeEstimate({
          useCaseId: "uc-bespoke",
          name: "Operationalise Loyalty Tiering with Behavioural Cohorts",
          referenceUseCaseName: "Customer Lifetime Value Modeling",
        }),
      ],
      REF,
    );
    expect(bridged).toHaveLength(1);
    expect(bridged[0]!.name).toBe("Customer Lifetime Value Modeling");
    expect(bridged[0]!.useCaseId).toBe("uc-bespoke");
    expect(bridged[0]!.valueMid).toBe(500_000);
  });

  it("resolves `referenceUseCaseName` case-insensitively", () => {
    // The LLM may emit a lowercased / casing-shifted variant; the bridge
    // normalises against the master-repo canonical casing.
    const bridged = bridgeEstimatesToMasterRepo(
      [
        makeEstimate({
          useCaseId: "uc-case",
          name: "Predict Customer Anything",
          referenceUseCaseName: "customer lifetime value modeling",
        }),
      ],
      REF,
    );
    expect(bridged).toHaveLength(1);
    expect(bridged[0]!.name).toBe("Customer Lifetime Value Modeling");
  });

  it("falls back to fuzzy match when `referenceUseCaseName` is null", () => {
    // Legacy row (column not yet backfilled). The fuzzy ladder still
    // catches the close customer-name match.
    const bridged = bridgeEstimatesToMasterRepo(
      [
        makeEstimate({
          useCaseId: "uc-legacy",
          name: "Customer Lifetime Value Prediction Engine",
          referenceUseCaseName: null,
        }),
      ],
      REF,
    );
    expect(bridged).toHaveLength(1);
    expect(bridged[0]!.name).toBe("Customer Lifetime Value Modeling");
  });

  it("falls back to fuzzy match when `referenceUseCaseName` points at an unknown title", () => {
    // Defensive: should the LLM hallucinate a name that doesn't exist in
    // the master repo, we don't want to silently drop the estimate.
    const bridged = bridgeEstimatesToMasterRepo(
      [
        makeEstimate({
          useCaseId: "uc-bad-fk",
          name: "Customer Lifetime Value Prediction Engine",
          referenceUseCaseName: "This Reference Does Not Exist",
        }),
      ],
      REF,
    );
    expect(bridged).toHaveLength(1);
    expect(bridged[0]!.name).toBe("Customer Lifetime Value Modeling");
  });

  it("sums values when persisted FK + fuzzy match collide on the same master-repo UC", () => {
    // One estimate carries the FK explicitly, the other relies on the
    // fuzzy fallback. Both should resolve to the same master-repo UC and
    // their values should sum on collision.
    const bridged = bridgeEstimatesToMasterRepo(
      [
        makeEstimate({
          useCaseId: "uc-fk",
          name: "Bespoke Phrasing With No Token Overlap",
          referenceUseCaseName: "Real-Time Fraud Detection",
          valueLow: 100_000,
          valueMid: 500_000,
          valueHigh: 1_000_000,
        }),
        makeEstimate({
          useCaseId: "uc-fuzzy",
          name: "Real Time Fraud Detection Engine",
          referenceUseCaseName: null,
          valueLow: 50_000,
          valueMid: 250_000,
          valueHigh: 600_000,
        }),
      ],
      REF,
    );
    expect(bridged).toHaveLength(1);
    expect(bridged[0]!.name).toBe("Real-Time Fraud Detection");
    expect(bridged[0]!.valueLow).toBe(150_000);
    expect(bridged[0]!.valueMid).toBe(750_000);
    expect(bridged[0]!.valueHigh).toBe(1_600_000);
  });
});
