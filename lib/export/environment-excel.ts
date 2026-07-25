/**
 * Environment Report Excel Export.
 *
 * Generates a Databricks-branded 13-sheet .xlsx workbook with full
 * environment scan results including domains, PII, lineage, health,
 * governance, data products, and Databricks feature adoption analysis.
 */

import ExcelJS from "exceljs";
import { computeFeatureAdoption } from "@/lib/domain/feature-adoption";
import { computeDataMaturity } from "@/lib/domain/data-maturity";
import type { EstateSynthesisResult, Evidence } from "@/lib/domain/estate-synthesis-types";
import { fromStoredLineageEntityType } from "@/lib/domain/lineage-entity-type";

// ---------------------------------------------------------------------------
// Brand constants (ARGB format for ExcelJS)
// ---------------------------------------------------------------------------

const DATABRICKS_BLUE = "FF003366";
const WHITE = "FFFFFFFF";
const LIGHT_GRAY_BG = "FFF9FAFB";
const BORDER_COLOR = "FFD1D5DB";

const GREEN_FILL = "FFE8F5E9";
const GREEN_FONT = "FF2E7D32";
const AMBER_FILL = "FFFFF3E0";
const AMBER_FONT = "FFE65100";
const RED_FILL = "FFFFEBEE";
const RED_FONT = "FFC62828";

// ---------------------------------------------------------------------------
// Styling helpers
// ---------------------------------------------------------------------------

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
      cell.alignment = { ...cell.alignment, vertical: "top", wrapText: true };
      if (r % 2 === 0) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_GRAY_BG } };
      }
    });
  }
}

function scoreColor(score: number): { fill: string; font: string } {
  if (score >= 70) return { fill: GREEN_FILL, font: GREEN_FONT };
  if (score >= 40) return { fill: AMBER_FILL, font: AMBER_FONT };
  return { fill: RED_FILL, font: RED_FONT };
}

function applyScoreCell(cell: ExcelJS.Cell, score: number): void {
  const { fill, font } = scoreColor(score);
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  cell.font = { bold: true, color: { argb: font } };
}

