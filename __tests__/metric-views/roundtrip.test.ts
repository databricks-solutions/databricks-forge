import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMetricViewYaml } from "@/lib/metric-views/parser";
import { serializeMetricViewYaml } from "@/lib/metric-views/serializer";

const FIXTURES = [
  "v1-basic.yaml",
  "v1-nested-joins.yaml",
  "v1-window.yaml",
  "v1-materialization.yaml",
  "v1-cron-filtered-ratios.yaml",
] as const;

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), "__tests__/fixtures/metric-views", name), "utf8");
}

describe("metric view semantic round trips", () => {
  it.each(FIXTURES)("preserves the normalized definition for %s", (name) => {
    const definition = parseMetricViewYaml(fixture(name), "orders_metrics");
    const serialized = serializeMetricViewYaml(definition);

    expect(parseMetricViewYaml(serialized, definition.name)).toEqual(definition);
    expect(serializeMetricViewYaml(parseMetricViewYaml(serialized, definition.name))).toBe(
      serialized,
    );
  });
});
