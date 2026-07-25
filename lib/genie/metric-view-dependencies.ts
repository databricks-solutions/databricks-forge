/**
 * Metric View dependency validation for Genie space and dashboard deployment.
 *
 * Before deploying a Genie space or dashboard that references metric views,
 * this module checks whether all required metric views are deployed in Unity
 * Catalog. If any are missing but have proposals in the ForgeMetricViewProposal
 * table, it can auto-deploy them.
 */

import { executeSQL } from "@/lib/dbx/sql";
import {
  findMetricViewProposalsByFqn,
  promoteMetricViewDeployment,
  updateDeploymentStatus,
  type MetricViewAccessScope,
} from "@/lib/lakebase/metric-view-proposals";
import { deployAsset } from "./deploy";
import { logger } from "@/lib/logger";
import { validateFqn, validateIdentifier } from "@/lib/validation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DependencyCheckResult {
  allDeployed: boolean;
  missing: Array<{
    name: string;
    fqn: string;
    proposalId?: string;
    ddl?: string;
    /** FQN where the view already exists (different from referenced FQN). */
    existingFqn?: string;
  }>;
  deployed: string[];
}

export interface DeployDependenciesResult {
  deployed: string[];
  failed: Array<{
    fqn: string;
    error: string;
    deployed?: boolean;
    manifestPromoted?: boolean;
  }>;
}

type DeploySql = (sql: string) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Unity Catalog search
// ---------------------------------------------------------------------------

/**
 * Search Unity Catalog for a metric view by name within a catalog.
 * Returns the 3-part FQN if found, null otherwise.
 */
