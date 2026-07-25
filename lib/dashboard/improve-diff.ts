import type {
  DashboardDesignV2,
  DatasetDesignV2,
  FilterDesignV2,
  WidgetDesignV2,
} from "./design-ir";
import { requireDashboardDesignV2 } from "./design-ir";
import { artifactFingerprint } from "@/lib/toolkit/artifact-fingerprint";

export interface DashboardWidgetDesignV2 extends WidgetDesignV2 {
  pageName: string;
}

export interface DashboardImproveDiff {
  existingAssetId: string;
  liveBaseFingerprint: string;
  baseFingerprint: string;
  mergedFingerprint: string;
  addDatasets: DatasetDesignV2[];
  addWidgets: DashboardWidgetDesignV2[];
  addFilters: FilterDesignV2[];
}

export type DashboardRecommendationClassification = "reuse" | "improve" | "new";
export type PersistedDashboardRecommendationType =
  | "reuse"
  | "new"
  | "enhancement"
  | "replacement";

export function toPersistedDashboardRecommendationType(
  classification: DashboardRecommendationClassification,
): PersistedDashboardRecommendationType {
  if (classification === "reuse") return "reuse";
  return classification === "improve" ? "enhancement" : "new";
}

export function fromPersistedDashboardRecommendationType(
  value: PersistedDashboardRecommendationType,
): DashboardRecommendationClassification {
  if (value === "reuse") return "reuse";
  return value === "enhancement" ? "improve" : "new";
}

export class DashboardImproveConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DashboardImproveConflictError";
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DashboardImproveConflictError("Persisted dashboard improvement diff is invalid.");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DashboardImproveConflictError(`Dashboard improvement ${field} is invalid.`);
  }
  return value;
}

function assertKeys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new DashboardImproveConflictError("Dashboard improvement contains unknown fields.");
  }
}

function assertDataset(value: unknown): void {
  const dataset = record(value);
  assertKeys(dataset, [
    "name",
    "displayName",
    "purpose",
    "sourceKind",
    "metricViewFqn",
    "metricIds",
    "dimensionIds",
    "sql",
    "expectedFields",
  ]);
  if (Array.isArray(dataset.expectedFields)) {
    for (const value of dataset.expectedFields) {
      assertKeys(record(value), ["name", "roles", "compatibleTypes"]);
    }
  }
}

function assertWidget(value: Record<string, unknown>): void {
  assertKeys(value, ["pageName", "type", "title", "datasetName", "fields"]);
  if (Array.isArray(value.fields)) {
    for (const field of value.fields) {
      assertKeys(record(field), ["name", "expression", "role"]);
    }
  }
}

function assertFilter(value: unknown): void {
  const filter = record(value);
  assertKeys(filter, ["type", "title", "field", "bindings"]);
  if (Array.isArray(filter.bindings)) {
    for (const binding of filter.bindings) {
      assertKeys(record(binding), ["datasetName", "fieldName", "expression"]);
    }
  }
}

function fingerprint(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new DashboardImproveConflictError(`Dashboard improvement ${field} is invalid.`);
  }
  return value;
}

export function fingerprintDashboardDesign(design: DashboardDesignV2): string {
  return artifactFingerprint({
    version: design.version,
    title: design.title,
    description: design.description,
    datasets: stable(design.datasets, (dataset) => dataset.name),
    pages: stable(
      design.pages.map((page) => ({
        ...page,
        widgets: stable(page.widgets, (widget) => widget.title),
        filters: stable(page.filters, (filter) => filter.title),
      })),
      (page) => page.name,
    ),
    globalFilters: stable(design.globalFilters, (filter) => filter.title),
  });
}

