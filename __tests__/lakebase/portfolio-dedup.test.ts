import { describe, it, expect } from "vitest";
import {
  aggregatePortfolio,
  portfolioAssetIdentitiesFromInsight,
  type PortfolioAssetIdentityRow,
  type PortfolioDetailIdentityRow,
  type PortfolioProgramRow,
  type PortfolioScanRow,
} from "@/lib/lakebase/portfolio-estate";
import {
  dedupePortfolioEntities,
  type PortfolioEntity,
} from "@/lib/ai/portfolio-synthesis/entity-resolution";

function scan(partial: Partial<PortfolioScanRow>): PortfolioScanRow {
  return {
    scanId: "s1",
    programId: null,
    ownerEmail: "a@x.com",
    workspaceId: null,
    ucPath: "main.sales",
    tableCount: 0,
    domainCount: 0,
    dataProductCount: 0,
    piiTablesCount: 0,
    avgGovernanceScore: 60,
    genieSpaceCount: 0,
    dashboardCount: 0,
    metricViewCount: 0,
    modelCount: 0,
    functionCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("aggregatePortfolio — table dedup by identity (not summed headers)", () => {
  it("dedups overlapping scopes within a program estate", () => {
    const programs: PortfolioProgramRow[] = [
      { id: "p1", name: "Estate", industryId: null, ownerEmail: "a@x.com", subVertical: null },
    ];
    const scans: PortfolioScanRow[] = [
      // Two member scans with OVERLAPPING table identities (t1 appears in both).
      scan({ scanId: "s1", programId: "p1", tableCount: 2, tableFqns: ["c.s.t1", "c.s.t2"] }),
      scan({
        scanId: "s2",
        programId: "p1",
        tableCount: 2,
        tableFqns: ["c.s.t1", "c.s.t3"],
        createdAt: "2026-02-01T00:00:00.000Z",
      }),
    ];
    const out = aggregatePortfolio({ programs, scans, syntheses: [] });
    const estate = out.estates.find((e) => e.estateId === "p1");
    // Distinct union {t1,t2,t3} = 3, NOT the summed header count of 4.
    expect(estate?.tableCount).toBe(3);
    expect(out.inventory.tables).toBe(3);
    expect(out.totals.tables).toBe(3);
  });

  it("dedups a same-scope rescan (identical identities across scans)", () => {
    const programs: PortfolioProgramRow[] = [
      { id: "p1", name: "Estate", industryId: null, ownerEmail: "a@x.com", subVertical: null },
    ];
    const scans: PortfolioScanRow[] = [
      scan({ scanId: "s1", programId: "p1", tableCount: 2, tableFqns: ["c.s.t1", "c.s.t2"] }),
      scan({
        scanId: "s2",
        programId: "p1",
        tableCount: 2,
        tableFqns: ["c.s.t1", "c.s.t2"],
        createdAt: "2026-02-01T00:00:00.000Z",
      }),
    ];
    const out = aggregatePortfolio({ programs, scans, syntheses: [] });
    expect(out.estates.find((e) => e.estateId === "p1")?.tableCount).toBe(2);
    expect(out.totals.tables).toBe(2);
  });

  it("keeps standalone estates independent (no cross-estate dedup of shared FQNs)", () => {
    const scans: PortfolioScanRow[] = [
      scan({ scanId: "s1", programId: null, ucPath: "a", tableCount: 1, tableFqns: ["shared.t"] }),
      scan({ scanId: "s2", programId: null, ucPath: "b", tableCount: 1, tableFqns: ["shared.t"] }),
    ];
    const out = aggregatePortfolio({ programs: [], scans, syntheses: [] });
    // Two independent estates-of-one, each 1 table; enterprise total is 2.
    expect(out.estates).toHaveLength(2);
    expect(out.totals.tables).toBe(2);
  });

  it("uses the maximum header floor when identities are not supplied", () => {
    const programs: PortfolioProgramRow[] = [
      { id: "p1", name: "Estate", industryId: null, ownerEmail: "a@x.com", subVertical: null },
    ];
    const scans: PortfolioScanRow[] = [
      scan({ scanId: "s1", programId: "p1", tableCount: 10 }),
      scan({ scanId: "s2", programId: "p1", tableCount: 5 }),
    ];
    const out = aggregatePortfolio({ programs, scans, syntheses: [] });
    expect(out.estates.find((e) => e.estateId === "p1")?.tableCount).toBe(10);
  });
});

describe("aggregatePortfolio — enterprise inventory semantic dedup", () => {
  const programs: PortfolioProgramRow[] = [
    {
      id: "p1",
      name: "Estate",
      industryId: null,
      ownerEmail: "a@x.com",
      subVertical: null,
    },
  ];
  const scans: PortfolioScanRow[] = [
    scan({
      scanId: "s-old",
      programId: "p1",
      tableCount: 2,
      domainCount: 1,
      dataProductCount: 1,
      piiTablesCount: 1,
      modelCount: 1,
      functionCount: 1,
      genieSpaceCount: 1,
      dashboardCount: 1,
      metricViewCount: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
    scan({
      scanId: "s-new",
      programId: "p1",
      tableCount: 2,
      domainCount: 1,
      dataProductCount: 1,
      piiTablesCount: 1,
      modelCount: 1,
      functionCount: 1,
      genieSpaceCount: 1,
      dashboardCount: 1,
      metricViewCount: 1,
      createdAt: "2026-02-01T00:00:00.000Z",
    }),
  ];
  const details: PortfolioDetailIdentityRow[] = [
    {
      id: "old-orders",
      scanId: "s-old",
      tableFqn: "c.s.orders",
      dataDomain: "Stale Domain",
      isPii: true,
    },
    {
      id: "new-orders",
      scanId: "s-new",
      tableFqn: "c.s.orders",
      dataDomain: "Sales",
      isPii: false,
    },
    {
      id: "old-customer",
      scanId: "s-old",
      tableFqn: "c.s.customer",
      dataDomain: "Sales",
      isPii: true,
    },
    {
      id: "new-customer",
      scanId: "s-new",
      tableFqn: "c.s.customer",
      dataDomain: "Sales",
      isPii: true,
    },
  ];
  const assets: PortfolioAssetIdentityRow[] = [
    { scanId: "s-old", kind: "data_product", identity: "customer-360" },
    { scanId: "s-new", kind: "data_product", identity: "customer-360" },
    { scanId: "s-old", kind: "model", identity: "c.s.churn" },
    { scanId: "s-new", kind: "model", identity: "c.s.churn" },
    { scanId: "s-old", kind: "function", identity: "c.s.normalize_email" },
    { scanId: "s-new", kind: "function", identity: "c.s.normalize_email" },
    { scanId: "s-old", kind: "genie_space", identity: "space-1" },
    { scanId: "s-new", kind: "genie_space", identity: "space-1" },
    { scanId: "s-old", kind: "dashboard", identity: "dash-1" },
    { scanId: "s-new", kind: "dashboard", identity: "dash-1" },
    { scanId: "s-old", kind: "metric_view", identity: "c.s.revenue_mv" },
    { scanId: "s-new", kind: "metric_view", identity: "c.s.revenue_mv" },
    // A genuinely distinct asset still adds.
    { scanId: "s-new", kind: "model", identity: "c.s.ltv" },
  ];

  it("does not inflate any inventory counter for overlap or same-scope rescans", () => {
    const out = aggregatePortfolio({
      programs,
      scans,
      syntheses: [],
      details,
      assets,
    });

    expect(out.inventory).toMatchObject({
      tables: 2,
      domains: 1,
      dataProducts: 1,
      piiTables: 1,
      workloads: {
        model: 2,
        function: 1,
        genie_space: 1,
        dashboard: 1,
        metric_view: 1,
      },
    });
  });

  it("is stable when identity row input order is reversed", () => {
    const forward = aggregatePortfolio({
      programs,
      scans,
      syntheses: [],
      details,
      assets,
    });
    const reversed = aggregatePortfolio({
      programs,
      scans: [...scans].reverse(),
      syntheses: [],
      details: [...details].reverse(),
      assets: [...assets].reverse(),
    });
    expect(reversed.inventory).toEqual(forward.inventory);
    expect(reversed.totals).toEqual(forward.totals);
  });

  it("keeps identical identities independent across standalone estates", () => {
    const standaloneScans = [
      scan({ scanId: "standalone-a", ucPath: "a" }),
      scan({ scanId: "standalone-b", ucPath: "b" }),
    ];
    const out = aggregatePortfolio({
      programs: [],
      scans: standaloneScans,
      syntheses: [],
      details: [
        {
          id: "a-detail",
          scanId: "standalone-a",
          tableFqn: "shared.t",
          dataDomain: "Shared",
          isPii: true,
        },
        {
          id: "b-detail",
          scanId: "standalone-b",
          tableFqn: "shared.t",
          dataDomain: "Shared",
          isPii: true,
        },
      ],
      assets: [
        { scanId: "standalone-a", kind: "model", identity: "shared.model" },
        { scanId: "standalone-b", kind: "model", identity: "shared.model" },
      ],
    });
    expect(out.inventory.tables).toBe(2);
    expect(out.inventory.domains).toBe(2);
    expect(out.inventory.piiTables).toBe(2);
    expect(out.inventory.workloads.model).toBe(2);
  });

  it("uses maximum completed-scan headers as floors when identities are absent or capped", () => {
    const floorScans = [
      scan({
        scanId: "floor-old",
        programId: "p1",
        tableCount: 12,
        domainCount: 4,
        dataProductCount: 3,
        piiTablesCount: 5,
        modelCount: 10,
        functionCount: 8,
        genieSpaceCount: 3,
        dashboardCount: 4,
        metricViewCount: 7,
      }),
      // Repeated content: headers must not be summed.
      scan({
        scanId: "floor-new",
        programId: "p1",
        tableCount: 12,
        domainCount: 4,
        dataProductCount: 3,
        piiTablesCount: 5,
        modelCount: 10,
        functionCount: 8,
        genieSpaceCount: 3,
        dashboardCount: 4,
        metricViewCount: 7,
        createdAt: "2026-02-01T00:00:00.000Z",
      }),
    ];
    const out = aggregatePortfolio({
      programs,
      scans: floorScans,
      syntheses: [],
      // Simulates detail/insight persistence caps or missing asset_discovery.
      details: [
        {
          id: "one-detail",
          scanId: "floor-new",
          tableFqn: "c.s.only_persisted",
          dataDomain: "One persisted domain",
          isPii: true,
        },
      ],
      assets: [
        { scanId: "floor-new", kind: "data_product", identity: "only-one" },
        { scanId: "floor-new", kind: "model", identity: "only-one" },
        { scanId: "floor-new", kind: "function", identity: "only-one" },
      ],
    });

    expect(out.inventory).toMatchObject({
      tables: 12,
      domains: 4,
      dataProducts: 3,
      piiTables: 5,
      workloads: {
        model: 10,
        function: 8,
        genie_space: 3,
        dashboard: 4,
        metric_view: 7,
      },
    });
  });

  it("retains pipeline metric-view headers without asset_discovery identities", () => {
    const out = aggregatePortfolio({
      programs,
      scans: [
        scan({
          scanId: "pipeline-scan",
          programId: "p1",
          tableCount: 1,
          metricViewCount: 6,
        }),
      ],
      syntheses: [],
      details: [],
      assets: [],
    });
    expect(out.inventory.workloads.metric_view).toBe(6);
  });
});

describe("portfolioAssetIdentitiesFromInsight", () => {
  it("uses FQNs for models/functions and semantic product names", () => {
    expect(
      portfolioAssetIdentitiesFromInsight(
        "s1",
        "uc_model",
        JSON.stringify({ fqn: "c.s.churn", name: "churn" }),
      ),
    ).toEqual([{ scanId: "s1", kind: "model", identity: "c.s.churn" }]);
    expect(
      portfolioAssetIdentitiesFromInsight(
        "s1",
        "uc_function",
        JSON.stringify({ catalog: "c", schema: "s", name: "normalize" }),
      ),
    ).toEqual([{ scanId: "s1", kind: "function", identity: "c.s.normalize" }]);
    expect(
      portfolioAssetIdentitiesFromInsight(
        "s1",
        "data_product",
        JSON.stringify({ productName: "Customer 360", primaryDomain: "Sales" }),
      ),
    ).toEqual([{ scanId: "s1", kind: "data_product", identity: "sales:customer 360" }]);
  });

  it("expands asset_discovery using persisted IDs/FQNs", () => {
    const rows = portfolioAssetIdentitiesFromInsight(
      "s1",
      "asset_discovery",
      JSON.stringify({
        discovery: {
          genieSpaces: [{ spaceId: "space-1", title: "Sales" }],
          dashboards: [{ dashboardId: "dash-1", displayName: "Sales" }],
          metricViews: [{ fqn: "c.s.revenue" }],
        },
      }),
    );
    expect(rows).toEqual([
      { scanId: "s1", kind: "genie_space", identity: "space-1" },
      { scanId: "s1", kind: "dashboard", identity: "dash-1" },
      { scanId: "s1", kind: "metric_view", identity: "c.s.revenue" },
    ]);
  });

  it("returns the same fallback semantic key for reordered payload fields", () => {
    const a = portfolioAssetIdentitiesFromInsight(
      "s1",
      "uc_model",
      JSON.stringify({ comment: "x", unknown: 1 }),
    );
    const b = portfolioAssetIdentitiesFromInsight(
      "s1",
      "uc_model",
      JSON.stringify({ unknown: 1, comment: "x" }),
    );
    expect(a[0].identity).toBe(b[0].identity);
  });
});

describe("dedupePortfolioEntities — within-estate dedup, latest wins", () => {
  function ent(partial: Partial<PortfolioEntity> & { scanCreatedAt: number }): PortfolioEntity & {
    scanCreatedAt: number;
  } {
    return {
      id: "id",
      estateId: "p1",
      estateName: "Estate",
      name: "Customer",
      domain: "Sales",
      description: "",
      tableCount: 1,
      ...partial,
    };
  }

  it("collapses same-name entities within an estate, keeping the latest record", () => {
    const entities = [
      ent({ id: "old", name: "Customer", tableCount: 2, scanCreatedAt: 100 }),
      ent({ id: "new", name: " customers ", tableCount: 5, scanCreatedAt: 200 }),
    ];
    const out = dedupePortfolioEntities(entities);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("new");
    expect(out[0].tableCount).toBe(5);
  });

  it("keeps same-named entities in DIFFERENT estates separate (pre-clustering)", () => {
    const entities = [
      ent({ id: "a", estateId: "p1", name: "Customer", scanCreatedAt: 1 }),
      ent({ id: "b", estateId: "p2", name: "Customer", scanCreatedAt: 1 }),
    ];
    const out = dedupePortfolioEntities(entities);
    expect(out).toHaveLength(2);
  });
});
