/**
 * Data Engine Pass 5: Genie Space Deployment
 *
 * Runs ONLY when Genie Mode is active and Pass 4 (validation) has produced
 * at least one healthy fact table. Generates a Genie Space via the fast
 * ad-hoc engine, creates it in Databricks using the USER's OBO token, and
 * immediately seeds ForgeGenieSpaceCache so the new space appears on
 * /genie without a manual sync.
 *
 * Failure here is NON-FATAL: the surrounding engine records the error on
 * `DataEngineResult.genieDeployError` and still returns a success result
 * for the data generation portion.
 */

import { createGenieSpace } from "@/lib/dbx/genie";
import { getConfig } from "@/lib/dbx/client";
import { runFastGenieEngine } from "@/lib/genie/adhoc-engine";
import { runHealthCheck } from "@/lib/genie/space-health-check";
import {
  upsertCachedSpaces,
  updateCachedSpaceDiscovery,
} from "@/lib/lakebase/genie-space-cache";
import { trackGenieSpaceCreated } from "@/lib/lakebase/genie-spaces";
import { randomUUID } from "crypto";
import type { Logger } from "@/lib/ports/logger";
import type { TableDesign } from "../../types";
import type { ResearchEngineResult } from "../../research-engine/types";
import type { TableResult } from "../types";

export interface GenieDeployInput {
  sessionId: string;
  catalog: string;
  schema: string;
  tableDesigns: TableDesign[];
  tableResults: TableResult[];
  research: ResearchEngineResult;
  oboToken?: string;
  /** Email of the demo session owner; used to tag the new Genie space row. */
  ownerEmail?: string | null;
  logger: Logger;
  signal?: AbortSignal;
  onProgress?: (msg: string, pct: number) => void;
}

export interface GenieDeployResult {
  spaceId: string;
  spaceUrl: string;
  title: string;
}

