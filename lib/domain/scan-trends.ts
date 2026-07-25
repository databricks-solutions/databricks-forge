/**
 * Scan-over-Scan Trend Analysis.
 *
 * Compares two environment scans to show:
 *   - New tables added
 *   - Tables removed
 *   - Size growth/shrinkage
 *   - Governance score changes
 *   - Domain changes
 *   - PII detection changes
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScanSnapshot {
  scanId: string;
  createdAt: string;
  ucPath: string;
  tableCount: number;
  totalSizeBytes: number;
  totalRows: number;
  domainCount: number;
  avgGovernanceScore: number;
  piiTablesCount: number;
  redundancyPairsCount: number;
  dataProductCount: number;
  tablesWithStreaming: number;
  tablesWithCDF: number;
  tablesNeedingOptimize: number;
  tablesNeedingVacuum: number;
  tableFqns: string[];
}

export interface TrendMetric {
  label: string;
  previous: number | string;
  current: number | string;
  change: number;
  changeLabel: string;
  direction: "up" | "down" | "stable";
  sentiment: "positive" | "negative" | "neutral";
}

export interface ScanTrendResult {
  previous: { scanId: string; createdAt: string };
  current: { scanId: string; createdAt: string };
  metrics: TrendMetric[];
  newTables: string[];
  removedTables: string[];
  daysBetween: number;
}

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

export function computeScanTrends(previous: ScanSnapshot, current: ScanSnapshot): ScanTrendResult {
  const prevSet = new Set(previous.tableFqns);
  const currSet = new Set(current.tableFqns);
  const newTables = current.tableFqns.filter((t) => !prevSet.has(t));
  const removedTables = previous.tableFqns.filter((t) => !currSet.has(t));

  const daysBetween = Math.round(
    (new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime()) /
      (1000 * 60 * 60 * 24),
  );

  function metric(
    label: string,
    prev: number,
    curr: number,
    opts?: { invertSentiment?: boolean; suffix?: string },
  ): TrendMetric {
    const change = curr - prev;
    const pct = prev > 0 ? Math.round((change / prev) * 100) : curr > 0 ? 100 : 0;
    const suffix = opts?.suffix ?? "";
    const direction: TrendMetric["direction"] = change > 0 ? "up" : change < 0 ? "down" : "stable";
    let sentiment: TrendMetric["sentiment"] = "neutral";
    if (change !== 0) {
      const positiveUp = !opts?.invertSentiment;
      sentiment = (direction === "up") === positiveUp ? "positive" : "negative";
    }
    return {
      label,
      previous: `${prev}${suffix}`,
      current: `${curr}${suffix}`,
      change,
      changeLabel:
        change === 0
          ? "No change"
          : `${change > 0 ? "+" : ""}${change} (${pct > 0 ? "+" : ""}${pct}%)`,
      direction,
      sentiment,
    };
  }

  const metrics: TrendMetric[] = [
    metric("Total Tables", previous.tableCount, current.tableCount),
    metric("Total Size (bytes)", previous.totalSizeBytes, current.totalSizeBytes),
    metric("Total Rows", previous.totalRows, current.totalRows),
    metric("Business Domains", previous.domainCount, current.domainCount),
    metric(
      "Avg Governance Score",
      Math.round(previous.avgGovernanceScore),
      Math.round(current.avgGovernanceScore),
    ),
    metric("PII Tables", previous.piiTablesCount, current.piiTablesCount, {
      invertSentiment: true,
    }),
    metric("Redundancy Pairs", previous.redundancyPairsCount, current.redundancyPairsCount, {
      invertSentiment: true,
    }),
    metric("Data Products", previous.dataProductCount, current.dataProductCount),
    metric("Tables with Streaming", previous.tablesWithStreaming, current.tablesWithStreaming),
    metric("Tables with CDF", previous.tablesWithCDF, current.tablesWithCDF),
    metric(
      "Tables Needing OPTIMIZE",
      previous.tablesNeedingOptimize,
      current.tablesNeedingOptimize,
      { invertSentiment: true },
    ),
    metric("Tables Needing VACUUM", previous.tablesNeedingVacuum, current.tablesNeedingVacuum, {
      invertSentiment: true,
    }),
  ];

  return {
    previous: { scanId: previous.scanId, createdAt: previous.createdAt },
    current: { scanId: current.scanId, createdAt: current.createdAt },
    metrics,
    newTables,
    removedTables,
    daysBetween,
  };
}
