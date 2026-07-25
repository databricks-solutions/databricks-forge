import { artifactFingerprint } from "@/lib/toolkit/artifact-fingerprint";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, message: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as UnknownRecord;
}

function identity(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function normalizeSerializedDashboard(value: string | unknown): UnknownRecord {
  if (value === undefined || value === null || value === "") {
    throw new Error("Live serialized dashboard artifact is missing.");
  }
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  const dashboard = record(parsed, "Live serialized dashboard artifact is unreadable.");
  if (!Array.isArray(dashboard.datasets) || !Array.isArray(dashboard.pages)) {
    throw new Error("Live serialized dashboard artifact is missing datasets or pages.");
  }
  const datasets = dashboard.datasets
    .map((dataset) => {
      const parsedDataset = record(dataset, "Live dashboard dataset is invalid.");
      return {
        ...parsedDataset,
        ...(Array.isArray(parsedDataset.queryLines)
          ? {
              queryLines: parsedDataset.queryLines.map((line) =>
                typeof line === "string" ? line.trimEnd() : line,
              ),
            }
          : {}),
      };
    })
    .sort((left, right) =>
      identity((left as UnknownRecord).name).localeCompare(identity((right as UnknownRecord).name)),
    );
  const pages = dashboard.pages
    .map((page) => {
      const parsedPage = record(page, "Live dashboard page is invalid.");
      if (!Array.isArray(parsedPage.layout)) {
        throw new Error("Live dashboard page layout is invalid.");
      }
      return {
        ...parsedPage,
        layout: parsedPage.layout
          .map((item) => record(item, "Live dashboard layout item is invalid."))
          .sort((left, right) => {
            const leftWidget = record(left.widget, "Live dashboard widget is invalid.");
            const rightWidget = record(right.widget, "Live dashboard widget is invalid.");
            return identity(leftWidget.name).localeCompare(identity(rightWidget.name));
          }),
      };
    })
    .sort((left, right) =>
      identity((left as UnknownRecord).name).localeCompare(identity((right as UnknownRecord).name)),
    );
  return { datasets, pages };
}

export function fingerprintSerializedDashboard(value: string | unknown): string {
  return artifactFingerprint(normalizeSerializedDashboard(value));
}
