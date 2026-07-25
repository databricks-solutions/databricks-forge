import { describe, it, expect } from "vitest";
import {
  deriveEdges,
  summarize,
  dedupeEdges,
  type RawEdge,
} from "@/lib/environment/relationships";

const DOMAINS = new Map<string, string | null>([
  ["main.sales.orders", "Sales"],
  ["main.sales.customers", "Sales"],
  ["main.fin.ledger", "Finance"],
  ["warehouse.sales.orders_raw", "Sales"],
  ["main.ops.unknown", null],
]);

describe("relationships derivation", () => {
  it("flags cross-catalog, cross-schema, cross-domain", () => {
    const edges: RawEdge[] = [
      { source: "main.sales.orders", target: "main.sales.customers", via: "foreign_key" }, // same everything
      { source: "main.sales.orders", target: "main.fin.ledger", via: "lineage" }, // cross-schema + cross-domain
      { source: "warehouse.sales.orders_raw", target: "main.sales.orders", via: "lineage" }, // cross-catalog, same domain
      { source: "main.sales.orders", target: "main.ops.unknown", via: "lineage" }, // cross-schema, domain unknown → not crossDomain
    ];
    const derived = deriveEdges(edges, DOMAINS);

    expect(derived[0]).toMatchObject({ crossCatalog: false, crossSchema: false, crossDomain: false });
    expect(derived[1]).toMatchObject({ crossCatalog: false, crossSchema: true, crossDomain: true });
    expect(derived[2]).toMatchObject({ crossCatalog: true, crossSchema: true, crossDomain: false });
    expect(derived[3]).toMatchObject({ crossSchema: true, crossDomain: false });
    expect(derived[3].targetDomain).toBeNull();
  });

  it("summarize counts boundaries + connected tables", () => {
    const edges: RawEdge[] = [
      { source: "main.sales.orders", target: "main.fin.ledger", via: "lineage" },
      { source: "warehouse.sales.orders_raw", target: "main.sales.orders", via: "lineage" },
    ];
    const s = summarize(deriveEdges(edges, DOMAINS));
    expect(s.total).toBe(2);
    expect(s.crossCatalog).toBe(1);
    expect(s.crossSchema).toBe(2);
    expect(s.crossDomain).toBe(1);
    expect(s.connectedTables).toBe(3);
  });

  it("dedupeEdges collapses undirected dups, drops self-edges, keeps best via/weight", () => {
    const edges: RawEdge[] = [
      { source: "a.b.c", target: "a.b.d", via: "lineage", weight: 2 },
      { source: "a.b.d", target: "a.b.c", via: "foreign_key", weight: 1 },
      { source: "a.b.c", target: "a.b.c", via: "lineage" }, // self → dropped
    ];
    const out = dedupeEdges(edges);
    expect(out).toHaveLength(1);
    expect(out[0].via).toBe("foreign_key");
    expect(out[0].weight).toBe(2);
  });
});
