import type {
  MetricViewDefinition,
  MetricViewDimension,
  MetricViewJoin,
  MetricViewMeasure,
} from "./definition";
import { artifactFingerprint } from "@/lib/toolkit/artifact-fingerprint";

export interface MetricViewImproveDiff {
  existingFqn: string;
  baseFingerprint: string;
  mergedFingerprint: string;
  addDimensions: MetricViewDimension[];
  addMeasures: MetricViewMeasure[];
  addJoins: MetricViewJoin[];
  commentUpdates: Array<{
    target: "view" | "dimension" | "measure";
    name?: string;
    comment: string;
  }>;
}

export class MetricViewImproveConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetricViewImproveConflictError";
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MetricViewImproveConflictError("Persisted metric view improvement diff is invalid.");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new MetricViewImproveConflictError(`Metric view improvement ${field} is invalid.`);
  }
  return value;
}

function assertKeys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new MetricViewImproveConflictError("Metric view improvement contains unknown fields.");
  }
}

function optionalSemanticMetadata(value: Record<string, unknown>): void {
  for (const field of ["comment", "displayName"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string") {
      throw new MetricViewImproveConflictError(`Metric view field ${field} is invalid.`);
    }
  }
  if (
    value.synonyms !== undefined &&
    (!Array.isArray(value.synonyms) ||
      value.synonyms.some((item) => typeof item !== "string"))
  ) {
    throw new MetricViewImproveConflictError("Metric view field synonyms are invalid.");
  }
}

function parseJoin(value: unknown): MetricViewJoin {
  const item = record(value);
  const kind = item.kind;
  assertKeys(item, [
    "kind",
    "name",
    "source",
    "joins",
    ...(kind === "on" ? ["on"] : ["using"]),
  ]);
  requiredString(item.name, "join name");
  requiredString(item.source, "join source");
  if (!Array.isArray(item.joins)) {
    throw new MetricViewImproveConflictError("Metric view nested joins are invalid.");
  }
  if (kind === "on") requiredString(item.on, "join expression");
  else if (
    kind !== "using" ||
    !Array.isArray(item.using) ||
    item.using.some((entry) => typeof entry !== "string" || !entry)
  ) {
    throw new MetricViewImproveConflictError("Metric view join kind is invalid.");
  }
  item.joins.forEach(parseJoin);
  return item as unknown as MetricViewJoin;
}

function parseDimension(value: unknown): MetricViewDimension {
  const item = record(value);
  assertKeys(item, [
    "kind",
    "name",
    "expr",
    "comment",
    "displayName",
    "synonyms",
    ...(item.kind === "joined" ? ["joinPath"] : []),
  ]);
  requiredString(item.name, "dimension name");
  requiredString(item.expr, "dimension expression");
  optionalSemanticMetadata(item);
  if (item.kind === "joined") {
    if (
      !Array.isArray(item.joinPath) ||
      item.joinPath.some((entry) => typeof entry !== "string" || !entry)
    ) {
      throw new MetricViewImproveConflictError("Joined dimension path is invalid.");
    }
  } else if (item.kind !== "local") {
    throw new MetricViewImproveConflictError("Metric view dimension kind is invalid.");
  }
  return item as unknown as MetricViewDimension;
}

function parseMeasure(value: unknown): MetricViewMeasure {
  const item = record(value);
  assertKeys(item, [
    "kind",
    "name",
    "comment",
    "displayName",
    "synonyms",
    "format",
    ...(item.kind === "ratio"
      ? ["numerator", "denominator"]
      : item.kind === "filtered"
        ? ["expr", "filter"]
        : item.kind === "window"
          ? ["expr", "window"]
          : ["expr"]),
  ]);
  requiredString(item.name, "measure name");
  optionalSemanticMetadata(item);
  if (item.format !== undefined && typeof item.format !== "string") {
    throw new MetricViewImproveConflictError("Metric view measure format is invalid.");
  }
  if (item.kind === "expression") requiredString(item.expr, "measure expression");
  else if (item.kind === "ratio") {
    requiredString(item.numerator, "measure numerator");
    requiredString(item.denominator, "measure denominator");
  } else if (item.kind === "filtered") {
    requiredString(item.expr, "measure expression");
    requiredString(item.filter, "measure filter");
  } else if (item.kind === "window") {
    requiredString(item.expr, "measure expression");
    if (!Array.isArray(item.window) || item.window.length === 0) {
      throw new MetricViewImproveConflictError("Metric view window is invalid.");
    }
    for (const window of item.window) {
      const parsed = record(window);
      assertKeys(parsed, ["order", "range", "semiadditive"]);
      requiredString(parsed.order, "window order");
      requiredString(parsed.range, "window range");
      if (
        parsed.semiadditive !== undefined &&
        parsed.semiadditive !== "first" &&
        parsed.semiadditive !== "last"
      ) {
        throw new MetricViewImproveConflictError("Metric view semiadditive value is invalid.");
      }
    }
  } else {
    throw new MetricViewImproveConflictError("Metric view measure kind is invalid.");
  }
  return item as unknown as MetricViewMeasure;
}