export function parseDashboardImproveDiff(value: unknown): DashboardImproveDiff {
  const input = record(value);
  assertKeys(input, [
    "existingAssetId",
    "liveBaseFingerprint",
    "baseFingerprint",
    "mergedFingerprint",
    "addDatasets",
    "addWidgets",
    "addFilters",
  ]);
  if (
    !Array.isArray(input.addDatasets) ||
    !Array.isArray(input.addWidgets) ||
    !Array.isArray(input.addFilters)
  ) {
    throw new DashboardImproveConflictError("Dashboard improvement arrays are invalid.");
  }
  input.addDatasets.forEach(assertDataset);
  input.addFilters.forEach(assertFilter);
  const pageNames = new Set<string>();
  const rawWidgets = input.addWidgets.map((value) => {
    const widget = record(value);
    assertWidget(widget);
    const pageName = requiredString(widget.pageName, "widget page name");
    pageNames.add(pageName);
    const { pageName: _pageName, ...design } = widget;
    return { pageName, design };
  });
  let candidate: DashboardDesignV2;
  try {
    candidate = requireDashboardDesignV2({
      version: "2",
      title: "Improvement diff",
      description: "",
      datasets: input.addDatasets,
      pages: [...pageNames].map((pageName) => ({
        name: pageName,
        displayName: pageName,
        widgets: rawWidgets
          .filter((widget) => widget.pageName === pageName)
          .map((widget) => widget.design),
        filters: [],
      })),
      globalFilters: input.addFilters,
    });
  } catch {
    throw new DashboardImproveConflictError("Persisted dashboard improvement diff is invalid.");
  }
  const widgetsByPage = new Map(candidate.pages.map((page) => [page.name, page.widgets]));
  return {
    existingAssetId: requiredString(input.existingAssetId, "existing dashboard ID"),
    liveBaseFingerprint: fingerprint(input.liveBaseFingerprint, "live base fingerprint"),
    baseFingerprint: fingerprint(input.baseFingerprint, "base fingerprint"),
    mergedFingerprint: fingerprint(input.mergedFingerprint, "merged fingerprint"),
    addDatasets: candidate.datasets,
    addWidgets: rawWidgets.flatMap((widget) =>
      (widgetsByPage.get(widget.pageName) ?? [])
        .filter((candidate) => candidate.title === widget.design.title)
        .map((candidate) => ({ ...candidate, pageName: widget.pageName })),
    ),
    addFilters: candidate.globalFilters,
  };
}

