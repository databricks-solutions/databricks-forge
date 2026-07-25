import { describe, it, expect } from "vitest";
import { normalizeScopeInput } from "@/lib/lakebase/estate-scope-input";

describe("normalizeScopeInput", () => {
  it("rejects a scope with no ucMetadata", () => {
    const res = normalizeScopeInput({ label: "x" });
    expect(res.ok).toBe(false);
  });

  it("parses and persists inclusionPatterns / workspaceId / teamLabel", () => {
    const res = normalizeScopeInput({
      ucMetadata: "cat.schema",
      inclusionPatterns: "fact_*, dim_*",
      workspaceId: "ws-123",
      teamLabel: "Upstream",
    });
    expect(res.ok).toBe(true);
    expect(res.scope).toMatchObject({
      ucMetadata: "cat.schema",
      inclusionPatterns: "fact_*, dim_*",
      workspaceId: "ws-123",
      teamLabel: "Upstream",
    });
    // label defaults to ucMetadata when absent
    expect(res.scope!.label).toBe("cat.schema");
  });

  it("rejects an unsafe inclusion pattern via the shared safe-pattern validator", () => {
    const res = normalizeScopeInput({
      ucMetadata: "cat.schema",
      inclusionPatterns: "fact_$$$",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/pattern/i);
  });

  it("rejects a wildcard-everything inclusion pattern", () => {
    const res = normalizeScopeInput({ ucMetadata: "cat.schema", inclusionPatterns: "*" });
    expect(res.ok).toBe(false);
  });

  it("clamps lineageDepth into the [1,10] bound", () => {
    expect(normalizeScopeInput({ ucMetadata: "c.s", lineageDepth: 99 }).scope!.lineageDepth).toBe(
      10,
    );
    expect(normalizeScopeInput({ ucMetadata: "c.s", lineageDepth: 0 }).scope!.lineageDepth).toBe(1);
    expect(normalizeScopeInput({ ucMetadata: "c.s", lineageDepth: 4 }).scope!.lineageDepth).toBe(4);
  });

  it("rejects an over-long provenance string", () => {
    const res = normalizeScopeInput({
      ucMetadata: "cat.schema",
      teamLabel: "x".repeat(300),
    });
    expect(res.ok).toBe(false);
  });

  it("normalises lineageDirection to a valid enum only", () => {
    expect(
      normalizeScopeInput({ ucMetadata: "c.s", lineageDirection: "both" }).scope!.lineageDirection,
    ).toBe("both");
    expect(
      normalizeScopeInput({ ucMetadata: "c.s", lineageDirection: "sideways" }).scope!
        .lineageDirection,
    ).toBeUndefined();
  });
});
