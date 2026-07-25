import { describe, it, expect } from "vitest";
import {
  applyDomainOverrides,
  resolveOverride,
  matchesOverride,
  type DomainOverride,
} from "@/lib/environment/domain-overrides";
import type { TableDetailRow } from "@/app/environment/types";

function row(fqn: string, domain: string | null, sub: string | null = null): TableDetailRow {
  return {
    tableFqn: fqn,
    tableType: "TABLE",
    dataDomain: domain,
    dataSubdomain: sub,
    dataTier: null,
    format: null,
    owner: null,
    sizeInBytes: null,
    numRows: null,
    numFiles: null,
    isManaged: true,
    comment: null,
    generatedDescription: null,
    sensitivityLevel: null,
    governancePriority: null,
    governanceScore: null,
    lastModified: null,
    discoveredVia: "selected",
  };
}

const DETAILS = [
  row("main.sales.orders", "Sales"),
  row("main.sales.customers", "Sales"),
  row("main.staging.tmp1", "Unclassified"),
  row("main.staging.tmp2", "Unclassified"),
  row("fin.gl.ledger", "Finance"),
];

describe("domain overrides", () => {
  it("matchesOverride respects scope", () => {
    expect(matchesOverride("a.b.c", { scope: "table", target: "a.b.c", action: "evict" })).toBe(
      true,
    );
    expect(matchesOverride("a.b.c", { scope: "schema", target: "a.b", action: "evict" })).toBe(
      true,
    );
    expect(matchesOverride("a.b.c", { scope: "catalog", target: "a", action: "evict" })).toBe(true);
    expect(matchesOverride("a.b.c", { scope: "table", target: "a.b.x", action: "evict" })).toBe(
      false,
    );
  });

  it("remap rewrites domain; evict drops table", () => {
    const overrides: DomainOverride[] = [
      { scope: "table", target: "main.sales.orders", action: "remap", newDomain: "Revenue" },
      { scope: "schema", target: "main.staging", action: "evict" },
    ];
    const out = applyDomainOverrides(DETAILS, overrides);
    const fqns = out.map((r) => r.tableFqn);
    expect(fqns).not.toContain("main.staging.tmp1");
    expect(fqns).not.toContain("main.staging.tmp2");
    expect(out.find((r) => r.tableFqn === "main.sales.orders")!.dataDomain).toBe("Revenue");
    expect(out.find((r) => r.tableFqn === "main.sales.customers")!.dataDomain).toBe("Sales");
  });

  it("most-specific scope wins (table > schema > catalog)", () => {
    const overrides: DomainOverride[] = [
      { scope: "catalog", target: "main", action: "evict" },
      { scope: "table", target: "main.sales.orders", action: "remap", newDomain: "Keep" },
    ];
    const winner = resolveOverride("main.sales.orders", overrides);
    expect(winner?.scope).toBe("table");
    const out = applyDomainOverrides(DETAILS, overrides);
    // orders survives via table remap; everything else under main is evicted
    expect(out.map((r) => r.tableFqn)).toEqual(["main.sales.orders", "fin.gl.ledger"]);
    expect(out[0].dataDomain).toBe("Keep");
  });

  it("recency breaks ties within a scope", () => {
    const overrides: DomainOverride[] = [
      {
        scope: "table",
        target: "x.y.z",
        action: "remap",
        newDomain: "Old",
        createdAt: "2026-01-01",
      },
      {
        scope: "table",
        target: "x.y.z",
        action: "remap",
        newDomain: "New",
        createdAt: "2026-06-01",
      },
    ];
    expect(resolveOverride("x.y.z", overrides)?.newDomain).toBe("New");
  });

  it("no overrides returns the input unchanged", () => {
    expect(applyDomainOverrides(DETAILS, [])).toBe(DETAILS);
  });
});
