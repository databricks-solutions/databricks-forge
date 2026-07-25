/**
 * Normalizes raw Fabric/PBI API responses into domain types.
 *
 * Both Admin Scanner and per-workspace API responses are converted to
 * the same FabricDataset / FabricReport / FabricWorkspace types.
 */

import type {
  FabricWorkspace,
  FabricDataset,
  FabricReport,
  FabricArtifact,
  FabricTable,
  FabricColumn,
  FabricMeasure,
  FabricRelationship,
  FabricDatasource,
} from "./types";

// ---------------------------------------------------------------------------
// Admin Scanner result parser
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseAdminScanResult(raw: Record<string, any>): {
  workspaces: FabricWorkspace[];
  datasets: FabricDataset[];
  reports: FabricReport[];
  artifacts: FabricArtifact[];
  measureCount: number;
} {
  const workspaces: FabricWorkspace[] = [];
  const datasets: FabricDataset[] = [];
  const reports: FabricReport[] = [];
  const artifacts: FabricArtifact[] = [];
  let measureCount = 0;

  for (const ws of raw.workspaces ?? []) {
    workspaces.push({
      id: "",
      workspaceId: ws.id ?? "",
      name: ws.name ?? "",
      state: ws.state ?? null,
      type: ws.type ?? null,
    });

    for (const ds of ws.datasets ?? []) {
      const parsed = parseDataset(ds, ws.id);
      datasets.push(parsed);
      measureCount += parsed.measures.length;
    }

    for (const rep of ws.reports ?? []) {
      reports.push(parseReport(rep, ws.id));
    }

    for (const dash of ws.dashboards ?? []) {
      reports.push({
        id: "",
        workspaceId: ws.id,
        reportId: dash.id ?? "",
        name: dash.displayName ?? dash.name ?? "",
        datasetId: null,
        reportType: "Dashboard",
        tiles: (dash.tiles ?? []).map((t: any) => ({
          id: t.id ?? "",
          title: t.title ?? "",
          datasetId: t.datasetId,
          reportId: t.reportId,
        })),
        sensitivityLabel: dash.sensitivityLabel?.labelId ?? null,
      });
    }

    for (const df of ws.dataflows ?? []) {
      artifacts.push({
        id: "",
        workspaceId: ws.id,
        artifactId: df.objectId ?? df.id ?? "",
        artifactType: "Dataflow",
        name: df.name ?? "",
        metadata: { configuredBy: df.configuredBy, description: df.description },
      });
    }

    for (const dm of ws.datamarts ?? []) {
      artifacts.push({
        id: "",
        workspaceId: ws.id,
        artifactId: dm.id ?? "",
        artifactType: dm.type ?? "Datamart",
        name: dm.name ?? "",
        metadata: { configuredBy: dm.configuredBy, description: dm.description },
      });
    }
  }

  return { workspaces, datasets, reports, artifacts, measureCount };
}

function parseDataset(ds: any, workspaceId: string): FabricDataset {
  const tables: FabricTable[] = [];
  const allMeasures: FabricMeasure[] = [];

  for (const t of ds.tables ?? []) {
    const columns: FabricColumn[] = (t.columns ?? []).map((c: any) => ({
      name: c.name ?? "",
      dataType: c.dataType ?? "String",
      isHidden: c.isHidden ?? false,
    }));

    const measures: FabricMeasure[] = (t.measures ?? []).map((m: any) => ({
      name: m.name ?? "",
      expression: m.expression ?? "",
      description: m.description ?? undefined,
      isHidden: m.isHidden ?? false,
    }));

    allMeasures.push(...measures);

    tables.push({
      name: t.name ?? "",
      columns,
      measures,
      isHidden: t.isHidden ?? false,
      description: t.description ?? undefined,
      source: t.source?.[0]?.expression ?? undefined,
    });
  }

  const relationships: FabricRelationship[] = (ds.relationships ?? []).map((r: any) => ({
    fromTable: r.fromTable ?? "",
    fromColumn: r.fromColumn ?? "",
    toTable: r.toTable ?? "",
    toColumn: r.toColumn ?? "",
    crossFilteringBehavior: r.crossFilteringBehavior ?? undefined,
  }));

  const datasources: FabricDatasource[] = [];
  for (const usage of ds.datasourceUsages ?? []) {
    if (usage.datasourceInstanceId) {
      datasources.push({ datasourceType: "reference", url: usage.datasourceInstanceId });
    }
  }

  return {
    id: "",
    workspaceId,
    datasetId: ds.id ?? "",
    name: ds.name ?? "",
    configuredBy: ds.configuredBy ?? null,
    tables,
    measures: allMeasures,
    relationships,
    expressions: (ds.expressions ?? []).map((e: any) => ({
      name: e.name ?? "",
      expression: e.expression ?? "",
      description: e.description ?? undefined,
    })),
    roles: (ds.roles ?? []).map((r: any) => ({
      name: r.name ?? "",
      members: (r.members ?? []).map((m: any) => m.memberName ?? ""),
      tablePermissions: (r.tablePermissions ?? []).map((tp: any) => ({
        name: tp.name ?? "",
        filterExpression: tp.filterExpression ?? "",
      })),
    })),
    datasources,
    sensitivityLabel: ds.sensitivityLabel?.labelId ?? null,
  };
}

function parseReport(rep: any, workspaceId: string): FabricReport {
  return {
    id: "",
    workspaceId,
    reportId: rep.id ?? "",
    name: rep.name ?? "",
    datasetId: rep.datasetId ?? null,
    reportType: rep.reportType ?? "PowerBIReport",
    tiles: [],
    sensitivityLabel: rep.sensitivityLabel?.labelId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Per-workspace API parser
// ---------------------------------------------------------------------------

export function parseWorkspaceDatasets(raw: any[], workspaceId: string): FabricDataset[] {
  return raw.map((ds) => parseDataset(ds, workspaceId));
}

export function parseWorkspaceReports(raw: any[], workspaceId: string): FabricReport[] {
  return raw.map((rep) => parseReport(rep, workspaceId));
}

/**
 * Parse per-workspace dashboards API response into FabricReport entries
 * with reportType "Dashboard", matching the admin scanner parser output.
 */
export function parseWorkspaceDashboards(raw: any[], workspaceId: string): FabricReport[] {
  return raw.map((dash) => ({
    id: "",
    workspaceId,
    reportId: dash.id ?? "",
    name: dash.displayName ?? dash.name ?? "",
    datasetId: null,
    reportType: "Dashboard",
    tiles: (dash.tiles ?? []).map((t: any) => ({
      id: t.id ?? "",
      title: t.title ?? "",
      datasetId: t.datasetId,
      reportId: t.reportId,
    })),
    sensitivityLabel: dash.sensitivityLabel?.labelId ?? null,
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */
