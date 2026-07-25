/**
 * Combined Executive Briefing -- PPTX export merging Estate Intelligence + Discovery.
 *
 * This is the deliverable an SA hands to a VP of Data Engineering:
 *   Slide 1: Title
 *   Slide 2: Data Estate Overview (tables, domains, size, maturity score)
 *   Slide 3: Governance Posture (PII, documentation, tag adoption, gaps)
 *   Slide 4: Architecture Quality (medallion tiers, redundancy, lineage, data products)
 *   Slide 5: Feature Adoption (liquid clustering, CDF, auto-optimize, recommendations)
 *   Slide 6: Use Case Highlights (top use cases, domain breakdown, schema coverage)
 *   Slide 7: Expansion Opportunities (data-rich domains with no analytics, untapped tables)
 */

import PptxGenJS from "pptxgenjs";
import fs from "fs";
import path from "path";
import type { UseCase } from "@/lib/domain/types";
import { computeDataMaturity } from "@/lib/domain/data-maturity";
import { computeFeatureAdoption } from "@/lib/domain/feature-adoption";
import { computeDomainStats, computeSchemaCoverage, effectiveScores } from "@/lib/domain/scoring";

// ---------------------------------------------------------------------------
// Brand constants (same as pptx.ts)
// ---------------------------------------------------------------------------

const DB_DARK = "1B3139";
const DB_RED = "FF3621";
const TEXT_COLOR = "2D3E50";
const TEXT_LIGHT = "BECBD2";
const WHITE = "FFFFFF";
const FOOTER_COLOR = "8899A6";
const MID_GRAY = "5E6E7D";
const SCORE_GREEN = "2EA44F";
const SCORE_AMBER = "E8912D";

const SLIDE_W = 13.33;
const CONTENT_MARGIN = 0.6;
const CONTENT_W = SLIDE_W - CONTENT_MARGIN * 2;

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface BriefingEstateData {
  ucPath: string;
  tableCount: number;
  totalSizeBytes: number;
  totalRows: number;
  domainCount: number;
  avgGovernanceScore: number;
  piiTablesCount: number;
  redundancyPairsCount: number;
  dataProductCount: number;
  lineageEdgeCount: number;
  lineageDiscoveredCount: number;
  tablesNeedingOptimize: number;
  tablesNeedingVacuum: number;
  tablesWithStreaming: number;
  tablesWithCDF: number;
  details: Array<{
    tableFqn: string;
    tableType: string | null;
    format: string | null;
    dataDomain: string | null;
    dataTier: string | null;
    sensitivityLevel: string | null;
    sizeInBytes: bigint | number | null;
    numRows: bigint | number | null;
    partitionColumns: string | null;
    clusteringColumns: string | null;
    comment: string | null;
    generatedDescription: string | null;
    owner: string | null;
    isManaged: boolean;
    propertiesJson: string | null;
    tagsJson: string | null;
    discoveredVia: string;
  }>;
  histories: Array<{
    tableFqn: string;
    hasStreamingWrites: boolean;
    totalOptimizeOps: number;
    totalVacuumOps: number;
    healthScore?: number | null;
  }>;
  insights: Array<{
    insightType: string;
    tableFqn: string | null;
    payloadJson: string;
  }>;
}

