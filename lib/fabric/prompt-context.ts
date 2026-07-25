/**
 * Build LLM prompt context from a Fabric/Power BI scan.
 *
 * Called during use case generation when a run is linked to a Fabric scan,
 * so the LLM can propose use cases that directly replace PBI assets.
 */

import { getFabricScanDetail } from "@/lib/lakebase/fabric-scans";
import { logger } from "@/lib/logger";
import type { FabricScanDetail, FabricDataset, FabricReport } from "./types";

const MAX_CONTEXT_CHARS = 8000;

/**
 * Load a Fabric scan and build a markdown context string for LLM injection.
 *
 * Returns empty string if the scan doesn't exist or has no usable data.
 */
export async function buildPbiContextForGeneration(scanId: string): Promise<string> {
  try {
    const detail = await getFabricScanDetail(scanId);
    if (!detail) {
      logger.warn("[fabric/prompt-context] Scan not found", { scanId });
      return "";
    }

    return buildContextFromDetail(detail);
  } catch (err) {
    logger.warn("[fabric/prompt-context] Failed to build PBI context", {
      scanId,
      error: err instanceof Error ? err.message : String(err),
    });
    return "";
  }
}

function buildContextFromDetail(detail: FabricScanDetail): string {
  const sections: string[] = [];

  sections.push("## Existing Power BI / Fabric Estate");
  sections.push(
    `The customer has ${detail.datasetCount} PBI datasets, ${detail.reportCount} reports, and ${detail.measureCount} DAX measures. ` +
      "Propose use cases that directly replace these PBI assets with Databricks-native alternatives (Gold tables, metric views, Lakeview dashboards, Genie spaces).",
  );

  const datasetSection = buildDatasetSection(detail.datasets);
  if (datasetSection) sections.push(datasetSection);

  const reportSection = buildReportSection(detail.reports, detail.datasets);
  if (reportSection) sections.push(reportSection);

  const relationshipSection = buildRelationshipSection(detail.datasets);
  if (relationshipSection) sections.push(relationshipSection);

  let context = sections.join("\n\n");
  if (context.length > MAX_CONTEXT_CHARS) {
    context = context.slice(0, MAX_CONTEXT_CHARS) + "\n\n[...truncated for brevity]";
  }

  return context;
}

function buildDatasetSection(datasets: FabricDataset[]): string {
  if (datasets.length === 0) return "";

  const lines: string[] = ["### PBI Datasets & Measures"];

  for (const ds of datasets) {
    lines.push(
      `\n**${ds.name}**${ds.sensitivityLabel ? ` [sensitivity: ${ds.sensitivityLabel}]` : ""}`,
    );

    if (ds.tables.length > 0) {
      lines.push("Tables:");
      for (const table of ds.tables) {
        const colSummary = table.columns
          .slice(0, 10)
          .map((c) => `${c.name} (${c.dataType})`)
          .join(", ");
        const extra = table.columns.length > 10 ? ` +${table.columns.length - 10} more` : "";
        lines.push(`- ${table.name}: ${colSummary}${extra}`);

        for (const measure of table.measures ?? []) {
          lines.push(
            `  - Measure: ${measure.name} = \`${truncateExpression(measure.expression)}\`${measure.description ? ` -- ${measure.description}` : ""}`,
          );
        }
      }
    }

    if (ds.measures.length > 0) {
      lines.push("Dataset-level measures:");
      for (const m of ds.measures) {
        lines.push(
          `- ${m.name} = \`${truncateExpression(m.expression)}\`${m.description ? ` -- ${m.description}` : ""}`,
        );
      }
    }

    if (ds.datasources.length > 0) {
      lines.push(
        `Data sources: ${ds.datasources.map((d) => d.datasourceType || "unknown").join(", ")}`,
      );
    }
  }

  return lines.join("\n");
}

function buildReportSection(reports: FabricReport[], datasets: FabricDataset[]): string {
  if (reports.length === 0) return "";

  const dsNameMap = new Map(datasets.map((ds) => [ds.datasetId, ds.name]));
  const lines: string[] = ["### PBI Reports"];

  for (const r of reports) {
    const dsRef = r.datasetId ? dsNameMap.get(r.datasetId) : null;
    const tiles = r.tiles.length > 0 ? ` -- tiles: ${r.tiles.map((t) => t.title).join(", ")}` : "";
    lines.push(
      `- **${r.name}**${r.reportType ? ` (${r.reportType})` : ""}${dsRef ? ` [dataset: ${dsRef}]` : ""}${tiles}`,
    );
  }

  return lines.join("\n");
}

function buildRelationshipSection(datasets: FabricDataset[]): string {
  const allRels = datasets.flatMap((ds) =>
    ds.relationships.map(
      (r) => `${ds.name}: ${r.fromTable}.${r.fromColumn} → ${r.toTable}.${r.toColumn}`,
    ),
  );
  if (allRels.length === 0) return "";

  return "### PBI Relationships\n" + allRels.map((r) => `- ${r}`).join("\n");
}

function truncateExpression(expr: string, max = 120): string {
  const oneLine = expr.replace(/\n/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max) + "..." : oneLine;
}