export async function runGenieDeploy(
  input: GenieDeployInput,
): Promise<GenieDeployResult> {
  const {
    sessionId,
    catalog,
    schema,
    tableDesigns,
    tableResults,
    research,
    oboToken,
    ownerEmail,
    logger: log,
    signal,
    onProgress,
  } = input;

  if (!oboToken) {
    throw new Error(
      "Genie Mode deploy requires an OBO token. The Genie Conversation + " +
        "create APIs must run as the logged-in user, not the service " +
        "principal. Capture `x-forwarded-access-token` in the API route " +
        "and thread it through `DataEngineInput.oboToken`.",
    );
  }

  // Only deploy with fact tables that actually loaded rows. A Genie Space
  // bound to failed tables would be useless to a demo audience.
  const successfulTableFqns = buildSuccessfulTableFqns(
    catalog,
    schema,
    tableDesigns,
    tableResults,
  );

  if (successfulTableFqns.length === 0) {
    throw new Error(
      "No successfully generated tables to bind to the Genie Space",
    );
  }

  onProgress?.("Generating Genie Space configuration...", 5);

  const scopeLabel = research.scope?.division ?? "Analytics";
  const title = buildSpaceTitle(research.customerName, scopeLabel);
  const description = buildSpaceDescription(research, schema);

  const fastResult = await runFastGenieEngine({
    tables: successfulTableFqns,
    signal,
    config: {
      title,
      description,
      domain: scopeLabel,
      autoTimePeriods: true,
      llmRefinement: true,
      qualityPreset: "balanced",
      mode: "fast",
      conversationSummary: buildConversationSummary(research),
    },
    onProgress: (msg, pct) => {
      onProgress?.(`Genie: ${msg}`, 5 + Math.floor(pct * 0.7));
    },
  });

  onProgress?.("Creating Genie Space in Databricks...", 80);

  const { warehouseId } = getConfig();
  const createResponse = await createGenieSpace({
    title: fastResult.recommendation.title,
    description: fastResult.recommendation.description,
    serializedSpace: fastResult.recommendation.serializedSpace,
    warehouseId,
    authMode: "obo", // OBO token must be used (see AGENTS.md).
    oboToken,
  });

  const spaceId = createResponse.space_id;
  const { host } = getConfig();
  const spaceUrl = `${host}/genie/rooms/${spaceId}`;

  log.info("Genie Space created", { spaceId, title: fastResult.recommendation.title });

  // ==========================================================================
  // Seed the local cache immediately so the /genie listing shows the new
  // space without a manual "Sync Spaces" action. This is a hard requirement
  // from the Genie Mode spec: the space must be visible straight after
  // deploy.
  // ==========================================================================
  try {
    await upsertCachedSpaces([
      {
        spaceId,
        title: fastResult.recommendation.title,
        description: fastResult.recommendation.description ?? null,
      },
    ]);

    // Compute a health score now so the listing can render the badge on
    // first paint.
    let healthScore: number | null = null;
    let healthReportJson: string | null = null;
    try {
      const parsedSpace = JSON.parse(fastResult.recommendation.serializedSpace);
      const report = runHealthCheck(parsedSpace);
      healthScore = Math.round(report.overallScore);
      healthReportJson = JSON.stringify(report);
    } catch (err) {
      log.warn("Genie cache: health check failed (non-fatal)", {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await updateCachedSpaceDiscovery(spaceId, {
      tableCount: fastResult.recommendation.tableCount,
      measureCount: fastResult.recommendation.measureCount,
      sampleQuestionCount: fastResult.recommendation.sampleQuestionCount,
      filterCount: fastResult.recommendation.filterCount,
      healthScore,
      healthReportJson,
      permissionDenied: false,
    });
  } catch (err) {
    // Cache seeding failure is non-fatal -- the space still exists in
    // Databricks and the next manual sync will pick it up.
    log.warn("Genie cache seed failed (non-fatal)", {
      sessionId,
      spaceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Also record this deployment in ForgeGenieSpace so it shows alongside
  // pipeline-run-generated spaces. `runId` is null because demo sessions
  // aren't pipeline runs.
  try {
    await trackGenieSpaceCreated(
      randomUUID(),
      spaceId,
      null,
      scopeLabel,
      fastResult.recommendation.title,
      { functions: [], metricViews: [], metadata: { promptVersion: "demo-genie-mode-v1" } },
      "obo",
      ownerEmail ?? null,
    );
  } catch (err) {
    log.warn("trackGenieSpaceCreated failed (non-fatal)", {
      sessionId,
      spaceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  onProgress?.("Genie Space deployed", 100);

  return {
    spaceId,
    spaceUrl,
    title: fastResult.recommendation.title,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSuccessfulTableFqns(
  catalog: string,
  schema: string,
  tableDesigns: TableDesign[],
  tableResults: TableResult[],
): string[] {
  const successful = new Set(
    tableResults.filter((r) => r.status === "completed").map((r) => r.name),
  );
  return tableDesigns
    .filter((t) => successful.has(t.name))
    .map((t) => `${catalog}.${schema}.${t.name}`);
}

function buildSpaceTitle(customerName: string, scope: string): string {
  const clean = scope.trim() || "Analytics";
  return `${customerName} -- ${clean} Demo`;
}

function buildSpaceDescription(
  research: ResearchEngineResult,
  schema: string,
): string {
  const industry = research.industryId;
  const division = research.scope?.division ?? "full enterprise";
  return (
    `Databricks Forge demo Genie Space for ${research.customerName} ` +
    `(${industry}, ${division}), bound to the auto-generated demo schema ` +
    `\`${schema}\`. Designed to answer analyst-level business questions ` +
    `directly from the Unity Catalog tables created in this demo session.`
  );
}

function buildConversationSummary(research: ResearchEngineResult): string {
  const priorities = [
    ...(research.companyProfile?.statedPriorities ?? []),
    ...(research.companyProfile?.inferredPriorities ?? []),
  ]
    .slice(0, 3)
    .map((p) => p.priority)
    .filter(Boolean)
    .join("; ");

  const focus =
    research.scope?.division
      ? `business unit ${research.scope.division}`
      : `full enterprise view`;

  return (
    `Demo Genie Space for ${research.customerName} in the ${research.industryId} ` +
    `industry (${focus}). ${priorities ? `Strategic priorities: ${priorities}.` : ""} ` +
    `The audience is an analyst running a sales demo, so favour clear aggregate ` +
    `measures, time-based slicing, and business-language column descriptions.`
  );
}