export interface BriefingDiscoveryData {
  businessName: string;
  useCases: UseCase[];
  filteredTables: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _logoBase64: string | null = null;
function getLogoBase64(): string | null {
  if (_logoBase64 !== null) return _logoBase64;
  try {
    const svgPath = path.join(process.cwd(), "public", "databricks-icon.svg");
    const svgContent = fs.readFileSync(svgPath, "utf-8");
    _logoBase64 = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString("base64")}`;
    return _logoBase64;
  } catch {
    _logoBase64 = "";
    return null;
  }
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function addFooter(slide: PptxGenJS.Slide, variant: "light" | "dark" = "light"): void {
  const logo = getLogoBase64();
  if (logo) {
    slide.addImage({ data: logo, x: CONTENT_MARGIN, y: 6.98, w: 0.25, h: 0.26 });
  }
  slide.addText(`Databricks Forge Executive Briefing  |  ${today()}`, {
    x: CONTENT_MARGIN + 0.35,
    y: 7.0,
    w: CONTENT_W - 0.35,
    fontSize: 10,
    color: variant === "dark" ? TEXT_LIGHT : FOOTER_COLOR,
    align: "right",
  });
}

function addBrandShapes(slide: PptxGenJS.Slide): void {
  slide.addShape("ellipse", {
    x: 11.3,
    y: -0.3,
    w: 2.5,
    h: 2.5,
    fill: { color: WHITE, transparency: 92 },
  });
  slide.addShape("ellipse", {
    x: -0.5,
    y: 5.8,
    w: 2.0,
    h: 2.0,
    fill: { color: WHITE, transparency: 92 },
  });
  slide.addShape("ellipse", {
    x: 12.0,
    y: 6.5,
    w: 0.6,
    h: 0.6,
    fill: { color: DB_RED, transparency: 50 },
  });
}

function addRedSeparator(slide: PptxGenJS.Slide, x: number, y: number, w: number): void {
  slide.addShape("rect", { x, y, w, h: 0.04, fill: { color: DB_RED } });
}

function humanSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function headerCell(text: string): PptxGenJS.TableCell {
  return {
    text,
    options: {
      bold: true,
      color: WHITE,
      fill: { color: DB_DARK },
      fontSize: 12,
      align: "left",
      valign: "middle",
    },
  };
}

function bodyCell(text: string, opts?: Partial<PptxGenJS.TextPropsOptions>): PptxGenJS.TableCell {
  return { text, options: { fontSize: 11, color: TEXT_COLOR, valign: "middle", ...opts } };
}

function scoreColor(score: number): string {
  return score >= 70 ? SCORE_GREEN : score >= 40 ? SCORE_AMBER : DB_RED;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function generateExecutiveBriefing(
  estate: BriefingEstateData,
  discovery: BriefingDiscoveryData | null,
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Databricks Forge";
  pptx.title = `${discovery?.businessName ?? "Data Estate"} - Executive Briefing`;

  // Compute scores
  const adoption = computeFeatureAdoption(estate.details, estate.histories);
  const maturity = computeDataMaturity({
    tableCount: estate.tableCount,
    avgGovernanceScore: estate.avgGovernanceScore,
    piiTablesCount: estate.piiTablesCount,
    tablesWithDescription: estate.details.filter((d) => d.comment || d.generatedDescription).length,
    tablesWithTags: estate.details.filter((d) => {
      try {
        return JSON.parse(d.tagsJson ?? "[]").length > 0;
      } catch {
        return false;
      }
    }).length,
    tablesWithOwner: estate.details.filter((d) => d.owner).length,
    tablesWithTier: estate.details.filter((d) => d.dataTier).length,
    tierCount: new Set(estate.details.map((d) => d.dataTier).filter(Boolean)).size,
    redundancyPairsCount: estate.redundancyPairsCount,
    dataProductCount: estate.dataProductCount,
    lineageEdgeCount: estate.lineageEdgeCount,
    lineageDiscoveredCount: estate.lineageDiscoveredCount,
    domainCount: estate.domainCount,
    tablesNeedingOptimize: estate.tablesNeedingOptimize,
    tablesNeedingVacuum: estate.tablesNeedingVacuum,
    tablesWithStreaming: estate.tablesWithStreaming,
    tablesWithCDF: estate.tablesWithCDF,
    avgHealthScore:
      estate.histories.length > 0
        ? estate.histories.reduce((s, h) => s + (h.healthScore ?? 0), 0) / estate.histories.length
        : 50,
    tablesWithAutoOptimize: adoption.stats.autoOptimizeCount,
    tablesWithLiquidClustering: adoption.stats.liquidClusteringCount,
    useCaseCount: discovery?.useCases.length,
    tablesCoveredByUseCases: discovery
      ? new Set(discovery.useCases.flatMap((uc) => uc.tablesInvolved)).size
      : undefined,
    avgUseCaseScore:
      discovery && discovery.useCases.length > 0
        ? discovery.useCases.reduce((s, uc) => s + effectiveScores(uc).overall, 0) /
          discovery.useCases.length
        : undefined,
    aiUseCaseCount: discovery?.useCases.filter((uc) => uc.type === "AI").length,
    statisticalUseCaseCount: discovery?.useCases.filter((uc) => uc.type === "Statistical").length,
  });

  // =====================================================================
  // SLIDE 1: TITLE
  // =====================================================================
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: DB_DARK };
  addBrandShapes(titleSlide);
  const logo = getLogoBase64();
  if (logo) {
    titleSlide.addImage({ data: logo, x: 0.6, y: 0.5, w: 0.55, h: 0.58 });
  }
  addRedSeparator(titleSlide, 1.5, 1.3, 3.5);
  titleSlide.addText("Executive Briefing", {
    x: 1.5,
    y: 1.6,
    w: 10,
    fontSize: 44,
    bold: true,
    color: WHITE,
    fontFace: "Calibri",
  });
  titleSlide.addText("Data Estate Intelligence & Use Case Discovery", {
    x: 1.5,
    y: 2.6,
    w: 10,
    fontSize: 24,
    color: TEXT_LIGHT,
  });
  addRedSeparator(titleSlide, 1.5, 3.6, 2.5);
  titleSlide.addText(discovery?.businessName ?? estate.ucPath, {
    x: 1.5,
    y: 3.9,
    w: 10,
    fontSize: 32,
    bold: true,
    color: DB_RED,
    fontFace: "Calibri",
  });
  titleSlide.addText(`Data Maturity: ${maturity.overall}/100 — ${maturity.level}`, {
    x: 1.5,
    y: 5.0,
    w: 10,
    fontSize: 20,
    color: TEXT_LIGHT,
  });
  addFooter(titleSlide, "dark");

  // =====================================================================
  // SLIDE 2: DATA ESTATE OVERVIEW
  // =====================================================================
  const overviewSlide = pptx.addSlide();
  overviewSlide.addText("Data Estate Overview", {
    x: CONTENT_MARGIN,
    y: 0.3,
    w: CONTENT_W,
    fontSize: 28,
    bold: true,
    color: DB_DARK,
  });
  addRedSeparator(overviewSlide, CONTENT_MARGIN, 0.95, 2);

  // Maturity score prominently
  overviewSlide.addText(`${maturity.overall}`, {
    x: CONTENT_MARGIN,
    y: 1.2,
    w: 2,
    fontSize: 60,
    bold: true,
    color: scoreColor(maturity.overall),
    align: "center",
  });
  overviewSlide.addText(`/100\n${maturity.level}`, {
    x: CONTENT_MARGIN,
    y: 2.9,
    w: 2,
    fontSize: 14,
    color: MID_GRAY,
    align: "center",
  });

  // Pillar bars
  const pillars = [
    maturity.pillars.governance,
    maturity.pillars.architecture,
    maturity.pillars.operations,
    maturity.pillars.analyticsReadiness,
  ];
  let pillarY = 1.3;
  for (const p of pillars) {
    overviewSlide.addText(`${p.name}: ${p.score}/100`, {
      x: 2.8,
      y: pillarY,
      w: 4,
      fontSize: 12,
      color: TEXT_COLOR,
    });
    // Bar background
    overviewSlide.addShape("rect", {
      x: 2.8,
      y: pillarY + 0.35,
      w: 4,
      h: 0.15,
      fill: { color: "E5E7EB" },
    });
    // Bar fill
    overviewSlide.addShape("rect", {
      x: 2.8,
      y: pillarY + 0.35,
      w: 4 * (p.score / 100),
      h: 0.15,
      fill: { color: scoreColor(p.score) },
    });
    pillarY += 0.7;
  }

  // Estate stats table
  const estateRows: PptxGenJS.TableCell[][] = [
    [headerCell("Metric"), headerCell("Value")],
    [bodyCell("Total Tables"), bodyCell(String(estate.tableCount))],
    [bodyCell("Total Size"), bodyCell(humanSize(estate.totalSizeBytes))],
    [bodyCell("Business Domains"), bodyCell(String(estate.domainCount))],
    [bodyCell("Data Products"), bodyCell(String(estate.dataProductCount))],
    [bodyCell("Feature Adoption Score"), bodyCell(`${adoption.adoptionScore}/100`)],
    [bodyCell("Lineage Edges"), bodyCell(String(estate.lineageEdgeCount))],
    [
      bodyCell("Tables via Lineage"),
      bodyCell(
        estate.lineageDiscoveredCount > 0 ? `${estate.lineageDiscoveredCount} discovered` : "None",
      ),
    ],
  ];
  overviewSlide.addTable(estateRows, {
    x: 7.5,
    y: 1.2,
    w: 5.2,
    fontSize: 11,
    border: { type: "solid", pt: 0.5, color: "D1D5DB" },
    colW: [3, 2.2],
  });
  addFooter(overviewSlide);

  // =====================================================================
  // SLIDE 3: GOVERNANCE POSTURE
  // =====================================================================
  const govSlide = pptx.addSlide();
  govSlide.addText("Governance Posture", {
    x: CONTENT_MARGIN,
    y: 0.3,
    w: CONTENT_W,
    fontSize: 28,
    bold: true,
    color: DB_DARK,
  });
  addRedSeparator(govSlide, CONTENT_MARGIN, 0.95, 2);

  const docPct =
    estate.tableCount > 0
      ? Math.round(
          (estate.details.filter((d) => d.comment || d.generatedDescription).length /
            estate.tableCount) *
            100,
        )
      : 0;
  const ownerPct =
    estate.tableCount > 0
      ? Math.round((estate.details.filter((d) => d.owner).length / estate.tableCount) * 100)
      : 0;
  const piiPct =
    estate.tableCount > 0 ? Math.round((estate.piiTablesCount / estate.tableCount) * 100) : 0;
  const govGaps = estate.insights.filter((i) => i.insightType === "governance_gap");

  const govRows: PptxGenJS.TableCell[][] = [
    [headerCell("Indicator"), headerCell("Value"), headerCell("Assessment")],
    [
      bodyCell("Avg Governance Score"),
      bodyCell(`${estate.avgGovernanceScore.toFixed(0)}/100`),
      bodyCell(
        estate.avgGovernanceScore >= 70
          ? "Strong"
          : estate.avgGovernanceScore >= 40
            ? "Needs improvement"
            : "Critical gaps",
      ),
    ],
    [
      bodyCell("Documentation Coverage"),
      bodyCell(`${docPct}%`),
      bodyCell(
        docPct >= 70 ? "Well documented" : docPct >= 40 ? "Partial" : "Most tables undocumented",
      ),
    ],
    [
      bodyCell("Ownership Assignment"),
      bodyCell(`${ownerPct}%`),
      bodyCell(
        ownerPct >= 70
          ? "Good ownership"
          : ownerPct >= 40
            ? "Partial"
            : "Ownership gaps — accountability risk",
      ),
    ],
    [
      bodyCell("Tables with PII"),
      bodyCell(`${estate.piiTablesCount} (${piiPct}%)`),
      bodyCell(estate.piiTablesCount > 0 ? "Requires compliance controls" : "No PII detected"),
    ],
    [
      bodyCell("Governance Gaps Found"),
      bodyCell(String(govGaps.length)),
      bodyCell(
        govGaps.length > 10
          ? "Many gaps requiring attention"
          : govGaps.length > 0
            ? "Some gaps identified"
            : "No gaps found",
      ),
    ],
  ];
  govSlide.addTable(govRows, {
    x: CONTENT_MARGIN,
    y: 1.3,
    w: CONTENT_W,
    fontSize: 11,
    border: { type: "solid", pt: 0.5, color: "D1D5DB" },
    colW: [4, 2.5, 5.63],
  });
  addFooter(govSlide);

  // =====================================================================
  // SLIDE 4: ARCHITECTURE QUALITY
  // =====================================================================
  const archSlide = pptx.addSlide();
  archSlide.addText("Architecture Quality", {
    x: CONTENT_MARGIN,
    y: 0.3,
    w: CONTENT_W,
    fontSize: 28,
    bold: true,
    color: DB_DARK,
  });
  addRedSeparator(archSlide, CONTENT_MARGIN, 0.95, 2);

  const tiers = { bronze: 0, silver: 0, gold: 0, unclassified: 0 };
  for (const d of estate.details) {
    if (d.dataTier === "bronze") tiers.bronze++;
    else if (d.dataTier === "silver") tiers.silver++;
    else if (d.dataTier === "gold") tiers.gold++;
    else tiers.unclassified++;
  }

  const archRows: PptxGenJS.TableCell[][] = [
    [headerCell("Indicator"), headerCell("Value")],
    [
      bodyCell("Medallion Tiers"),
      bodyCell(
        `Bronze: ${tiers.bronze} | Silver: ${tiers.silver} | Gold: ${tiers.gold} | Unclassified: ${tiers.unclassified}`,
      ),
    ],
    [bodyCell("Redundancy Pairs"), bodyCell(String(estate.redundancyPairsCount))],
    [bodyCell("Data Products"), bodyCell(String(estate.dataProductCount))],
    [
      bodyCell("Lineage Coverage"),
      bodyCell(
        `${estate.lineageEdgeCount} edges, ${estate.lineageDiscoveredCount} tables discovered via lineage`,
      ),
    ],
    [
      bodyCell("Managed vs External"),
      bodyCell(
        `${estate.details.filter((d) => d.isManaged).length} / ${estate.details.filter((d) => !d.isManaged).length}`,
      ),
    ],
  ];
  archSlide.addTable(archRows, {
    x: CONTENT_MARGIN,
    y: 1.3,
    w: CONTENT_W,
    fontSize: 11,
    border: { type: "solid", pt: 0.5, color: "D1D5DB" },
    colW: [4, 8.13],
  });
  addFooter(archSlide);

  // =====================================================================
  // SLIDE 5: FEATURE ADOPTION
  // =====================================================================
  const featSlide = pptx.addSlide();
  featSlide.addText("Databricks Feature Adoption", {
    x: CONTENT_MARGIN,
    y: 0.3,
    w: CONTENT_W,
    fontSize: 28,
    bold: true,
    color: DB_DARK,
  });
  addRedSeparator(featSlide, CONTENT_MARGIN, 0.95, 2);

  featSlide.addText(`Adoption Score: ${adoption.adoptionScore}/100`, {
    x: CONTENT_MARGIN,
    y: 1.2,
    w: CONTENT_W,
    fontSize: 20,
    bold: true,
    color: scoreColor(adoption.adoptionScore),
  });

  const featRows: PptxGenJS.TableCell[][] = [
    [headerCell("Feature"), headerCell("Status"), headerCell("Recommendation")],
  ];
  for (const f of adoption.findings.slice(0, 6)) {
    const sevColor =
      f.severity === "high" ? DB_RED : f.severity === "medium" ? SCORE_AMBER : SCORE_GREEN;
    featRows.push([
      bodyCell(f.feature, { bold: true }),
      bodyCell(f.current, { color: sevColor }),
      bodyCell(f.recommendation),
    ]);
  }
  featSlide.addTable(featRows, {
    x: CONTENT_MARGIN,
    y: 1.8,
    w: CONTENT_W,
    fontSize: 10,
    border: { type: "solid", pt: 0.5, color: "D1D5DB" },
    colW: [2.5, 4.5, 5.13],
    rowH: [0.35, ...Array(featRows.length - 1).fill(0.6)],
    autoPage: true,
  });
  addFooter(featSlide);

  // =====================================================================
  // SLIDE 6: USE CASE HIGHLIGHTS (if discovery data available)
  // =====================================================================
  if (discovery && discovery.useCases.length > 0) {
    const ucSlide = pptx.addSlide();
    ucSlide.addText("Use Case Discovery Highlights", {
      x: CONTENT_MARGIN,
      y: 0.3,
      w: CONTENT_W,
      fontSize: 28,
      bold: true,
      color: DB_DARK,
    });
    addRedSeparator(ucSlide, CONTENT_MARGIN, 0.95, 2);

    const domainStats = computeDomainStats(discovery.useCases);
    const aiCount = discovery.useCases.filter((uc) => uc.type === "AI").length;
    const avgScore = Math.round(
      (discovery.useCases.reduce((s, uc) => s + effectiveScores(uc).overall, 0) /
        discovery.useCases.length) *
        100,
    );

    ucSlide.addText(
      `${discovery.useCases.length} use cases discovered across ${domainStats.length} domains (${aiCount} AI, ${discovery.useCases.length - aiCount} Statistical) — avg score ${avgScore}%`,
      { x: CONTENT_MARGIN, y: 1.2, w: CONTENT_W, fontSize: 14, color: TEXT_COLOR },
    );

    // Top 8 use cases table
    const topUc = [...discovery.useCases]
      .sort((a, b) => effectiveScores(b).overall - effectiveScores(a).overall)
      .slice(0, 8);
    const ucRows: PptxGenJS.TableCell[][] = [
      [
        headerCell("#"),
        headerCell("Use Case"),
        headerCell("Domain"),
        headerCell("Type"),
        headerCell("Score"),
      ],
    ];
    topUc.forEach((uc, i) => {
      ucRows.push([
        bodyCell(String(i + 1)),
        bodyCell(uc.name),
        bodyCell(uc.domain),
        bodyCell(uc.type),
        bodyCell(`${Math.round(effectiveScores(uc).overall * 100)}%`, {
          color: scoreColor(effectiveScores(uc).overall * 100),
          bold: true,
        }),
      ]);
    });
    ucSlide.addTable(ucRows, {
      x: CONTENT_MARGIN,
      y: 1.7,
      w: CONTENT_W,
      fontSize: 10,
      border: { type: "solid", pt: 0.5, color: "D1D5DB" },
      colW: [0.5, 5, 2.5, 1.5, 2.63],
    });
    addFooter(ucSlide);
  }

  // =====================================================================
  // SLIDE 7: EXPANSION OPPORTUNITIES
  // =====================================================================
  if (discovery && discovery.useCases.length > 0) {
    const expSlide = pptx.addSlide();
    expSlide.addText("Expansion Opportunities", {
      x: CONTENT_MARGIN,
      y: 0.3,
      w: CONTENT_W,
      fontSize: 28,
      bold: true,
      color: DB_DARK,
    });
    addRedSeparator(expSlide, CONTENT_MARGIN, 0.95, 2);

    const coverage = computeSchemaCoverage(discovery.filteredTables, discovery.useCases);
    expSlide.addText(
      `Schema Coverage: ${coverage.coveragePct}% (${coverage.coveredTables} of ${coverage.totalTables} tables have use cases)`,
      { x: CONTENT_MARGIN, y: 1.2, w: CONTENT_W, fontSize: 14, color: TEXT_COLOR },
    );
    expSlide.addText(
      `${coverage.uncoveredTables.length} tables have no associated use cases — these represent untapped data with potential for new analytics.`,
      { x: CONTENT_MARGIN, y: 1.6, w: CONTENT_W, fontSize: 12, color: MID_GRAY },
    );

    // Top uncovered tables
    if (coverage.uncoveredTables.length > 0) {
      const uncoveredRows: PptxGenJS.TableCell[][] = [
        [headerCell("Untapped Table"), headerCell("Status")],
      ];
      for (const fqn of coverage.uncoveredTables.slice(0, 12)) {
        uncoveredRows.push([bodyCell(fqn), bodyCell("No use cases generated — expansion signal")]);
      }
      if (coverage.uncoveredTables.length > 12) {
        uncoveredRows.push([
          bodyCell(`... and ${coverage.uncoveredTables.length - 12} more`),
          bodyCell(""),
        ]);
      }
      expSlide.addTable(uncoveredRows, {
        x: CONTENT_MARGIN,
        y: 2.2,
        w: CONTENT_W,
        fontSize: 10,
        border: { type: "solid", pt: 0.5, color: "D1D5DB" },
        colW: [7, 5.13],
      });
    }

    // Top referenced tables
    if (coverage.topTables.length > 0) {
      expSlide.addText("Most Valuable Data Assets (most use case references):", {
        x: CONTENT_MARGIN,
        y: 5.4,
        w: CONTENT_W,
        fontSize: 12,
        bold: true,
        color: TEXT_COLOR,
      });
      const topText = coverage.topTables
        .slice(0, 5)
        .map((t) => `${t.fqn} (${t.useCaseCount} use cases)`)
        .join("  |  ");
      expSlide.addText(topText, {
        x: CONTENT_MARGIN,
        y: 5.8,
        w: CONTENT_W,
        fontSize: 10,
        color: MID_GRAY,
      });
    }
    addFooter(expSlide);
  }

  const arrayBuffer = await pptx.write({ outputType: "arraybuffer" });
  return Buffer.from(arrayBuffer as ArrayBuffer);
}
