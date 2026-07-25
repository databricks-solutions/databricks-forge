/**
 * API: /api/metric-views/generate
 *
 * POST -- Standalone metric view generation. Builds metric view proposals
 * from UC metadata without requiring a full Genie engine or pipeline run.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { resolveEndpoint } from "@/lib/dbx/client";
import { listTables, listColumns, listForeignKeys } from "@/lib/queries/metadata";
import { buildSchemaAllowlist } from "@/lib/genie/schema-allowlist";
import { runMetricViewProposals } from "@/lib/genie/passes/metric-view-proposals";
import { deploymentTargetFromSchemaScope } from "@/lib/metric-views/legacy-adapter";
import { buildLightweightSeed } from "@/lib/metric-views/seed";
import { discoverExistingMetricViews } from "@/lib/metric-views/discovery";
import { saveMetricViewProposals } from "@/lib/lakebase/metric-view-proposals";
import { requireUser } from "@/lib/auth/route-user";
import { logger } from "@/lib/logger";
import type { MetadataSnapshot } from "@/lib/domain/types";
import type { JoinSpecInput } from "@/lib/metric-views/types";
import { logActivity } from "@/lib/lakebase/activity-log";
import { isMetricViewValidationDeployable } from "@/lib/metric-views/deployability";

interface RequestBody {
  schemaScope: string;
  tables?: string[];
  businessContext?: string;
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = (await request.json()) as RequestBody;
    const { schemaScope, tables: tableFilter } = body;

    if (!schemaScope || schemaScope.split(".").length < 2) {
      return NextResponse.json(
        { error: "schemaScope must be catalog.schema format" },
        { status: 400 },
      );
    }

    const [catalogName, schemaName] = schemaScope.split(".");
    const endpoint = resolveEndpoint("generation");

    // Build metadata snapshot from UC information_schema
    const tableInfos = await listTables(catalogName, schemaName);
    const columnInfos = await listColumns(catalogName, schemaName);
    const fks = await listForeignKeys(catalogName, schemaName).catch(() => []);

    const metadata: MetadataSnapshot = {
      cacheKey: `standalone_${schemaScope}_${Date.now()}`,
      ucPath: schemaScope,
      tables: tableInfos,
      columns: columnInfos,
      foreignKeys: fks,
      metricViews: [],

      tableCount: tableInfos.length,
      columnCount: columnInfos.length,
      cachedAt: new Date().toISOString(),
      lineageDiscoveredFqns: [],
    };

    // Filter to specific tables if requested
    const tableFqns = tableFilter?.length ? tableFilter : tableInfos.map((t) => t.fqn);

    const allowlist = buildSchemaAllowlist(metadata);

    // Build join specs from FK metadata
    const joinSpecs: JoinSpecInput[] = fks.map((fk) => ({
      leftTable: fk.tableFqn,
      rightTable: fk.referencedTableFqn,
      sql: `${fk.tableFqn.split(".").pop()}.${fk.columnName} = ${fk.referencedTableFqn.split(".").pop()}.${fk.referencedColumnName}`,
      relationshipType: "many_to_one" as const,
      source: "fk" as const,
      confidence: "high" as const,
    }));

    // Build lightweight seed (no LLM needed)
    const { measures, dimensions, columnEnrichments } = buildLightweightSeed(tableFqns, metadata);

    // Discover existing metric views (best-effort)
    const existingViews = await discoverExistingMetricViews([schemaScope]).catch(() => []);

    // Generate metric view proposals
    const deploymentTarget = deploymentTargetFromSchemaScope(schemaScope);
    const result = await runMetricViewProposals({
      domain: schemaScope,
      ...(deploymentTarget ? { deploymentTarget } : {}),
      tableFqns,
      metadata,
      allowlist,
      useCases: [],
      measures,
      dimensions,
      joinSpecs,
      columnEnrichments,
      endpoint,
    });

    // Tag proposals as "new" (standalone path doesn't have subdomain context for classification)
    const taggedProposals = result.proposals.map((p) => ({
      ...p,
      classification: "new" as const,
      rationale: "Standalone generation (no pipeline context).",
    }));

    // Persist proposals
    await saveMetricViewProposals(null, schemaScope, null, taggedProposals, user.email);
    const validCount = taggedProposals.filter(isMetricViewValidationDeployable).length;
    if (taggedProposals.length > 0) {
      const hasUnverified = taggedProposals.some(
        (proposal) => proposal.validationStatus === "unverified",
      );
      await logActivity(
        validCount === taggedProposals.length
          ? "metric_view_validated"
          : hasUnverified
            ? "metric_view_validation_unverified"
            : "metric_view_validation_failed",
        {
          userId: user.email,
          metadata: {
            schemaScope,
            proposalCount: taggedProposals.length,
            validCount,
          },
        },
      );
    }

    logger.info("Standalone metric view generation complete", {
      schemaScope,
      proposalCount: result.proposals.length,
    });

    return NextResponse.json({
      proposals: taggedProposals,
      schemaScope,
      tableCount: tableFqns.length,
      existingMetricViews: existingViews.length,
    });
  } catch (err) {
    logger.error("Standalone metric view generation failed", {
      error: safeErrorMessage(err),
    });
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
