import { describe, it, expect } from "vitest";
import {
  BOOST_PER_TABLE,
  MAX_BOOST,
  applyBlastRadiusBoost,
  computeBlastRadius,
  computeFeasibilityBoost,
} from "@/lib/domain/blast-radius";
import type { LineageEdge, LineageGraph, UseCase } from "@/lib/domain/types";

// -- Test fixtures -----------------------------------------------------------

function makeUseCase(id: string, tables: string[]): Pick<UseCase, "id" | "tablesInvolved"> {
  return { id, tablesInvolved: tables };
}

function makeEdge(
  source: string,
  target: string,
  overrides: Partial<LineageEdge> = {},
): LineageEdge {
  return {
    sourceTableFqn: source,
    targetTableFqn: target,
    sourceType: "TABLE",
    targetType: "TABLE",
    lastEventTime: null,
    entityType: null,
    eventCount: 1,
    ...overrides,
  };
}

function makeGraph(edges: LineageEdge[]): LineageGraph {
  return {
    edges,
    seedTables: [],
    discoveredTables: [],
    upstreamDepth: 0,
    downstreamDepth: 0,
  };
}

function makeFullUseCase(overrides: Partial<UseCase> = {}): UseCase {
  return {
    id: "uc1",
    runId: "run1",
    useCaseNo: 1,
    name: "Test UC",
    type: "Statistical",
    analyticsTechnique: "",
    statement: "",
    solution: "",
    businessValue: "",
    beneficiary: "",
    sponsor: "",
    domain: "General",
    subdomain: "",
    tablesInvolved: [],
    priorityScore: 0.5,
    feasibilityScore: 0.5,
    impactScore: 0.5,
    overallScore: 0.5,
    userPriorityScore: null,
    userFeasibilityScore: null,
    userImpactScore: null,
    userOverallScore: null,
    scoreRationale: null,
    consultingScorecard: null,
    sqlCode: null,
    sqlStatus: null,
    feedback: null,
    feedbackAt: null,
    enrichmentTags: null,
    sourceSystems: null,
    sourceSystemsOrigin: null,
    blastRadius: null,
    referenceUseCaseName: null,
    referenceUseCaseResolvedAt: null,
    ...overrides,
  };
}

// -- Tests -------------------------------------------------------------------

