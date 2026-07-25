/**
 * Databricks Feature Adoption Analysis.
 *
 * Synthesizes metadata already captured during estate scans (table properties,
 * Delta protocol versions, clustering/partitioning, CDF, auto-optimize) into
 * actionable feature adoption findings with recommendations.
 *
 * This is unique intelligence that Databricks account teams cannot get from
 * internal tooling -- it requires scanning the customer's actual table metadata.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeatureAdoptionFinding {
  feature: string;
  category: "performance" | "cost" | "reliability" | "collaboration" | "governance";
  severity: "high" | "medium" | "low";
  current: string;
  recommendation: string;
  tablesAffected: number;
  tables: string[]; // sample FQNs (max 10)
}

export interface FeatureAdoptionSummary {
  /** Overall adoption score 0-100 */
  adoptionScore: number;
  /** Per-feature findings with recommendations */
  findings: FeatureAdoptionFinding[];
  /** Aggregate stats */
  stats: {
    totalTables: number;
    deltaTableCount: number;
    liquidClusteringCount: number;
    legacyPartitionCount: number;
    unpartitionedCount: number;
    cdfEnabledCount: number;
    streamingWithoutCdfCount: number;
    autoOptimizeCount: number;
    largeWithoutAutoOptimize: number;
    outdatedProtocolCount: number;
    tablesWithoutDescription: number;
    tablesWithoutOwner: number;
    tablesWithTags: number;
  };
}

/** Minimal table detail shape needed for analysis (matches scan data). */
interface TableInput {
  tableFqn: string;
  tableType: string | null;
  format: string | null;
  sizeInBytes: bigint | number | null;
  numRows: bigint | number | null;
  partitionColumns: string | null; // JSON array or raw string
  clusteringColumns: string | null; // JSON array or raw string
  comment: string | null;
  generatedDescription: string | null;
  owner: string | null;
  isManaged: boolean;
  propertiesJson: string | null;
  tagsJson: string | null;
  discoveredVia: string;
}

