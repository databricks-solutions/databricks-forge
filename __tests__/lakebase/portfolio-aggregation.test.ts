import { describe, it, expect } from "vitest";
import {
  aggregatePortfolio,
  type PortfolioAggregationInput,
  type PortfolioProgramRow,
  type PortfolioScanRow,
  type PortfolioSynthesisRow,
} from "@/lib/lakebase/portfolio-estate";
import type { EstateScores, EstateValueAtRisk } from "@/lib/domain/estate-synthesis-types";

function scan(partial: Partial<PortfolioScanRow>): PortfolioScanRow {
  return {
    scanId: "s1",
    programId: null,
    ownerEmail: "a@x.com",
    workspaceId: null,
    ucPath: "main.sales",
    tableCount: 10,
    domainCount: 2,
    dataProductCount: 1,
    piiTablesCount: 1,
    avgGovernanceScore: 60,
    genieSpaceCount: 1,
    dashboardCount: 2,
    metricViewCount: 0,
    modelCount: 0,
    functionCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function scores(overall: number, over: Partial<EstateScores> = {}): EstateScores {
  return {
    overall,
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

function synthRow(partial: Partial<PortfolioSynthesisRow>): PortfolioSynthesisRow {
  return {
    id: "syn-1",
    estateId: null,
    scanId: null,
    scoresJson: null,
    valueAtRiskJson: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("aggregatePortfolio", () => {
  it("rolls program scans into one estate and standalone scans into estates-of-one", () => {
    const programs: PortfolioProgramRow[] = [
      {
        id: "p1",
        name: "Sales Estate",
        industryId: "retail",
        ownerEmail: "a@x.com",
        subVertical: null,
      },
    ];
    const scans: PortfolioScanRow[] = [
      scan({ scanId: "s1", programId: "p1", tableCount: 10 }),
      scan({ scanId: "s2", programId: "p1", tableCount: 5, createdAt: "2026-02-01T00:00:00.000Z" }),
      scan({ scanId: "s3", programId: null, ucPath: "main.hr", tableCount: 3 }),
    ];
    const out = aggregatePortfolio({ programs, scans, syntheses: [] });

    expect(out.estates).toHaveLength(2);
    const program = out.estates.find((e) => e.kind === "program");
    // With no persisted identities, repeated/overlapping scans use the maximum
    // completed-scan header as a conservative floor — never a repeated sum.
    expect(program?.tableCount).toBe(10);
    expect(program?.scanCount).toBe(2);
    const standalone = out.estates.find((e) => e.kind === "standalone");
    expect(standalone?.estateId).toBe("scan:s3");
    expect(standalone?.tableCount).toBe(3);

    expect(out.totals.estates).toBe(2);
    expect(out.totals.tables).toBe(13);
  });

  it("prefers synthesis scores and uses governance proxy when absent", () => {
    const programs: PortfolioProgramRow[] = [
      { id: "p1", name: "P1", industryId: null, ownerEmail: "a@x.com", subVertical: null },
      { id: "p2", name: "P2", industryId: null, ownerEmail: "b@x.com", subVertical: null },
    ];
    const scans: PortfolioScanRow[] = [
      scan({ scanId: "s1", programId: "p1", avgGovernanceScore: 40 }),
      scan({ scanId: "s2", programId: "p2", avgGovernanceScore: 80 }),
    ];
    const syntheses: PortfolioSynthesisRow[] = [
      synthRow({
        estateId: "p1",
        scoresJson: JSON.stringify(scores(90)),
        valueAtRiskJson: JSON.stringify({
          low: 1,
          mid: 100,
          high: 200,
          currency: "USD",
        } as EstateValueAtRisk),
      }),
    ];
    const out = aggregatePortfolio({ programs, scans, syntheses });

    const p1 = out.estates.find((e) => e.estateId === "p1");
    const p2 = out.estates.find((e) => e.estateId === "p2");
    expect(p1?.readiness).toBe(90); // from synthesis
    expect(p1?.valueAtRiskMid).toBe(100);
    expect(p2?.readiness).toBe(80); // governance proxy
    expect(p2?.valueAtRiskMid).toBe(0);

    // Estates sorted by readiness desc.
    expect(out.estates[0].estateId).toBe("p1");
    expect(out.totals.totalValueAtRisk).toBe(100);
  });

  it("aggregates the enterprise inventory across all scans", () => {
    const scans: PortfolioScanRow[] = [
      scan({
        scanId: "s1",
        programId: null,
        ucPath: "a",
        domainCount: 2,
        dataProductCount: 1,
        piiTablesCount: 3,
        genieSpaceCount: 1,
        dashboardCount: 2,
        metricViewCount: 1,
        modelCount: 4,
      }),
      scan({
        scanId: "s2",
        programId: null,
        ucPath: "b",
        domainCount: 3,
        dataProductCount: 2,
        piiTablesCount: 1,
        genieSpaceCount: 0,
        dashboardCount: 1,
        metricViewCount: 4,
        modelCount: 3,
      }),
    ];
    const out = aggregatePortfolio({ programs: [], scans, syntheses: [] });
    expect(out.inventory.domains).toBe(5);
    expect(out.inventory.dataProducts).toBe(3);
    expect(out.inventory.piiTables).toBe(4);
    expect(out.inventory.workloads.model).toBe(7);
    expect(out.inventory.workloads.genie_space).toBe(1);
    expect(out.inventory.workloads.dashboard).toBe(3);
    expect(out.inventory.workloads.metric_view).toBe(5);
  });

  it("returns empty structures for an empty org", () => {
    const empty: PortfolioAggregationInput = { programs: [], scans: [], syntheses: [] };
    const out = aggregatePortfolio(empty);
    expect(out.estates).toEqual([]);
    expect(out.totals.estates).toBe(0);
    expect(out.totals.avgReadiness).toBe(0);
  });

  it("deterministically selects equal-timestamp synthesis and scan provenance by id", () => {
    const programs: PortfolioProgramRow[] = [
      { id: "p1", name: "P1", industryId: null, ownerEmail: "a@x.com", subVertical: null },
    ];
    const scans = [
      scan({
        scanId: "scan-a",
        programId: "p1",
        workspaceId: "workspace-a",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      scan({
        scanId: "scan-z",
        programId: "p1",
        workspaceId: "workspace-z",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ];
    const syntheses = [
      synthRow({
        id: "syn-a",
        estateId: "p1",
        scoresJson: JSON.stringify(scores(10)),
        createdAt: "2026-02-01T00:00:00.000Z",
      }),
      synthRow({
        id: "syn-z",
        estateId: "p1",
        scoresJson: JSON.stringify(scores(90)),
        createdAt: "2026-02-01T00:00:00.000Z",
      }),
    ];

    const forward = aggregatePortfolio({ programs, scans, syntheses });
    const reversed = aggregatePortfolio({
      programs,
      scans: [...scans].reverse(),
      syntheses: [...syntheses].reverse(),
    });

    expect(reversed.estates).toEqual(forward.estates);
    expect(forward.estates[0].workspaceId).toBe("workspace-z");
    expect(forward.estates[0].readiness).toBe(90);
  });
});