function fingerprint(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new MetricViewImproveConflictError(`Metric view improvement ${field} is invalid.`);
  }
  return value;
}

export function parseMetricViewImproveDiff(value: unknown): MetricViewImproveDiff {
  const input = record(value);
  assertKeys(input, [
    "existingFqn",
    "baseFingerprint",
    "mergedFingerprint",
    "addDimensions",
    "addMeasures",
    "addJoins",
    "commentUpdates",
  ]);
  if (
    !Array.isArray(input.addDimensions) ||
    !Array.isArray(input.addMeasures) ||
    !Array.isArray(input.addJoins) ||
    !Array.isArray(input.commentUpdates)
  ) {
    throw new MetricViewImproveConflictError("Metric view improvement arrays are invalid.");
  }
  const commentUpdates = input.commentUpdates.map((value) => {
    const update = record(value);
    assertKeys(update, ["target", "name", "comment"]);
    if (
      update.target !== "view" &&
      update.target !== "dimension" &&
      update.target !== "measure"
    ) {
      throw new MetricViewImproveConflictError("Metric view comment target is invalid.");
    }
    requiredString(update.comment, "comment");
    if (update.target !== "view") requiredString(update.name, "comment field name");
    if (update.target === "view" && update.name !== undefined) {
      throw new MetricViewImproveConflictError("View comment cannot name a field.");
    }
    return update as unknown as MetricViewImproveDiff["commentUpdates"][number];
  });
  return {
    existingFqn: requiredString(input.existingFqn, "existing FQN"),
    baseFingerprint: fingerprint(input.baseFingerprint, "base fingerprint"),
    mergedFingerprint: fingerprint(input.mergedFingerprint, "merged fingerprint"),
    addDimensions: input.addDimensions.map(parseDimension),
    addMeasures: input.addMeasures.map(parseMeasure),
    addJoins: input.addJoins.map(parseJoin),
    commentUpdates,
  };
}

export function fingerprintMetricViewDefinition(definition: MetricViewDefinition): string {
  return artifactFingerprint({
    ...definition,
    joins: stable(definition.joins),
    dimensions: stable(definition.dimensions),
    measures: stable(definition.measures),
    requiredFeatures: [...definition.requiredFeatures].sort(),
  });
}

function identity(name: string): string {
  return name.trim().toLowerCase();
}

function stable<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => identity(left.name).localeCompare(identity(right.name)));
}