interface HistoryInput {
  tableFqn: string;
  hasStreamingWrites: boolean;
  totalOptimizeOps: number;
  totalVacuumOps: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParseArray(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeParseObj(json: string | null): Record<string, string> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function toNumber(v: bigint | number | null): number {
  if (v == null) return 0;
  return typeof v === "bigint" ? Number(v) : v;
}

function sample(arr: string[], max = 10): string[] {
  return arr.slice(0, max);
}

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

export function computeFeatureAdoption(
  tables: TableInput[],
  histories: HistoryInput[],
): FeatureAdoptionSummary {
  const historyMap = new Map(histories.map((h) => [h.tableFqn, h]));

  // Filter to Delta tables only for Delta-specific features
  const deltaTables = tables.filter(
    (t) => t.format === "delta" || t.format === "DELTA" || !t.format,
  );

  // --- Clustering vs Partitioning ---
  const liquidClustering: string[] = [];
  const legacyPartition: string[] = [];
  const unpartitioned: string[] = [];

  for (const t of deltaTables) {
    const clustering = safeParseArray(t.clusteringColumns);
    const partitions = safeParseArray(t.partitionColumns);

    if (clustering.length > 0) {
      liquidClustering.push(t.tableFqn);
    } else if (partitions.length > 0) {
      legacyPartition.push(t.tableFqn);
    } else {
      unpartitioned.push(t.tableFqn);
    }
  }

  // --- CDF ---
  const cdfEnabled: string[] = [];
  const streamingWithoutCdf: string[] = [];
  for (const t of deltaTables) {
    const props = safeParseObj(t.propertiesJson);
    const hasCdf = props["delta.enableChangeDataFeed"] === "true";
    if (hasCdf) {
      cdfEnabled.push(t.tableFqn);
    }
    const history = historyMap.get(t.tableFqn);
    if (history?.hasStreamingWrites && !hasCdf) {
      streamingWithoutCdf.push(t.tableFqn);
    }
  }

  // --- Auto-Optimize ---
  const autoOptimize: string[] = [];
  const largeWithoutAutoOpt: string[] = [];
  const SIZE_THRESHOLD = 1_000_000_000; // 1 GB
  for (const t of deltaTables) {
    const props = safeParseObj(t.propertiesJson);
    const hasAutoOpt =
      props["delta.autoOptimize.optimizeWrite"] === "true" ||
      props["delta.autoOptimize.autoCompact"] === "true";
    if (hasAutoOpt) {
      autoOptimize.push(t.tableFqn);
    }
    const size = toNumber(t.sizeInBytes);
    if (size > SIZE_THRESHOLD && !hasAutoOpt) {
      largeWithoutAutoOpt.push(t.tableFqn);
    }
  }

  // --- Delta Protocol Versions ---
  const outdatedProtocol: string[] = [];
  for (const t of deltaTables) {
    const props = safeParseObj(t.propertiesJson);
    const readerV = parseInt(props["delta.minReaderVersion"] ?? "0", 10);
    if (readerV > 0 && readerV < 2) {
      outdatedProtocol.push(t.tableFqn);
    }
  }

  // --- Documentation & Governance ---
  const withoutDescription = tables
    .filter((t) => !t.comment && !t.generatedDescription)
    .map((t) => t.tableFqn);
  const withoutOwner = tables.filter((t) => !t.owner).map((t) => t.tableFqn);
  const withTags = tables
    .filter((t) => {
      const tags = safeParseArray(t.tagsJson);
      return tags.length > 0;
    })
    .map((t) => t.tableFqn);

  // --- Build findings ---
  const findings: FeatureAdoptionFinding[] = [];

  if (legacyPartition.length > 0 && deltaTables.length > 0) {
    const pct = Math.round((legacyPartition.length / deltaTables.length) * 100);
    findings.push({
      feature: "Liquid Clustering",
      category: "performance",
      severity: pct > 50 ? "high" : pct > 20 ? "medium" : "low",
      current: `${legacyPartition.length} tables (${pct}%) use legacy Hive-style partitioning. ${liquidClustering.length} tables already use liquid clustering.`,
      recommendation:
        "Migrate high-traffic tables from legacy partitioning to liquid clustering for automatic data layout optimization, faster queries, and elimination of partition-related small file problems.",
      tablesAffected: legacyPartition.length,
      tables: sample(legacyPartition),
    });
  }

  if (streamingWithoutCdf.length > 0) {
    findings.push({
      feature: "Change Data Feed (CDF)",
      category: "reliability",
      severity: "high",
      current: `${streamingWithoutCdf.length} tables with streaming writes do not have CDF enabled. ${cdfEnabled.length} tables have CDF enabled.`,
      recommendation:
        "Enable Change Data Feed on streaming tables to support incremental processing, CDC pipelines, and audit trails. This eliminates the need for full table scans to detect changes.",
      tablesAffected: streamingWithoutCdf.length,
      tables: sample(streamingWithoutCdf),
    });
  }

  if (largeWithoutAutoOpt.length > 0) {
    findings.push({
      feature: "Auto-Optimize",
      category: "performance",
      severity: largeWithoutAutoOpt.length > 10 ? "high" : "medium",
      current: `${largeWithoutAutoOpt.length} large tables (>1 GB) lack auto-optimize. ${autoOptimize.length} tables have auto-optimize enabled.`,
      recommendation:
        "Enable auto-optimize (optimizeWrite + autoCompact) on large tables to automatically compact small files during writes, reducing storage costs and improving query performance.",
      tablesAffected: largeWithoutAutoOpt.length,
      tables: sample(largeWithoutAutoOpt),
    });
  }

  if (outdatedProtocol.length > 0) {
    findings.push({
      feature: "Delta Protocol Upgrade",
      category: "performance",
      severity: "medium",
      current: `${outdatedProtocol.length} tables use Delta reader version 1. Modern features (deletion vectors, column mapping, liquid clustering) require version 2+.`,
      recommendation:
        "Upgrade Delta protocol versions to unlock deletion vectors, column mapping, and liquid clustering. Run ALTER TABLE ... SET TBLPROPERTIES for affected tables.",
      tablesAffected: outdatedProtocol.length,
      tables: sample(outdatedProtocol),
    });
  }

  if (withoutDescription.length > 0 && tables.length > 0) {
    const pct = Math.round((withoutDescription.length / tables.length) * 100);
    findings.push({
      feature: "Table Documentation",
      category: "governance",
      severity: pct > 50 ? "high" : pct > 20 ? "medium" : "low",
      current: `${withoutDescription.length} tables (${pct}%) have no description or comment. Undocumented tables are harder to discover and govern.`,
      recommendation:
        "Add COMMENT ON TABLE for undocumented tables. Use AI-generated descriptions from the estate scan as a starting point for documentation.",
      tablesAffected: withoutDescription.length,
      tables: sample(withoutDescription),
    });
  }

  if (withoutOwner.length > 0 && tables.length > 0) {
    const pct = Math.round((withoutOwner.length / tables.length) * 100);
    if (pct > 30) {
      findings.push({
        feature: "Table Ownership",
        category: "governance",
        severity: pct > 60 ? "high" : "medium",
        current: `${withoutOwner.length} tables (${pct}%) have no owner assigned in Unity Catalog.`,
        recommendation:
          "Assign owners to tables in Unity Catalog for clear accountability, incident response, and governance workflows.",
        tablesAffected: withoutOwner.length,
        tables: sample(withoutOwner),
      });
    }
  }

  if (tables.length > 0 && withTags.length < tables.length * 0.3) {
    const tagPct = Math.round((withTags.length / tables.length) * 100);
    findings.push({
      feature: "Unity Catalog Tags",
      category: "governance",
      severity: tagPct < 10 ? "high" : "medium",
      current: `Only ${withTags.length} tables (${tagPct}%) have Unity Catalog tags applied.`,
      recommendation:
        "Apply UC tags (sensitivity, domain, data classification) to improve discoverability, enforce access policies, and support automated governance workflows.",
      tablesAffected: tables.length - withTags.length,
      tables: sample(tables.filter((t) => !withTags.includes(t.tableFqn)).map((t) => t.tableFqn)),
    });
  }

  // --- Compute adoption score ---
  // Score based on how well the estate adopts modern features
  let score = 100;
  const total = Math.max(deltaTables.length, 1);

  // Deductions for each gap area
  if (legacyPartition.length > 0)
    score -= Math.min(20, Math.round((legacyPartition.length / total) * 20));
  if (streamingWithoutCdf.length > 0) score -= Math.min(15, streamingWithoutCdf.length * 3);
  if (largeWithoutAutoOpt.length > 0)
    score -= Math.min(15, Math.round((largeWithoutAutoOpt.length / total) * 15));
  if (outdatedProtocol.length > 0)
    score -= Math.min(10, Math.round((outdatedProtocol.length / total) * 10));
  if (withoutDescription.length > 0)
    score -= Math.min(15, Math.round((withoutDescription.length / tables.length) * 15));
  if (withoutOwner.length > 0)
    score -= Math.min(10, Math.round((withoutOwner.length / tables.length) * 10));
  if (withTags.length < tables.length * 0.5)
    score -= Math.min(15, Math.round(((tables.length - withTags.length) / tables.length) * 15));

  return {
    adoptionScore: Math.max(0, Math.min(100, score)),
    findings: findings.sort((a, b) => {
      const sev = { high: 0, medium: 1, low: 2 };
      return sev[a.severity] - sev[b.severity];
    }),
    stats: {
      totalTables: tables.length,
      deltaTableCount: deltaTables.length,
      liquidClusteringCount: liquidClustering.length,
      legacyPartitionCount: legacyPartition.length,
      unpartitionedCount: unpartitioned.length,
      cdfEnabledCount: cdfEnabled.length,
      streamingWithoutCdfCount: streamingWithoutCdf.length,
      autoOptimizeCount: autoOptimize.length,
      largeWithoutAutoOptimize: largeWithoutAutoOpt.length,
      outdatedProtocolCount: outdatedProtocol.length,
      tablesWithoutDescription: withoutDescription.length,
      tablesWithoutOwner: withoutOwner.length,
      tablesWithTags: withTags.length,
    },
  };
}
