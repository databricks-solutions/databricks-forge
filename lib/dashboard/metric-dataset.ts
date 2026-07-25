import type { VerifiedMetricViewAsset } from "@/lib/semantic-assets/types";
import { validateFqn, validateIdentifier } from "@/lib/validation";
import { validateMetricViewSql } from "./validation";

export const DEFAULT_METRIC_DATASET_LIMIT = 1000;
const MAX_LIMIT = 1000;

function quoteIdentifier(value: string, label: string): string {
  return `\`${validateIdentifier(value, label)}\``;
}

function quoteFqn(value: string): { normalized: string; quoted: string } {
  const normalized = validateFqn(value, "metric view FQN");
  const parts = normalized.split(".");
  if (parts.length !== 3) {
    throw new Error(`metric view FQN must have exactly 3 dot-separated parts, got ${parts.length}`);
  }
  return {
    normalized,
    quoted: parts
      .map((part, index) => quoteIdentifier(part, `metric view FQN segment ${index + 1}`))
      .join("."),
  };
}

function checkedLimit(limit: number | undefined): number {
  const value = limit ?? DEFAULT_METRIC_DATASET_LIMIT;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_LIMIT) {
    throw new Error(`metric dataset limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return value;
}

function requestedNames(
  requestedIds: string[],
  fields: Array<{ id: string; name: string }>,
  kind: "measure" | "dimension",
): string[] {
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  return requestedIds.map((id) => {
    const field = fieldsById.get(id);
    if (!field) throw new Error(`Requested ${kind} ID "${id}" is not governed by this metric view`);
    return validateIdentifier(field.name, `metric view ${kind}`);
  });
}

function assertUniqueAliases(dimensions: string[], measures: string[]): void {
  const seen = new Set<string>();
  for (const alias of [...dimensions, ...measures]) {
    const normalized = alias.trim().toLowerCase();
    if (seen.has(normalized)) {
      throw new Error(`Duplicate normalized dataset alias "${normalized}"`);
    }
    seen.add(normalized);
  }
}

export function renderMetricViewDatasetSql(input: {
  asset: VerifiedMetricViewAsset;
  measures: string[];
  dimensions: string[];
  limit?: number;
}): string {
  if (input.asset.validationState !== "valid") {
    throw new Error(`Metric view "${input.asset.id}" is not verified`);
  }
  if (input.measures.length === 0) {
    throw new Error("Metric-view datasets require at least one requested measure ID");
  }

  const fqn = quoteFqn(input.asset.deployedFqn ?? input.asset.intendedFqn);
  const dimensions = requestedNames(input.dimensions, input.asset.dimensions, "dimension");
  const measures = requestedNames(input.measures, input.asset.measures, "measure");
  assertUniqueAliases(dimensions, measures);
  const projections = [
    ...dimensions.map((name) => quoteIdentifier(name, "metric view dimension")),
    ...measures.map(
      (name) =>
        `MEASURE(${quoteIdentifier(name, "metric view measure")}) AS ${quoteIdentifier(
          name,
          "metric view measure alias",
        )}`,
    ),
  ];
  const lines = [
    "SELECT",
    ...projections.map(
      (projection, index) => `  ${projection}${index < projections.length - 1 ? "," : ""}`,
    ),
    `FROM ${fqn.quoted}`,
    ...(dimensions.length > 0 ? ["GROUP BY ALL"] : []),
    `LIMIT ${checkedLimit(input.limit)}`,
  ];
  const sql = lines.join("\n");
  const validation = validateMetricViewSql(
    sql,
    new Set([fqn.normalized.toLowerCase()]),
    new Map([[fqn.normalized.toLowerCase(), measures]]),
  );
  if (!validation.valid) {
    throw new Error(`Rendered metric-view SQL failed validation: ${validation.issues.join("; ")}`);
  }
  return sql;
}