export async function searchMetricViewInCatalog(
  name: string,
  catalog: string,
): Promise<string | null> {
  try {
    const safeCatalog = validateIdentifier(catalog, "catalog");
    const safeName = name.replace(/'/g, "''");
    const sql = `
      SELECT table_catalog, table_schema, table_name
      FROM \`${safeCatalog}\`.information_schema.tables
      WHERE table_type = 'METRIC_VIEW'
        AND LOWER(table_name) = LOWER('${safeName}')
      LIMIT 1
    `;
    const result = await executeSQL(sql);
    if (result.rows.length > 0) {
      const [cat, sch, tbl] = result.rows[0];
      return `${cat}.${sch}.${tbl}`;
    }
    return null;
  } catch (err) {
    logger.debug("searchMetricViewInCatalog failed", { name, catalog, error: String(err) });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

function quoteValidatedFqn(fqn: string): string {
  return fqn
    .split(".")
    .map((part) => `\`${part}\``)
    .join(".");
}

/**
 * Check whether the required metric view FQNs are deployed in Unity Catalog.
 * For any missing, check if a proposal exists in the ForgeMetricViewProposal
 * table that could be auto-deployed. Also searches for views deployed at a
 * different FQN (by name) and populates `existingFqn` when found.
 */
export async function checkMetricViewDependencies(
  requiredFqns: string[],
  access: MetricViewAccessScope,
): Promise<DependencyCheckResult> {
  if (requiredFqns.length === 0) {
    return { allDeployed: true, missing: [], deployed: [] };
  }
  const safeRequiredFqns = requiredFqns.map((fqn) =>
    validateFqn(fqn, "metric view FQN"),
  );

  const deployed: string[] = [];
  const missingFqns: string[] = [];

  // Check each FQN via DESCRIBE TABLE (lightweight probe)
  for (const fqn of safeRequiredFqns) {
    try {
      await executeSQL(`DESCRIBE TABLE ${quoteValidatedFqn(fqn)}`);
      deployed.push(fqn);
    } catch {
      missingFqns.push(fqn);
    }
  }

  if (missingFqns.length === 0) {
    return { allDeployed: true, missing: [], deployed };
  }

  // Look up proposals for missing FQNs
  const proposals = await findMetricViewProposalsByFqn(missingFqns, access);
  const proposalByName = new Map(proposals.map((p) => [p.name.toLowerCase(), p]));

  const missing: DependencyCheckResult["missing"] = [];

  for (const fqn of missingFqns) {
    const name = fqn.split(".").pop()?.toLowerCase() ?? fqn;
    const proposal = proposalByName.get(name);

    let existingFqn: string | undefined;

    // If the proposal was already deployed elsewhere, use that FQN
    if (proposal?.deployedFqn) {
      try {
        const safeDeployedFqn = validateFqn(
          proposal.deployedFqn,
          "deployed metric view FQN",
        );
        await executeSQL(`DESCRIBE TABLE ${quoteValidatedFqn(safeDeployedFqn)}`);
        existingFqn = safeDeployedFqn;
      } catch {
        // deployedFqn is stale -- view no longer exists there
      }
    }

    // If still not found, search UC by name within the same catalog
    if (!existingFqn) {
      const catalog = fqn.split(".")[0];
      if (catalog && catalog !== name) {
        const found = await searchMetricViewInCatalog(name, catalog);
        if (found) existingFqn = found;
      }
    }

    missing.push({
      name: proposal?.name ?? name,
      fqn,
      proposalId: proposal?.id,
      ddl: proposal?.ddl,
      existingFqn,
    });
  }

  return {
    allDeployed: false,
    missing,
    deployed,
  };
}

// ---------------------------------------------------------------------------
// Auto-deploy
// ---------------------------------------------------------------------------

/**
 * Deploy missing metric views that have proposals with DDL available.
 * Skips any that don't have a proposal or whose DDL is missing.
 */
export async function ensureMetricViewsDeployed(
  requiredFqns: string[],
  access: MetricViewAccessScope,
  targetSchema: string | undefined,
  deploySql: DeploySql,
): Promise<DeployDependenciesResult> {
  const check = await checkMetricViewDependencies(requiredFqns, access);

  if (check.allDeployed) {
    return { deployed: check.deployed, failed: [] };
  }

  const deployed = [...check.deployed];
  const failed: DeployDependenciesResult["failed"] = [];

  for (const mv of check.missing) {
    if (!mv.ddl) {
      failed.push({ fqn: mv.fqn, error: "No DDL available — proposal not found" });
      continue;
    }

    try {
      // Derive schema from the FQN if no explicit target is provided
      const schema = targetSchema ?? mv.fqn.split(".").slice(0, 2).join(".");
      const result = await deployAsset(
        { name: mv.name, ddl: mv.ddl },
        schema,
        undefined,
        deploySql,
      );

      if (result.deployed) {
        if (mv.proposalId) {
          try {
            await promoteMetricViewDeployment(mv.proposalId, result.fqn);
          } catch (error) {
            failed.push({
              fqn: mv.fqn,
              deployed: true,
              manifestPromoted: false,
              error: `Metric view SQL succeeded but semantic manifest promotion failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
            continue;
          }
        }
        deployed.push(result.fqn);
        logger.info("Auto-deployed missing metric view dependency", { fqn: result.fqn });
      } else {
        const errorMsg = result.error ?? "Deploy returned false";
        failed.push({ fqn: mv.fqn, error: errorMsg });
        if (mv.proposalId) {
          await updateDeploymentStatus(mv.proposalId, "failed");
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      failed.push({ fqn: mv.fqn, error: errorMsg });
      logger.warn("Failed to auto-deploy metric view dependency", {
        fqn: mv.fqn,
        error: errorMsg,
      });
    }
  }

  return { deployed, failed };
}

// ---------------------------------------------------------------------------
// FQN extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract metric view FQNs referenced in a serialized space JSON.
 * Looks in data_sources.metric_views for identifiers.
 */
export function extractMetricViewFqnsFromSpace(serializedSpaceJson: string): string[] {
  try {
    const space = JSON.parse(serializedSpaceJson);
    const mvs = space?.data_sources?.metric_views;
    if (!Array.isArray(mvs)) return [];
    return mvs
      .map((mv: { identifier?: string }) => mv.identifier)
      .filter((id: unknown): id is string => typeof id === "string" && id.split(".").length >= 3);
  } catch {
    return [];
  }
}

/**
 * Extract metric view FQNs referenced in dashboard dataset SQL.
 * Looks for FROM / JOIN clauses referencing known metric view patterns.
 */
export function extractMetricViewFqnsFromSql(sql: string, knownMvFqns: string[]): string[] {
  if (knownMvFqns.length === 0) return [];

  const lowerSql = sql.toLowerCase();
  return knownMvFqns.filter((fqn) => lowerSql.includes(fqn.toLowerCase()));
}

// ---------------------------------------------------------------------------
// FQN rewriting (Lakeview dashboards + Genie spaces)
// ---------------------------------------------------------------------------

/**
 * Apply case-insensitive string replacements to every entry in an array.
 * Returns true if at least one replacement was made.
 */
function rewriteStringArray(
  arr: string[],
  entries: Array<[old: string, replacement: string]>,
): boolean {
  let changed = false;
  for (let i = 0; i < arr.length; i++) {
    let result = arr[i];
    for (const [oldRef, newFqn] of entries) {
      if (oldRef.toLowerCase() === newFqn.toLowerCase()) continue;
      const escaped = oldRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const replaced = result.replace(new RegExp(escaped, "gi"), newFqn);
      if (replaced !== result) {
        result = replaced;
        changed = true;
      }
    }
    arr[i] = result;
  }
  return changed;
}

/**
 * Rewrite metric view FQNs in a serialized Lakeview dashboard **or** Genie
 * space JSON.
 *
 * `rewrites` maps original references (FQN or bare name) to the actual
 * deployed FQN. Replacements are case-insensitive and applied to:
 *
 *  - **Dashboard**: every dataset's `queryLines`
 *  - **Genie space**: `data_sources.metric_views[].identifier` and
 *    `instructions.example_question_sqls[].sql[]`
 */
export function rewriteDashboardMetricViewFqns(
  serializedJson: string,
  rewrites: Record<string, string>,
): string {
  const entries = Object.entries(rewrites);
  if (entries.length === 0) return serializedJson;

  try {
    const parsed = JSON.parse(serializedJson);
    let changed = false;

    // --- Lakeview dashboard format: datasets[key].queryLines ---
    const datasets = parsed?.datasets;
    if (datasets && typeof datasets === "object") {
      for (const dsKey of Object.keys(datasets)) {
        const ds = datasets[dsKey];
        if (Array.isArray(ds?.queryLines)) {
          if (rewriteStringArray(ds.queryLines, entries)) changed = true;
        }
      }
    }

    // --- Genie space format: data_sources.metric_views[].identifier ---
    const metricViews = parsed?.data_sources?.metric_views;
    if (Array.isArray(metricViews)) {
      for (const mv of metricViews as Array<{ identifier?: string; description?: string[] }>) {
        if (typeof mv.identifier !== "string") continue;
        for (const [oldRef, newFqn] of entries) {
          if (oldRef.toLowerCase() === newFqn.toLowerCase()) continue;
          if (mv.identifier.toLowerCase() === oldRef.toLowerCase()) {
            mv.identifier = newFqn;
            changed = true;
            break;
          }
        }
      }
    }

    // --- Genie space format: instructions.example_question_sqls[].sql[] ---
    const exampleSqls = parsed?.instructions?.example_question_sqls;
    if (Array.isArray(exampleSqls)) {
      for (const eq of exampleSqls as Array<{ sql?: string[] }>) {
        if (Array.isArray(eq.sql)) {
          if (rewriteStringArray(eq.sql, entries)) changed = true;
        }
      }
    }

    if (!changed) return serializedJson;
    return JSON.stringify(parsed);
  } catch {
    logger.warn("Failed to parse serialized JSON for FQN rewriting");
    return serializedJson;
  }
}
