import { describe, expect, it } from "vitest";
import {
  scopeOf,
  KIND_SCOPE,
  GLOBAL_KINDS,
  RUN_SCOPED_KINDS,
  SCAN_SCOPED_KINDS,
  SOURCE_SCOPED_KINDS,
  SOURCE_PARENT,
} from "@/lib/embeddings/kind-scope";

describe("kind-scope", () => {
  it("classifies pipeline kinds as scoped to a run", () => {
    expect(scopeOf("use_case")).toBe("run");
    expect(scopeOf("business_context")).toBe("run");
    expect(scopeOf("value_estimate")).toBe("run");
  });

  it("classifies estate / fabric kinds as scoped to a scan", () => {
    expect(scopeOf("table_detail")).toBe("scan");
    expect(scopeOf("fabric_dataset")).toBe("scan");
  });

  it("classifies source-id keyed kinds with a parent mapping", () => {
    expect(scopeOf("document_chunk")).toBe("source");
    expect(scopeOf("company_research")).toBe("source");
    expect(SOURCE_PARENT.document_chunk).toBe("document");
    expect(SOURCE_PARENT.company_research).toBe("demo_session");
  });

  it("classifies catalog reference kinds as global", () => {
    expect(scopeOf("outcome_map")).toBe("global");
    expect(scopeOf("benchmark_context")).toBe("global");
    expect(scopeOf("skill_chunk")).toBe("global");
  });

  it("each helper set is consistent with the KIND_SCOPE map", () => {
    for (const k of GLOBAL_KINDS) expect(KIND_SCOPE[k]).toBe("global");
    for (const k of RUN_SCOPED_KINDS) expect(KIND_SCOPE[k]).toBe("run");
    for (const k of SCAN_SCOPED_KINDS) expect(KIND_SCOPE[k]).toBe("scan");
    for (const k of SOURCE_SCOPED_KINDS) expect(KIND_SCOPE[k]).toBe("source");

    const totals =
      GLOBAL_KINDS.length +
      RUN_SCOPED_KINDS.length +
      SCAN_SCOPED_KINDS.length +
      SOURCE_SCOPED_KINDS.length;
    expect(totals).toBe(Object.keys(KIND_SCOPE).length);
  });

  it("every source-scoped kind has a SOURCE_PARENT mapping", () => {
    for (const k of SOURCE_SCOPED_KINDS) {
      expect(SOURCE_PARENT[k]).toBeDefined();
    }
  });
});
