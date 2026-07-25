import { describe, it, expect } from "vitest";
import { ESTATE_ACTION_REGISTRY, defaultActionFor } from "@/lib/domain/estate-actions";
import type { EstateFindingKind } from "@/lib/domain/estate-synthesis-types";

const ALL_KINDS: EstateFindingKind[] = [
  "opportunity",
  "documentation_gap",
  "query_ready_domain",
  "coverage_gap",
  "well_architected_gap",
  "value_quantification",
  "governance_risk",
  "freshness_risk",
  "fragmentation",
];

describe("ESTATE_ACTION_REGISTRY", () => {
  it("covers every finding kind exactly", () => {
    expect(Object.keys(ESTATE_ACTION_REGISTRY).sort()).toEqual([...ALL_KINDS].sort());
  });

  it("every definition has an engine, label, description and href builder", () => {
    for (const kind of ALL_KINDS) {
      const def = ESTATE_ACTION_REGISTRY[kind];
      expect(def.engine).toBeTruthy();
      expect(def.label).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(typeof def.href).toBe("function");
    }
  });

  it("url-encodes the scan id in hrefs that consume it", () => {
    const action = defaultActionFor("documentation_gap", "scan/with space");
    expect(action.href).toBe("/environment/comments?scan=scan%2Fwith%20space");
    expect(action.engine).toBe("comments");
    expect(action.params).toEqual({ scanId: "scan/with space" });
  });

  it("opportunity routes discovery via /configure?fromScan", () => {
    const action = defaultActionFor("opportunity", "scan-1");
    expect(action.engine).toBe("opportunities");
    expect(action.href).toBe("/configure?fromScan=scan-1");
  });

  it("static-href engines ignore the scan id", () => {
    expect(defaultActionFor("well_architected_gap", "scan-1").href).toBe("/assessment");
    expect(defaultActionFor("query_ready_domain", "scan-1").href).toBe("/genie/create/schema");
  });
});
