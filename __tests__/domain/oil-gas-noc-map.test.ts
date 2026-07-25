import { describe, it, expect } from "vitest";
import {
  INDUSTRY_OUTCOMES,
  getIndustryOutcome,
} from "@/lib/domain/industry-outcomes/index";
import { getMasterRepoEnrichment } from "@/lib/domain/industry-outcomes/master-repo-registry";
import {
  OIL_GAS_NOC_USE_CASES,
  OIL_GAS_NOC_DATA_ASSETS,
} from "@/lib/domain/industry-outcomes/oil-gas-noc.enrichment";

describe("Oil & Gas (NOC) outcome map", () => {
  it("is registered as a built-in industry", () => {
    const map = getIndustryOutcome("oil-gas-noc");
    expect(map).toBeDefined();
    expect(map!.name).toContain("Oil & Gas");
    expect(INDUSTRY_OUTCOMES.some((i) => i.id === "oil-gas-noc")).toBe(true);
  });

  it("has the integrated NOC objectives", () => {
    const map = getIndustryOutcome("oil-gas-noc")!;
    const names = map.objectives.map((o) => o.name);
    expect(names).toContain("Maximize Production & Recovery");
    expect(names).toContain("LNG & Value-Chain Optimization");
    expect(names).toContain("Downstream & Petrochemical Yield");
    expect(names).toContain("Integrated Trading & Commercial");
    // Every objective has at least one priority with at least one use case.
    for (const obj of map.objectives) {
      expect(obj.priorities.length).toBeGreaterThan(0);
      for (const p of obj.priorities) {
        expect(p.useCases.length).toBeGreaterThan(0);
        expect(p.kpis.length).toBeGreaterThan(0);
        expect(p.personas.length).toBeGreaterThan(0);
      }
    }
  });

  it("exposes master-repo enrichment via the registry", () => {
    const enrichment = getMasterRepoEnrichment("oil-gas-noc");
    expect(enrichment).toBeDefined();
    expect(enrichment!.useCases.length).toBe(OIL_GAS_NOC_USE_CASES.length);
    expect(enrichment!.dataAssets.length).toBe(OIL_GAS_NOC_DATA_ASSETS.length);
  });

  it("every enrichment use-case name is a verbatim FK into the base map", () => {
    const map = getIndustryOutcome("oil-gas-noc")!;
    const baseUseCaseNames = new Set<string>();
    for (const obj of map.objectives) {
      for (const p of obj.priorities) {
        for (const uc of p.useCases) baseUseCaseNames.add(uc.name);
      }
    }
    for (const uc of OIL_GAS_NOC_USE_CASES) {
      expect(
        baseUseCaseNames.has(uc.name),
        `enrichment use case "${uc.name}" must match a base-map use case verbatim`,
      ).toBe(true);
    }
  });

  it("enrichment strategicImperative/strategicPillar match base objectives/priorities", () => {
    const map = getIndustryOutcome("oil-gas-noc")!;
    const objectiveNames = new Set(map.objectives.map((o) => o.name));
    const pillarNames = new Set(
      map.objectives.flatMap((o) => o.priorities.map((p) => p.name)),
    );
    for (const uc of OIL_GAS_NOC_USE_CASES) {
      if (uc.strategicImperative) {
        expect(
          objectiveNames.has(uc.strategicImperative),
          `"${uc.name}" strategicImperative "${uc.strategicImperative}" must be a base objective`,
        ).toBe(true);
      }
      if (uc.strategicPillar) {
        expect(
          pillarNames.has(uc.strategicPillar),
          `"${uc.name}" strategicPillar "${uc.strategicPillar}" must be a base priority`,
        ).toBe(true);
      }
    }
  });

  it("every dataAssetId referenced by a use case resolves to a defined data asset", () => {
    const assetIds = new Set(OIL_GAS_NOC_DATA_ASSETS.map((a) => a.id));
    for (const uc of OIL_GAS_NOC_USE_CASES) {
      for (const id of uc.dataAssetIds ?? []) {
        expect(assetIds.has(id), `use case "${uc.name}" references unknown asset ${id}`).toBe(
          true,
        );
      }
      // dataAssetCriticality keys must be a subset of dataAssetIds.
      for (const id of Object.keys(uc.dataAssetCriticality ?? {})) {
        expect(
          (uc.dataAssetIds ?? []).includes(id),
          `use case "${uc.name}" criticality key ${id} not in dataAssetIds`,
        ).toBe(true);
      }
    }
  });

  it("data asset ids are unique", () => {
    const ids = OIL_GAS_NOC_DATA_ASSETS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Oil & Gas industry detection", () => {
  it("routes hydrocarbon terms to oil-gas-noc and keeps utilities on energy-utilities", async () => {
    const { detectIndustryFromContext } = await import(
      "@/lib/domain/industry-outcomes-server"
    );
    expect(await detectIndustryFromContext("Oil & Gas")).toBe("oil-gas-noc");
    expect(await detectIndustryFromContext("LNG and upstream E&P")).toBe("oil-gas-noc");
    expect(await detectIndustryFromContext("refining and petrochemicals")).toBe("oil-gas-noc");
    expect(await detectIndustryFromContext("electric utilities and renewables")).toBe(
      "energy-utilities",
    );
  });
});
