/**
 * API: /api/metric-views/[id]/repair
 *
 * POST -- Repair a single metric view proposal by re-running auto-fixes,
 * validation, and (if needed) LLM repair with the run's cached metadata.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import {
  getMetricViewProposalById,
  updateMetricViewProposal,
  updateDeploymentStatus,
} from "@/lib/lakebase/metric-view-proposals";
import { loadMetadataForRun } from "@/lib/lakebase/metadata-cache";
import {
  buildSchemaAllowlist,
  buildSchemaContextBlock,
  buildCompactColumnsBlock,
} from "@/lib/genie/schema-allowlist";
import {
  validateMetricViewYaml,
  nestSnowflakeJoins,
  qualifyNestedAliasRefs,
  autoRenameCollidingJoinAliases,
  autoRenameShadowedMeasures,
  autoRenameShadowedDimensions,
  autoFixMaterializationRefs,
  repairProposal,
  hasColumnErrors,
  validateMetricViewDefinitionWithProbes,
} from "@/lib/genie/passes/metric-view-proposals";
import { resolveEndpoint } from "@/lib/dbx/client";
import { logger } from "@/lib/logger";
import { loadMetricViewProposalOrRespond } from "@/lib/auth/route-guards";
import { logActivity } from "@/lib/lakebase/activity-log";
import { isMetricViewValidationDeployable } from "@/lib/metric-views/deployability";
import { definitionToLegacyText } from "@/lib/metric-views/legacy-adapter";
import { parseMetricViewYaml } from "@/lib/metric-views/parser";
import { evidenceFailed } from "@/lib/validation/evidence";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await loadMetricViewProposalOrRespond(request, id, "edit");
    if (!guard.ok) return guard.response;
    const proposal = guard.value.proposal;
    if (proposal.classification === "improve" || proposal.classification === "reuse") {
      return NextResponse.json(
        { error: "Reuse and improvement previews are immutable; regenerate the proposal." },
        { status: 409 },
      );
    }

    if (!proposal.runId) {
      return NextResponse.json(
        { error: "Cannot repair a standalone proposal (no run metadata available)" },
        { status: 400 },
      );
    }

    const metadata = await loadMetadataForRun(proposal.runId);
    if (!metadata) {
      return NextResponse.json(
        { error: "Metadata cache not found for this run. Cannot rebuild schema context." },
        { status: 404 },
      );
    }

    const allowlist = buildSchemaAllowlist(metadata);
    const tableFqns =
      proposal.sourceTables.length > 0 ? proposal.sourceTables : metadata.tables.map((t) => t.fqn);
    const schemaBlock = buildSchemaContextBlock(metadata, tableFqns);
    const columnsBlock = buildCompactColumnsBlock(metadata, tableFqns);

    // Step 1: Run deterministic auto-fixes on current YAML/DDL
    let yaml = nestSnowflakeJoins(proposal.yaml);
    let ddl = nestSnowflakeJoins(proposal.ddl);

    yaml = qualifyNestedAliasRefs(yaml);
    ddl = qualifyNestedAliasRefs(ddl);

    const aliasCollision = autoRenameCollidingJoinAliases(yaml, ddl, allowlist);
    yaml = aliasCollision.yaml;
    ddl = aliasCollision.ddl;

    const dimCollision = autoRenameShadowedDimensions(yaml, ddl);
    yaml = dimCollision.yaml;
    ddl = dimCollision.ddl;

    const shadowFix = autoRenameShadowedMeasures(yaml, ddl, allowlist);
    yaml = shadowFix.yaml;
    ddl = shadowFix.ddl;

    const matFix = autoFixMaterializationRefs(yaml, ddl);
    yaml = matFix.yaml;
    ddl = matFix.ddl;

    // Step 2: Validate after auto-fixes
    let validation = validateMetricViewYaml(yaml, ddl, allowlist);

    // Step 3: If still errored with column issues, attempt LLM repair
    if (validation.status === "error" && hasColumnErrors(validation.issues)) {
      logger.info("Repair: attempting LLM repair for metric view", {
        id,
        name: proposal.name,
        issues: validation.issues,
      });

      const endpoint = resolveEndpoint("sql");
      const repaired = await repairProposal(
        {
          name: proposal.name,
          description: proposal.description ?? "",
          yaml,
          ddl,
          sourceTables: proposal.sourceTables,
          hasJoins: proposal.hasJoins,
          hasFilteredMeasures: false,
          hasWindowMeasures: false,
          hasMaterialization: false,
          validationStatus: validation.status,
          validationIssues: validation.issues,
        },
        schemaBlock,
        columnsBlock,
        endpoint,
      );

      if (repaired) {
        yaml = nestSnowflakeJoins(repaired.yaml);
        ddl = nestSnowflakeJoins(repaired.ddl);
        yaml = qualifyNestedAliasRefs(yaml);
        ddl = qualifyNestedAliasRefs(ddl);

        const reAliasCollision = autoRenameCollidingJoinAliases(yaml, ddl, allowlist);
        yaml = reAliasCollision.yaml;
        ddl = reAliasCollision.ddl;

        const reDimCollision = autoRenameShadowedDimensions(yaml, ddl);
        yaml = reDimCollision.yaml;
        ddl = reDimCollision.ddl;

        const reShadow = autoRenameShadowedMeasures(yaml, ddl, allowlist);
        yaml = reShadow.yaml;
        ddl = reShadow.ddl;

        const reMatFix = autoFixMaterializationRefs(yaml, ddl);
        yaml = reMatFix.yaml;
        ddl = reMatFix.ddl;

        validation = validateMetricViewYaml(yaml, ddl, allowlist);
      }
    }

    // Step 4: Parse and canonicalize before any Release 1 runtime validation.
    // Only replace the YAML body so the explicit outer DDL target is preserved.
    let definition: ReturnType<typeof parseMetricViewYaml>;
    try {
      definition = parseMetricViewYaml(yaml, proposal.name);
      const canonical = definitionToLegacyText(definition, { originalDdl: ddl });
      yaml = canonical.yaml;
      ddl = canonical.ddl;
    } catch (error) {
      const message = `Metric view YAML could not be canonicalized: ${safeErrorMessage(error)}`;
      const parseEvidence = evidenceFailed(
        "metric_view_parse",
        "METRIC_VIEW_PARSE_FAILED",
        message,
      );
      await updateMetricViewProposal(id, {
        definition: null,
        yaml,
        ddl,
        validationStatus: "error",
        validationIssues: [message],
        validatorVersion: null,
        validationEvidence: [parseEvidence],
        validatedAt: null,
      });
      await logActivity("metric_view_validation_failed", {
        userId: guard.user.email,
        resourceId: id,
        metadata: {
          validationStatus: "error",
          issueCount: 1,
          validatorVersion: null,
          validatedAt: null,
        },
      });
      logger.warn("Metric view repair stopped at typed parse gate", {
        id,
        name: proposal.name,
        error: safeErrorMessage(error),
      });
      const updated = await getMetricViewProposalById(id);
      return NextResponse.json({ repaired: false, proposal: updated });
    }

    // Step 5: Run the complete Release 1 lifecycle against the canonical
    // definition: static checks, temporary create, MEASURE() probes, cleanup.
    const fullValidation = await validateMetricViewDefinitionWithProbes({
      yaml,
      ddl,
      allowlist,
    });

    // Step 6: Persist the repaired proposal
    await updateMetricViewProposal(id, {
      definition,
      yaml,
      ddl,
      validationStatus: fullValidation.status,
      validationIssues: fullValidation.issues,
      validatorVersion: fullValidation.validatorVersion,
      validationEvidence: fullValidation.evidence,
      validatedAt: fullValidation.validatedAt,
    });

    if (proposal.deploymentStatus === "failed") {
      await updateDeploymentStatus(id, "proposed");
    }

    const deployable = isMetricViewValidationDeployable({
      validationStatus: fullValidation.status,
      validatorVersion: fullValidation.validatorVersion,
      validatedAt: fullValidation.validatedAt,
      validationEvidence: fullValidation.evidence,
    });
    const repaired = deployable;
    await logActivity(
      deployable
        ? "metric_view_validated"
        : fullValidation.status === "unverified"
          ? "metric_view_validation_unverified"
          : "metric_view_validation_failed",
      {
        userId: guard.user.email,
        resourceId: id,
        metadata: {
          validationStatus: fullValidation.status,
          issueCount: fullValidation.issues.length,
          validatorVersion: fullValidation.validatorVersion,
          validatedAt: fullValidation.validatedAt,
        },
      },
    );
    logger.info("Metric view repair completed", {
      id,
      name: proposal.name,
      repaired,
      newStatus: fullValidation.status,
      issueCount: fullValidation.issues.length,
    });

    const updated = await getMetricViewProposalById(id);

    return NextResponse.json({ repaired, proposal: updated });
  } catch (err) {
    logger.error("Metric view repair endpoint error", { error: safeErrorMessage(err) });
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
