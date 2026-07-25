import { describe, it, expect } from "vitest";
import { attributeSourceSystems } from "@/lib/domain/source-system-attribution";
import type { LineageEdge, LineageGraph, TableInfo, UseCase } from "@/lib/domain/types";

// -- Test fixtures -----------------------------------------------------------

function makeUseCase(id: string, tables: string[]): Pick<UseCase, "id" | "tablesInvolved"> {
  return { id, tablesInvolved: tables };
}

function makeTable(
  fqn: string,
  comment: string | null = null,
): Pick<TableInfo, "fqn" | "catalog" | "schema" | "tableName" | "comment"> {
  const parts = fqn.split(".");
  return {
    fqn,
    catalog: parts[0] ?? "",
    schema: parts[1] ?? "",
    tableName: parts[2] ?? "",
    comment,
  };
}

function makeEdge(
  source: string,
  target: string,
  overrides: Partial<LineageEdge> = {},
): LineageEdge {
  return {
    sourceTableFqn: source,
    targetTableFqn: target,
    sourceType: "TABLE",
    targetType: "TABLE",
    lastEventTime: null,
    entityType: null,
    eventCount: 1,
    ...overrides,
  };
}

function makeGraph(edges: LineageEdge[]): LineageGraph {
  return {
    edges,
    seedTables: [],
    discoveredTables: [],
    upstreamDepth: 0,
    downstreamDepth: 0,
  };
}

// -- Tests -------------------------------------------------------------------

