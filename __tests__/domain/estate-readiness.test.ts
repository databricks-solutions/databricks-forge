import { describe, it, expect } from "vitest";
import {
  computeMetadataQualityCoverage,
  computeTierDistribution,
  computeReadinessScore,
  readinessBandForScore,
} from "@/lib/domain/estate-readiness";
import type { TableDetail } from "@/lib/domain/types";

type DetailLite = Pick<
  TableDetail,
  "fqn" | "comment" | "generatedDescription" | "owner" | "dataTier" | "dataDomain"
>;

function d(partial: Partial<DetailLite> & { fqn: string }): DetailLite {
  return {
    fqn: partial.fqn,
    comment: partial.comment ?? null,
    generatedDescription: partial.generatedDescription ?? null,
    owner: partial.owner ?? null,
    dataTier: partial.dataTier ?? null,
    dataDomain: partial.dataDomain ?? null,
  };
}

describe("estate-readiness", () => {
  it("computes metadata-quality coverage percentages", () => {
    const details = [
      d({ fqn: "c.s.a", comment: "x", owner: "o", dataTier: "gold", dataDomain: "Sales" }),
      d({ fqn: "c.s.b", generatedDescription: "y", dataTier: "bronze" }),
      d({ fqn: "c.s.c" }),
      d({ fqn: "c.s.d" }),
    ];
    const cov = computeMetadataQualityCoverage(details, {
      hasTags: (fqn) => fqn === "c.s.a",
      columnsByFqn: (fqn) =>
        fqn === "c.s.a"
          ? JSON.stringify([
              { name: "id", comment: "pk" },
              { name: "x", comment: null },
            ])
          : null,
    });
    expect(cov.tableCount).toBe(4);
    expect(cov.tablesWithCommentPct).toBe(50); // a + b
    expect(cov.tablesWithOwnerPct).toBe(25); // a
    expect(cov.tablesWithTierPct).toBe(50); // a + b
    expect(cov.tablesWithDomainPct).toBe(25); // a
    expect(cov.tablesWithTagsPct).toBe(25); // a
    expect(cov.columnsWithCommentPct).toBe(50); // 1 of 2 columns commented
  });

  it("counts tier distribution including null -> unknown", () => {
    const dist = computeTierDistribution([
      d({ fqn: "1", dataTier: "gold" }),
      d({ fqn: "2", dataTier: "gold" }),
      d({ fqn: "3", dataTier: "silver" }),
      d({ fqn: "4", dataTier: "bronze" }),
      d({ fqn: "5", dataTier: "system" }),
      d({ fqn: "6" }),
    ]);
    expect(dist).toEqual({ bronze: 1, silver: 1, gold: 2, system: 1, unknown: 1 });
  });

  it("scores a well-governed gold entity as ready and a bare bronze entity as needs work/missing", () => {
    const map = new Map<string, DetailLite>([
      ["good", d({ fqn: "good", comment: "doc", owner: "team", dataTier: "gold" })],
      ["bad", d({ fqn: "bad" })],
    ]);
    const gov = new Map<string, number>([
      ["good", 90],
      ["bad", 10],
    ]);
    const good = computeReadinessScore(["good"], map, gov);
    const bad = computeReadinessScore(["bad"], map, gov);
    expect(good.band).toBe("ready");
    expect(good.score).toBeGreaterThanOrEqual(70);
    expect(bad.band).toBe("missing");
    expect(bad.score).toBeLessThan(40);
  });

  it("returns missing for an empty table set", () => {
    expect(computeReadinessScore([], new Map()).band).toBe("missing");
  });

  it("bands map to thresholds", () => {
    expect(readinessBandForScore(80)).toBe("ready");
    expect(readinessBandForScore(50)).toBe("needs_work");
    expect(readinessBandForScore(20)).toBe("missing");
  });
});
