/**
 * Data Gap v2 Excel export (Phase 3.8).
 *
 * Renders a Databricks-branded .xlsx workbook from a `DataGapResult`
 * (Master Repository v2 Data Gap engine), centred on the Sales-Ready
 * Onboarding Plan. Designed to be a single-button download from the
 * v2 DataGapCard: "Download Onboarding Plan".
 *
 * Five sheets:
 *
 *   1. **Onboarding Plan** — Ranked source systems with their preferred
 *      Lakeflow ingestion path, asset count, use-case count, and annual
 *      unlock value (low/mid/high). The headline sheet for Sales.
 *   2. **Asset Coverage** — Full per-Reference-Data-Asset coverage matrix:
 *      present/missing flag, matched-table count, MC/VA use case counts,
 *      resolved source systems (with origin badge), recommended path.
 *   3. **Value at Risk** — Per-missing-asset economic value-at-risk,
 *      attributed back to use cases. Carries the Phase 2 impactedUseCases.
 *   4. **Use Case Mapping** — Per-Master-Repo-use-case asset linkage with
 *      criticality (MC/VA), aggregated for traceability.
 *   5. **Summary** — Top-of-file KPIs: total assets, coverage %, total
 *      value-at-risk, plus a header with industry name + generated date.
 *
 * All input comes from a `DataGapResult` already on disk via
 * `getLatestDataGapAnalysisForRun`. The exporter is pure — no I/O, no
 * Prisma — so the API route stays thin (load result, build buffer, ship).
 */

import ExcelJS from "exceljs";
import type {
  AssetCoverage,
  AssetValueAtRisk,
  DataGapResult,
  IngestionRecommendation,
} from "@/lib/engines/data-gap-analysis/types";
import {
  buildOnboardingPlan,
  type OnboardingPlanRow,
} from "@/lib/engines/data-gap-analysis/onboarding-plan";
import type { ResolvedSourceSystem } from "@/lib/engines/data-gap-analysis/source-systems";

/**
 * Render a single resolved source for an Excel cell. Lineage rows show
 * the vendor; master-repo rows show the category + example vendors so
 * the customer-facing workbook never claims we know a specific vendor
 * we haven't actually detected.
 */
function renderSourceForCell(s: ResolvedSourceSystem): string {
  if (s.origin === "unknown") return "Unconfirmed";
  if (s.origin === "master-repo" && s.exampleVendors && s.exampleVendors.length > 0) {
    return `${s.name} (e.g. ${s.exampleVendors.slice(0, 3).join(", ")})`;
  }
  return s.name;
}

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

const DATABRICKS_BLUE = "FF003366";
const WHITE = "FFFFFFFF";
const LIGHT_GRAY_BG = "FFF9FAFB";
const BORDER_COLOR = "FFD1D5DB";
const AMBER_FILL = "FFFFF3E0";
const GREEN_FILL = "FFE8F5E9";

const STRATEGY_LABEL: Record<string, string> = {
  lakeflow_connect: "Lakeflow Connect",
  uc_federation: "UC Federation",
  lakebridge_migrate: "Lakebridge Migrate",
  bespoke: "Bespoke",
};

const ORIGIN_LABEL: Record<string, string> = {
  lineage: "Lineage-confirmed",
  "master-repo": "Reference architecture",
  unknown: "Unconfirmed",
};

// ---------------------------------------------------------------------------
// Styling helpers
// ---------------------------------------------------------------------------

function thinBorder(): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = { style: "thin", color: { argb: BORDER_COLOR } };
  return { top: side, bottom: side, left: side, right: side };
}

function styleHeaderRow(sheet: ExcelJS.Worksheet, rowNumber = 1): void {
  const header = sheet.getRow(rowNumber);
  header.height = 26;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: WHITE }, size: 11 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: DATABRICKS_BLUE },
    };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = thinBorder();
  });
}

function styleDataRows(sheet: ExcelJS.Worksheet, startRow: number, endRow: number): void {
  for (let r = startRow; r <= endRow; r++) {
    const row = sheet.getRow(r);
    row.eachCell((cell) => {
      cell.border = thinBorder();
      cell.alignment = { vertical: "top", wrapText: true };
      if (r % 2 === 0) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: LIGHT_GRAY_BG },
        };
      }
    });
  }
}

function paintCells(
  sheet: ExcelJS.Worksheet,
  cells: { row: number; col: number; argb: string }[],
): void {
  for (const c of cells) {
    sheet.getCell(c.row, c.col).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: c.argb },
    };
  }
}