function identity(value: string): string {
  return value.trim().toLowerCase();
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function stable<T>(items: T[], name: (item: T) => string): T[] {
  return [...items].sort((left, right) => identity(name(left)).localeCompare(identity(name(right))));
}

function additive<T>(
  kind: string,
  existing: T[],
  desired: T[],
  name: (item: T) => string,
): T[] {
  const existingByName = new Map(existing.map((item) => [identity(name(item)), item]));
  const desiredByName = new Map<string, T>();
  for (const item of desired) {
    const key = identity(name(item));
    if (!key || desiredByName.has(key)) {
      throw new DashboardImproveConflictError(`Duplicate or empty desired ${kind} identity.`);
    }
    desiredByName.set(key, item);
  }
  for (const item of existing) {
    const desiredItem = desiredByName.get(identity(name(item)));
    if (!desiredItem) {
      throw new DashboardImproveConflictError(
        `Dashboard improvement cannot remove ${kind} "${name(item)}".`,
      );
    }
    if (!same(item, desiredItem)) {
      throw new DashboardImproveConflictError(
        `Dashboard improvement cannot replace existing ${kind} "${name(item)}".`,
      );
    }
  }
  return stable(
    desired.filter((item) => !existingByName.has(identity(name(item)))),
    name,
  );
}

function assertPageEnvelope(existing: DashboardDesignV2, desired: DashboardDesignV2): void {
  if (
    existing.version !== desired.version ||
    existing.title !== desired.title ||
    existing.description !== desired.description
  ) {
    throw new DashboardImproveConflictError(
      "Dashboard improvement cannot replace the version, title, or description.",
    );
  }
  const existingByName = new Map(existing.pages.map((page) => [identity(page.name), page]));
  const desiredByName = new Map(desired.pages.map((page) => [identity(page.name), page]));
  if (
    existingByName.size !== existing.pages.length ||
    desiredByName.size !== desired.pages.length ||
    existingByName.size !== desiredByName.size
  ) {
    throw new DashboardImproveConflictError(
      "Dashboard improvement cannot add, remove, or duplicate pages.",
    );
  }
  for (const page of existing.pages) {
    const desiredPage = desiredByName.get(identity(page.name));
    if (
      !desiredPage ||
      page.displayName !== desiredPage.displayName ||
      page.description !== desiredPage.description ||
      !same(page.filters, desiredPage.filters)
    ) {
      throw new DashboardImproveConflictError(
        `Dashboard improvement cannot replace page "${page.name}" metadata or page filters.`,
      );
    }
  }
}

export function buildDashboardImproveDiff(
  existingAssetId: string,
  existing: DashboardDesignV2,
  desired: DashboardDesignV2,
  liveBaseFingerprint: string,
): DashboardImproveDiff {
  if (!existingAssetId.trim()) {
    throw new DashboardImproveConflictError(
      "Dashboard improvement requires an existing dashboard ID.",
    );
  }
  fingerprint(liveBaseFingerprint, "live base fingerprint");
  assertPageEnvelope(existing, desired);
  const addDatasets = additive(
    "dataset",
    existing.datasets,
    desired.datasets,
    (dataset) => dataset.name,
  );
  const addWidgets = stable(
    existing.pages.flatMap((page) => {
      const desiredPage = desired.pages.find(
        (candidate) => identity(candidate.name) === identity(page.name),
      )!;
      return additive("widget", page.widgets, desiredPage.widgets, (widget) => widget.title).map(
        (widget) => ({ ...widget, pageName: page.name }),
      );
    }),
    (widget) => `${widget.pageName}\u0000${widget.title}`,
  );
  const addFilters = additive(
    "global filter",
    existing.globalFilters,
    desired.globalFilters,
    (filter) => filter.title,
  );
  return {
    existingAssetId,
    liveBaseFingerprint,
    baseFingerprint: fingerprintDashboardDesign(existing),
    mergedFingerprint: fingerprintDashboardDesign(desired),
    addDatasets,
    addWidgets,
    addFilters,
  };
}

function assertNewIdentities<T>(
  kind: string,
  existing: T[],
  additions: T[],
  name: (item: T) => string,
): void {
  const seen = new Set(existing.map((item) => identity(name(item))));
  for (const addition of additions) {
    const key = identity(name(addition));
    if (!key || seen.has(key)) {
      throw new DashboardImproveConflictError(
        `Cannot add duplicate or conflicting ${kind} "${name(addition)}".`,
      );
    }
    seen.add(key);
  }
}

export function applyDashboardImproveDiff(
  existing: DashboardDesignV2,
  diff: DashboardImproveDiff,
): DashboardDesignV2 {
  const parsed = parseDashboardImproveDiff(diff);
  if (fingerprintDashboardDesign(existing) !== parsed.baseFingerprint) {
    throw new DashboardImproveConflictError("Dashboard improvement base fingerprint mismatch.");
  }
  if (!parsed.existingAssetId.trim()) {
    throw new DashboardImproveConflictError(
      "Dashboard improvement requires an existing dashboard ID.",
    );
  }
  assertNewIdentities("dataset", existing.datasets, parsed.addDatasets, (dataset) => dataset.name);
  assertNewIdentities(
    "global filter",
    existing.globalFilters,
    parsed.addFilters,
    (filter) => filter.title,
  );

  const widgetsByPage = new Map<string, DashboardWidgetDesignV2[]>();
  for (const widget of parsed.addWidgets) {
    const page = existing.pages.find(
      (candidate) => identity(candidate.name) === identity(widget.pageName),
    );
    if (!page) {
      throw new DashboardImproveConflictError(
        `Cannot add widget "${widget.title}" to missing page "${widget.pageName}".`,
      );
    }
    const pageAdditions = widgetsByPage.get(identity(page.name)) ?? [];
    assertNewIdentities(
      "widget",
      [...page.widgets, ...pageAdditions],
      [widget],
      (item) => item.title,
    );
    pageAdditions.push(widget);
    widgetsByPage.set(identity(page.name), pageAdditions);
  }

  const merged = {
    ...existing,
    datasets: [...existing.datasets, ...stable(parsed.addDatasets, (dataset) => dataset.name)],
    pages: existing.pages.map((page) => ({
      ...page,
      widgets: [
        ...page.widgets,
        ...stable(widgetsByPage.get(identity(page.name)) ?? [], (widget) => widget.title).map(
          ({ pageName: _pageName, ...widget }) => widget,
        ),
      ],
      filters: [...page.filters],
    })),
    globalFilters: [
      ...existing.globalFilters,
      ...stable(parsed.addFilters, (filter) => filter.title),
    ],
  };
  if (fingerprintDashboardDesign(merged) !== parsed.mergedFingerprint) {
    throw new DashboardImproveConflictError("Dashboard improvement merged fingerprint mismatch.");
  }
  return merged;
}
