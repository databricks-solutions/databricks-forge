/**
 * Estate Overview page types.
 * Extracted from app/environment/page.tsx for reuse across environment components.
 */

export interface CoverageEntry {
  ucPath: string;
  scanId: string;
  runId: string | null;
  tableCount: number;
  scannedAt: string;
}

export interface AggregateStats {
  totalTables: number;
  totalScans: number;
  totalSizeBytes: string;
  totalRows: string;
  domainCount: number;
  piiTablesCount: number;
  avgGovernanceScore: number;
  oldestScanAt: string | null;
  newestScanAt: string | null;
  /** Server-computed data maturity (real inputs, no client-side zeros). */
  maturity?: import("@/lib/domain/data-maturity").DataMaturityScore | null;
  assetInventory?: {
    models: number;
    functions: number;
    genieSpaces: number;
    dashboards: number;
    metricViews: number;
  };
  coverageByScope: CoverageEntry[];
}

export interface TableDetailRow {
  tableFqn: string;
  tableType: string | null;
  dataDomain: string | null;
  dataSubdomain: string | null;
  dataTier: string | null;
  format: string | null;
  owner: string | null;
  sizeInBytes: string | null;
  numRows: string | null;
  numFiles: number | null;
  isManaged: boolean;
  comment: string | null;
  generatedDescription: string | null;
  sensitivityLevel: string | null;
  governancePriority: string | null;
  governanceScore: number | null;
  lastModified: string | null;
  discoveredVia: string;
  /**
   * Storage-engine signals surfaced in the Domain Explorer tooltip. All
   * optional — the aggregate/single-scan reads spread the full
   * `ForgeTableDetail` row so these are present at runtime, but older mocks
   * and partial payloads may omit them.
   */
  clusteringColumns?: string | null;
  propertiesJson?: string | null;
  cdfEnabled?: boolean;
  autoOptimize?: boolean;
}

export interface InsightRow {
  insightType: string;
  tableFqn: string | null;
  payloadJson: string;
  severity: string;
}

export interface AggregateData {
  details: TableDetailRow[];
  insights: InsightRow[];
  stats: AggregateStats;
}

export interface SingleScanData {
  scanId: string;
  ucPath: string;
  tableCount: number;
  totalSizeBytes: string;
  totalRows: string;
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
  scanDurationMs: number | null;
  createdAt: string;
  runId: string | null;
  details: TableDetailRow[];
  insights: InsightRow[];
}

export interface ScanProgressData {
  scanId: string;
  phase: string;
  message: string;
  tablesFound: number;
  columnsFound: number;
  lineageTablesFound: number;
  lineageEdgesFound: number;
  enrichedCount: number;
  enrichTotal: number;
  llmPass: string | null;
  domainsFound: number;
  piiDetected: number;
  elapsedMs: number;
}

export type ViewMode = "aggregate" | "single-scan" | "new-scan";

export interface GovernanceQualityStats {
  avgConsultantReadiness: number | null;
  avgAssistantScore: number | null;
  releaseGatePassRate: number | null;
  benchmarkFreshnessRate: number | null;
  benchmarkIndustryCoverage: number | null;
}

export interface CoverageTableRow {
  tableFqn: string;
  domain: string | null;
  tier: string | null;
  sensitivityLevel: string | null;
  governanceScore: number | null;
  comment: string | null;
  generatedDescription: string | null;
  sizeInBytes: string | null;
  numRows: string | null;
  owner: string | null;
  useCases: Array<{
    id: string;
    name: string;
    type: string;
    domain: string;
    overallScore: number;
    runId: string;
  }>;
}

export interface TrendMetricRow {
  label: string;
  previous: number | string;
  current: number | string;
  changeLabel: string;
  direction: "up" | "down" | "stable";
  sentiment: "positive" | "negative" | "neutral";
}