function humanSize(bytes: number | bigint | null | undefined): string {
  if (bytes == null) return "—";
  const n = typeof bytes === "bigint" ? Number(bytes) : bytes;
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function humanNumber(n: number | bigint | null | undefined): string {
  if (n == null) return "—";
  const v = typeof n === "bigint" ? Number(n) : n;
  if (v === 0) return "0";
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
}

function safeJSON<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Scan data types (matching Prisma include output)
// ---------------------------------------------------------------------------

export interface ScanWithRelations {
  scanId: string;
  ucPath: string;
  tableCount: number;
  totalSizeBytes: bigint;
  totalFiles: number;
  tablesWithStreaming: number;
  tablesWithCDF: number;
  tablesNeedingOptimize: number;
  tablesNeedingVacuum: number;
  lineageDiscoveredCount: number;
  domainCount: number;
  piiTablesCount: number;
  redundancyPairsCount: number;
  dataProductCount: number;
  avgGovernanceScore: number;
  genieSpaceCount?: number;
  dashboardCount?: number;
  metricViewCount?: number;
  analyticsCoveragePercent?: number;
  scanDurationMs: number | null;
  passResultsJson: string | null;
  createdAt: Date;
  details: Array<{
    tableFqn: string;
    catalog: string;
    schema: string;
    tableName: string;
    tableType: string | null;
    comment: string | null;
    generatedDescription: string | null;
    format: string | null;
    provider: string | null;
    location: string | null;
    isManaged: boolean;
    owner: string | null;
    sizeInBytes: bigint | null;
    numFiles: number | null;
    numRows: bigint | null;
    partitionColumns: string | null;
    clusteringColumns: string | null;
    dataDomain: string | null;
    dataSubdomain: string | null;
    dataTier: string | null;
    sensitivityLevel: string | null;
    governancePriority: string | null;
    governanceScore: number | null;
    tableCreatedAt: string | null;
    lastModified: string | null;
    discoveredVia: string;
    propertiesJson: string | null;
    tagsJson: string | null;
    columnTagsJson: string | null;
    columnsJson: string | null;
  }>;
  histories: Array<{
    tableFqn: string;
    lastWriteRows: bigint | null;
    lastWriteBytes: bigint | null;
    totalWriteOps: number;
    totalStreamingOps: number;
    totalOptimizeOps: number;
    totalVacuumOps: number;
    totalMergeOps: number;
    lastWriteTimestamp: string | null;
    lastOptimizeTimestamp: string | null;
    lastVacuumTimestamp: string | null;
    hasStreamingWrites: boolean;
    historyDays: number;
    healthScore: number | null;
    issuesJson: string | null;
    recommendationsJson: string | null;
    topOperationsJson: string | null;
  }>;
  lineage: Array<{
    sourceTableFqn: string;
    targetTableFqn: string;
    sourceType: string | null;
    targetType: string | null;
    entityType: string | null;
    lastEventTime: string | null;
    eventCount: number;
  }>;
  insights: Array<{
    insightType: string;
    tableFqn: string | null;
    payloadJson: string;
    severity: string;
  }>;
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/**
 * Generate the Environment Report Excel. When a consultant-grade `synthesis`
 * is supplied an "Executive Diagnosis" sheet (exec brief + readiness sub-scores
 * + evidence-backed findings + value-at-risk) is prepended as the board-pack
 * cover sheet.
 */
export async function generateEnvironmentExcel(
  scan: ScanWithRelations,
  synthesis?: EstateSynthesisResult | null,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Databricks Forge";
  wb.created = new Date();

  if (synthesis) addExecutiveDiagnosis(wb, synthesis);
  addExecutiveSummary(wb, scan);
  addTableInventory(wb, scan);
  addDataDomains(wb, scan);
  addDataProducts(wb, scan);
  addSensitivityPII(wb, scan);
  addImplicitRelationships(wb, scan);
  addRedundancyReport(wb, scan);
  addGovernanceScorecard(wb, scan);
  addTableHealth(wb, scan);
  addLineage(wb, scan);
  addHistoryInsights(wb, scan);
  addTagsProperties(wb, scan);
  addFeatureAdoption(wb, scan);
  addAnalyticsCoverage(wb, scan);

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// ---------------------------------------------------------------------------
// Sheet 0: Executive Diagnosis (consultant-grade synthesis cover sheet)
// ---------------------------------------------------------------------------

function evidenceToText(ev: Evidence): string {
  if (ev.tier === "sourced") {
    const q = ev.quote ? `"${ev.quote}"` : "";
    const src = ev.sourceTitle || ev.sourceUrl || "";
    return [q, src].filter(Boolean).join(" — ");
  }
  if (ev.tier === "benchmark") {
    return [ev.benchmarkLabel, ev.benchmarkRange].filter(Boolean).join(": ");
  }
  return ev.rationale ?? "";
}

function addExecutiveDiagnosis(wb: ExcelJS.Workbook, synthesis: EstateSynthesisResult): void {
  const sheet = wb.addWorksheet("Executive Diagnosis");
  sheet.columns = [
    { header: "Section", key: "section", width: 28 },
    { header: "Detail", key: "detail", width: 90 },
  ];

  const { brief, scores, valueAtRisk, findings } = synthesis;
  const rows: Array<{ section: string; value: string; bold?: boolean }> = [];

  rows.push({
    section: "READINESS SCORE",
    value: `${scores.overall}/100 — ${scores.band.toUpperCase()}`,
    bold: true,
  });
  rows.push({ section: "  Governance", value: `${scores.governance}/100` });
  rows.push({ section: "  Quality", value: `${scores.quality}/100` });
  rows.push({ section: "  Freshness", value: `${scores.freshness}/100` });
  rows.push({ section: "  Documentation", value: `${scores.documentation}/100` });
  rows.push({ section: "  Analytics Maturity", value: `${scores.analyticsMaturity}/100` });
  rows.push({ section: "  Cost Efficiency", value: `${scores.cost}/100` });

  if (valueAtRisk) {
    const fmt = (n: number) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: valueAtRisk.currency || "USD",
        maximumFractionDigits: 0,
      }).format(n);
    rows.push({ section: "", value: "" });
    rows.push({
      section: "VALUE AT RISK",
      value: `${fmt(valueAtRisk.low)} – ${fmt(valueAtRisk.mid)} – ${fmt(valueAtRisk.high)} (low/mid/high)`,
      bold: true,
    });
  }

  rows.push({ section: "", value: "" });
  rows.push({ section: "EXECUTIVE BRIEF", value: "", bold: true });
  rows.push({ section: "Estate Shape", value: brief.estateShape });
  rows.push({ section: "Strengths", value: brief.strengths });
  rows.push({ section: "Critical Risks", value: brief.criticalRisks });
  rows.push({ section: "Quick Wins", value: brief.quickWins });
  rows.push({ section: "Strategic Recommendations", value: brief.strategicRecommendations });
  rows.push({ section: "Situation", value: brief.situationComplicationResolution.situation });
  rows.push({ section: "Complication", value: brief.situationComplicationResolution.complication });
  rows.push({ section: "Resolution", value: brief.situationComplicationResolution.resolution });

  rows.push({ section: "", value: "" });
  rows.push({ section: "KEY FINDINGS", value: "", bold: true });
  for (const f of findings) {
    rows.push({
      section: `[${f.severity.toUpperCase()}] ${f.title}`,
      value: f.summary,
      bold: true,
    });
    if (f.evidence.length > 0) {
      const ev = f.evidence
        .map((e) => `• (${e.tier}) ${evidenceToText(e)}`)
        .filter((t) => t.trim().length > 3)
        .join("\n");
      if (ev) rows.push({ section: "  Evidence", value: ev });
    }
    if (f.action?.label) {
      rows.push({ section: "  Recommended Action", value: f.action.label });
    }
  }

  for (const r of rows) {
    const row = sheet.addRow({ section: r.section, detail: r.value });
    if (r.bold) {
      row.eachCell((cell) => {
        cell.font = { bold: true, size: 11 };
      });
    }
  }
  styleHeaderRow(sheet);
  styleDataRows(sheet, 2, rows.length + 1);
}

// ---------------------------------------------------------------------------
// Sheet 1: Executive Summary
// ---------------------------------------------------------------------------

function addExecutiveSummary(wb: ExcelJS.Workbook, scan: ScanWithRelations): void {
  const sheet = wb.addWorksheet("Executive Summary");
  sheet.columns = [
    { header: "Metric", key: "metric", width: 40 },
    { header: "Value", key: "value", width: 30 },
  ];

  // Compute Data Maturity Score
  const adoption = computeFeatureAdoption(scan.details, scan.histories);
  const maturity = computeDataMaturity({
    tableCount: scan.tableCount,
    avgGovernanceScore: scan.avgGovernanceScore,
    piiTablesCount: scan.piiTablesCount,
    tablesWithDescription: scan.details.filter((d) => d.comment || d.generatedDescription).length,
    tablesWithTags: scan.details.filter((d) => {
      try {
        return JSON.parse(d.tagsJson ?? "[]").length > 0;
      } catch {
        return false;
      }
    }).length,
    tablesWithOwner: scan.details.filter((d) => d.owner).length,
    tablesWithTier: scan.details.filter((d) => d.dataTier).length,
    tierCount: new Set(scan.details.map((d) => d.dataTier).filter(Boolean)).size,
    redundancyPairsCount: scan.redundancyPairsCount,
    dataProductCount: scan.dataProductCount,
    lineageEdgeCount: scan.lineage.length,
    lineageDiscoveredCount: scan.lineageDiscoveredCount,
    domainCount: scan.domainCount,
    tablesNeedingOptimize: scan.tablesNeedingOptimize,
    tablesNeedingVacuum: scan.tablesNeedingVacuum,
    tablesWithStreaming: scan.tablesWithStreaming,
    tablesWithCDF: scan.tablesWithCDF,
    avgHealthScore:
      scan.histories.reduce((s, h) => s + (h.healthScore ?? 0), 0) /
      Math.max(scan.histories.length, 1),
    tablesWithAutoOptimize: adoption.stats.autoOptimizeCount,
    tablesWithLiquidClustering: adoption.stats.liquidClusteringCount,
  });

  const rows: Array<{ metric: string; value: string | number }> = [
    { metric: "DATA MATURITY SCORE", value: `${maturity.overall}/100 — ${maturity.level}` },
    { metric: "  Governance Pillar", value: `${maturity.pillars.governance.score}/100` },
    { metric: "  Architecture Pillar", value: `${maturity.pillars.architecture.score}/100` },
    { metric: "  Operations Pillar", value: `${maturity.pillars.operations.score}/100` },
    {
      metric: "  Analytics Readiness Pillar",
      value: `${maturity.pillars.analyticsReadiness.score}/100`,
    },
    { metric: "FEATURE ADOPTION SCORE", value: `${adoption.adoptionScore}/100` },
    { metric: "", value: "" },
    { metric: "Scan ID", value: scan.scanId },
    { metric: "UC Scope", value: scan.ucPath },
    { metric: "Scanned At", value: scan.createdAt.toISOString() },
    {
      metric: "Scan Duration",
      value: scan.scanDurationMs ? `${(scan.scanDurationMs / 1000).toFixed(1)}s` : "—",
    },
    { metric: "Total Tables", value: scan.tableCount },
    { metric: "Tables via Lineage Discovery", value: scan.lineageDiscoveredCount },
    { metric: "Total Size", value: humanSize(scan.totalSizeBytes) },
    {
      metric: "Total Rows",
      value: humanNumber(scan.details.reduce((sum, d) => sum + Number(d.numRows ?? 0), 0)),
    },
    { metric: "Total Files", value: scan.totalFiles },
    {
      metric: "Managed vs External",
      value: `${scan.details.filter((d) => d.isManaged).length} / ${scan.details.filter((d) => !d.isManaged).length}`,
    },
    { metric: "Tables with Streaming", value: scan.tablesWithStreaming },
    { metric: "Tables with CDF", value: scan.tablesWithCDF },
    { metric: "Tables Needing OPTIMIZE", value: scan.tablesNeedingOptimize },
    { metric: "Tables Needing VACUUM", value: scan.tablesNeedingVacuum },
    { metric: "Business Domains Found", value: scan.domainCount },
    { metric: "Tables with PII", value: scan.piiTablesCount },
    { metric: "Redundancy Pairs", value: scan.redundancyPairsCount },
    { metric: "Data Products", value: scan.dataProductCount },
    { metric: "Avg Governance Score", value: scan.avgGovernanceScore.toFixed(1) },
    ...((scan.genieSpaceCount ?? 0) + (scan.dashboardCount ?? 0) + (scan.metricViewCount ?? 0) > 0
      ? [
          { metric: "", value: "" as string | number },
          { metric: "ANALYTICS COVERAGE", value: "" as string | number },
          { metric: "Existing Genie Spaces", value: scan.genieSpaceCount ?? 0 },
          { metric: "Existing Dashboards", value: scan.dashboardCount ?? 0 },
          { metric: "Existing Metric Views", value: scan.metricViewCount ?? 0 },
          {
            metric: "Table Coverage",
            value: `${(scan.analyticsCoveragePercent ?? 0).toFixed(0)}%`,
          },
        ]
      : []),
  ];

  for (const r of rows) {
    const row = sheet.addRow(r);
    // Bold the headline maturity/adoption rows
    if (
      (typeof r.metric === "string" && r.metric.startsWith("DATA MATURITY")) ||
      r.metric.startsWith("FEATURE ADOPTION")
    ) {
      row.eachCell((cell) => {
        cell.font = { bold: true, size: 12 };
      });
    }
  }
  styleHeaderRow(sheet);
  styleDataRows(sheet, 2, rows.length + 1);
}

// ---------------------------------------------------------------------------
// Sheet 2: Table Inventory
// ---------------------------------------------------------------------------

function addTableInventory(wb: ExcelJS.Workbook, scan: ScanWithRelations): void {
  const sheet = wb.addWorksheet("Table Inventory");
  sheet.columns = [
    { header: "FQN", key: "fqn", width: 50 },
    { header: "Domain", key: "domain", width: 18 },
    { header: "Subdomain", key: "subdomain", width: 18 },
    { header: "Tier", key: "tier", width: 10 },
    { header: "Type", key: "type", width: 12 },
    { header: "Format", key: "format", width: 10 },
    { header: "Owner", key: "owner", width: 20 },
    { header: "Size", key: "size", width: 12 },
    { header: "Rows", key: "rows", width: 12 },
    { header: "Files", key: "files", width: 8 },
    { header: "Managed", key: "managed", width: 10 },
    { header: "Description", key: "description", width: 50 },
    { header: "Created", key: "created", width: 20 },
    { header: "Last Modified", key: "modified", width: 20 },
    { header: "Discovered Via", key: "via", width: 14 },
  ];

  for (const d of scan.details) {
    sheet.addRow({
      fqn: d.tableFqn,
      domain: d.dataDomain ?? "—",
      subdomain: d.dataSubdomain ?? "—",
      tier: d.dataTier ?? "—",
      type: d.tableType ?? "—",
      format: d.format ?? "—",
      owner: d.owner ?? "—",
      size: humanSize(d.sizeInBytes),
      rows: humanNumber(d.numRows),
      files: d.numFiles ?? "—",
      managed: d.isManaged ? "Managed" : "External",
      description: d.comment ?? d.generatedDescription ?? "—",
      created: d.tableCreatedAt ?? "—",
      modified: d.lastModified ?? "—",
      via: d.discoveredVia,
    });
  }

  styleHeaderRow(sheet);
  styleDataRows(sheet, 2, scan.details.length + 1);
}

// ---------------------------------------------------------------------------
// Sheet 3: Data Domains
// ---------------------------------------------------------------------------

function addDataDomains(wb: ExcelJS.Workbook, scan: ScanWithRelations): void {
  const sheet = wb.addWorksheet("Data Domains");
  sheet.columns = [
    { header: "Domain", key: "domain", width: 25 },
    { header: "Subdomain", key: "subdomain", width: 25 },
    { header: "Table Count", key: "count", width: 14 },
    { header: "Total Size", key: "size", width: 14 },
    { header: "Tables", key: "tables", width: 80 },
  ];

  const domainMap = new Map<string, { subdomain: string; tables: typeof scan.details }>();
  for (const d of scan.details) {
    const key = `${d.dataDomain ?? "Unassigned"}::${d.dataSubdomain ?? "General"}`;
    const existing = domainMap.get(key);
    if (existing) {
      existing.tables.push(d);
    } else {
      domainMap.set(key, { subdomain: d.dataSubdomain ?? "General", tables: [d] });
    }
  }

  let rowNum = 1;
  for (const [key, data] of domainMap) {
    const domain = key.split("::")[0];
    const totalSize = data.tables.reduce((s, t) => s + Number(t.sizeInBytes ?? 0), 0);
    sheet.addRow({
      domain,
      subdomain: data.subdomain,
      count: data.tables.length,
      size: humanSize(totalSize),
      tables: data.tables.map((t) => t.tableFqn).join(", "),
    });
    rowNum++;
  }

  styleHeaderRow(sheet);
  styleDataRows(sheet, 2, rowNum);
}

// ---------------------------------------------------------------------------
// Sheet 4: Data Products
// ---------------------------------------------------------------------------

function addDataProducts(wb: ExcelJS.Workbook, scan: ScanWithRelations): void {
  const sheet = wb.addWorksheet("Data Products");
  sheet.columns = [
    { header: "Product Name", key: "name", width: 30 },
    { header: "Description", key: "description", width: 50 },
    { header: "Domain", key: "domain", width: 18 },
    { header: "Maturity", key: "maturity", width: 14 },
    { header: "Owner", key: "owner", width: 20 },
    { header: "Tables", key: "tables", width: 80 },
  ];

  const products = scan.insights
    .filter((i) => i.insightType === "data_product")
    .map((i) =>
      safeJSON<{
        productName: string;
        description: string;
        tables: string[];
        primaryDomain: string;
        maturityLevel: string;
        ownerHint: string;
      }>(i.payloadJson, {
        productName: "",
        description: "",
        tables: [],
        primaryDomain: "",
        maturityLevel: "",
        ownerHint: "",
      }),
    );

  for (const p of products) {
    sheet.addRow({
      name: p.productName,
      description: p.description,
      domain: p.primaryDomain,
      maturity: p.maturityLevel,
      owner: p.ownerHint || "—",
      tables: p.tables.join(", "),
    });
  }

  styleHeaderRow(sheet);
  styleDataRows(sheet, 2, products.length + 1);
}

// ---------------------------------------------------------------------------
// Sheet 5: Sensitivity / PII
// ---------------------------------------------------------------------------

function addSensitivityPII(wb: ExcelJS.Workbook, scan: ScanWithRelations): void {
  const sheet = wb.addWorksheet("Sensitivity PII");
  sheet.columns = [
    { header: "Table FQN", key: "fqn", width: 50 },
    { header: "Column", key: "column", width: 25 },
    { header: "Classification", key: "classification", width: 18 },
    { header: "Confidence", key: "confidence", width: 12 },
    { header: "Reason", key: "reason", width: 50 },
    { header: "Regulation", key: "regulation", width: 14 },
  ];

  const piiInsights = scan.insights
    .filter((i) => i.insightType === "pii_detection")
    .map((i) =>
      safeJSON<{
        tableFqn: string;
        columnName: string;
        classification: string;
        confidence: string;
        reason: string;
        regulation: string;
      }>(i.payloadJson, {
        tableFqn: "",
        columnName: "",
        classification: "",
        confidence: "",
        reason: "",
        regulation: "",
      }),
    );

  for (const p of piiInsights) {
    sheet.addRow({
      fqn: p.tableFqn,
      column: p.columnName,
      classification: p.classification,
      confidence: p.confidence,
      reason: p.reason,
      regulation: p.regulation || "—",
    });
  }

  styleHeaderRow(sheet);
  styleDataRows(sheet, 2, piiInsights.length + 1);
}

// ---------------------------------------------------------------------------
// Sheet 6: Implicit Relationships
// ---------------------------------------------------------------------------

function addImplicitRelationships(wb: ExcelJS.Workbook, scan: ScanWithRelations): void {
  const sheet = wb.addWorksheet("Implicit Relationships");
  sheet.columns = [
    { header: "Source Table", key: "source", width: 45 },
    { header: "Source Column", key: "sourceCol", width: 20 },
    { header: "Target Table", key: "target", width: 45 },
    { header: "Target Column", key: "targetCol", width: 20 },
    { header: "Confidence", key: "confidence", width: 12 },
    { header: "Reasoning", key: "reasoning", width: 50 },
  ];

  const rels = scan.insights
    .filter((i) => i.insightType === "implicit_relationship")
    .map((i) =>
      safeJSON<{
        sourceTableFqn: string;
        sourceColumn: string;
        targetTableFqn: string;
        targetColumn: string;
        confidence: string;
        reasoning: string;
      }>(i.payloadJson, {
        sourceTableFqn: "",
        sourceColumn: "",
        targetTableFqn: "",
        targetColumn: "",
        confidence: "",
        reasoning: "",
      }),
    );

  for (const r of rels) {
    sheet.addRow({
      source: r.sourceTableFqn,
      sourceCol: r.sourceColumn,
      target: r.targetTableFqn,
      targetCol: r.targetColumn,
      confidence: r.confidence,
      reasoning: r.reasoning,
    });
  }

  styleHeaderRow(sheet);
  styleDataRows(sheet, 2, rels.length + 1);
}

// ---------------------------------------------------------------------------
// Sheet 7: Redundancy Report
// ---------------------------------------------------------------------------

function addRedundancyReport(wb: ExcelJS.Workbook, scan: ScanWithRelations): void {
  const sheet = wb.addWorksheet("Redundancy Report");
  sheet.columns = [
    { header: "Table A", key: "tableA", width: 45 },
    { header: "Table B", key: "tableB", width: 45 },
    { header: "Similarity %", key: "similarity", width: 14 },
    { header: "Shared Columns", key: "shared", width: 40 },
    { header: "Reason", key: "reason", width: 40 },
    { header: "Recommendation", key: "rec", width: 18 },
  ];

  const pairs = scan.insights
    .filter((i) => i.insightType === "redundancy")
    .map((i) =>
      safeJSON<{
        tableA: string;
        tableB: string;
        similarityPercent: number;
        sharedColumns: string[];
        reason: string;
        recommendation: string;
      }>(i.payloadJson, {
        tableA: "",
        tableB: "",
        similarityPercent: 0,
        sharedColumns: [],
        reason: "",
        recommendation: "",
      }),
    );

  pairs.sort((a, b) => b.similarityPercent - a.similarityPercent);

  for (const p of pairs) {
    sheet.addRow({
      tableA: p.tableA,
      tableB: p.tableB,
      similarity: p.similarityPercent,
      shared: p.sharedColumns.join(", "),
      reason: p.reason,
      rec: p.recommendation,
    });
  }

  styleHeaderRow(sheet);
  styleDataRows(sheet, 2, pairs.length + 1);
}

// ---------------------------------------------------------------------------
// Sheet 8: Governance Scorecard
// ---------------------------------------------------------------------------

function addGovernanceScorecard(wb: ExcelJS.Workbook, scan: ScanWithRelations): void {
  const sheet = wb.addWorksheet("Governance Scorecard");
  sheet.columns = [
    { header: "Table FQN", key: "fqn", width: 50 },
    { header: "Score", key: "score", width: 10 },
    { header: "Gap Categories", key: "categories", width: 30 },
    { header: "Top Gaps", key: "gaps", width: 60 },
    { header: "Recommendations", key: "recs", width: 60 },
  ];

  const gaps = scan.insights
    .filter((i) => i.insightType === "governance_gap")
    .map((i) =>
      safeJSON<{
        tableFqn: string;
        overallScore: number;
        gaps: Array<{ category: string; severity: string; detail: string; recommendation: string }>;
      }>(i.payloadJson, { tableFqn: "", overallScore: 0, gaps: [] }),
    );

  gaps.sort((a, b) => a.overallScore - b.overallScore);

  let rowNum = 1;
  for (const g of gaps) {
    const row = sheet.addRow({
      fqn: g.tableFqn,
      score: g.overallScore,
      categories: g.gaps.map((gap) => gap.category).join(", "),
      gaps: g.gaps
        .slice(0, 3)
        .map((gap) => `[${gap.severity}] ${gap.detail}`)
        .join(" | "),
      recs: g.gaps
        .slice(0, 3)
        .map((gap) => gap.recommendation)
        .join(" | "),
    });
    rowNum++;
    const scoreCell = row.getCell("score");
    applyScoreCell(scoreCell, g.overallScore);
  }

  styleHeaderRow(sheet);
  styleDataRows(sheet, 2, rowNum);
}

// ---------------------------------------------------------------------------
// Sheet 9: Table Health
// ---------------------------------------------------------------------------

function addTableHealth(wb: ExcelJS.Workbook, scan: ScanWithRelations): void {
  const sheet = wb.addWorksheet("Table Health");
  sheet.columns = [
    { header: "FQN", key: "fqn", width: 50 },
    { header: "Domain", key: "domain", width: 18 },
    { header: "Health Score", key: "score", width: 14 },
    { header: "Issues", key: "issues", width: 50 },
    { header: "Recommendations", key: "recs", width: 50 },
    { header: "Last OPTIMIZE", key: "optimize", width: 20 },
    { header: "Last VACUUM", key: "vacuum", width: 20 },
    { header: "Streaming", key: "streaming", width: 12 },
    { header: "CDF", key: "cdf", width: 8 },
  ];

  const detailMap = new Map(scan.details.map((d) => [d.tableFqn, d]));

  let rowNum = 1;
  for (const h of scan.histories) {
    const d = detailMap.get(h.tableFqn);
    const issues = safeJSON<string[]>(h.issuesJson, []);
    const recs = safeJSON<string[]>(h.recommendationsJson, []);

    const row = sheet.addRow({
      fqn: h.tableFqn,
      domain: d?.dataDomain ?? "—",
      score: h.healthScore ?? 100,
      issues: issues.join("; "),
      recs: recs.join("; "),
      optimize: h.lastOptimizeTimestamp ?? "Never",
      vacuum: h.lastVacuumTimestamp ?? "Never",
      streaming: h.hasStreamingWrites ? "Yes" : "No",
      cdf: d?.propertiesJson?.includes("enableChangeDataFeed") ? "Yes" : "No",
    });
    rowNum++;

    if (h.healthScore != null) {
      applyScoreCell(row.getCell("score"), h.healthScore);
    }
  }

  styleHeaderRow(sheet);
  styleDataRows(sheet, 2, rowNum);
}

// ---------------------------------------------------------------------------
// Sheet 10: Lineage
// ---------------------------------------------------------------------------

function addLineage(wb: ExcelJS.Workbook, scan: ScanWithRelations): void {
  const sheet = wb.addWorksheet("Lineage");
  sheet.columns = [
    { header: "Source FQN", key: "source", width: 50 },
    { header: "Target FQN", key: "target", width: 50 },
    { header: "Source Type", key: "sourceType", width: 18 },
    { header: "Target Type", key: "targetType", width: 18 },
    { header: "Entity Type", key: "entityType", width: 18 },
    { header: "Last Event", key: "lastEvent", width: 20 },
    { header: "Event Count", key: "count", width: 12 },
  ];

  for (const e of scan.lineage) {
    sheet.addRow({
      source: e.sourceTableFqn,
      target: e.targetTableFqn,
      sourceType: e.sourceType ?? "—",
      targetType: e.targetType ?? "—",
      entityType: fromStoredLineageEntityType(e.entityType) ?? "—",
      lastEvent: e.lastEventTime ?? "—",
      count: e.eventCount,
    });
  }

  styleHeaderRow(sheet);
  styleDataRows(sheet, 2, scan.lineage.length + 1);
}

// ---------------------------------------------------------------------------
// Sheet 11: History Insights
// ---------------------------------------------------------------------------

function addHistoryInsights(wb: ExcelJS.Workbook, scan: ScanWithRelations): void {
  const sheet = wb.addWorksheet("History Insights");
  sheet.columns = [
    { header: "FQN", key: "fqn", width: 50 },
    { header: "Total Writes", key: "writes", width: 12 },
    { header: "Streaming Ops", key: "streaming", width: 14 },
    { header: "OPTIMIZE", key: "optimize", width: 12 },
    { header: "VACUUM", key: "vacuum", width: 12 },
    { header: "MERGE", key: "merge", width: 10 },
    { header: "Last Write", key: "lastWrite", width: 20 },
    { header: "Last Write Rows", key: "lastWriteRows", width: 16 },
    { header: "Last Write Bytes", key: "lastWriteBytes", width: 16 },
    { header: "History Span", key: "span", width: 14 },
  ];

  for (const h of scan.histories) {
    sheet.addRow({
      fqn: h.tableFqn,
      writes: h.totalWriteOps,
      streaming: h.totalStreamingOps,
      optimize: h.totalOptimizeOps,
      vacuum: h.totalVacuumOps,
      merge: h.totalMergeOps,
      lastWrite: h.lastWriteTimestamp ?? "—",
      lastWriteRows: humanNumber(h.lastWriteRows),
      lastWriteBytes: humanSize(h.lastWriteBytes),
      span: `${h.historyDays} days`,
    });
  }

  styleHeaderRow(sheet);
  styleDataRows(sheet, 2, scan.histories.length + 1);
}

// ---------------------------------------------------------------------------
// Sheet 12: Tags and Properties
// ---------------------------------------------------------------------------

function addTagsProperties(wb: ExcelJS.Workbook, scan: ScanWithRelations): void {
  const sheet = wb.addWorksheet("Tags & Properties");
  sheet.columns = [
    { header: "Table FQN", key: "fqn", width: 50 },
    { header: "Source", key: "source", width: 12 },
    { header: "Name", key: "name", width: 30 },
    { header: "Value", key: "value", width: 50 },
  ];

  let rowNum = 1;
  for (const d of scan.details) {
    // Tags
    const tags = safeJSON<Array<{ tagName: string; tagValue: string }>>(d.tagsJson, []);
    for (const tag of tags) {
      sheet.addRow({ fqn: d.tableFqn, source: "Tag", name: tag.tagName, value: tag.tagValue });
      rowNum++;
    }

    // Properties
    const props = safeJSON<Record<string, string>>(d.propertiesJson, {});
    for (const [key, val] of Object.entries(props)) {
      sheet.addRow({ fqn: d.tableFqn, source: "Property", name: key, value: val });
      rowNum++;
    }
  }

  styleHeaderRow(sheet);
  styleDataRows(sheet, 2, rowNum);
}

// ---------------------------------------------------------------------------
// Sheet 13: Feature Adoption
// ---------------------------------------------------------------------------

function addFeatureAdoption(wb: ExcelJS.Workbook, scan: ScanWithRelations): void {
  const adoption = computeFeatureAdoption(scan.details, scan.histories);

  const sheet = wb.addWorksheet("Feature Adoption");
  sheet.columns = [
    { header: "Feature", key: "feature", width: 28 },
    { header: "Category", key: "category", width: 16 },
    { header: "Severity", key: "severity", width: 12 },
    { header: "Current State", key: "current", width: 60 },
    { header: "Recommendation", key: "recommendation", width: 70 },
    { header: "Tables Affected", key: "affected", width: 16 },
    { header: "Example Tables", key: "examples", width: 60 },
  ];

  // Add adoption score as first row
  const scoreRow = sheet.addRow({
    feature: "OVERALL ADOPTION SCORE",
    category: "",
    severity: "",
    current: `${adoption.adoptionScore}/100`,
    recommendation:
      adoption.adoptionScore >= 80
        ? "Strong feature adoption. Focus on remaining gaps."
        : adoption.adoptionScore >= 50
          ? "Moderate adoption. Several opportunities to improve performance and governance."
          : "Low adoption. Significant opportunities to leverage Databricks platform features.",
    affected: "",
    examples: "",
  });
  scoreRow.eachCell((cell) => {
    cell.font = { bold: true, size: 12 };
  });

  // Add findings
  for (const f of adoption.findings) {
    const row = sheet.addRow({
      feature: f.feature,
      category: f.category,
      severity: f.severity,
      current: f.current,
      recommendation: f.recommendation,
      affected: f.tablesAffected,
      examples: f.tables.join(", "),
    });

    const sevCell = row.getCell("severity");
    const { fill, font } =
      f.severity === "high"
        ? { fill: RED_FILL, font: RED_FONT }
        : f.severity === "medium"
          ? { fill: AMBER_FILL, font: AMBER_FONT }
          : { fill: GREEN_FILL, font: GREEN_FONT };
    sevCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    sevCell.font = { color: { argb: font }, bold: true };
  }

  // Summary stats below findings
  sheet.addRow({});
  const statsHeader = sheet.addRow({
    feature: "STATISTICS",
    category: "Value",
  });
  statsHeader.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DATABRICKS_BLUE } };
  });

  const stats = [
    ["Total Tables", adoption.stats.totalTables],
    ["Delta Tables", adoption.stats.deltaTableCount],
    ["Liquid Clustering", adoption.stats.liquidClusteringCount],
    ["Legacy Partitioning", adoption.stats.legacyPartitionCount],
    ["CDF Enabled", adoption.stats.cdfEnabledCount],
    ["Streaming Without CDF", adoption.stats.streamingWithoutCdfCount],
    ["Auto-Optimize Enabled", adoption.stats.autoOptimizeCount],
    ["Large Tables Without Auto-Optimize", adoption.stats.largeWithoutAutoOptimize],
    ["Outdated Delta Protocol", adoption.stats.outdatedProtocolCount],
    ["Without Description", adoption.stats.tablesWithoutDescription],
    ["Without Owner", adoption.stats.tablesWithoutOwner],
    ["With UC Tags", adoption.stats.tablesWithTags],
  ] as const;
  for (const [metric, value] of stats) {
    sheet.addRow({ feature: metric, category: String(value) });
  }

  styleHeaderRow(sheet);
  const lastRow = adoption.findings.length + stats.length + 4;
  styleDataRows(sheet, 2, lastRow);
}