// ---------------------------------------------------------------------------
// Sheet builders
// ---------------------------------------------------------------------------

function buildOnboardingPlanSheet(wb: ExcelJS.Workbook, plan: OnboardingPlanRow[]): void {
  const sheet = wb.addWorksheet("Onboarding Plan", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "Rank", key: "rank", width: 6 },
    { header: "Source System", key: "system", width: 32 },
    { header: "Confidence", key: "origin", width: 22 },
    { header: "Recommended Path", key: "path", width: 32 },
    { header: "Assets Unlocked", key: "assetCount", width: 16 },
    { header: "Use Cases Unlocked", key: "ucCount", width: 18 },
    { header: "Annual Unlock (Low)", key: "low", width: 18 },
    { header: "Annual Unlock (Mid)", key: "mid", width: 18 },
    { header: "Annual Unlock (High)", key: "high", width: 18 },
    { header: "Top Assets", key: "topAssets", width: 50 },
    { header: "Use Case Sample", key: "ucs", width: 50 },
  ];
  styleHeaderRow(sheet);
  plan.forEach((row, idx) => {
    const systemCell = renderSystemCell(row);
    const pathCell = renderPathCell(row);
    sheet.addRow({
      rank: idx + 1,
      system: systemCell,
      origin: ORIGIN_LABEL[row.origin] ?? row.origin,
      path: pathCell,
      assetCount: row.assetCount,
      ucCount: row.useCaseCount,
      low: row.valueLow,
      mid: row.valueMid,
      high: row.valueHigh,
      topAssets: row.assets.map((a) => `${a.assetId}: ${a.assetName}`).join("\n"),
      ucs: row.useCases.join("\n"),
    });
  });
  styleDataRows(sheet, 2, sheet.lastRow?.number ?? 1);
  // Currency format on the three value columns
  for (let r = 2; r <= (sheet.lastRow?.number ?? 1); r++) {
    sheet.getCell(r, 7).numFmt = '"$"#,##0';
    sheet.getCell(r, 8).numFmt = '"$"#,##0';
    sheet.getCell(r, 9).numFmt = '"$"#,##0';
  }
  // Highlight the unknown row(s)
  for (let r = 2; r <= (sheet.lastRow?.number ?? 1); r++) {
    const origin = sheet.getCell(r, 3).value;
    if (typeof origin === "string" && origin.startsWith("Unconfirmed")) {
      paintCells(sheet, [{ row: r, col: 3, argb: AMBER_FILL }]);
    } else if (typeof origin === "string" && origin.startsWith("Lineage")) {
      paintCells(sheet, [{ row: r, col: 3, argb: GREEN_FILL }]);
    }
  }
  appendLegend(sheet);
}

/**
 * Render the "Source System" cell. Lineage rows show the verbatim vendor;
 * master-repo rows show the category + a short example list so the
 * workbook is self-explanatory when emailed without the UI context; the
 * unconfirmed bucket calls out the likely categories so sales sees the
 * discovery prompts immediately.
 */
function renderSystemCell(row: OnboardingPlanRow): string {
  if (row.origin === "master-repo" && row.exampleVendors && row.exampleVendors.length > 0) {
    return `${row.systemName} (e.g. ${row.exampleVendors.slice(0, 3).join(", ")})`;
  }
  if (row.origin === "unknown" && row.likelyCategories && row.likelyCategories.length > 0) {
    return `${row.systemName} (likely categories: ${row.likelyCategories.join(", ")})`;
  }
  return row.systemName;
}

/**
 * Render the "Recommended Path" cell. Lineage rows are vendor-specific
 * paths; master-repo rows add a `(typical for category)` caveat so the
 * reader doesn't mistake the recommendation for a vendor confirmation.
 */
function renderPathCell(row: OnboardingPlanRow): string {
  if (!row.preferredStrategy) return "Confirm source with customer";
  const label = STRATEGY_LABEL[row.preferredStrategy] ?? row.preferredStrategy;
  if (row.origin === "master-repo") {
    return `${label} (typical for ${row.systemName})`;
  }
  return label;
}

/**
 * Append a 3-row confidence legend to the bottom of the Onboarding Plan
 * sheet so the workbook is self-describing when shared with customers.
 */
