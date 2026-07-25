import { describe, expect, it } from "vitest";
import {
  applyMetricViewImproveDiff,
  buildMetricViewImproveDiff,
  fingerprintMetricViewDefinition,
  MetricViewImproveConflictError,
  parseMetricViewImproveDiff,
} from "@/lib/metric-views/improve-diff";
import type { MetricViewDefinition } from "@/lib/metric-views/definition";

function definition(overrides: Partial<MetricViewDefinition> = {}): MetricViewDefinition {
  return {
    version: "1.1",
    name: "catalog.analytics.sales_metrics",
    comment: "Sales metrics",
    source: { kind: "table", table: "catalog.sales.orders" },
    joins: [],
    dimensions: [{ kind: "local", name: "order_date", expr: "order_date" }],
    measures: [{ kind: "expression", name: "revenue", expr: "SUM(revenue)" }],
    requiredFeatures: [],
    ...overrides,
  };
}

describe("metric view improvement diffs", () => {
  it("builds an additive, deterministically ordered diff and merged preview", () => {
    const existing = definition();
    const desired = definition({
      comment: "Curated sales metrics",
      joins: [
        { kind: "on", name: "store", source: "catalog.sales.stores", on: "source.store_id = store.id", joins: [] },
      ],
      dimensions: [
        ...existing.dimensions,
        { kind: "local", name: "z_region", expr: "region" },
        { kind: "local", name: "a_channel", expr: "channel" },
      ],
      measures: [
        ...existing.measures,
        { kind: "expression", name: "z_orders", expr: "COUNT(*)" },
        { kind: "expression", name: "a_margin", expr: "SUM(margin)" },
      ],
    });

    const diff = buildMetricViewImproveDiff(existing, desired);

    expect(diff).toMatchObject({
      existingFqn: existing.name,
      baseFingerprint: fingerprintMetricViewDefinition(existing),
      mergedFingerprint: fingerprintMetricViewDefinition(desired),
      addDimensions: [{ name: "a_channel" }, { name: "z_region" }],
      addMeasures: [{ name: "a_margin" }, { name: "z_orders" }],
      addJoins: [{ name: "store" }],
      commentUpdates: [{ target: "view", comment: "Curated sales metrics" }],
    });
    expect(applyMetricViewImproveDiff(existing, diff)).toEqual({
      ...desired,
      joins: desired.joins,
      dimensions: [existing.dimensions[0], desired.dimensions[2], desired.dimensions[1]],
      measures: [existing.measures[0], desired.measures[2], desired.measures[1]],
    });
  });

  it("suppresses exact duplicates while retaining comment-only updates", () => {
    const existing = definition({
      dimensions: [{ kind: "local", name: "region", expr: "region", comment: "Old" }],
      measures: [{ kind: "expression", name: "revenue", expr: "SUM(revenue)", comment: "Old" }],
    });
    const desired = definition({
      dimensions: [{ kind: "local", name: "region", expr: "region", comment: "New" }],
      measures: [{ kind: "expression", name: "revenue", expr: "SUM(revenue)", comment: "New" }],
    });

    const original = structuredClone(existing);
    const diff = buildMetricViewImproveDiff(existing, desired);
    expect(diff).toEqual({
      existingFqn: existing.name,
      baseFingerprint: fingerprintMetricViewDefinition(existing),
      mergedFingerprint: fingerprintMetricViewDefinition(desired),
      addDimensions: [],
      addMeasures: [],
      addJoins: [],
      commentUpdates: [
        { target: "dimension", name: "region", comment: "New" },
        { target: "measure", name: "revenue", comment: "New" },
      ],
    });
    applyMetricViewImproveDiff(existing, diff);
    expect(existing).toEqual(original);
  });

  it("rejects replacement, deletion, source, filter, and feature conflicts", () => {
    const existing = definition();
    const conflicts: MetricViewDefinition[] = [
      definition({ dimensions: [{ kind: "local", name: "order_date", expr: "DATE(order_date)" }] }),
      definition({ dimensions: [] }),
      definition({ source: { kind: "table", table: "catalog.sales.other" } }),
      definition({ filter: "status = 'OPEN'" }),
      definition({ requiredFeatures: ["source_query"] }),
    ];

    for (const desired of conflicts) {
      expect(() => buildMetricViewImproveDiff(existing, desired)).toThrow(
        MetricViewImproveConflictError,
      );
    }
  });

  it("rejects malformed externally supplied diffs during apply", () => {
    const existing = definition();
    expect(() =>
      applyMetricViewImproveDiff(existing, {
        existingFqn: existing.name,
        baseFingerprint: fingerprintMetricViewDefinition(existing),
        mergedFingerprint: "corrupt",
        addDimensions: [{ kind: "local", name: "order_date", expr: "different" }],
        addMeasures: [],
        addJoins: [],
        commentUpdates: [],
      }),
    ).toThrow(MetricViewImproveConflictError);
  });

  it("strictly parses persisted diffs and rejects corruption", () => {
    const existing = definition();
    const diff = buildMetricViewImproveDiff(existing, existing);
    expect(parseMetricViewImproveDiff(JSON.parse(JSON.stringify(diff)))).toEqual(diff);
    expect(() =>
      parseMetricViewImproveDiff({ ...diff, addMeasures: [{ name: "bad", kind: "unknown" }] }),
    ).toThrow(MetricViewImproveConflictError);
    expect(() => parseMetricViewImproveDiff({ ...diff, baseFingerprint: 42 })).toThrow(
      MetricViewImproveConflictError,
    );
    expect(() => parseMetricViewImproveDiff({ ...diff, replacement: true })).toThrow(
      MetricViewImproveConflictError,
    );
  });

  it("rejects base and merged fingerprint drift during apply", () => {
    const existing = definition();
    const diff = buildMetricViewImproveDiff(existing, existing);
    expect(() => applyMetricViewImproveDiff({ ...existing, comment: "drift" }, diff)).toThrow(
      MetricViewImproveConflictError,
    );
    expect(() =>
      applyMetricViewImproveDiff(existing, { ...diff, mergedFingerprint: "0".repeat(64) }),
    ).toThrow(MetricViewImproveConflictError);
  });
});
