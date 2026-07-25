/**
 * Excel export for run comparison results.
 *
 * Generates a workbook with sheets for: Summary, Step Metrics,
 * Use Case Overlap, Use Case Alignment, and Config Diff.
 */

import ExcelJS from "exceljs";
import type { RunComparisonResult } from "@/lib/lakebase/run-comparison";

const DATABRICKS_BLUE = "FF003366";
const WHITE = "FFFFFFFF";
const LIGHT_GRAY_BG = "FFF9FAFB";
const BORDER_COLOR = "FFD1D5DB";

function thinBorder(): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = { style: "thin", color: { argb: BORDER_COLOR } };
  return { top: side, bottom: side, left: side, right: side };
}

function styleHeaderRow(sheet: ExcelJS.Worksheet): void {
  const headerRow = sheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: WHITE }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DATABRICKS_BLUE } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = thinBorder();
  });
}

function styleDataRows(sheet: ExcelJS.Worksheet, startRow: number, endRow: number): void {
  for (let r = startRow; r <= endRow; r++) {
    const row = sheet.getRow(r);
    row.eachCell((cell) => {
      cell.border = thinBorder();
      cell.alignment = { vertical: "middle", wrapText: true };
      if (r % 2 === 0) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_GRAY_BG } };
      }
    });
  }
}