function appendLegend(sheet: ExcelJS.Worksheet): void {
  const startRow = (sheet.lastRow?.number ?? 1) + 2;
  sheet.getCell(startRow, 1).value = "Confidence legend";
  sheet.getCell(startRow, 1).font = { bold: true };
  const legendRows: Array<[string, string]> = [
    [
      "Lineage-confirmed",
      "Vendor confirmed from upstream lineage in this workspace. Recommended path matches the vendor.",
    ],
    [
      "Reference architecture",
      "Inferred from the industry reference architecture. The category is right but the specific vendor is NOT verified — confirm with the customer.",
    ],
    [
      "Unconfirmed",
      "No source signal yet. Confirm the source with the customer before picking an ingestion path.",
    ],
  ];
  legendRows.forEach(([label, description], idx) => {
    const r = startRow + 1 + idx;
    sheet.getCell(r, 1).value = label;
    sheet.getCell(r, 1).font = { italic: true };
    sheet.mergeCells(r, 2, r, 11);
    sheet.getCell(r, 2).value = description;
    sheet.getCell(r, 2).alignment = { vertical: "top", wrapText: true };
  });
}

function buildCoverageSheet(wb: ExcelJS.Workbook, coverage: AssetCoverage[]): void {
  const sheet = wb.addWorksheet("Asset Coverage", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "Asset ID", key: "id", width: 16 },
    { header: "Asset Name", key: "name", width: 30 },
    { header: "Family", key: "family", width: 20 },
    { header: "Status", key: "status", width: 12 },
    { header: "Matched Tables", key: "matched", width: 14 },
    { header: "MC Use Cases", key: "mc", width: 14 },
    { header: "VA Use Cases", key: "va", width: 14 },
    { header: "Source Systems", key: "sources", width: 30 },
    { header: "Source Confidence", key: "origin", width: 22 },
    { header: "Recommended Path", key: "recommended", width: 22 },
    { header: "Recommendation Rationale", key: "rationale", width: 60 },
  ];
  styleHeaderRow(sheet);
  coverage.forEach((row) => {
    const top: IngestionRecommendation | undefined = row.recommendations[0];
    const sources = (row.resolvedSourceSystems ?? [])
      .map((s) => renderSourceForCell(s))
      .join("\n");
    const originList = (row.resolvedSourceSystems ?? [])
      .map((s) => ORIGIN_LABEL[s.origin] ?? s.origin)
      .join(", ");
    sheet.addRow({
      id: row.assetId,
      name: row.assetName,
      family: row.assetFamily,
      status: row.present ? "Present" : "Missing",
      matched: row.matchedTables.length,
      mc: row.mcUseCaseCount,
      va: row.vaUseCaseCount,
      sources: sources || "--",
      origin: originList || "--",
      recommended: top
        ? (STRATEGY_LABEL[top.strategy] ?? top.strategy) + ` (${top.rating})`
        : "--",
      rationale: top?.rationale ?? "",
    });
  });
  styleDataRows(sheet, 2, sheet.lastRow?.number ?? 1);
  // Paint Status column green for Present, amber for Missing
  for (let r = 2; r <= (sheet.lastRow?.number ?? 1); r++) {
    const status = sheet.getCell(r, 4).value;
    paintCells(sheet, [
      { row: r, col: 4, argb: status === "Present" ? GREEN_FILL : AMBER_FILL },
    ]);
  }
}

function buildValueAtRiskSheet(wb: ExcelJS.Workbook, var_: AssetValueAtRisk[]): void {
  const sheet = wb.addWorksheet("Value at Risk", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "Asset ID", key: "id", width: 16 },
    { header: "Asset Name", key: "name", width: 30 },
    { header: "Blocked Use Cases (MC)", key: "blocked", width: 50 },
    { header: "Reduced Use Cases (VA)", key: "reduced", width: 50 },
    { header: "Value at Risk (Low)", key: "low", width: 18 },
    { header: "Value at Risk (Mid)", key: "mid", width: 18 },
    { header: "Value at Risk (High)", key: "high", width: 18 },
    { header: "Top Impact Category", key: "cat", width: 22 },
  ];
  styleHeaderRow(sheet);
  var_.forEach((row) => {
    const topCat = Object.entries(row.byImpactCategory).sort(
      (a, b) => (b[1]?.mid ?? 0) - (a[1]?.mid ?? 0),
    )[0];
    sheet.addRow({
      id: row.assetId,
      name: row.assetName,
      blocked: row.blockedUseCases.join("\n"),
      reduced: row.reducedUseCases.join("\n"),
      low: row.totalLow,
      mid: row.totalMid,
      high: row.totalHigh,
      cat: topCat ? topCat[0] : "--",
    });
  });
  styleDataRows(sheet, 2, sheet.lastRow?.number ?? 1);
  for (let r = 2; r <= (sheet.lastRow?.number ?? 1); r++) {
    sheet.getCell(r, 5).numFmt = '"$"#,##0';
    sheet.getCell(r, 6).numFmt = '"$"#,##0';
    sheet.getCell(r, 7).numFmt = '"$"#,##0';
  }
}

