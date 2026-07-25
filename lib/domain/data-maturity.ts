/**
 * Data Maturity Score -- composite metric for a customer's data platform maturity.
 *
 * Four pillars, each scored 0-100:
 *   1. Governance (25%): PII coverage, documentation, tag adoption, governance scores
 *   2. Architecture (25%): medallion tiers, redundancy, data products, lineage coverage
 *   3. Operations (25%): optimize cadence, vacuum cadence, streaming, CDF, health scores
 *   4. Analytics Readiness (25%): use case density, schema coverage, type balance
 *
 * Overall maturity levels:
 *   0-20  Foundational
 *   21-40 Developing
 *   41-60 Established
 *   61-80 Advanced
 *   81-100 Leading
 *
 * This score is the headline number an SA quotes in an account review.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MaturityPillar {
  name: string;
  score: number;
  weight: number;
  indicators: MaturityIndicator[];
}

export interface MaturityIndicator {
  label: string;
  value: string;
  score: number; // 0-100
  detail?: string;
}

export type MaturityLevel = "Foundational" | "Developing" | "Established" | "Advanced" | "Leading";

export interface DataMaturityScore {
  overall: number;
  level: MaturityLevel;
  pillars: {
    governance: MaturityPillar;
    architecture: MaturityPillar;
    operations: MaturityPillar;
    analyticsReadiness: MaturityPillar;
  };
}

// ---------------------------------------------------------------------------
// Inputs (same shape as environment scan + optional discovery data)
// ---------------------------------------------------------------------------

export interface MaturityInputs {
  /** Total tables scanned */
  tableCount: number;
  /** Average governance score (0-100) from LLM governance pass */
  avgGovernanceScore: number;
  /** Tables with PII detected */
  piiTablesCount: number;
  /** Tables with descriptions (comment or generated) */
  tablesWithDescription: number;
  /** Tables with tags in Unity Catalog */
  tablesWithTags: number;
  /** Tables with an owner set */
  tablesWithOwner: number;
  /** Tables classified by medallion tier */
  tablesWithTier: number;
  /** Number of distinct data tiers found (bronze/silver/gold etc.) */
  tierCount: number;
  /** Redundancy pairs detected */
  redundancyPairsCount: number;
  /** Data products identified */
  dataProductCount: number;
  /** Lineage edges discovered */
  lineageEdgeCount: number;
  /** Tables discovered via lineage */
  lineageDiscoveredCount: number;
  /** Domain count */
  domainCount: number;
  /** Tables needing OPTIMIZE */
  tablesNeedingOptimize: number;
  /** Tables needing VACUUM */
  tablesNeedingVacuum: number;
  /** Tables with streaming writes */
  tablesWithStreaming: number;
  /** Tables with CDF enabled */
  tablesWithCDF: number;
  /** Average health score (0-100) from rule-based checks */
  avgHealthScore: number;
  /** Tables with auto-optimize enabled */
  tablesWithAutoOptimize: number;
  /** Tables with liquid clustering */
  tablesWithLiquidClustering: number;

  // Optional discovery data (if a discovery run was linked)
  /** Number of use cases generated */
  useCaseCount?: number;
  /** Tables covered by use cases */
  tablesCoveredByUseCases?: number;
  /** Average use case score (0-1) */
  avgUseCaseScore?: number;
  /** Count of AI-type use cases */
  aiUseCaseCount?: number;
  /** Count of Statistical-type use cases */
  statisticalUseCaseCount?: number;
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function pctScore(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return clamp((numerator / denominator) * 100);
}

