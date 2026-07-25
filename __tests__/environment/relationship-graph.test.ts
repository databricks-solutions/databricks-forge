import { describe, it, expect } from "vitest";
import {
  buildRelationshipGraph,
  mergeProgramRelationshipInputs,
  type ProgramRelationshipRow,
} from "@/lib/environment/relationships";

function relationshipRows(): ProgramRelationshipRow[] {
  return [
    {
      kind: "detail",
      id: "detail-old",
      scanId: "scan-a",
      scanCreatedAt: 100,
      tableFqn: "cat.sales.orders",
      dataDomain: "Old Sales",
      payloadJson: null,
    },
    {
      kind: "detail",
      id: "detail-new",
      scanId: "scan-b",
      scanCreatedAt: 200,
      tableFqn: "cat.sales.orders",
      dataDomain: "Revenue",
      payloadJson: null,
    },
    {
      kind: "canonical_entity",
      id: "entity-old",
      scanId: "scan-a",
      scanCreatedAt: 100,
      tableFqn: null,
      dataDomain: null,
      payloadJson: JSON.stringify({ name: "Order", tables: ["cat.sales.stale_orders"] }),
    },
    {
      kind: "canonical_entity",
      id: "entity-new",
      scanId: "scan-b",
      scanCreatedAt: 200,
      tableFqn: null,
      dataDomain: null,
      payloadJson: JSON.stringify({ name: " order ", tables: ["cat.sales.orders"] }),
    },
    {
      kind: "canonical_entity",
      id: "entity-ledger",
      scanId: "scan-b",
      scanCreatedAt: 200,
      tableFqn: null,
      dataDomain: null,
      payloadJson: JSON.stringify({ name: "Ledger", tables: ["cat.fin.ledger"] }),
    },
    {
      kind: "entity_relationship",
      id: "rel",
      scanId: "scan-b",
      scanCreatedAt: 200,
      tableFqn: null,
      dataDomain: null,
      payloadJson: JSON.stringify({
        sourceEntity: "Order",
        targetEntity: "Ledger",
        via: "inferred",
      }),
    },
  ];
}

describe("mergeProgramRelationshipInputs", () => {
  it("is input-order independent for latest domains and semantic entities", () => {
    const rows = relationshipRows();
    const forward = mergeProgramRelationshipInputs("p1", rows);
    const reversed = mergeProgramRelationshipInputs("p1", [...rows].reverse());

    expect(reversed).toEqual(forward);
    expect(forward.details).toEqual([
      { tableFqn: "cat.sales.orders", dataDomain: "Revenue" },
    ]);
    expect(forward.canonicalEntities).toEqual([
      { payloadJson: JSON.stringify({ name: "Ledger", tables: ["cat.fin.ledger"] }) },
      { payloadJson: JSON.stringify({ name: " order ", tables: ["cat.sales.orders"] }) },
    ]);

    const domainByFqn = new Map([
      ["cat.sales.orders", "Revenue"],
      ["cat.fin.ledger", "Finance"],
    ]);
    const graphForward = buildRelationshipGraph({ ...forward, lineage: [], domainByFqn });
    const graphReversed = buildRelationshipGraph({ ...reversed, lineage: [], domainByFqn });
    expect(graphReversed).toEqual(graphForward);
    expect(graphForward.edges[0]).toMatchObject({
      source: "cat.sales.orders",
      target: "cat.fin.ledger",
    });
  });

  it("uses scan id then row id as stable tie-breakers", () => {
    const sameTime: ProgramRelationshipRow[] = [
      {
        kind: "detail",
        id: "detail-z",
        scanId: "scan-z",
        scanCreatedAt: 100,
        tableFqn: "cat.sales.orders",
        dataDomain: "Winner",
        payloadJson: null,
      },
      {
        kind: "detail",
        id: "detail-a",
        scanId: "scan-a",
        scanCreatedAt: 100,
        tableFqn: "cat.sales.orders",
        dataDomain: "Loser",
        payloadJson: null,
      },
    ];
    expect(mergeProgramRelationshipInputs("p1", sameTime).details[0].dataDomain).toBe("Winner");
    expect(
      mergeProgramRelationshipInputs("p1", [...sameTime].reverse()).details[0].dataDomain,
    ).toBe("Winner");
  });
});

describe("buildRelationshipGraph", () => {
  it("aggregates lineage + ontology edges across scans and flags cross-boundary", () => {
    const domainByFqn = new Map<string, string | null>([
      ["cat1.sales.orders", "Sales"],
      ["cat1.sales.customers", "Sales"],
      ["cat2.fin.ledger", "Finance"],
    ]);
    const result = buildRelationshipGraph({
      // Two scans' lineage merged into one edge list.
      lineage: [
        { sourceTableFqn: "cat1.sales.orders", targetTableFqn: "cat1.sales.customers", eventCount: 5 },
        { sourceTableFqn: "cat1.sales.orders", targetTableFqn: "cat2.fin.ledger", eventCount: 2 },
      ],
      canonicalEntities: [
        { payloadJson: JSON.stringify({ name: "Order", tables: ["cat1.sales.orders"] }) },
        { payloadJson: JSON.stringify({ name: "Ledger", tables: ["cat2.fin.ledger"] }) },
      ],
      entityRelationships: [
        { payloadJson: JSON.stringify({ sourceEntity: "Order", targetEntity: "Ledger", via: "inferred" }) },
      ],
      domainByFqn,
    });

    // orders→customers (same domain), orders→ledger (cross domain + catalog).
    // The ontology Order→Ledger edge dedupes with the lineage orders→ledger.
    expect(result.summary.total).toBe(2);
    expect(result.summary.crossCatalog).toBe(1);
    expect(result.summary.crossDomain).toBe(1);
    const crossEdge = result.edges.find((e) => e.crossDomain);
    expect(crossEdge?.crossCatalog).toBe(true);
  });

  it("truncates to maxEdges and reports truncation", () => {
    const lineage = Array.from({ length: 5 }, (_, i) => ({
      sourceTableFqn: `c.s.t${i}`,
      targetTableFqn: `c.s.u${i}`,
      eventCount: i,
    }));
    const result = buildRelationshipGraph({
      lineage,
      canonicalEntities: [],
      entityRelationships: [],
      domainByFqn: new Map(),
      maxEdges: 2,
    });
    expect(result.edges).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });
});
