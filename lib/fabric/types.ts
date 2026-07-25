/**
 * TypeScript types for Fabric / Power BI scan results.
 *
 * These types represent the normalized domain model used throughout the app.
 * The parser (parser.ts) converts raw API responses into these types.
 */

export interface FabricScanSummary {
  id: string;
  connectionId: string;
  accessLevel: "admin" | "workspace";
  status: "pending" | "scanning" | "completed" | "failed";
  workspaceCount: number;
  datasetCount: number;
  reportCount: number;
  measureCount: number;
  artifactCount: number;
  scanMode: "full" | "incremental";
  errorMessage: string | null;
  createdBy: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface FabricWorkspace {
  id: string;
  workspaceId: string;
  name: string;
  state: string | null;
  type: string | null;
}

export interface FabricColumn {
  name: string;
  dataType: string;
  isHidden?: boolean;
}

export interface FabricMeasure {
  name: string;
  expression: string;
  description?: string;
  isHidden?: boolean;
}

export interface FabricTable {
  name: string;
  columns: FabricColumn[];
  measures: FabricMeasure[];
  isHidden?: boolean;
  description?: string;
  source?: string;
}

export interface FabricRelationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  crossFilteringBehavior?: string;
}

export interface FabricDatasource {
  datasourceType: string;
  server?: string;
  database?: string;
  url?: string;
}

export interface FabricDataset {
  id: string;
  workspaceId: string;
  datasetId: string;
  name: string;
  configuredBy: string | null;
  tables: FabricTable[];
  measures: FabricMeasure[];
  relationships: FabricRelationship[];
  expressions: Array<{ name: string; expression: string; description?: string }>;
  roles: Array<{
    name: string;
    members: string[];
    tablePermissions: Array<{ name: string; filterExpression: string }>;
  }>;
  datasources: FabricDatasource[];
  sensitivityLabel: string | null;
}

export interface FabricReport {
  id: string;
  workspaceId: string;
  reportId: string;
  name: string;
  datasetId: string | null;
  reportType: string | null;
  tiles: Array<{ id: string; title: string; datasetId?: string; reportId?: string }>;
  sensitivityLabel: string | null;
}

export interface FabricArtifact {
  id: string;
  workspaceId: string;
  artifactId: string;
  artifactType: string;
  name: string;
  metadata: Record<string, unknown>;
}

export interface FabricScanDetail extends FabricScanSummary {
  workspaces: FabricWorkspace[];
  datasets: FabricDataset[];
  reports: FabricReport[];
  artifacts: FabricArtifact[];
}

export interface FabricScanProgress {
  scanId: string;
  status: "pending" | "scanning" | "completed" | "failed";
  message: string;
  percent: number;
  phase: string;
}