function comparable<T extends { comment?: string }>(value: T): Omit<T, "comment"> {
  const { comment: _comment, ...rest } = value;
  return rest;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertDefinitionEnvelopeUnchanged(
  existing: MetricViewDefinition,
  desired: MetricViewDefinition,
): void {
  const envelope = (definition: MetricViewDefinition) => ({
    version: definition.version,
    name: definition.name,
    source: definition.source,
    filter: definition.filter,
    materialization: definition.materialization,
    requiredFeatures: definition.requiredFeatures,
  });
  if (!same(envelope(existing), envelope(desired))) {
    throw new MetricViewImproveConflictError(
      "Metric view improvement cannot replace its name, source, filter, materialization, version, or features.",
    );
  }
}

function additiveChanges<T extends { name: string; comment?: string }>(
  kind: "dimension" | "measure",
  existing: T[],
  desired: T[],
  commentUpdates: MetricViewImproveDiff["commentUpdates"],
): T[] {
  const existingByName = new Map(existing.map((item) => [identity(item.name), item]));
  const desiredByName = new Map<string, T>();
  for (const item of desired) {
    const key = identity(item.name);
    if (desiredByName.has(key)) {
      throw new MetricViewImproveConflictError(`Duplicate desired ${kind} "${item.name}".`);
    }
    desiredByName.set(key, item);
  }
  for (const item of existing) {
    const desiredItem = desiredByName.get(identity(item.name));
    if (!desiredItem) {
      throw new MetricViewImproveConflictError(`Improvement cannot remove ${kind} "${item.name}".`);
    }
    if (!same(comparable(item), comparable(desiredItem))) {
      throw new MetricViewImproveConflictError(
        `Improvement cannot replace existing ${kind} "${item.name}".`,
      );
    }
    if (item.comment !== desiredItem.comment) {
      if (desiredItem.comment === undefined) {
        throw new MetricViewImproveConflictError(
          `Improvement cannot remove the comment from ${kind} "${item.name}".`,
        );
      }
      commentUpdates.push({
        target: kind,
        name: item.name,
        comment: desiredItem.comment,
      });
    }
  }
  return stable(desired.filter((item) => !existingByName.has(identity(item.name))));
}

function additiveJoins(existing: MetricViewJoin[], desired: MetricViewJoin[]): MetricViewJoin[] {
  const existingByName = new Map(existing.map((join) => [identity(join.name), join]));
  const desiredByName = new Map<string, MetricViewJoin>();
  for (const join of desired) {
    const key = identity(join.name);
    if (desiredByName.has(key)) {
      throw new MetricViewImproveConflictError(`Duplicate desired join "${join.name}".`);
    }
    desiredByName.set(key, join);
  }
  for (const join of existing) {
    const desiredJoin = desiredByName.get(identity(join.name));
    if (!desiredJoin) {
      throw new MetricViewImproveConflictError(`Improvement cannot remove join "${join.name}".`);
    }
    if (!same(join, desiredJoin)) {
      throw new MetricViewImproveConflictError(
        `Improvement cannot replace existing join "${join.name}".`,
      );
    }
  }
  return stable(desired.filter((join) => !existingByName.has(identity(join.name))));
}

export function buildMetricViewImproveDiff(
  existing: MetricViewDefinition,
  desired: MetricViewDefinition,
): MetricViewImproveDiff {
  assertDefinitionEnvelopeUnchanged(existing, desired);
  const commentUpdates: MetricViewImproveDiff["commentUpdates"] = [];
  if (existing.comment !== desired.comment) {
    if (desired.comment === undefined) {
      throw new MetricViewImproveConflictError("Improvement cannot remove the metric view comment.");
    }
    commentUpdates.push({ target: "view", comment: desired.comment });
  }
  const addDimensions = additiveChanges(
    "dimension",
    existing.dimensions,
    desired.dimensions,
    commentUpdates,
  );
  const addMeasures = additiveChanges(
    "measure",
    existing.measures,
    desired.measures,
    commentUpdates,
  );
  const addJoins = additiveJoins(existing.joins, desired.joins);
  return {
    existingFqn: existing.name,
    baseFingerprint: fingerprintMetricViewDefinition(existing),
    mergedFingerprint: fingerprintMetricViewDefinition(desired),
    addDimensions,
    addMeasures,
    addJoins,
    commentUpdates,
  };
}

function assertAdditions<T extends { name: string }>(
  kind: string,
  existing: T[],
  additions: T[],
): void {
  const seen = new Set(existing.map((item) => identity(item.name)));
  for (const addition of additions) {
    const key = identity(addition.name);
    if (seen.has(key)) {
      throw new MetricViewImproveConflictError(
        `Cannot add duplicate or conflicting ${kind} "${addition.name}".`,
      );
    }
    seen.add(key);
  }
}

export function applyMetricViewImproveDiff(
  existing: MetricViewDefinition,
  diff: MetricViewImproveDiff,
): MetricViewDefinition {
  const parsed = parseMetricViewImproveDiff(diff);
  if (fingerprintMetricViewDefinition(existing) !== parsed.baseFingerprint) {
    throw new MetricViewImproveConflictError("Metric view improvement base fingerprint mismatch.");
  }
  if (!parsed.existingFqn.trim()) {
    throw new MetricViewImproveConflictError("Metric view improvement requires an existing FQN.");
  }
  assertAdditions("dimension", existing.dimensions, parsed.addDimensions);
  assertAdditions("measure", existing.measures, parsed.addMeasures);
  assertAdditions("join", existing.joins, parsed.addJoins);

  const merged = structuredClone(existing);
  merged.joins.push(...structuredClone(stable(parsed.addJoins)));
  merged.dimensions.push(...structuredClone(stable(parsed.addDimensions)));
  merged.measures.push(...structuredClone(stable(parsed.addMeasures)));
  for (const update of parsed.commentUpdates) {
    if (!update.comment.trim()) {
      throw new MetricViewImproveConflictError("Comment updates must be non-empty.");
    }
    if (update.target === "view") {
      if (update.name !== undefined) {
        throw new MetricViewImproveConflictError("View comment updates cannot name a field.");
      }
      merged.comment = update.comment;
      continue;
    }
    if (!update.name) {
      throw new MetricViewImproveConflictError(`${update.target} comment update requires a name.`);
    }
    const collection = update.target === "dimension" ? merged.dimensions : merged.measures;
    const field = collection.find((item) => identity(item.name) === identity(update.name!));
    if (!field) {
      throw new MetricViewImproveConflictError(
        `Cannot update missing ${update.target} "${update.name}".`,
      );
    }
    field.comment = update.comment;
  }
  if (fingerprintMetricViewDefinition(merged) !== parsed.mergedFingerprint) {
    throw new MetricViewImproveConflictError(
      "Metric view improvement merged fingerprint mismatch.",
    );
  }
  return merged;
}
