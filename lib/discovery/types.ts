/**
 * Types for the asset discovery module.
 *
 * Represents existing customer resources (Genie spaces, dashboards,
 * metric views) discovered during pipeline runs or estate scans.
 */

// ---------------------------------------------------------------------------
// Discovered resources
// ---------------------------------------------------------------------------

export interface DiscoveredGenieSpace {
  spaceId: string;
  title: string;
  description: string | null;
  tables: string[];
  metricViews: string[];
  sampleQuestionCount: number;
  measureCount: number;
  filterCount: number;
  instructionLength: number;
  creatorEmail?: string;
  updatedAt?: string;
}

export interface DiscoveredDashboard {
  dashboardId: string;
  displayName: string;
  tables: string[];
  isPublished: boolean;
  datasetCount: number;
  widgetCount: number;
  creatorEmail?: string;
  updatedAt?: string;
  parentPath?: string;
  /** Typed design when discovery can prove the existing dashboard contract. */
  dashboardDesign?: import("@/lib/dashboard/design-ir").DashboardDesignV2;
  /** OBO-observed live serialized artifact bound to dashboardDesign. */
  liveSerializedFingerprint?: string;
}

export interface DiscoveredMetricView {
  fqn: string;
  catalog: string;
  schema: string;
  name: string;
  comment: string | null;
}

// ---------------------------------------------------------------------------
// Discovery result (output of the full scan)
// ---------------------------------------------------------------------------

export interface DiscoveryResult {
  genieSpaces: DiscoveredGenieSpace[];
  dashboards: DiscoveredDashboard[];
  metricViews: DiscoveredMetricView[];
  discoveredAt: string;
}

// ---------------------------------------------------------------------------
// Coverage analysis
// ---------------------------------------------------------------------------

export interface AssetCoverage {
  /** All table FQNs in scope */
  allTables: string[];
  /** table FQN -> list of Genie space IDs covering it */
  coveredByGenieSpaces: Record<string, string[]>;
  /** table FQN -> list of dashboard IDs covering it */
  coveredByDashboards: Record<string, string[]>;
  /** table FQN -> list of metric view FQNs covering it */
  coveredByMetricViews: Record<string, string[]>;
  /** Tables not covered by any analytics asset */
  uncoveredTables: string[];
  /** 0-100 percentage of tables covered by at least one asset */
  coveragePercent: number;
  /** High-level counts */
  genieSpaceCount: number;
  dashboardCount: number;
  metricViewCount: number;
}

// ---------------------------------------------------------------------------
// Recommendation type (new, enhancement, or replacement)
// ---------------------------------------------------------------------------

export type RecommendationType = "new" | "enhancement" | "replacement";