describe("computeBlastRadius — empty / null lineage", () => {
  it("returns a zeroed summary when lineage graph is null", () => {
    const out = computeBlastRadius({
      useCases: [makeUseCase("u1", ["a.b.c"])],
      lineageGraph: null,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.summary.downstreamTableCount).toBe(0);
    expect(out[0]?.summary.feasibilityBoost).toBe(0);
    expect(out[0]?.summary.totalEventCount).toBe(0);
  });

  it("returns a zeroed summary when a use case has no tables", () => {
    const out = computeBlastRadius({
      useCases: [makeUseCase("u1", [])],
      lineageGraph: makeGraph([makeEdge("a.b.c", "x.y.z")]),
    });
    expect(out[0]?.summary.downstreamTableCount).toBe(0);
  });
});

describe("computeBlastRadius — single seed table", () => {
  it("counts direct downstream consumers and groups by entityType", () => {
    const out = computeBlastRadius({
      useCases: [makeUseCase("u1", ["main.silver.orders"])],
      lineageGraph: makeGraph([
        makeEdge("main.silver.orders", "main.gold.dim_orders", {
          entityType: "JOB",
          eventCount: 5,
        }),
        makeEdge("main.silver.orders", "main.gold.fact_revenue", {
          entityType: "NOTEBOOK",
          eventCount: 3,
        }),
        makeEdge("main.silver.orders", "main.ml.feature_orders", {
          entityType: "PIPELINE",
          eventCount: 2,
        }),
      ]),
    });
    const s = out[0]!.summary;
    expect(s.downstreamTableCount).toBe(3);
    expect(s.byEntityType.job).toBe(1);
    expect(s.byEntityType.notebook).toBe(1);
    expect(s.byEntityType.pipeline).toBe(1);
    expect(s.byEntityType.other).toBe(0);
    expect(s.totalEventCount).toBe(10);
    expect(s.feasibilityBoost).toBeCloseTo(0.09);
  });

  it("buckets DASHBOARD and QUERY entityTypes into the dashboard slot", () => {
    const out = computeBlastRadius({
      useCases: [makeUseCase("u1", ["main.silver.orders"])],
      lineageGraph: makeGraph([
        makeEdge("main.silver.orders", "main.gold.t1", { entityType: "DASHBOARD" }),
        makeEdge("main.silver.orders", "main.gold.t2", { entityType: "QUERY" }),
      ]),
    });
    expect(out[0]?.summary.byEntityType.dashboard).toBe(2);
  });

  it("buckets unknown entityTypes into the 'other' slot", () => {
    const out = computeBlastRadius({
      useCases: [makeUseCase("u1", ["main.silver.orders"])],
      lineageGraph: makeGraph([
        makeEdge("main.silver.orders", "main.gold.t1", { entityType: "TRIGGER" }),
        makeEdge("main.silver.orders", "main.gold.t2", { entityType: null }),
      ]),
    });
    expect(out[0]?.summary.byEntityType.other).toBe(2);
  });
});

describe("computeBlastRadius — BFS multi-hop", () => {
  it("counts downstream tables across multiple hops within the budget", () => {
    // orders → o_clean → o_enriched → o_final
    const out = computeBlastRadius({
      useCases: [makeUseCase("u1", ["main.silver.orders"])],
      lineageGraph: makeGraph([
        makeEdge("main.silver.orders", "main.silver.o_clean", { entityType: "JOB" }),
        makeEdge("main.silver.o_clean", "main.silver.o_enriched", { entityType: "JOB" }),
        makeEdge("main.silver.o_enriched", "main.gold.o_final", { entityType: "JOB" }),
      ]),
    });
    expect(out[0]?.summary.downstreamTableCount).toBe(3);
    expect(out[0]?.summary.byEntityType.job).toBe(3);
  });

  it("respects the maxDownstreamHops budget", () => {
    const out = computeBlastRadius({
      useCases: [makeUseCase("u1", ["main.silver.orders"])],
      lineageGraph: makeGraph([
        makeEdge("main.silver.orders", "main.silver.o1"),
        makeEdge("main.silver.o1", "main.silver.o2"),
        makeEdge("main.silver.o2", "main.silver.o3"),
        makeEdge("main.silver.o3", "main.silver.o4"),
        makeEdge("main.silver.o4", "main.silver.o5"),
      ]),
      maxDownstreamHops: 2,
    });
    expect(out[0]?.summary.downstreamTableCount).toBe(2); // o1, o2
  });
});

describe("computeBlastRadius — multi-seed dedup", () => {
  it("does not double-count a downstream table reached from two seeds", () => {
    // Both seeds feed the same fact_revenue table via different edges.
    // The TABLE count must be 1, but each edge bucket should still tally.
    const out = computeBlastRadius({
      useCases: [makeUseCase("u1", ["a.b.orders", "a.b.payments"])],
      lineageGraph: makeGraph([
        makeEdge("a.b.orders", "a.b.fact_revenue", { entityType: "JOB" }),
        makeEdge("a.b.payments", "a.b.fact_revenue", { entityType: "PIPELINE" }),
      ]),
    });
    const s = out[0]!.summary;
    expect(s.downstreamTableCount).toBe(1);
    expect(s.byEntityType.job).toBe(1);
    expect(s.byEntityType.pipeline).toBe(1);
  });

  it("excludes the seeds themselves from the downstream count", () => {
    // Edge from seed A to seed B (both in tablesInvolved) — not downstream.
    const out = computeBlastRadius({
      useCases: [makeUseCase("u1", ["a.b.orders", "a.b.payments"])],
      lineageGraph: makeGraph([
        makeEdge("a.b.orders", "a.b.payments", { entityType: "JOB" }),
      ]),
    });
    expect(out[0]?.summary.downstreamTableCount).toBe(0);
  });

  it("dedups duplicate edges (same source+target+entityType) defensively", () => {
    const out = computeBlastRadius({
      useCases: [makeUseCase("u1", ["a.b.orders"])],
      lineageGraph: makeGraph([
        makeEdge("a.b.orders", "a.b.gold", { entityType: "JOB", eventCount: 4 }),
        makeEdge("a.b.orders", "a.b.gold", { entityType: "JOB", eventCount: 4 }),
      ]),
    });
    const s = out[0]!.summary;
    expect(s.downstreamTableCount).toBe(1);
    expect(s.byEntityType.job).toBe(1);
    expect(s.totalEventCount).toBe(4);
  });
});

describe("computeFeasibilityBoost", () => {
  it("is zero when there are no downstream tables", () => {
    expect(computeFeasibilityBoost(0)).toBe(0);
  });

  it("scales linearly per table up to the cap", () => {
    expect(computeFeasibilityBoost(1)).toBeCloseTo(BOOST_PER_TABLE);
    expect(computeFeasibilityBoost(3)).toBeCloseTo(0.09);
    expect(computeFeasibilityBoost(5)).toBe(MAX_BOOST);
    expect(computeFeasibilityBoost(50)).toBe(MAX_BOOST);
  });
});

describe("applyBlastRadiusBoost", () => {
  it("is a no-op when boost is zero", () => {
    const uc = makeFullUseCase({ feasibilityScore: 0.6, overallScore: 0.55 });
    applyBlastRadiusBoost(uc, {
      downstreamTableCount: 0,
      byEntityType: { job: 0, notebook: 0, pipeline: 0, dashboard: 0, other: 0 },
      totalEventCount: 0,
      feasibilityBoost: 0,
    });
    expect(uc.feasibilityScore).toBe(0.6);
    expect(uc.overallScore).toBe(0.55);
  });

  it("adds the boost to feasibility and one-third into overall", () => {
    const uc = makeFullUseCase({ feasibilityScore: 0.5, overallScore: 0.5 });
    applyBlastRadiusBoost(uc, {
      downstreamTableCount: 3,
      byEntityType: { job: 3, notebook: 0, pipeline: 0, dashboard: 0, other: 0 },
      totalEventCount: 9,
      feasibilityBoost: 0.09,
    });
    expect(uc.feasibilityScore).toBeCloseTo(0.59);
    expect(uc.overallScore).toBeCloseTo(0.53);
  });

  it("clamps to 1.0 at the ceiling", () => {
    const uc = makeFullUseCase({ feasibilityScore: 0.95, overallScore: 0.98 });
    applyBlastRadiusBoost(uc, {
      downstreamTableCount: 10,
      byEntityType: { job: 10, notebook: 0, pipeline: 0, dashboard: 0, other: 0 },
      totalEventCount: 50,
      feasibilityBoost: MAX_BOOST,
    });
    expect(uc.feasibilityScore).toBe(1);
    expect(uc.overallScore).toBe(1);
  });

  it("never lowers a score", () => {
    const uc = makeFullUseCase({ feasibilityScore: 0.8, overallScore: 0.8 });
    applyBlastRadiusBoost(uc, {
      downstreamTableCount: 1,
      byEntityType: { job: 1, notebook: 0, pipeline: 0, dashboard: 0, other: 0 },
      totalEventCount: 1,
      feasibilityBoost: 0.03,
    });
    expect(uc.feasibilityScore).toBeGreaterThanOrEqual(0.8);
    expect(uc.overallScore).toBeGreaterThanOrEqual(0.8);
  });
});
