/**
 * Unit tests for the use-case to data-asset attribution helper used by the
 * `/api/runs/[runId]/data-gap` route. The helper exists because pipeline
 * runs do not persist a per-table `dataAssetId` column, so the route
 * derives one by matching generated use case names to the master-repository
 * reference catalogue.
 *
 * The original implementation matched by exact (case-insensitive) title and
 * silently produced zero attributions on real runs because the use-case
 * generation prompt forbids the LLM from copying reference titles verbatim.
 * These tests pin the three-tier matcher (exact -> token-Jaccard ->
 * substring containment) and the multi-MC propagation that replaces it.
 */

import { describe, it, expect } from "vitest";

import {
  attributeTablesToAssets,
  findReferenceMatch,
} from "@/lib/engines/data-gap-analysis/use-case-attribution";
import type {
  MasterRepoEnrichment,
  MasterRepoUseCase,
  ReferenceDataAsset,
} from "@/lib/domain/industry-outcomes/master-repo-types";

function makeAsset(id: string, family = "F"): ReferenceDataAsset {
  return {
    id,
    name: `Asset ${id}`,
    description: "",
    systemLocation: "Snowflake",
    assetFamily: family,
    easeOfAccess: "Medium",
    lakeflowConnect: "Low",
    ucFederation: "High",
    lakebridgeMigrate: "Low",
  };
}

function makeRefUc(
  name: string,
  mcAssets: string[],
  vaAssets: string[] = [],
): MasterRepoUseCase {
  const dataAssetIds = [...mcAssets, ...vaAssets];
  const dataAssetCriticality: Record<string, "MC" | "VA"> = {};
  for (const id of mcAssets) dataAssetCriticality[id] = "MC";
  for (const id of vaAssets) dataAssetCriticality[id] = "VA";
  return { name, description: "", dataAssetIds, dataAssetCriticality };
}

function makeEnrichment(useCases: MasterRepoUseCase[]): MasterRepoEnrichment {
  const assetIds = new Set<string>();
  for (const uc of useCases) for (const id of uc.dataAssetIds ?? []) assetIds.add(id);
  return {
    useCases,
    dataAssets: [...assetIds].map((id) => makeAsset(id)),
  };
}

describe("findReferenceMatch", () => {
  const refs = [
    makeRefUc("Customer Lifetime Value Modeling", ["A1"]),
    makeRefUc("Inventory Demand Forecasting", ["A2"]),
    makeRefUc("Real-Time Fraud Detection", ["A3"]),
  ];

  it("matches on case-insensitive exact title (tier 1)", () => {
    const m = findReferenceMatch("customer lifetime value modeling", refs);
    expect(m?.name).toBe("Customer Lifetime Value Modeling");
  });

  it("matches via token-Jaccard when the LLM rephrases the title (tier 2)", () => {
    // The use-case-generation prompt explicitly forbids verbatim copies, so
    // rephrasing is the common production path.
    const m = findReferenceMatch("Customer Lifetime Value Prediction", refs);
    expect(m?.name).toBe("Customer Lifetime Value Modeling");
  });

  it("matches via substring containment when fuzzy threshold is missed (tier 3)", () => {
    // "Real-Time Fraud Detection" sits inside the longer LLM title.
    const m = findReferenceMatch(
      "AI-Powered Real-Time Fraud Detection across Channels",
      refs,
    );
    expect(m?.name).toBe("Real-Time Fraud Detection");
  });

  it("returns null when no tier matches", () => {
    expect(findReferenceMatch("Climate Risk Stress Testing", refs)).toBeNull();
  });

  it("does not match on a single shared low-signal token", () => {
    // "Customer" alone is below the Jaccard threshold and not a substring.
    expect(findReferenceMatch("Customer Survey Sentiment", refs)).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(findReferenceMatch("", refs)).toBeNull();
  });
});