function buildUseCaseMappingSheet(
  wb: ExcelJS.Workbook,
  valueAtRisk: AssetValueAtRisk[],
  coverage: AssetCoverage[],
): void {
  const sheet = wb.addWorksheet("Use Case Mapping", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "Use Case", key: "uc", width: 40 },
    { header: "Asset", key: "asset", width: 30 },
    { header: "Criticality", key: "crit", width: 14 },
    { header: "Source System(s)", key: "sources", width: 28 },
    { header: "Asset Status", key: "status", width: 14 },
  ];
  styleHeaderRow(sheet);
  const coverageById = new Map(coverage.map((c) => [c.assetId, c] as const));
  for (const v of valueAtRisk) {
    const cov = coverageById.get(v.assetId);
    const sources = (cov?.resolvedSourceSystems ?? [])
      .map((s) => renderSourceForCell(s))
      .join("\n");
    for (const uc of v.blockedUseCases) {
      sheet.addRow({
        uc,
        asset: `${v.assetId}: ${v.assetName}`,
        crit: "MC",
        sources: sources || "--",
        status: cov?.present ? "Present" : "Missing",
      });
    }
    for (const uc of v.reducedUseCases) {
      sheet.addRow({
        uc,
        asset: `${v.assetId}: ${v.assetName}`,
        crit: "VA",
        sources: sources || "--",
        status: cov?.present ? "Present" : "Missing",
      });
    }
  }
  styleDataRows(sheet, 2, sheet.lastRow?.number ?? 1);
}

function buildSummarySheet(wb: ExcelJS.Workbook, result: DataGapResult): void {
  const sheet = wb.addWorksheet("Summary");
  sheet.columns = [
    { header: "Metric", key: "metric", width: 36 },
    { header: "Value", key: "value", width: 32 },
  ];
  styleHeaderRow(sheet);
  const rows: Array<[string, string | number]> = [
    ["Industry", result.industryName],
    ["Generated At (UTC)", result.generatedAt],
    ["Total Reference Data Assets", result.summary.totalAssets],
    ["Assets Present in Workspace", result.summary.presentAssets],
    ["Assets Missing", result.summary.missingAssets],
    ["MC Requirements Satisfied", result.summary.mcCovered],
    ["MC Requirements Missing", result.summary.mcMissing],
    [
      "MC Coverage %",
      `${(result.summary.mcCoveragePct * 100).toFixed(1)}%`,
    ],
    ["VA Requirements Satisfied", result.summary.vaCovered],
    ["VA Requirements Missing", result.summary.vaMissing],
    ["Total Annual Value at Risk (Low)", result.summary.valueAtRiskLow],
    ["Total Annual Value at Risk (Mid)", result.summary.valueAtRiskMid],
    ["Total Annual Value at Risk (High)", result.summary.valueAtRiskHigh],
  ];
  rows.forEach(([metric, value]) => sheet.addRow({ metric, value }));
  styleDataRows(sheet, 2, sheet.lastRow?.number ?? 1);
  // Currency format on the three VA-R rows
  const lastRow = sheet.lastRow?.number ?? 1;
  for (let r = lastRow - 2; r <= lastRow; r++) sheet.getCell(r, 2).numFmt = '"$"#,##0';
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export async function buildDataGapWorkbook(result: DataGapResult): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Databricks Forge";
  wb.created = new Date();

  // Sheet order matches sales reading order: headline first.
  const plan = buildOnboardingPlan(result);
  buildOnboardingPlanSheet(wb, plan);
  buildCoverageSheet(wb, result.coverage);
  buildValueAtRiskSheet(wb, result.valueAtRisk);
  buildUseCaseMappingSheet(wb, result.valueAtRisk, result.coverage);
  buildSummarySheet(wb, result);

  // Return the raw ArrayBuffer from ExcelJS. Callers (Next route + tests)
  // wrap it as `new Uint8Array(buffer)` — the same pattern used by the
  // legacy v1 `gap-report` route in this codebase. Avoids the Buffer-vs-
  // Buffer<ArrayBuffer> TypeScript collisions surfacing in node v22 typings.
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
