/**
 * Table Health Score Algorithm.
 *
 * Rule-based scoring (0-100) that evaluates table maintenance,
 * data freshness, documentation, and configuration. Deducts points
 * for identified issues and generates actionable recommendations.
 */

import type { TableDetail, TableHistorySummary, TableHealthInsight } from "@/lib/domain/types";

// ---------------------------------------------------------------------------
// Scoring rules
// ---------------------------------------------------------------------------

interface HealthRule {
  id: string;
  deduction: number;
  check: (detail: TableDetail, history: TableHistorySummary | null) => boolean;
  issue: string;
  recommendation: string;
}

interface HealthThresholds {
  optimizeWindowDays: number;
  vacuumWindowDays: number;
  staleWriteDays: number;
  staleAccessDays: number;
  smallFileBytes: number;
  highPartitionCount: number;
  veryLargeRowCount: number;
}

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const HEALTH_THRESHOLDS: HealthThresholds = {
  optimizeWindowDays: readIntEnv("FORGE_HEALTH_OPTIMIZE_WINDOW_DAYS", 30),
  vacuumWindowDays: readIntEnv("FORGE_HEALTH_VACUUM_WINDOW_DAYS", 30),
  staleWriteDays: readIntEnv("FORGE_HEALTH_STALE_WRITE_DAYS", 90),
  staleAccessDays: readIntEnv("FORGE_HEALTH_STALE_ACCESS_DAYS", 90),
  smallFileBytes: readIntEnv("FORGE_HEALTH_SMALL_FILE_BYTES", 33_554_432),
  highPartitionCount: readIntEnv("FORGE_HEALTH_HIGH_PARTITION_COUNT", 100),
  veryLargeRowCount: readIntEnv("FORGE_HEALTH_VERY_LARGE_ROW_COUNT", 1_000_000_000),
};

