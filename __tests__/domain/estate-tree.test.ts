import { describe, it, expect } from "vitest";
import {
  buildEstateTree,
  parseCanonicalEntities,
  type AggregateDetailRow,
} from "@/lib/domain/estate-tree";
import type { CanonicalEntity } from "@/lib/domain/types";

const details: AggregateDetailRow[] = [
  { tableFqn: "main.sales.customer", dataDomain: "Sales", dataTier: "gold", comment: "c", governanceScore: 80 },
  { tableFqn: "main.sales.orders", dataDomain: "Sales", dataTier: "silver", governanceScore: 40 },
  { tableFqn: "main.ops.events", dataDomain: "Operations", generatedDescription: "g" },
  { tableFqn: "main.misc.scratch" }, // no domain -> Uncategorised, ungrouped
];

describe("buildEstateTree", () => {
  it("groups claimed tables under their canonical entity + domain", () => {
    const entities: CanonicalEntity[] = [
      {
        name: "Customer",
        domain: "Sales",
        description: "customer entity",
        readinessScore: 75,
        readiness: "ready",
        tables: ["main.sales.customer"],
      } as CanonicalEntity,
    ];
    const tree = buildEstateTree(details, entities);
    const sales = tree.domains.find((d) => d.domain === "Sales")!;
    expect(sales).toBeDefined();
    const customer = sales.entities.find((e) => e.name === "Customer")!;
    expect(customer.tables.map((t) => t.fqn)).toEqual(["main.sales.customer"]);
    expect(customer.readinessScore).toBe(75);
    expect(tree.entityCount).toBe(1);
  });

  it("places unclaimed tables under an Ungrouped entity and counts unassigned", () => {
    const tree = buildEstateTree(details, []);
    expect(tree.tableCount).toBe(4);
    expect(tree.unassignedTableCount).toBe(4);
    expect(tree.entityCount).toBe(0);
    const uncat = tree.domains.find((d) => d.domain === "Uncategorised")!;
    expect(uncat.entities[0].name).toBe("Ungrouped tables");
  });

  it("sorts Ungrouped entity last and domains by table count desc", () => {
    const entities: CanonicalEntity[] = [
      {
        name: "Order",
        domain: "Sales",
        description: "",
        tables: ["main.sales.orders"],
      } as CanonicalEntity,
    ];
    const tree = buildEstateTree(details, entities);
    // Sales has the most tables -> first domain.
    expect(tree.domains[0].domain).toBe("Sales");
    const sales = tree.domains[0];
    expect(sales.entities[sales.entities.length - 1].name).toBe("Ungrouped tables");
  });

  it("derives hasComment from either comment or generated description", () => {
    const tree = buildEstateTree(details, []);
    const all = tree.domains.flatMap((d) => d.entities.flatMap((e) => e.tables));
    expect(all.find((t) => t.fqn === "main.ops.events")!.hasComment).toBe(true);
    expect(all.find((t) => t.fqn === "main.misc.scratch")!.hasComment).toBe(false);
  });
});

describe("parseCanonicalEntities", () => {
  it("parses only canonical_entity insights and skips malformed payloads", () => {
    const parsed = parseCanonicalEntities([
      { insightType: "canonical_entity", payloadJson: JSON.stringify({ name: "A", tables: [] }) },
      { insightType: "governance_gap", payloadJson: "{}" },
      { insightType: "canonical_entity", payloadJson: "{not json" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("A");
  });
});
