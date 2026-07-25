/**
 * Fabric Migration Orchestrator.
 *
 * Coordinates the 4-step sequential migration pipeline:
 *   Step 1: Gold Schema — propose and deploy CREATE TABLE DDL
 *   Step 2: Metric Views — DAX→SQL + metric view generation via existing engine
 *   Step 3: Dashboards — PBI report hints → Lakeview dashboards via existing engine
 *   Step 4: Genie Spaces — Gold schema + measures → Genie via existing engine
 *
 * Each step deploys before the next begins so downstream steps validate
 * against live UC objects.
 */

import { logger } from "@/lib/logger";
import { proposeGoldSchema, type GoldTableProposal } from "./gold-proposer";
import { translateDaxMeasures, type DaxTranslation } from "./dax-to-sql";
import { getFabricScanDetail } from "@/lib/lakebase/fabric-scans";
import { executeSQL } from "@/lib/dbx/sql";
import { withPrisma } from "@/lib/prisma";
import type { FabricDataset } from "./types";
import type { NameMapping } from "./name-normalizer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MigrationStep = "gold_schema" | "metric_views" | "dashboards" | "genie_spaces";
export type ArtifactStatus = "pending" | "proposed" | "deployed" | "failed" | "skipped";

export interface RlsWarning {
  roleName: string;
  pbiTableName: string;
  ucTableName: string;
  filterExpression: string;
  members: string[];
  suggestedAction: string;
}

export interface MigrationState {
  id: string;
  scanId: string;
  targetCatalog: string;
  targetSchema: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  currentStep: MigrationStep | null;
  goldTables: Array<GoldTableProposal & { deployStatus: ArtifactStatus; error?: string }>;
  metricViews: Array<{ name: string; yaml: string; deployStatus: ArtifactStatus; error?: string }>;
  dashboards: Array<{
    name: string;
    id?: string;
    url?: string;
    deployStatus: ArtifactStatus;
    error?: string;
  }>;
  genieSpaces: Array<{
    name: string;
    id?: string;
    url?: string;
    deployStatus: ArtifactStatus;
    error?: string;
  }>;
  daxTranslations: DaxTranslation[];
  nameMapping: NameMapping[];
  rlsWarnings: RlsWarning[];
  warnings: string[];
  ownerEmail?: string | null;
}

// ---------------------------------------------------------------------------
// In-memory state (for polling)
// ---------------------------------------------------------------------------

const migrationStates = new Map<string, MigrationState>();

export function getMigrationState(migrationId: string): MigrationState | null {
  return migrationStates.get(migrationId) ?? null;
}

// ---------------------------------------------------------------------------
// Step 1: Gold Schema
// ---------------------------------------------------------------------------