const HEALTH_RULES: HealthRule[] = [
  {
    id: "no_optimize_30d",
    deduction: 15,
    check: (_, h) => {
      if (!h || !h.lastOptimizeTimestamp) return true;
      return daysSince(h.lastOptimizeTimestamp) > HEALTH_THRESHOLDS.optimizeWindowDays;
    },
    issue: `No OPTIMIZE run in the last ${HEALTH_THRESHOLDS.optimizeWindowDays} days`,
    recommendation:
      "Schedule regular OPTIMIZE to compact small files and improve query performance.",
  },
  {
    id: "no_vacuum_30d",
    deduction: 15,
    check: (_, h) => {
      if (!h || !h.lastVacuumTimestamp) return true;
      return daysSince(h.lastVacuumTimestamp) > HEALTH_THRESHOLDS.vacuumWindowDays;
    },
    issue: `No VACUUM run in the last ${HEALTH_THRESHOLDS.vacuumWindowDays} days`,
    recommendation: "Schedule regular VACUUM to remove stale data files and reduce storage costs.",
  },
  {
    id: "small_file_problem",
    deduction: 20,
    check: (d) => {
      if (!d.sizeInBytes || !d.numFiles || d.numFiles === 0) return false;
      const avgFileSize = d.sizeInBytes / d.numFiles;
      return avgFileSize < HEALTH_THRESHOLDS.smallFileBytes;
    },
    issue: `Small file problem detected (average file size < ${Math.round(HEALTH_THRESHOLDS.smallFileBytes / (1024 * 1024))}MB)`,
    recommendation:
      "Run OPTIMIZE to compact small files. Consider enabling auto-optimize for streaming tables.",
  },
  {
    id: "no_comment",
    deduction: 10,
    check: (d) => !d.comment,
    issue: "No table description/comment set",
    recommendation: "Add a COMMENT ON TABLE to document the table's purpose and contents.",
  },
  {
    id: "high_partition_count",
    deduction: 10,
    check: (d) => d.partitionColumns.length > HEALTH_THRESHOLDS.highPartitionCount,
    issue: `Extremely high partition column count (> ${HEALTH_THRESHOLDS.highPartitionCount})`,
    recommendation:
      "Review partitioning strategy. Consider liquid clustering for better performance.",
  },
  {
    id: "stale_data_90d",
    deduction: 15,
    check: (_, h) => {
      if (!h || !h.lastWriteTimestamp) return false; // Can't determine staleness without history
      return daysSince(h.lastWriteTimestamp) > HEALTH_THRESHOLDS.staleWriteDays;
    },
    issue: `Stale data: no writes in the last ${HEALTH_THRESHOLDS.staleWriteDays} days`,
    recommendation:
      "Verify if this table is still actively used. Consider archiving or dropping if abandoned.",
  },
  {
    id: "not_accessed_90d",
    deduction: 10,
    check: (d) => {
      if (!d.lastAccess || d.lastAccess === "UNKNOWN") return false;
      return daysSince(d.lastAccess) > HEALTH_THRESHOLDS.staleAccessDays;
    },
    issue: `Table not accessed in the last ${HEALTH_THRESHOLDS.staleAccessDays} days`,
    recommendation:
      "This table has not been read or queried recently. Verify it is still needed or consider archiving.",
  },
  {
    id: "no_cdf_with_streaming",
    deduction: 10,
    check: (d, h) => {
      if (!h || !h.hasStreamingWrites) return false;
      return d.tableProperties["delta.enableChangeDataFeed"] !== "true";
    },
    issue: "Streaming writes detected but Change Data Feed (CDF) is not enabled",
    recommendation:
      "Enable CDF with ALTER TABLE SET TBLPROPERTIES ('delta.enableChangeDataFeed' = true) for downstream consumers.",
  },
  {
    id: "outdated_delta_protocol",
    deduction: 5,
    check: (d) => {
      if (d.deltaMinReaderVersion == null) return false;
      return d.deltaMinReaderVersion < 2;
    },
    issue: "Outdated Delta protocol version (reader version < 2)",
    recommendation:
      "Upgrade Delta protocol to enable features like column mapping and deletion vectors.",
  },
  {
    id: "empty_table",
    deduction: 10,
    check: (d) => {
      if (d.numRows == null) return false;
      return d.numRows === 0 && d.tableType !== "VIEW";
    },
    issue: "Table has zero rows",
    recommendation:
      "Empty tables add clutter and may indicate failed ingestion or an abandoned asset. Verify data loads or consider dropping.",
  },
  {
    id: "very_large_table",
    deduction: 5,
    check: (d) => {
      if (d.numRows == null) return false;
      return d.numRows > HEALTH_THRESHOLDS.veryLargeRowCount;
    },
    issue: `Very large table (> ${HEALTH_THRESHOLDS.veryLargeRowCount.toLocaleString()} rows)`,
    recommendation:
      "Tables of this scale require careful partitioning, clustering, and maintenance scheduling. Review OPTIMIZE/VACUUM cadence and consider archiving old data.",
  },
];

// ---------------------------------------------------------------------------
// Scoring function
// ---------------------------------------------------------------------------

/**
 * Compute health score and insights for a single table.
 */
export function computeTableHealth(
  detail: TableDetail,
  history: TableHistorySummary | null,
): TableHealthInsight {
  let score = 100;
  const issues: string[] = [];
  const recommendations: string[] = [];

  for (const rule of HEALTH_RULES) {
    if (rule.check(detail, history)) {
      score -= rule.deduction;
      issues.push(rule.issue);
      recommendations.push(rule.recommendation);
    }
  }

  return {
    tableFqn: detail.fqn,
    healthScore: Math.max(0, score),
    issues,
    recommendations,
  };
}

/**
 * Compute health scores for all tables.
 */
export function computeAllTableHealth(
  details: TableDetail[],
  histories: Map<string, TableHistorySummary>,
): Map<string, TableHealthInsight> {
  const results = new Map<string, TableHealthInsight>();
  for (const detail of details) {
    const history = histories.get(detail.fqn) ?? null;
    results.set(detail.fqn, computeTableHealth(detail, history));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysSince(isoTimestamp: string): number {
  try {
    return Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 86_400_000);
  } catch {
    return 999;
  }
}