// ---------------------------------------------------------------------------
// Sheet 14: Analytics Coverage
// ---------------------------------------------------------------------------

function addAnalyticsCoverage(wb: ExcelJS.Workbook, scan: ScanWithRelations): void {
  const maturityInsight = scan.insights.find((i) => i.insightType === "analytics_maturity");
  type MaturityData = {
    overallScore: number;
    level: string;
    dimensions: Record<string, { score: number; summary: string }>;
    uncoveredDomains: string[];
    topRecommendations: Array<{ priority: number; action: string; impact: string; effort: string }>;
  };
  const maturity: MaturityData | null = maturityInsight
    ? safeJSON<MaturityData | null>(maturityInsight.payloadJson, null)
    : null;

  const genieSpaces = scan.insights.filter((i) => i.insightType === "discovered_genie_space");
  const dashboards = scan.insights.filter((i) => i.insightType === "discovered_dashboard");

  if (!maturity && genieSpaces.length === 0 && dashboards.length === 0) return;

  const sheet = wb.addWorksheet("Analytics Coverage");

  if (maturity) {
    sheet.columns = [
      { header: "Metric", key: "metric", width: 35 },
      { header: "Value", key: "value", width: 55 },
    ];

    sheet.addRow({
      metric: "ANALYTICS MATURITY SCORE",
      value: `${maturity.overallScore}/100 — ${maturity.level}`,
    });
    const scoreRow = sheet.getRow(sheet.rowCount);
    scoreRow.eachCell((cell) => {
      cell.font = { bold: true, size: 12 };
    });
    applyScoreCell(scoreRow.getCell("value"), maturity.overallScore);

    for (const [dim, data] of Object.entries(maturity.dimensions)) {
      sheet.addRow({
        metric: `  ${dim.charAt(0).toUpperCase() + dim.slice(1)}`,
        value: `${data.score}/100 — ${data.summary}`,
      });
    }

    sheet.addRow({ metric: "", value: "" });

    if (maturity.uncoveredDomains.length > 0) {
      sheet.addRow({ metric: "UNCOVERED DOMAINS", value: maturity.uncoveredDomains.join(", ") });
      const ucRow = sheet.getRow(sheet.rowCount);
      ucRow.eachCell((cell) => {
        cell.font = { bold: true };
      });
    }

    sheet.addRow({ metric: "", value: "" });

    if (maturity.topRecommendations.length > 0) {
      sheet.addRow({ metric: "TOP RECOMMENDATIONS", value: "" });
      const recHeader = sheet.getRow(sheet.rowCount);
      recHeader.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: WHITE } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DATABRICKS_BLUE } };
      });

      for (const rec of maturity.topRecommendations) {
        sheet.addRow({
          metric: `#${rec.priority} [Impact: ${rec.impact}, Effort: ${rec.effort}]`,
          value: rec.action,
        });
      }
    }

    styleHeaderRow(sheet);
    styleDataRows(sheet, 2, sheet.rowCount);
  }
}