export async function generateComparisonExcel(comparison: RunComparisonResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const { runA, runB } = comparison;

  // --- Summary Sheet ---
  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Metric", key: "metric", width: 30 },
    { header: `Run A: ${runA.run.config.businessName}`, key: "a", width: 30 },
    { header: `Run B: ${runB.run.config.businessName}`, key: "b", width: 30 },
    { header: "Delta", key: "delta", width: 15 },
  ];
  styleHeaderRow(summary);

  const metrics: Array<{ metric: string; a: string | number; b: string | number; delta: string }> =
    [
      {
        metric: "Run ID",
        a: runA.run.runId.substring(0, 8),
        b: runB.run.runId.substring(0, 8),
        delta: "",
      },
      { metric: "Status", a: runA.run.status, b: runB.run.status, delta: "" },
      {
        metric: "Use Cases",
        a: runA.metrics.useCaseCount,
        b: runB.metrics.useCaseCount,
        delta: String(runB.metrics.useCaseCount - runA.metrics.useCaseCount),
      },
      {
        metric: "Avg Overall Score",
        a: runA.metrics.avgOverallScore.toFixed(3),
        b: runB.metrics.avgOverallScore.toFixed(3),
        delta: (runB.metrics.avgOverallScore - runA.metrics.avgOverallScore).toFixed(3),
      },
      {
        metric: "Domains",
        a: runA.metrics.domains.length,
        b: runB.metrics.domains.length,
        delta: String(runB.metrics.domains.length - runA.metrics.domains.length),
      },
      {
        metric: "AI Use Cases",
        a: runA.metrics.aiCount,
        b: runB.metrics.aiCount,
        delta: String(runB.metrics.aiCount - runA.metrics.aiCount),
      },
      {
        metric: "Statistical Use Cases",
        a: runA.metrics.statisticalCount,
        b: runB.metrics.statisticalCount,
        delta: String(runB.metrics.statisticalCount - runA.metrics.statisticalCount),
      },
      {
        metric: "SQL Success Rate",
        a: `${(runA.metrics.sqlSuccessRate * 100).toFixed(1)}%`,
        b: `${(runB.metrics.sqlSuccessRate * 100).toFixed(1)}%`,
        delta: `${((runB.metrics.sqlSuccessRate - runA.metrics.sqlSuccessRate) * 100).toFixed(1)}%`,
      },
      {
        metric: "Total Tokens",
        a: runA.metrics.totalTokens,
        b: runB.metrics.totalTokens,
        delta: String(runB.metrics.totalTokens - runA.metrics.totalTokens),
      },
      {
        metric: "Total Duration (s)",
        a: (runA.metrics.totalDurationMs / 1000).toFixed(1),
        b: (runB.metrics.totalDurationMs / 1000).toFixed(1),
        delta: `${((runB.metrics.totalDurationMs - runA.metrics.totalDurationMs) / 1000).toFixed(1)}s`,
      },
    ];

  for (const m of metrics) summary.addRow(m);
  styleDataRows(summary, 2, summary.rowCount);

  // --- Step Metrics Sheet ---
  const steps = wb.addWorksheet("Step Metrics");
  steps.columns = [
    { header: "Step", key: "step", width: 25 },
    { header: "Duration A (s)", key: "durationA", width: 16 },
    { header: "Duration B (s)", key: "durationB", width: 16 },
    { header: "Tokens A", key: "tokensA", width: 14 },
    { header: "Tokens B", key: "tokensB", width: 14 },
    { header: "Calls A", key: "callsA", width: 12 },
    { header: "Calls B", key: "callsB", width: 12 },
    { header: "Success A", key: "successA", width: 14 },
    { header: "Success B", key: "successB", width: 14 },
  ];
  styleHeaderRow(steps);

  for (const s of comparison.stepMetrics) {
    steps.addRow({
      step: s.step,
      durationA: s.durationMsA != null ? (s.durationMsA / 1000).toFixed(1) : "—",
      durationB: s.durationMsB != null ? (s.durationMsB / 1000).toFixed(1) : "—",
      tokensA: s.tokensA,
      tokensB: s.tokensB,
      callsA: s.callsA,
      callsB: s.callsB,
      successA: `${(s.successRateA * 100).toFixed(1)}%`,
      successB: `${(s.successRateB * 100).toFixed(1)}%`,
    });
  }
  styleDataRows(steps, 2, steps.rowCount);

  // --- Overlap Sheet ---
  const overlap = wb.addWorksheet("Use Case Overlap");
  overlap.columns = [
    { header: "Category", key: "category", width: 25 },
    { header: "Count", key: "count", width: 12 },
    { header: "Details", key: "details", width: 60 },
  ];
  styleHeaderRow(overlap);

  overlap.addRow({
    category: "Shared Use Cases",
    count: comparison.overlap.sharedCount,
    details: comparison.overlap.sharedNames.slice(0, 20).join(", "),
  });
  overlap.addRow({
    category: "Unique to Run A",
    count: comparison.overlap.uniqueACount,
    details: "",
  });
  overlap.addRow({
    category: "Unique to Run B",
    count: comparison.overlap.uniqueBCount,
    details: "",
  });
  styleDataRows(overlap, 2, overlap.rowCount);

  // --- Alignment Sheet ---
  const alignment = wb.addWorksheet("Use Case Alignment");
  alignment.columns = [
    { header: "Use Case A", key: "nameA", width: 35 },
    { header: "Domain A", key: "domainA", width: 20 },
    { header: "Score A", key: "scoreA", width: 12 },
    { header: "Use Case B", key: "nameB", width: 35 },
    { header: "Domain B", key: "domainB", width: 20 },
    { header: "Score B", key: "scoreB", width: 12 },
    { header: "Similarity", key: "similarity", width: 14 },
  ];
  styleHeaderRow(alignment);

  for (const a of comparison.useCaseAlignment) {
    alignment.addRow({
      nameA: a.nameA,
      domainA: a.domainA,
      scoreA: a.scoreA.toFixed(3),
      nameB: a.nameB,
      domainB: a.domainB,
      scoreB: a.scoreB.toFixed(3),
      similarity: `${(a.similarity * 100).toFixed(1)}%`,
    });
  }
  styleDataRows(alignment, 2, alignment.rowCount);

  // --- Config Diff Sheet ---
  const config = wb.addWorksheet("Config Diff");
  config.columns = [
    { header: "Setting", key: "setting", width: 25 },
    { header: "Run A", key: "a", width: 35 },
    { header: "Run B", key: "b", width: 35 },
  ];
  styleHeaderRow(config);

  const configPairs: Array<{ setting: string; a: string; b: string }> = [
    { setting: "Business Name", a: runA.run.config.businessName, b: runB.run.config.businessName },
    { setting: "UC Metadata", a: runA.run.config.ucMetadata, b: runB.run.config.ucMetadata },
    { setting: "AI Model", a: runA.run.config.aiModel, b: runB.run.config.aiModel },
    {
      setting: "Discovery Depth",
      a: runA.run.config.discoveryDepth ?? "balanced",
      b: runB.run.config.discoveryDepth ?? "balanced",
    },
    { setting: "Industry", a: runA.run.config.industry ?? "—", b: runB.run.config.industry ?? "—" },
    {
      setting: "Sample Rows",
      a: String(runA.run.config.sampleRowsPerTable ?? 0),
      b: String(runB.run.config.sampleRowsPerTable ?? 0),
    },
    {
      setting: "Priorities",
      a: runA.run.config.businessPriorities.join(", "),
      b: runB.run.config.businessPriorities.join(", "),
    },
  ];

  for (const c of configPairs) config.addRow(c);
  styleDataRows(config, 2, config.rowCount);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
