import { describe, it, expect } from "vitest";
import {
  insightDedupKey,
  mergeInsights,
  normalizeSemanticName,
  type MergeableInsight,
} from "@/lib/environment/insight-merge";

function ins(partial: Partial<MergeableInsight>): MergeableInsight {
  return {
    id: "i1",
    insightType: "pii_detection",
    tableFqn: "main.sales.orders",
    payloadJson: "{}",
    estateId: "p1",
    scanCreatedAt: 1,
    ...partial,
  };
}

describe("insightDedupKey", () => {
  it("keys canonical_entity by normalized name + estate scope, not payload hash", () => {
    const a = ins({
      insightType: "canonical_entity",
      tableFqn: null,
      payloadJson: JSON.stringify({ name: "Customer", tables: ["a"] }),
      estateId: "p1",
    });
    const b = ins({
      insightType: "canonical_entity",
      tableFqn: null,
      payloadJson: JSON.stringify({ name: " customer ", tables: ["a", "b"] }),
      estateId: "p1",
    });
    // Same normalized name + same estate → same key (payload differs).
    expect(insightDedupKey(a)).toBe(insightDedupKey(b));
  });

  it("scopes semantic identity by estate so different estates don't collapse", () => {
    const a = ins({
      insightType: "canonical_entity",
      tableFqn: null,
      payloadJson: JSON.stringify({ name: "Customer" }),
      estateId: "p1",
    });
    const b = ins({ ...a, estateId: "scan:s9" });
    expect(insightDedupKey(a)).not.toBe(insightDedupKey(b));
  });

  it("keys business_glossary_term by normalized term name", () => {
    const a = ins({
      insightType: "business_glossary_term",
      tableFqn: null,
      payloadJson: JSON.stringify({ term: "Net Revenue", definition: "v1" }),
    });
    const b = ins({
      insightType: "business_glossary_term",
      tableFqn: null,
      payloadJson: JSON.stringify({ term: "net revenue", definition: "v2 changed" }),
    });
    expect(insightDedupKey(a)).toBe(insightDedupKey(b));
  });

  it("preserves every distinct PII finding on the same table", () => {
    const a = ins({
      insightType: "pii_detection",
      payloadJson: JSON.stringify({ column: "email" }),
    });
    const b = ins({ insightType: "pii_detection", payloadJson: JSON.stringify({ column: "ssn" }) });
    expect(insightDedupKey(a)).not.toBe(insightDedupKey(b));
  });

  it("preserves distinct implicit/entity relationships", () => {
    const a = ins({
      insightType: "implicit_relationship",
      payloadJson: JSON.stringify({ sourceTableFqn: "x", targetTableFqn: "y" }),
    });
    const b = ins({
      insightType: "implicit_relationship",
      payloadJson: JSON.stringify({ sourceTableFqn: "x", targetTableFqn: "z" }),
    });
    expect(insightDedupKey(a)).not.toBe(insightDedupKey(b));
  });

  it("keeps governance_gap as one-per-table (latest wins)", () => {
    const a = ins({
      insightType: "governance_gap",
      payloadJson: JSON.stringify({ overallScore: 10 }),
    });
    const b = ins({
      insightType: "governance_gap",
      payloadJson: JSON.stringify({ overallScore: 90 }),
    });
    expect(insightDedupKey(a)).toBe(insightDedupKey(b));
  });
});

describe("mergeInsights", () => {
  it("changed ontology payload replaces the stale one (latest scan wins)", () => {
    const stale = ins({
      id: "old",
      insightType: "canonical_entity",
      tableFqn: null,
      payloadJson: JSON.stringify({ name: "Customer", tables: ["a"] }),
      scanCreatedAt: 100,
    });
    const fresh = ins({
      id: "new",
      insightType: "canonical_entity",
      tableFqn: null,
      payloadJson: JSON.stringify({ name: "Customer", tables: ["a", "b", "c"] }),
      scanCreatedAt: 200,
    });
    const merged = mergeInsights([stale, fresh]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("new");
  });

  it("retains all distinct multi-valued findings across scans", () => {
    const email = ins({ id: "e", payloadJson: JSON.stringify({ column: "email" }) });
    const ssn = ins({ id: "s", payloadJson: JSON.stringify({ column: "ssn" }) });
    const merged = mergeInsights([email, ssn]);
    expect(merged.map((m) => m.id).sort()).toEqual(["e", "s"]);
  });

  it("keeps latest governance_gap per table", () => {
    const older = ins({ id: "g1", insightType: "governance_gap", scanCreatedAt: 1 });
    const newer = ins({ id: "g2", insightType: "governance_gap", scanCreatedAt: 5 });
    const merged = mergeInsights([older, newer]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("g2");
  });

  it("is deterministic on createdAt ties (higher id wins)", () => {
    const a = ins({ id: "a", insightType: "governance_gap", scanCreatedAt: 5 });
    const b = ins({ id: "b", insightType: "governance_gap", scanCreatedAt: 5 });
    expect(mergeInsights([a, b])[0].id).toBe("b");
    expect(mergeInsights([b, a])[0].id).toBe("b");
  });
});

describe("normalizeSemanticName", () => {
  it("lowercases, trims and collapses whitespace", () => {
    expect(normalizeSemanticName("  Net   Revenue ")).toBe("net revenue");
  });
});
