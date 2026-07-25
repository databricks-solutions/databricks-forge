/**
 * API: /api/metric-views/[id]/deploy
 *
 * POST -- Deploy a single metric view proposal to Unity Catalog.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import {
  promoteMetricViewDeployment,
  updateDeploymentStatus,
} from "@/lib/lakebase/metric-view-proposals";
import { deployAsset } from "@/lib/genie/deploy";
import { validateMetricViewTargetSchema } from "@/lib/metric-views/deploy-target";
import { logger } from "@/lib/logger";
import { loadMetricViewProposalOrRespond } from "@/lib/auth/route-guards";
import { logActivity } from "@/lib/lakebase/activity-log";
import { isMetricViewValidationDeployable } from "@/lib/metric-views/deployability";
import { IdentifierValidationError, validateFqn, validateIdentifier } from "@/lib/validation";
import { executeSQLWithToken } from "@/lib/dbx/sql";
import {
  applyMetricViewImproveDiff,
  fingerprintMetricViewDefinition,
  parseMetricViewImproveDiff,
} from "@/lib/metric-views/improve-diff";
import {
  buildMetricViewAlterStatement,
  parseMetricViewShowCreate,
} from "@/lib/metric-views/improve-alter";

async function promoteDeploymentOrPartialResponse(
  id: string,
  fqn: string,
): Promise<NextResponse | null> {
  try {
    await promoteMetricViewDeployment(id, fqn);
    return null;
  } catch (error) {
    logger.error("Metric view deployed but semantic manifest promotion failed", {
      id,
      fqn,
      error: safeErrorMessage(error),
    });
    return NextResponse.json(
      {
        deployed: true,
        manifestPromoted: false,
        fqn,
        error: `Metric view SQL succeeded but semantic manifest promotion failed: ${safeErrorMessage(error)}`,
      },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await loadMetricViewProposalOrRespond(request, id, "edit");
    if (!guard.ok) return guard.response;
    const body = (await request.json().catch(() => ({}))) as {
      targetSchema?: string;
      resourcePrefix?: string;
    };

    const proposal = guard.value.proposal;

    if (!isMetricViewValidationDeployable(proposal)) {
      return NextResponse.json(
        {
          error: "Cannot deploy a metric view without valid validation evidence",
          validationStatus: proposal.validationStatus,
          issues: proposal.validationIssues,
        },
        { status: 422 },
      );
    }

    if (proposal.classification === "reuse") {
      if (!proposal.existingFqn) {
        return NextResponse.json(
          { error: "Metric view reuse requires an exact existing FQN" },
          { status: 422 },
        );
      }
      validateFqn(proposal.existingFqn, "existing metric view");
      return NextResponse.json({
        deployed: false,
        reused: true,
        fqn: proposal.existingFqn,
      });
    }

    if (proposal.classification === "improve") {
      let improveDiff;
      try {
        improveDiff = parseMetricViewImproveDiff(proposal.improveDiff);
        if (
          !proposal.existingFqn ||
          !proposal.improveBaseDefinition ||
          !proposal.definition ||
          improveDiff.existingFqn.toLowerCase() !== proposal.existingFqn.toLowerCase()
        ) {
          throw new Error("missing binding");
        }
        const recomputed = applyMetricViewImproveDiff(proposal.improveBaseDefinition, improveDiff);
        if (
          fingerprintMetricViewDefinition(recomputed) !==
          fingerprintMetricViewDefinition(proposal.definition)
        ) {
          throw new Error("artifact drift");
        }
      } catch {
        return NextResponse.json(
          { error: "Metric view improvement binding is missing, corrupt, or drifted" },
          { status: 422 },
        );
      }
      validateFqn(proposal.existingFqn, "existing metric view");
      const parts = proposal.existingFqn.split(".");
      const quotedExistingFqn = parts.map((part) => `\`${part}\``).join(".");
      const oboToken = guard.user.oboToken;
      if (!oboToken) {
        return NextResponse.json(
          { error: "User authorization is required for metric view improvement" },
          { status: 401 },
        );
      }
      const deploySql = (sql: string) => executeSQLWithToken(sql, oboToken);
      try {
        const showCreate = await deploySql(`SHOW CREATE TABLE ${quotedExistingFqn}`);
        const liveDefinition = parseMetricViewShowCreate(showCreate, proposal.existingFqn);
        if (fingerprintMetricViewDefinition(liveDefinition) !== improveDiff.baseFingerprint) {
          throw new Error("The live metric view changed after this improvement was generated.");
        }
      } catch {
        return NextResponse.json(
          { error: "The live metric view base is missing, unreadable, or changed" },
          { status: 409 },
        );
      }
      const alter = buildMetricViewAlterStatement(proposal.existingFqn, proposal.definition!);
      try {
        await deploySql(alter);
      } catch {
        return NextResponse.json(
          {
            error: "Metric view update conflicted because the exact target changed or disappeared",
          },
          { status: 409 },
        );
      }
      const promotionFailure = await promoteDeploymentOrPartialResponse(id, proposal.existingFqn);
      if (promotionFailure) return promotionFailure;
      await logActivity("metric_view_deployed", {
        userId: guard.user.email,
        resourceId: id,
        metadata: { fqn: proposal.existingFqn, action: "improved" },
      });
      return NextResponse.json({ deployed: true, fqn: proposal.existingFqn });
    }
    const derivedSchema = body.targetSchema ?? proposal.schemaScope;
    const resourcePrefix = body.resourcePrefix;
    try {
      validateMetricViewTargetSchema(derivedSchema);
      if (resourcePrefix) validateIdentifier(resourcePrefix, "metric view resource prefix");
    } catch (error) {
      if (!(error instanceof IdentifierValidationError)) throw error;
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const oboToken = guard.user.oboToken;
    if (!oboToken) {
      return NextResponse.json(
        { error: "User authorization is required for metric view deployment" },
        { status: 401 },
      );
    }
    const deploySql = (sql: string) => executeSQLWithToken(sql, oboToken);
    const asset = { name: proposal.name, ddl: proposal.ddl };
    const result = await deployAsset(asset, derivedSchema, resourcePrefix, deploySql);

    if (result.deployed) {
      const promotionFailure = await promoteDeploymentOrPartialResponse(id, result.fqn);
      if (promotionFailure) return promotionFailure;
      await logActivity("metric_view_deployed", {
        userId: guard.user.email,
        resourceId: id,
        metadata: { fqn: result.fqn },
      });
      logger.info("Metric view proposal deployed", { id, fqn: result.fqn });

      return NextResponse.json({
        deployed: true,
        fqn: result.fqn,
      });
    } else {
      await updateDeploymentStatus(id, "failed");
      logger.warn("Metric view proposal deployment failed", { id, error: result.error });

      return NextResponse.json({ deployed: false, error: result.error }, { status: 422 });
    }
  } catch (err) {
    logger.error("Metric view deploy endpoint error", { error: safeErrorMessage(err) });
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
