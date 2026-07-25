import { describe, it, expect } from "vitest";
import { runPortfolioSynthesis } from "@/lib/ai/portfolio-synthesis/engine";
import type { PortfolioSynthesisInput } from "@/lib/ai/portfolio-synthesis/types";
import type { PortfolioOverview, PortfolioEstateSummary } from "@/lib/lakebase/portfolio-estate";
import type { PortfolioEntity } from "@/lib/ai/portfolio-synthesis/entity-resolution";
import type { EstateScores } from "@/lib/domain/estate-synthesis-types";

function scores(over: Partial<EstateScores> = {}): EstateScores {
  return {
    overall: 50,
    band: "developing",
    governance: 50,
    quality: 50,
    freshness: 50,
    documentation: 50,
    analyticsMaturity: 50,
    cost: 50,
    ...over,
  } as EstateScores;
}

function estate(partial: Partial<PortfolioEstateSummary> & { estateId: string; name: string }): PortfolioEstateSummary {
  return {
    kind: "program",
    industryId: null,
    ownerEmail: "a@x.com",
    workspaceId: null,
    scanCount: 1,
    tableCount: 10,
    scores: null,
    readiness: 60,
    valueAtRiskMid: 0,
    lastScannedAt: null,
    ...partial,
  };
}

function overview(partial: Partial<PortfolioOverview> = {}): PortfolioOverview {
  return {
    estates: [],
    inventory: { estates: 0, scans: 0, tables: 0, domains: 0, dataProducts: 0, piiTables: 0, workloads: {} },
    totals: { estates: 0, scans: 0, tables: 0, totalValueAtRisk: 0, avgReadiness: 0 },
    generatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function ent(id: string, name: string, estateId: string, estateName: string, tableCount = 2): PortfolioEntity {
  return { id, estateId, estateName, name, domain: "core", description: "", tableCount };
}

describe("runPortfolioSynthesis", () => {
  it("produces fragmentation, opportunities, and a 3-phase uplift plan", async () => {
    const input: PortfolioSynthesisInput = {
      overview: overview({
        estates: [
          estate({
            estateId: "p1",
            name: "Laggard",
            readiness: 25,
            valueAtRiskMid: 5000,
            scores: scores({ overall: 25, documentation: 20 }),
          }),
          estate({ estateId: "p2", name: "Leader", readiness: 85, scores: scores({ overall: 85, documentation: 90 }) }),
        ],
        totals: { estates: 2, scans: 2, tables: 20, totalValueAtRisk: 5000, avgReadiness: 55 },
      }),
      entities: [
        ent("p1:Customer", "Customer", "p1", "Laggard", 3),
        ent("p2:Customers", "Customers", "p2", "Leader", 2),
        ent("p1:Order", "Order", "p1", "Laggard", 5),
      ],
    };

    const result = await runPortfolioSynthesis(input);

    // Fragmentation: only the multi-estate "Customer" cluster.
    expect(result.fragmentation).toHaveLength(1);
    expect(result.fragmentation[0].estates.sort()).toEqual(["Laggard", "Leader"]);

    // Opportunities include a consolidation + a laggard remediation, sorted by value desc.
    expect(result.opportunities.some((o) => o.id.startsWith("frag:"))).toBe(true);
    expect(result.opportunities.some((o) => o.id === "lag:p1")).toBe(true);
    const values = result.opportunities.map((o) => o.valueUsd);
    expect([...values].sort((a, b) => b - a)).toEqual(values);

    // Uplift plan: phase 1 doc sprint (worst doc = "Laggard"), phase 2 consolidate, phase 3 operating model.
    const phases = result.upliftPlan.map((a) => a.phase);
    expect(phases).toContain(1);
    expect(phases).toContain(2);
    expect(phases).toContain(3);
    const doc = result.upliftPlan.find((a) => a.id === "uplift-doc");
    expect(doc?.owner).toBe("Laggard");
    result.upliftPlan.forEach((a) => {
      expect(a.costUsd).toBeGreaterThan(0);
      expect(a.valueUsd).toBeGreaterThan(0);
    });

    expect(result.headline).toContain("1 business entity");
  });

  it("handles an org with no fragmentation", async () => {
    const input: PortfolioSynthesisInput = {
      overview: overview({
        estates: [estate({ estateId: "p1", name: "Solo", readiness: 40 })],
        totals: { estates: 1, scans: 1, tables: 10, totalValueAtRisk: 0, avgReadiness: 40 },
      }),
      entities: [ent("p1:Customer", "Customer", "p1", "Solo")],
    };
    const result = await runPortfolioSynthesis(input);
    expect(result.fragmentation).toHaveLength(0);
    expect(result.headline).toContain("No cross-estate fragmentation");
    // Phase 3 operating-model action always present.
    expect(result.upliftPlan.some((a) => a.id === "uplift-operating-model")).toBe(true);
  });
});