describe("attributeSourceSystems — naming-only signals (no lineage)", () => {
  it("attributes Salesforce from catalog-level token in the seed FQN", () => {
    const out = attributeSourceSystems({
      useCases: [makeUseCase("u1", ["salesforce_raw.public.accounts"])],
      lineageGraph: null,
      tables: [makeTable("salesforce_raw.public.accounts")],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.sourceSystems).toEqual(["Salesforce"]);
    expect(out[0]?.origin).toBe("naming");
  });

  it("attributes from prefix patterns on schema or table tokens", () => {
    const out = attributeSourceSystems({
      useCases: [
        makeUseCase("u_workday", ["main.workday_hcm.workers"]),
        makeUseCase("u_servicenow", ["main.itsm.servicenow_incidents"]),
      ],
      lineageGraph: null,
      tables: [
        makeTable("main.workday_hcm.workers"),
        makeTable("main.itsm.servicenow_incidents"),
      ],
    });
    const byId = new Map(out.map((r) => [r.useCaseId, r] as const));
    expect(byId.get("u_workday")?.sourceSystems).toEqual(["Workday"]);
    expect(byId.get("u_servicenow")?.sourceSystems).toEqual(["ServiceNow"]);
  });

  it("ignores generic medallion tokens (bronze / silver / gold / raw)", () => {
    const out = attributeSourceSystems({
      useCases: [makeUseCase("u1", ["bronze.raw.customer_data"])],
      lineageGraph: null,
      tables: [makeTable("bronze.raw.customer_data")],
    });
    expect(out[0]?.sourceSystems).toEqual([]);
  });

  it("dedups duplicate hits across multiple tables in the same use case", () => {
    const out = attributeSourceSystems({
      useCases: [
        makeUseCase("u1", [
          "salesforce_raw.public.accounts",
          "salesforce_raw.public.opportunities",
        ]),
      ],
      lineageGraph: null,
      tables: [
        makeTable("salesforce_raw.public.accounts"),
        makeTable("salesforce_raw.public.opportunities"),
      ],
    });
    expect(out[0]?.sourceSystems).toEqual(["Salesforce"]);
  });
});

describe("attributeSourceSystems — comment-only signals", () => {
  it("attributes SAP from a comment that mentions S/4HANA", () => {
    const out = attributeSourceSystems({
      useCases: [makeUseCase("u1", ["main.derived.orders"])],
      lineageGraph: null,
      tables: [
        makeTable(
          "main.derived.orders",
          "Synced nightly from S/4HANA via Lakeflow Connect",
        ),
      ],
    });
    expect(out[0]?.sourceSystems).toEqual(["SAP"]);
    expect(out[0]?.origin).toBe("comment");
  });

  it("emits 'mixed' origin when one hit is naming and another is comment", () => {
    const out = attributeSourceSystems({
      useCases: [makeUseCase("u1", ["salesforce_raw.public.accounts", "main.derived.gl"])],
      lineageGraph: null,
      tables: [
        makeTable("salesforce_raw.public.accounts"),
        makeTable("main.derived.gl", "Loaded from Oracle EBS general ledger"),
      ],
    });
    expect(out[0]?.sourceSystems).toEqual(["Oracle", "Salesforce"]);
    expect(out[0]?.origin).toBe("mixed");
  });
});

describe("attributeSourceSystems — lineage walking", () => {
  it("walks upstream to a CONNECTION boundary and uses it as the gold signal", () => {
    // Use case touches a derived `main.silver.customer_360` that is fed
    // (via several hops of `main.bronze.*` tables) from a federated foreign
    // table `salesforce_fed.public.accounts` with sourceType=CONNECTION.
    const edges = [
      makeEdge("main.bronze.sf_accounts", "main.silver.customer_360"),
      makeEdge("main.bronze.sf_opps", "main.silver.customer_360"),
      makeEdge(
        "salesforce_fed.public.accounts",
        "main.bronze.sf_accounts",
        { sourceType: "CONNECTION" },
      ),
      makeEdge(
        "salesforce_fed.public.opportunities",
        "main.bronze.sf_opps",
        { sourceType: "CONNECTION" },
      ),
    ];
    const out = attributeSourceSystems({
      useCases: [makeUseCase("u1", ["main.silver.customer_360"])],
      lineageGraph: makeGraph(edges),
      tables: [
        makeTable("main.silver.customer_360", "Customer 360 derived view"),
        makeTable("main.bronze.sf_accounts"),
        makeTable("main.bronze.sf_opps"),
      ],
    });
    expect(out[0]?.sourceSystems).toEqual(["Salesforce"]);
    expect(out[0]?.origin).toBe("lineage");
  });

  it("walks upstream when the root TableInfo is outside the scan scope", () => {
    // No TableInfo for the foreign-catalog root — resolver must still
    // tokenize the FQN itself.
    const edges = [
      makeEdge(
        "snowflake_fed.public.orders",
        "main.silver.orders",
        { sourceType: "CONNECTION" },
      ),
    ];
    const out = attributeSourceSystems({
      useCases: [makeUseCase("u1", ["main.silver.orders"])],
      lineageGraph: makeGraph(edges),
      tables: [makeTable("main.silver.orders")],
    });
    expect(out[0]?.sourceSystems).toEqual(["Snowflake"]);
    expect(out[0]?.origin).toBe("lineage");
  });

  it("respects the maxUpstreamHops cap and stops the walk", () => {
    // Build a chain a → b → c → d → e (4 hops). With maxUpstreamHops=2,
    // the resolver should stop before reaching the Salesforce-named root.
    const edges = [
      makeEdge("salesforce_raw.public.x", "main.layer1.a"),
      makeEdge("main.layer1.a", "main.layer2.b"),
      makeEdge("main.layer2.b", "main.layer3.c"),
      makeEdge("main.layer3.c", "main.layer4.d"),
      makeEdge("main.layer4.d", "main.silver.seed"),
    ];
    const out = attributeSourceSystems({
      useCases: [makeUseCase("u1", ["main.silver.seed"])],
      lineageGraph: makeGraph(edges),
      tables: [
        makeTable("main.silver.seed"),
        makeTable("main.layer1.a"),
        makeTable("main.layer2.b"),
        makeTable("main.layer3.c"),
        makeTable("main.layer4.d"),
      ],
      maxUpstreamHops: 2,
    });
    expect(out[0]?.sourceSystems).toEqual([]);
  });

  it("prefers lineage origin even when naming would also have matched", () => {
    // Seed is named "salesforce_raw.public.accounts" (naming match) AND it
    // has an upstream CONNECTION edge to `salesforce_fed.public.accounts`
    // (lineage match) — origin must be "lineage".
    const edges = [
      makeEdge(
        "salesforce_fed.public.accounts",
        "salesforce_raw.public.accounts",
        { sourceType: "CONNECTION" },
      ),
    ];
    const out = attributeSourceSystems({
      useCases: [makeUseCase("u1", ["salesforce_raw.public.accounts"])],
      lineageGraph: makeGraph(edges),
      tables: [makeTable("salesforce_raw.public.accounts")],
    });
    expect(out[0]?.sourceSystems).toEqual(["Salesforce"]);
    expect(out[0]?.origin).toBe("lineage");
  });
});

describe("attributeSourceSystems — edge cases", () => {
  it("returns empty for a use case with no tablesInvolved", () => {
    const out = attributeSourceSystems({
      useCases: [makeUseCase("u1", [])],
      lineageGraph: null,
      tables: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.sourceSystems).toEqual([]);
  });

  it("is order-stable: dedup'd source systems are sorted alphabetically", () => {
    const out = attributeSourceSystems({
      useCases: [
        makeUseCase("u1", [
          "workday_raw.hcm.workers",
          "salesforce_raw.crm.accounts",
        ]),
      ],
      lineageGraph: null,
      tables: [
        makeTable("workday_raw.hcm.workers"),
        makeTable("salesforce_raw.crm.accounts"),
      ],
    });
    expect(out[0]?.sourceSystems).toEqual(["Salesforce", "Workday"]);
  });

  it("does not mis-attribute generic `sf_*` schemas to Salesforce", () => {
    // Loose schema name `sf_` (e.g. `main.sf_finance.gl`) is not specific
    // enough to attribute to Salesforce — the matcher must skip it.
    const out = attributeSourceSystems({
      useCases: [makeUseCase("u1", ["main.sf_finance.gl"])],
      lineageGraph: null,
      tables: [makeTable("main.sf_finance.gl")],
    });
    expect(out[0]?.sourceSystems).toEqual([]);
  });
});
