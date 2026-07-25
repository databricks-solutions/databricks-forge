import { describe, expect, it } from "vitest";

import {
  findTrackedDashboardForDomain,
  indexSemanticManifests,
  missingDashboardManifestDomains,
  selectDashboardDomainGroups,
} from "@/lib/dashboard/domain-groups";
import type { UseCase } from "@/lib/domain/types";
import type { SemanticAssetManifest } from "@/lib/semantic-assets/types";

function useCase(id: string, domain: string): UseCase {
  return {
    id,
    domain,
    subdomain: "",
    tablesInvolved: [],
  } as unknown as UseCase;
}

function manifest(domain: string): SemanticAssetManifest {
  return {
    version: "1",
    domain,
    subdomains: [],
    metricViews: [],
    measures: [],
    dimensions: [],
    filters: [],
    generatedAt: "2026-07-25T00:00:00.000Z",
  };
}

describe("dashboard domain groups", () => {
  it("merges Procurement and Inventory into the normalized Supply Chain group", () => {
    const groups = selectDashboardDomainGroups([
      useCase("procurement", "Procurement"),
      useCase("inventory", " Inventory "),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      domain: "Supply Chain",
      useCases: [{ id: "procurement" }, { id: "inventory" }],
    });
  });

  it.each([
    ["Sales", "Sales Analytics"],
    [" Customer ", "Customer Insights"],
  ])("normalizes %s to the Genie domain %s", (rawDomain, normalizedDomain) => {
    const groups = selectDashboardDomainGroups([useCase("uc-1", rawDomain)]);

    expect(groups.map((group) => group.domain)).toEqual([normalizedDomain]);
  });

  it("matches explicit filters using normalized Genie domain names", () => {
    const groups = selectDashboardDomainGroups(
      [
        useCase("procurement", "Procurement"),
        useCase("sales", "Sales"),
        useCase("customer", "Customer"),
      ],
      [" supply chain "],
    );

    expect(groups.map((group) => group.domain)).toEqual(["Supply Chain"]);
  });

  it("resolves persisted manifests through the same canonical key", () => {
    const supplyChainManifest = manifest("Supply Chain");
    const manifests = { Procurement: supplyChainManifest };
    const groups = selectDashboardDomainGroups([useCase("inventory", "Inventory")]);

    expect(indexSemanticManifests(manifests).get("supply chain")).toBe(supplyChainManifest);
    expect(missingDashboardManifestDomains(groups, manifests)).toEqual([]);
  });

  it("admits manifests whose raw labels differ but share one canonical bucket", () => {
    // Procurement and Inventory are deliberate aliases of Supply Chain, so a
    // recommendation keyed with one alias may legitimately carry a manifest
    // labelled with the other. Matching is on canonical vocabulary, not on
    // identical raw strings.
    const inventoryManifest = manifest("Inventory");
    const manifests = { Procurement: inventoryManifest };

    expect(indexSemanticManifests(manifests).get("supply chain")).toBe(inventoryManifest);
    expect(
      missingDashboardManifestDomains(
        selectDashboardDomainGroups([useCase("uc-1", "Procurement")]),
        manifests,
      ),
    ).toEqual([]);
  });

  it("rejects a manifest that canonicalizes to a different bucket than its key", () => {
    const financeManifest = manifest("Finance");
    const manifests = { Procurement: financeManifest };

    expect(indexSemanticManifests(manifests).size).toBe(0);
    expect(
      missingDashboardManifestDomains(
        selectDashboardDomainGroups([useCase("uc-1", "Procurement")]),
        manifests,
      ),
    ).toEqual(["Supply Chain"]);
  });

  it("preserves case and whitespace-insensitive matching for custom domains", () => {
    const groups = selectDashboardDomainGroups([useCase("risk", "  risk_ops  ")], [" RISK OPS "]);

    expect(groups.map((group) => group.domain)).toEqual(["Risk Ops"]);
  });
});

describe("tracked dashboard domain resolution", () => {
  const legacy = { id: "legacy", domain: "Procurement", status: "created" };
  const canonical = { id: "canonical", domain: "Supply Chain", status: "created" };

  it("adopts a pre-canonicalization alias row for the canonical domain", () => {
    expect(findTrackedDashboardForDomain([legacy], "Supply Chain")).toBe(legacy);
  });

  it("prefers an exact label match over an alias-canonical match", () => {
    expect(findTrackedDashboardForDomain([legacy, canonical], "supply chain")).toBe(canonical);
  });

  it("ignores trashed rows in both matching passes", () => {
    expect(
      findTrackedDashboardForDomain(
        [
          { ...legacy, status: "trashed" },
          { ...canonical, status: "trashed" },
        ],
        "Supply Chain",
      ),
    ).toBeUndefined();
  });

  it("never matches on an empty or whitespace-only domain", () => {
    expect(
      findTrackedDashboardForDomain([{ id: "blank", domain: " ", status: "created" }], " "),
    ).toBeUndefined();
  });

  it("returns undefined for an unrelated domain", () => {
    expect(findTrackedDashboardForDomain([legacy, canonical], "Finance")).toBeUndefined();
  });
});