export async function runGoldSchemaStep(
  migrationId: string,
  scanId: string,
  targetCatalog: string,
  targetSchema: string,
  resourcePrefix?: string,
  ownerEmail: string | null = null,
): Promise<MigrationState> {
  const scan = await getFabricScanDetail(scanId);
  if (!scan) throw new Error("Scan not found");

  const state: MigrationState = {
    id: migrationId,
    scanId,
    targetCatalog,
    targetSchema,
    status: "in_progress",
    currentStep: "gold_schema",
    goldTables: [],
    metricViews: [],
    dashboards: [],
    genieSpaces: [],
    daxTranslations: [],
    nameMapping: [],
    rlsWarnings: [],
    warnings: [],
    ownerEmail: ownerEmail ? ownerEmail.toLowerCase().trim() : null,
  };
  migrationStates.set(migrationId, state);

  try {
    const proposal = await proposeGoldSchema(scan.datasets, targetCatalog, targetSchema, {
      resourcePrefix,
    });
    state.goldTables = proposal.tables.map((t) => ({
      ...t,
      deployStatus: "proposed" as ArtifactStatus,
    }));
    state.nameMapping = proposal.nameMapping;
    state.warnings = proposal.warnings;
    state.rlsWarnings = extractRlsWarnings(scan.datasets, proposal.nameMapping);

    await persistMigrationState(state);
    return state;
  } catch (err) {
    state.status = "failed";
    state.warnings.push(
      `Gold schema proposal failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    migrationStates.set(migrationId, state);
    throw err;
  }
}

export async function deployGoldTables(migrationId: string): Promise<MigrationState> {
  const state = migrationStates.get(migrationId);
  if (!state) throw new Error("Migration not found");

  for (const table of state.goldTables) {
    if (table.deployStatus === "deployed" || table.deployStatus === "skipped") continue;
    try {
      await executeSQL(table.ddl, state.targetCatalog, state.targetSchema);
      table.deployStatus = "deployed";

      if (table.tagDdl) {
        try {
          await executeSQL(table.tagDdl, state.targetCatalog, state.targetSchema);
        } catch (tagErr) {
          state.warnings.push(
            `Sensitivity tag failed for ${table.ucTableName}: ${tagErr instanceof Error ? tagErr.message : String(tagErr)}`,
          );
          logger.warn("[migration] Sensitivity tag DDL failed (non-fatal)", {
            table: table.ucTableName,
            error: tagErr instanceof Error ? tagErr.message : String(tagErr),
          });
        }
      }
    } catch (err) {
      table.deployStatus = "failed";
      table.error = err instanceof Error ? err.message : String(err);
      logger.warn("[migration] Gold table deployment failed", {
        table: table.ucTableName,
        error: table.error,
      });
    }
  }

  await persistMigrationState(state);
  return state;
}

// ---------------------------------------------------------------------------
// Step 2: Metric Views (DAX→SQL + existing engine)
// ---------------------------------------------------------------------------

export async function runMetricViewStep(migrationId: string): Promise<MigrationState> {
  const state = migrationStates.get(migrationId);
  if (!state) throw new Error("Migration not found");

  state.currentStep = "metric_views";

  try {
    const scan = await getFabricScanDetail(state.scanId);
    if (!scan) throw new Error("Scan not found");

    const allMeasures = extractMeasures(scan.datasets);
    if (allMeasures.length === 0) {
      state.warnings.push("No DAX measures found to translate.");
      return state;
    }

    state.daxTranslations = await translateDaxMeasures(allMeasures, state.nameMapping);

    const successfulTranslations = state.daxTranslations.filter(
      (t) => t.confidence !== "low" || !t.sqlExpression.startsWith("/*"),
    );

    const deployedTables = state.goldTables
      .filter((t) => t.deployStatus === "deployed")
      .map((t) => `${state.targetCatalog}.${state.targetSchema}.${t.ucTableName}`);

    if (deployedTables.length > 0 && successfulTranslations.length > 0) {
      try {
        const { runAdHocGenieEngine } = await import("@/lib/genie/adhoc-engine");
        const result = await runAdHocGenieEngine({
          tables: deployedTables,
          ownerEmail: state.ownerEmail,
          config: {
            domain: "Migrated from Power BI",
            generateMetricViews: true,
          },
        });

        if (result.recommendation?.metricViews?.length) {
          for (const mv of result.recommendation.metricViews) {
            state.metricViews.push({
              name: typeof mv === "string" ? mv : "metric_view",
              yaml: typeof mv === "string" ? mv : JSON.stringify(mv),
              deployStatus: "proposed",
            });
          }
        }
      } catch (err) {
        logger.warn("[migration] Metric view engine call failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        state.warnings.push(
          `Metric view engine failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    await persistMigrationState(state);
    return state;
  } catch (err) {
    state.warnings.push(
      `Metric view step failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    await persistMigrationState(state);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Step 3: Dashboards (via existing engine)
// ---------------------------------------------------------------------------

export async function runDashboardStep(migrationId: string): Promise<MigrationState> {
  const state = migrationStates.get(migrationId);
  if (!state) throw new Error("Migration not found");

  state.currentStep = "dashboards";

  try {
    const scan = await getFabricScanDetail(state.scanId);
    if (!scan) throw new Error("Scan not found");

    const deployedTables = state.goldTables
      .filter((t) => t.deployStatus === "deployed")
      .map((t) => `${state.targetCatalog}.${state.targetSchema}.${t.ucTableName}`);

    if (deployedTables.length === 0) {
      state.warnings.push("No deployed Gold tables — skipping dashboard generation.");
      return state;
    }

    const { runAdHocDashboardEngine } = await import("@/lib/dashboard/adhoc-engine");

    for (const report of scan.reports) {
      try {
        const widgetDescriptions = report.tiles.map((t) => t.title).filter(Boolean);
        const result = await runAdHocDashboardEngine({
          tables: deployedTables,
          widgetDescriptions,
          domainHint: "Migrated from Power BI",
          title: `${report.name} (migrated)`,
          deploy: false,
        });

        state.dashboards.push({
          name: report.name,
          id: result.dashboardId,
          url: result.dashboardUrl,
          deployStatus: "proposed",
        });
      } catch (err) {
        logger.warn("[migration] Dashboard generation failed for report", {
          report: report.name,
          error: err instanceof Error ? err.message : String(err),
        });
        state.dashboards.push({
          name: report.name,
          deployStatus: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await persistMigrationState(state);
    return state;
  } catch (err) {
    state.warnings.push(
      `Dashboard step failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    await persistMigrationState(state);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Step 4: Genie Spaces (via existing engine)
// ---------------------------------------------------------------------------

export async function runGenieStep(migrationId: string): Promise<MigrationState> {
  const state = migrationStates.get(migrationId);
  if (!state) throw new Error("Migration not found");

  state.currentStep = "genie_spaces";

  try {
    const deployedTables = state.goldTables
      .filter((t) => t.deployStatus === "deployed")
      .map((t) => `${state.targetCatalog}.${state.targetSchema}.${t.ucTableName}`);

    if (deployedTables.length === 0) {
      state.warnings.push("No deployed Gold tables — skipping Genie space generation.");
      return state;
    }

    try {
      const { runAdHocGenieEngine } = await import("@/lib/genie/adhoc-engine");
      const result = await runAdHocGenieEngine({
        tables: deployedTables,
        ownerEmail: state.ownerEmail,
        config: { domain: "Migrated from Power BI" },
      });

      state.genieSpaces.push({
        name: result.recommendation?.title ?? "Migrated PBI Space",
        deployStatus: "proposed",
      });
    } catch (err) {
      logger.warn("[migration] Genie engine failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      state.genieSpaces.push({
        name: "Migrated PBI Space",
        deployStatus: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    state.status = "completed";
    state.currentStep = null;
    await persistMigrationState(state);
    return state;
  } catch (err) {
    state.warnings.push(`Genie step failed: ${err instanceof Error ? err.message : String(err)}`);
    await persistMigrationState(state);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractMeasures(
  datasets: FabricDataset[],
): Array<{ name: string; expression: string; tableName: string }> {
  const measures: Array<{ name: string; expression: string; tableName: string }> = [];
  for (const ds of datasets) {
    for (const table of ds.tables) {
      for (const m of table.measures) {
        measures.push({ name: m.name, expression: m.expression, tableName: table.name });
      }
    }
  }
  return measures;
}

function extractRlsWarnings(datasets: FabricDataset[], nameMapping: NameMapping[]): RlsWarning[] {
  const warnings: RlsWarning[] = [];
  const tableMap = new Map(
    nameMapping.filter((m) => m.source === "table").map((m) => [m.original, m.normalized]),
  );

  for (const ds of datasets) {
    for (const role of ds.roles) {
      if (!role.tablePermissions?.length) continue;
      for (const perm of role.tablePermissions) {
        if (!perm.filterExpression) continue;
        const ucTableName = tableMap.get(perm.name) ?? perm.name;
        warnings.push({
          roleName: role.name,
          pbiTableName: perm.name,
          ucTableName,
          filterExpression: perm.filterExpression,
          members: role.members ?? [],
          suggestedAction: `Create a UC row filter on \`${ucTableName}\` equivalent to: \`${perm.filterExpression}\``,
        });
      }
    }
  }

  return warnings;
}

async function persistMigrationState(state: MigrationState): Promise<void> {
  try {
    await withPrisma(async (prisma) => {
      await prisma.forgeFabricMigration.upsert({
        where: { id: state.id },
        create: {
          id: state.id,
          scanId: state.scanId,
          targetCatalog: state.targetCatalog,
          targetSchema: state.targetSchema,
          status: state.status,
          currentStep: state.currentStep,
          goldTablesJson: JSON.stringify(state.goldTables),
          metricViewsJson: JSON.stringify(state.metricViews),
          dashboardsJson: JSON.stringify(state.dashboards),
          genieSpacesJson: JSON.stringify(state.genieSpaces),
          nameMappingJson: JSON.stringify(state.nameMapping),
          rlsWarningsJson: state.rlsWarnings.length > 0 ? JSON.stringify(state.rlsWarnings) : null,
          ownerEmail: state.ownerEmail ?? null,
        },
        update: {
          status: state.status,
          currentStep: state.currentStep,
          goldTablesJson: JSON.stringify(state.goldTables),
          metricViewsJson: JSON.stringify(state.metricViews),
          dashboardsJson: JSON.stringify(state.dashboards),
          genieSpacesJson: JSON.stringify(state.genieSpaces),
          nameMappingJson: JSON.stringify(state.nameMapping),
          rlsWarningsJson: state.rlsWarnings.length > 0 ? JSON.stringify(state.rlsWarnings) : null,
          completedAt: state.status === "completed" ? new Date() : undefined,
        },
      });
    });
  } catch (err) {
    logger.warn("[migration] Failed to persist migration state", {
      id: state.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