describe("attributeTablesToAssets", () => {
  it("propagates ALL MC asset ids to every table -- not just the first", () => {
    // The pre-fix implementation kept only the first MC asset per table.
    // Ensure both MC assets now flow through.
    const enrichment = makeEnrichment([
      makeRefUc("Demand Forecasting", ["MC1", "MC2"], ["VA1"]),
    ]);

    const out = attributeTablesToAssets({
      useCases: [{ name: "Demand Forecasting", tablesInvolved: ["cat.s.t1"] }],
      enrichment,
    });

    expect(out).toHaveLength(2);
    const assetIds = new Set(out.map((r) => r.dataAssetId));
    expect(assetIds).toEqual(new Set(["MC1", "MC2"]));
    expect(out.every((r) => r.fqn === "cat.s.t1")).toBe(true);
  });

  it("dedupes (fqn, assetId) pairs across multiple matched UCs", () => {
    // Two generated UCs hit the same ref UC and share a table; we must not
    // double-count the table on the asset coverage row.
    const enrichment = makeEnrichment([
      makeRefUc("Demand Forecasting", ["MC1"]),
    ]);

    const out = attributeTablesToAssets({
      useCases: [
        { name: "Demand Forecasting", tablesInvolved: ["cat.s.t1"] },
        // Different rephrasing, same ref UC.
        { name: "AI Demand Forecasting Model", tablesInvolved: ["cat.s.t1"] },
      ],
      enrichment,
    });

    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ fqn: "cat.s.t1", dataAssetId: "MC1" });
  });

  it("ignores generated UCs that have no Mission-Critical asset in the matched ref", () => {
    // VA-only matches do not contribute to MC coverage attribution.
    const enrichment = makeEnrichment([
      makeRefUc("VA-Only Pattern", [], ["VA1"]),
    ]);
    const out = attributeTablesToAssets({
      useCases: [{ name: "VA-Only Pattern", tablesInvolved: ["cat.s.t1"] }],
      enrichment,
    });
    expect(out).toEqual([]);
  });

  it("emits one row per (table, asset) pair when one UC has multiple tables", () => {
    const enrichment = makeEnrichment([
      makeRefUc("Customer Lifetime Value Modeling", ["MC1", "MC2"]),
    ]);
    const out = attributeTablesToAssets({
      useCases: [
        // Rephrased -- exercises tier 2.
        {
          name: "Customer Lifetime Value Prediction",
          tablesInvolved: ["cat.s.customers", "cat.s.orders"],
        },
      ],
      enrichment,
    });
    // 2 tables * 2 MC assets = 4 rows.
    expect(out).toHaveLength(4);
    const pairs = new Set(out.map((r) => `${r.fqn}|${r.dataAssetId}`));
    expect(pairs).toEqual(
      new Set([
        "cat.s.customers|MC1",
        "cat.s.customers|MC2",
        "cat.s.orders|MC1",
        "cat.s.orders|MC2",
      ]),
    );
  });

  it("returns no rows when no generated UC names match any reference", () => {
    const enrichment = makeEnrichment([makeRefUc("Demand Forecasting", ["MC1"])]);
    const out = attributeTablesToAssets({
      useCases: [
        { name: "Climate Risk Stress Testing", tablesInvolved: ["cat.s.t1"] },
      ],
      enrichment,
    });
    expect(out).toEqual([]);
  });

  it("tolerates missing/null tablesInvolved", () => {
    const enrichment = makeEnrichment([makeRefUc("Demand Forecasting", ["MC1"])]);
    const out = attributeTablesToAssets({
      useCases: [
        { name: "Demand Forecasting" },
        { name: "Demand Forecasting", tablesInvolved: null },
        { name: "Demand Forecasting", tablesInvolved: [] },
      ],
      enrichment,
    });
    expect(out).toEqual([]);
  });

  // ---------------------------------------------------------------------
  // Persisted FK preference (`referenceUseCaseName` short-circuits fuzzy)
  // ---------------------------------------------------------------------

  it("prefers persisted `referenceUseCaseName` over fuzzy `name` matching", () => {
    // The customer-facing name shares NO meaningful tokens with the
    // reference title; the fuzzy ladder would return null. The persisted
    // FK rescues the attribution.
    const enrichment = makeEnrichment([
      makeRefUc("Customer Lifetime Value Modeling", ["MC1"]),
    ]);
    const out = attributeTablesToAssets({
      useCases: [
        {
          name: "Operationalise Loyalty Tiering with Behavioural Cohorts",
          referenceUseCaseName: "Customer Lifetime Value Modeling",
          tablesInvolved: ["cat.s.customers"],
        },
      ],
      enrichment,
    });
    expect(out).toEqual([{ fqn: "cat.s.customers", dataAssetId: "MC1" }]);
  });

  it("resolves persisted `referenceUseCaseName` case-insensitively", () => {
    const enrichment = makeEnrichment([
      makeRefUc("Customer Lifetime Value Modeling", ["MC1"]),
    ]);
    const out = attributeTablesToAssets({
      useCases: [
        {
          name: "Bespoke",
          referenceUseCaseName: "customer lifetime value modeling",
          tablesInvolved: ["cat.s.t"],
        },
      ],
      enrichment,
    });
    expect(out).toEqual([{ fqn: "cat.s.t", dataAssetId: "MC1" }]);
  });

  it("falls back to fuzzy match when `referenceUseCaseName` is null (legacy row)", () => {
    const enrichment = makeEnrichment([
      makeRefUc("Customer Lifetime Value Modeling", ["MC1"]),
    ]);
    const out = attributeTablesToAssets({
      useCases: [
        {
          name: "Customer Lifetime Value Prediction Engine",
          referenceUseCaseName: null,
          tablesInvolved: ["cat.s.t"],
        },
      ],
      enrichment,
    });
    expect(out).toEqual([{ fqn: "cat.s.t", dataAssetId: "MC1" }]);
  });

  it("falls back to fuzzy match when `referenceUseCaseName` points at an unknown title", () => {
    // Defensive: an LLM-emitted name that doesn't exist in this run's
    // master repo should not silently drop attribution.
    const enrichment = makeEnrichment([
      makeRefUc("Customer Lifetime Value Modeling", ["MC1"]),
    ]);
    const out = attributeTablesToAssets({
      useCases: [
        {
          name: "Customer Lifetime Value Prediction Engine",
          referenceUseCaseName: "Not A Real Reference",
          tablesInvolved: ["cat.s.t"],
        },
      ],
      enrichment,
    });
    expect(out).toEqual([{ fqn: "cat.s.t", dataAssetId: "MC1" }]);
  });
});
