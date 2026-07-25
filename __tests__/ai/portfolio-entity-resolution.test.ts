import { describe, it, expect } from "vitest";
import {
  resolveEntityClusters,
  normaliseEntityName,
  type PortfolioEntity,
} from "@/lib/ai/portfolio-synthesis/entity-resolution";

function ent(
  partial: Partial<PortfolioEntity> & { id: string; name: string; estateName: string },
): PortfolioEntity {
  return {
    estateId: partial.estateId ?? partial.id,
    domain: partial.domain ?? "core",
    description: partial.description ?? "",
    tableCount: partial.tableCount ?? 1,
    ...partial,
  };
}

describe("normaliseEntityName", () => {
  it("singularises and strips qualifier tokens", () => {
    expect(normaliseEntityName("Customers")).toBe("customer");
    expect(normaliseEntityName("dim_customer")).toBe("customer");
    expect(normaliseEntityName("Customer Master Table")).toBe("customer");
    expect(normaliseEntityName("Companies")).toBe("company");
  });
});

describe("resolveEntityClusters (name fallback)", () => {
  it("clusters same-named entities across estates and flags fragmentation", async () => {
    const entities: PortfolioEntity[] = [
      ent({
        id: "e1:Customer",
        estateId: "e1",
        name: "Customer",
        estateName: "Sales Estate",
        tableCount: 3,
      }),
      ent({
        id: "e2:Customers",
        estateId: "e2",
        name: "Customers",
        estateName: "Marketing Estate",
        tableCount: 2,
      }),
      ent({
        id: "e1:Order",
        estateId: "e1",
        name: "Order",
        estateName: "Sales Estate",
        tableCount: 5,
      }),
    ];
    const clusters = await resolveEntityClusters(entities);

    const customer = clusters.find((c) => normaliseEntityName(c.label) === "customer");
    expect(customer?.estates.sort()).toEqual(["Marketing Estate", "Sales Estate"]);
    expect(customer?.fragmented).toBe(true);
    expect(customer?.totalTables).toBe(5);

    const order = clusters.find((c) => normaliseEntityName(c.label) === "order");
    expect(order?.fragmented).toBe(false);

    // Fragmented clusters come first.
    expect(clusters[0].fragmented).toBe(true);
  });

  it("does not flag fragmentation when one estate models an entity twice", async () => {
    const entities: PortfolioEntity[] = [
      ent({ id: "e1:Customer", estateId: "e1", name: "Customer", estateName: "Sales Estate" }),
      ent({ id: "e1:Customers", estateId: "e1", name: "Customers", estateName: "Sales Estate" }),
    ];
    const clusters = await resolveEntityClusters(entities);
    expect(clusters[0].fragmented).toBe(false);
    expect(clusters[0].estates).toEqual(["Sales Estate"]);
  });

  it("returns empty for no entities", async () => {
    expect(await resolveEntityClusters([])).toEqual([]);
  });
});

describe("resolveEntityClusters (embedding)", () => {
  it("clusters by cosine similarity when an embedder is injected", async () => {
    const entities: PortfolioEntity[] = [
      ent({ id: "e1", estateId: "e1", name: "Client", estateName: "Estate A", tableCount: 2 }),
      ent({ id: "e2", estateId: "e2", name: "Customer", estateName: "Estate B", tableCount: 3 }),
      ent({ id: "e3", estateId: "e3", name: "Widget", estateName: "Estate C", tableCount: 1 }),
    ];
    // Client + Customer near-identical vectors; Widget orthogonal.
    const vectors: Record<string, number[]> = {
      Client: [1, 0, 0],
      Customer: [0.99, 0.01, 0],
      Widget: [0, 0, 1],
    };
    const embed = async (texts: string[]) =>
      texts.map((t) => {
        const name = t.split(" — ")[0];
        return vectors[name] ?? [0, 0, 0];
      });

    const clusters = await resolveEntityClusters(entities, { embed, threshold: 0.9 });
    const merged = clusters.find(
      (c) => c.estates.includes("Estate A") && c.estates.includes("Estate B"),
    );
    expect(merged).toBeTruthy();
    expect(merged?.fragmented).toBe(true);
    expect(clusters.some((c) => c.estates.length === 1 && c.label === "Widget")).toBe(true);
  });

  it("falls back to name clustering when the embedder throws", async () => {
    const entities: PortfolioEntity[] = [
      ent({ id: "e1", estateId: "e1", name: "Customer", estateName: "Estate A" }),
      ent({ id: "e2", estateId: "e2", name: "Customer", estateName: "Estate B" }),
    ];
    const embed = async () => {
      throw new Error("endpoint down");
    };
    const clusters = await resolveEntityClusters(entities, { embed });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].fragmented).toBe(true);
  });
});
