/**
 * Portfolio-level Excel export -- standalone Business Value workbook.
 *
 * Generates a Databricks-branded .xlsx with 8 sheets:
 *   1. Executive Summary
 *   2. Key Findings
 *   3. Strategic Recommendations
 *   4. Risk Callouts
 *   5. Domain Performance
 *   6. Delivery Pipeline
 *   7. Use Cases
 *   8. Stakeholders
 */

import ExcelJS from "exceljs";
import type { BusinessValuePortfolio, StakeholderProfile } from "@/lib/domain/types";
import type { PortfolioUseCase } from "@/lib/lakebase/portfolio";
import { EXCEL } from "./brand";
import { styleHeaderRow, styleDataRows, styleScoreCell } from "./excel-helpers";
import { calculateRoi } from "@/lib/domain/cost-modeling";
import type { EffortEstimate } from "@/lib/domain/types";

function fmtCurrency(v: number): string {
  return v >= 1_000_000
    ? `$${(v / 1_000_000).toFixed(1)}M`
    : v >= 1_000
      ? `$${Math.round(v / 1_000)}K`
      : `$${v}`;
}

export async function generatePortfolioExcel(
  portfolio: BusinessValuePortfolio,
  useCases: PortfolioUseCase[],
  stakeholders: StakeholderProfile[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Databricks Forge";
  wb.created = new Date();

  const syn = portfolio.latestSynthesis;

  // =====================================================================
  // 1. Executive Summary
  // =====================================================================
  const sumSheet = wb.addWorksheet("Executive Summary");
  sumSheet.columns = [
    { header: "Metric", key: "metric", width: 32 },
    { header: "Value", key: "value", width: 55 },
  ];

  const sumRows: Array<{ metric: string; value: string }> = [
    {
      metric: "Total Estimated Value (Mid)",
      value: fmtCurrency(portfolio.totalEstimatedValue.mid),
    },
    {
      metric: "Value Range",
      value: `${fmtCurrency(portfolio.totalEstimatedValue.low)} – ${fmtCurrency(portfolio.totalEstimatedValue.high)}`,
    },
    { metric: "Total Use Cases", value: String(portfolio.totalUseCases) },
    { metric: "Quick Wins", value: String(portfolio.byPhase.quick_wins.count) },
    { metric: "Delivered Value", value: fmtCurrency(portfolio.deliveredValue) },
    {
      metric: "Domains",
      value: String(portfolio.byDomain.length),
    },
    { metric: "", value: "" },
    {
      metric: "Top Domain",
      value: syn?.topDomain ?? portfolio.byDomain[0]?.domain ?? "—",
    },
    {
      metric: "Discovery → Delivered Conversion",
      value: `${portfolio.byStage.delivered} of ${portfolio.totalUseCases} (${portfolio.totalUseCases > 0 ? Math.round((portfolio.byStage.delivered / portfolio.totalUseCases) * 100) : 0}%)`,
    },
    { metric: "", value: "" },
    { metric: "Generated", value: new Date().toISOString() },
    { metric: "Report By", value: "Databricks Forge" },
  ];

  sumRows.forEach((r) => sumSheet.addRow(r));
  styleHeaderRow(sumSheet);
  for (let r = 2; r <= sumSheet.rowCount; r++) {
    const mc = sumSheet.getRow(r).getCell(1);
    if (mc.value) mc.font = { bold: true, color: { argb: EXCEL.DATABRICKS_BLUE }, size: 11 };
    sumSheet.getRow(r).getCell(2).font = { color: { argb: EXCEL.TEXT_DARK }, size: 11 };
    sumSheet.getRow(r).getCell(2).alignment = { wrapText: true, vertical: "top" };
  }

  // =====================================================================
  // 2. Key Findings
  // =====================================================================
  if (syn && syn.keyFindings.length > 0) {
    const kfSheet = wb.addWorksheet("Key Findings");
    kfSheet.columns = [
      { header: "Title", key: "title", width: 35 },
      { header: "Description", key: "description", width: 65 },
      { header: "Domain", key: "domain", width: 20 },
      { header: "Severity", key: "severity", width: 14 },
    ];
    for (const f of syn.keyFindings) {
      kfSheet.addRow({
        title: f.title,
        description: f.description,
        domain: f.domain ?? "",
        severity: f.severity,
      });
    }
    styleHeaderRow(kfSheet);
    styleDataRows(kfSheet, 2, kfSheet.rowCount);
  }

  // =====================================================================
  // 3. Strategic Recommendations
  // =====================================================================
  if (syn && syn.strategicRecommendations.length > 0) {
    const srSheet = wb.addWorksheet("Recommendations");
    srSheet.columns = [
      { header: "#", key: "no", width: 6 },
      { header: "Title", key: "title", width: 35 },
      { header: "Description", key: "description", width: 65 },
      { header: "Priority", key: "priority", width: 14 },
    ];
    syn.strategicRecommendations.forEach((r, i) => {
      srSheet.addRow({
        no: i + 1,
        title: r.title,
        description: r.description,
        priority: r.priority,
      });
    });
    styleHeaderRow(srSheet);
    styleDataRows(srSheet, 2, srSheet.rowCount);
  }

  // =====================================================================
  // 4. Risk Callouts
  // =====================================================================
  if (syn && syn.riskCallouts.length > 0) {
    const rcSheet = wb.addWorksheet("Risk Callouts");
    rcSheet.columns = [
      { header: "Title", key: "title", width: 35 },
      { header: "Description", key: "description", width: 65 },
      { header: "Impact", key: "impact", width: 14 },
    ];
    for (const r of syn.riskCallouts) {
      rcSheet.addRow({ title: r.title, description: r.description, impact: r.impact });
    }
    styleHeaderRow(rcSheet);
    styleDataRows(rcSheet, 2, rcSheet.rowCount);
  }

  // =====================================================================
  // 5. Domain Performance
  // =====================================================================
  const domSheet = wb.addWorksheet("Domain Performance");
  domSheet.columns = [
    { header: "Domain", key: "domain", width: 25 },
    { header: "Use Cases", key: "useCaseCount", width: 12 },
    { header: "Est. Value (Mid)", key: "valueMid", width: 18 },
    { header: "Avg Score", key: "avgScore", width: 12 },
    { header: "Avg Feasibility", key: "avgFeasibility", width: 16 },
  ];
  for (const d of portfolio.byDomain) {
    domSheet.addRow({
      domain: d.domain,
      useCaseCount: d.useCaseCount,
      valueMid: d.valueMid,
      avgScore: d.avgScore,
      avgFeasibility: d.avgFeasibility,
    });
  }
  styleHeaderRow(domSheet);
  styleDataRows(domSheet, 2, domSheet.rowCount);
  for (let r = 2; r <= domSheet.rowCount; r++) {
    const row = domSheet.getRow(r);
    row.getCell(1).font = { bold: true, color: { argb: EXCEL.DATABRICKS_BLUE }, size: 10 };
    row.getCell(3).numFmt = "#,##0";
    const avg = row.getCell(4);
    if (typeof avg.value === "number") styleScoreCell(avg, avg.value as number);
    const feas = row.getCell(5);
    if (typeof feas.value === "number") styleScoreCell(feas, feas.value as number);
  }
  domSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 5 } };

  // =====================================================================
  // 6. Delivery Pipeline
  // =====================================================================
  const dpSheet = wb.addWorksheet("Delivery Pipeline");
  dpSheet.columns = [
    { header: "Phase", key: "phase", width: 20 },
    { header: "Use Cases", key: "count", width: 12 },
    { header: "Est. Value (Mid)", key: "valueMid", width: 18 },
  ];
  const phases: Array<{ key: string; label: string }> = [
    { key: "quick_wins", label: "Quick Wins" },
    { key: "foundation", label: "Foundation" },
    { key: "transformation", label: "Transformation" },
  ];
  for (const p of phases) {
    const data = portfolio.byPhase[p.key as keyof typeof portfolio.byPhase];
    dpSheet.addRow({ phase: p.label, count: data.count, valueMid: data.valueMid });
  }
  styleHeaderRow(dpSheet);
  styleDataRows(dpSheet, 2, dpSheet.rowCount);
  for (let r = 2; r <= dpSheet.rowCount; r++) {
    dpSheet.getRow(r).getCell(3).numFmt = "#,##0";
  }

  // =====================================================================
  // 7. Use Cases (with cost modeling and ROI)
  // =====================================================================
  const ucSheet = wb.addWorksheet("Use Cases");
  ucSheet.columns = [
    { header: "Name", key: "name", width: 38 },
    { header: "Domain", key: "domain", width: 18 },
    { header: "Type", key: "type", width: 12 },
    { header: "Overall Score", key: "overallScore", width: 14 },
    { header: "Feasibility", key: "feasibilityScore", width: 13 },
    { header: "Business Value", key: "businessValue", width: 40 },
    { header: "Est. Value ($)", key: "valueMid", width: 16 },
    { header: "Phase", key: "phase", width: 16 },
    { header: "Effort", key: "effort", width: 10 },
    { header: "Impl. Cost ($)", key: "implCost", width: 16 },
    { header: "Net ROI ($)", key: "netRoi", width: 16 },
    { header: "ROI %", key: "roiPercent", width: 10 },
    { header: "Payback (mo)", key: "payback", width: 13 },
  ];

  for (const uc of useCases) {
    const effort = uc.effortEstimate as EffortEstimate | null;
    const roi = effort ? calculateRoi(uc.valueMid, effort) : null;
    ucSheet.addRow({
      name: uc.name,
      domain: uc.domain,
      type: uc.type,
      overallScore: uc.overallScore,
      feasibilityScore: uc.feasibilityScore,
      businessValue: uc.businessValue,
      valueMid: uc.valueMid,
      phase: uc.phase?.replace(/_/g, " ") ?? "",
      effort: effort?.toUpperCase() ?? "",
      implCost: roi?.costMid ?? "",
      netRoi: roi?.netRoi ?? "",
      roiPercent: roi ? `${Math.round(roi.roiPercent)}%` : "",
      payback: roi?.paybackMonths != null ? `${roi.paybackMonths}` : "",
    });
  }
  styleHeaderRow(ucSheet);
  styleDataRows(ucSheet, 2, ucSheet.rowCount);
  for (let r = 2; r <= ucSheet.rowCount; r++) {
    const row = ucSheet.getRow(r);
    const sc = row.getCell(4);
    if (typeof sc.value === "number") styleScoreCell(sc, sc.value as number);
    const fs = row.getCell(5);
    if (typeof fs.value === "number") styleScoreCell(fs, fs.value as number);
    for (const c of [7, 10, 11]) {
      const cell = row.getCell(c);
      if (typeof cell.value === "number") cell.numFmt = "#,##0";
    }
  }
  ucSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 13 } };
  ucSheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1, activeCell: "B2" }];

  // =====================================================================
  // 8. Stakeholders
  // =====================================================================
  if (stakeholders.length > 0) {
    const stSheet = wb.addWorksheet("Stakeholders");
    stSheet.columns = [
      { header: "Role", key: "role", width: 28 },
      { header: "Department", key: "department", width: 20 },
      { header: "Use Cases", key: "useCaseCount", width: 12 },
      { header: "Total Value ($)", key: "totalValue", width: 16 },
      { header: "Domains", key: "domains", width: 30 },
      { header: "Change Complexity", key: "changeComplexity", width: 18 },
      { header: "Champion", key: "isChampion", width: 12 },
      { header: "Sponsor", key: "isSponsor", width: 12 },
    ];
    for (const s of stakeholders) {
      stSheet.addRow({
        role: s.role,
        department: s.department,
        useCaseCount: s.useCaseCount,
        totalValue: s.totalValue,
        domains: s.domains.join(", "),
        changeComplexity: s.changeComplexity ?? "",
        isChampion: s.isChampion ? "Yes" : "",
        isSponsor: s.isSponsor ? "Yes" : "",
      });
    }
    styleHeaderRow(stSheet);
    styleDataRows(stSheet, 2, stSheet.rowCount);
    for (let r = 2; r <= stSheet.rowCount; r++) {
      stSheet.getRow(r).getCell(4).numFmt = "#,##0";
    }
    stSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 8 } };
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