function getLevel(score: number): MaturityLevel {
  if (score >= 81) return "Leading";
  if (score >= 61) return "Advanced";
  if (score >= 41) return "Established";
  if (score >= 21) return "Developing";
  return "Foundational";
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

export function computeDataMaturity(inputs: MaturityInputs): DataMaturityScore {
  const t = Math.max(inputs.tableCount, 1);

  // --- Governance Pillar ---
  const docPct = pctScore(inputs.tablesWithDescription, t);
  const tagPct = pctScore(inputs.tablesWithTags, t);
  const ownerPct = pctScore(inputs.tablesWithOwner, t);
  const govScore = clamp(inputs.avgGovernanceScore);
  const piiCoverage = inputs.piiTablesCount > 0 ? 80 : 40; // at least we know if PII exists

  const governanceIndicators: MaturityIndicator[] = [
    { label: "Avg Governance Score", value: `${govScore}/100`, score: govScore },
    { label: "Documentation Coverage", value: `${docPct}%`, score: docPct },
    { label: "Tag Adoption", value: `${tagPct}%`, score: tagPct },
    { label: "Ownership Assignment", value: `${ownerPct}%`, score: ownerPct },
    {
      label: "PII Detection Active",
      value: inputs.piiTablesCount > 0 ? "Yes" : "No PII found",
      score: piiCoverage,
    },
  ];
  const governancePillarScore = clamp(
    governanceIndicators.reduce((s, i) => s + i.score, 0) / governanceIndicators.length,
  );

  // --- Architecture Pillar ---
  const tierPct = pctScore(inputs.tablesWithTier, t);
  const tierDiversity = clamp(Math.min(inputs.tierCount, 3) * 33); // 3 tiers = 99 → 100
  const redundancyPenalty = clamp(100 - Math.min(inputs.redundancyPairsCount * 10, 50));
  const dataProductScore = clamp(Math.min(inputs.dataProductCount, 10) * 10);
  const lineageCoverage =
    inputs.lineageEdgeCount > 0 ? clamp(Math.min((inputs.lineageEdgeCount / t) * 50, 100)) : 0;

  const architectureIndicators: MaturityIndicator[] = [
    { label: "Medallion Tier Adoption", value: `${tierPct}%`, score: tierPct },
    { label: "Tier Diversity", value: `${inputs.tierCount} tiers`, score: tierDiversity },
    {
      label: "Redundancy (lower is better)",
      value: `${inputs.redundancyPairsCount} pairs`,
      score: redundancyPenalty,
    },
    { label: "Data Products", value: String(inputs.dataProductCount), score: dataProductScore },
    {
      label: "Lineage Coverage",
      value: `${inputs.lineageEdgeCount} edges`,
      score: lineageCoverage,
    },
  ];
  const architecturePillarScore = clamp(
    architectureIndicators.reduce((s, i) => s + i.score, 0) / architectureIndicators.length,
  );

  // --- Operations Pillar ---
  const optimizeScore = clamp(100 - pctScore(inputs.tablesNeedingOptimize, t));
  const vacuumScore = clamp(100 - pctScore(inputs.tablesNeedingVacuum, t));
  const cdfPct =
    inputs.tablesWithStreaming > 0
      ? pctScore(inputs.tablesWithCDF, inputs.tablesWithStreaming)
      : inputs.tablesWithCDF > 0
        ? 80
        : 50; // no streaming = neutral
  const healthScore = clamp(inputs.avgHealthScore);
  const autoOptPct = pctScore(inputs.tablesWithAutoOptimize, t);
  const liquidPct = pctScore(inputs.tablesWithLiquidClustering, t);

  const operationsIndicators: MaturityIndicator[] = [
    { label: "Avg Health Score", value: `${healthScore}/100`, score: healthScore },
    { label: "OPTIMIZE Compliance", value: `${optimizeScore}%`, score: optimizeScore },
    { label: "VACUUM Compliance", value: `${vacuumScore}%`, score: vacuumScore },
    { label: "Auto-Optimize Adoption", value: `${autoOptPct}%`, score: autoOptPct },
    { label: "Liquid Clustering", value: `${liquidPct}%`, score: liquidPct },
    { label: "CDF on Streaming Tables", value: `${clamp(cdfPct)}%`, score: clamp(cdfPct) },
  ];
  const operationsPillarScore = clamp(
    operationsIndicators.reduce((s, i) => s + i.score, 0) / operationsIndicators.length,
  );

  // --- Analytics Readiness Pillar ---
  let analyticsIndicators: MaturityIndicator[];
  if (inputs.useCaseCount != null && inputs.useCaseCount > 0) {
    const density = (inputs.useCaseCount / t).toFixed(1);
    const densityScore = clamp(Math.min((inputs.useCaseCount / t) * 50, 100));
    const coverage =
      inputs.tablesCoveredByUseCases != null ? pctScore(inputs.tablesCoveredByUseCases, t) : 0;
    const avgUcScore = inputs.avgUseCaseScore != null ? clamp(inputs.avgUseCaseScore * 100) : 50;
    const aiPct =
      inputs.aiUseCaseCount != null && inputs.useCaseCount > 0
        ? pctScore(inputs.aiUseCaseCount, inputs.useCaseCount)
        : 50;
    const balance = Math.abs(aiPct - 50);
    const balanceScore = clamp(100 - balance); // 50/50 = perfect balance

    analyticsIndicators = [
      { label: "Use Case Density", value: `${density} per table`, score: densityScore },
      { label: "Schema Coverage", value: `${coverage}%`, score: coverage },
      { label: "Avg Use Case Quality", value: `${avgUcScore}%`, score: avgUcScore },
      { label: "AI/Statistical Balance", value: `${aiPct}% AI`, score: balanceScore },
      {
        label: "Domain Coverage",
        value: `${inputs.domainCount} domains`,
        score: clamp(Math.min(inputs.domainCount, 8) * 12.5),
      },
    ];
  } else {
    // No discovery data -- score based on estate alone
    const domainScore = clamp(Math.min(inputs.domainCount, 8) * 12.5);
    analyticsIndicators = [
      { label: "Domain Coverage", value: `${inputs.domainCount} domains`, score: domainScore },
      {
        label: "Discovery Runs",
        value: "Not yet run",
        score: 0,
        detail: "Run a discovery pipeline to unlock analytics readiness scoring",
      },
    ];
  }
  const analyticsReadinessPillarScore = clamp(
    analyticsIndicators.reduce((s, i) => s + i.score, 0) / analyticsIndicators.length,
  );

  // --- Overall ---
  const overall = clamp(
    governancePillarScore * 0.25 +
      architecturePillarScore * 0.25 +
      operationsPillarScore * 0.25 +
      analyticsReadinessPillarScore * 0.25,
  );

  return {
    overall,
    level: getLevel(overall),
    pillars: {
      governance: {
        name: "Governance",
        score: governancePillarScore,
        weight: 0.25,
        indicators: governanceIndicators,
      },
      architecture: {
        name: "Architecture",
        score: architecturePillarScore,
        weight: 0.25,
        indicators: architectureIndicators,
      },
      operations: {
        name: "Operations",
        score: operationsPillarScore,
        weight: 0.25,
        indicators: operationsIndicators,
      },
      analyticsReadiness: {
        name: "Analytics Readiness",
        score: analyticsReadinessPillarScore,
        weight: 0.25,
        indicators: analyticsIndicators,
      },
    },
  };
}
