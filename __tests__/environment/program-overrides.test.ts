import { describe, it, expect } from "vitest";
import {
  resolveProgramOverride,
  buildProgramDomainMap,
  type ScopedDomainOverride,
} from "@/lib/environment/domain-overrides";

function ov(partial: Partial<ScopedDomainOverride> & { scanId: string; scanRank: number }): ScopedDomainOverride {
  return {
    scope: "table",
    target: "c.s.t",
    action: "remap",
    newDomain: "X",
    ...partial,
  };
}

describe("resolveProgramOverride (cross-scan precedence)", () => {
  it("latest scan wins over an earlier scan even at a more specific scope", () => {
    const overrides: ScopedDomainOverride[] = [
      // Earlier scan, most-specific (table) scope.
      ov({ scanId: "s1", scanRank: 1, scope: "table", target: "c.s.orders", action: "remap", newDomain: "Old" }),
      // Later scan, broader (schema) scope — still wins because latest scan wins first.
      ov({ scanId: "s2", scanRank: 2, scope: "schema", target: "c.s", action: "remap", newDomain: "New" }),
    ];
    const winner = resolveProgramOverride("c.s.orders", overrides);
    expect(winner?.newDomain).toBe("New");
    expect(winner?.scanId).toBe("s2");
  });

  it("within the same scan, table beats schema beats catalog", () => {
    const overrides: ScopedDomainOverride[] = [
      ov({ scanId: "s1", scanRank: 3, scope: "catalog", target: "c", action: "evict" }),
      ov({ scanId: "s1", scanRank: 3, scope: "schema", target: "c.s", action: "remap", newDomain: "Schema" }),
      ov({ scanId: "s1", scanRank: 3, scope: "table", target: "c.s.orders", action: "remap", newDomain: "Table" }),
    ];
    const winner = resolveProgramOverride("c.s.orders", overrides);
    expect(winner?.scope).toBe("table");
    expect(winner?.newDomain).toBe("Table");
  });

  it("returns null when no override targets the fqn", () => {
    expect(resolveProgramOverride("c.s.other", [ov({ scanId: "s1", scanRank: 1, target: "c.s.orders" })])).toBeNull();
  });
});

describe("buildProgramDomainMap", () => {
  it("applies latest-scan remaps and drops evicted tables", () => {
    const details = [
      { tableFqn: "c.s.orders", dataDomain: "Sales" },
      { tableFqn: "c.s.tmp", dataDomain: "Sales" },
    ];
    const overrides: ScopedDomainOverride[] = [
      ov({ scanId: "s2", scanRank: 2, scope: "table", target: "c.s.orders", action: "remap", newDomain: "Revenue" }),
      ov({ scanId: "s2", scanRank: 2, scope: "table", target: "c.s.tmp", action: "evict" }),
    ];
    const map = buildProgramDomainMap(details, overrides);
    expect(map.get("c.s.orders")).toBe("Revenue");
    expect(map.has("c.s.tmp")).toBe(false);
  });
});
