/**
 * API: /api/runs/[runId]/genie-engine/[domain]/metric-views
 *
 * POST -- Execute a metric view DDL statement to create the metric view
 *         in Databricks, then add it to the domain's serialized space
 *         as a data source metric view.
 */

import { NextRequest, NextResponse } from "next/server";
import { loadRunOrRespond } from "@/lib/auth/route-guards";
import { safeErrorMessage } from "@/lib/error-utils";
import { executeSQLWithToken } from "@/lib/dbx/sql";
import { withPrisma } from "@/lib/prisma";
import {
  getMetricViewProposalsByRunDomain,
  promoteMetricViewDeployment,
} from "@/lib/lakebase/metric-view-proposals";
import { logger } from "@/lib/logger";
import { isSafeId, validateDdl } from "@/lib/validation";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; domain: string }> },
) {
  try {
    const { runId, domain } = await params;
    if (!isSafeId(runId)) {
      return NextResponse.json({ error: "Invalid runId" }, { status: 400 });
    }
    const decodedDomain = decodeURIComponent(domain);

    const guard = await loadRunOrRespond(request, runId, "edit");
    if (!guard.ok) return guard.response;
    const oboToken = guard.user.oboToken;
    if (!oboToken) {
      return NextResponse.json(
        { error: "User authorization is required for metric view deployment" },
        { status: 401 },
      );
    }

    const body = (await request.json()) as {
      ddl: string;
      name: string;
      description?: string;
    };

    if (!body.ddl || !body.name) {
      return NextResponse.json({ error: "Missing required fields: ddl, name" }, { status: 400 });
    }

    try {
      validateDdl(body.ddl, /^\s*CREATE\s+/i, "Metric view DDL");
    } catch {
      return NextResponse.json(
        { error: "DDL does not appear to be a valid CREATE VIEW statement" },
        { status: 400 },
      );
    }

    await executeSQLWithToken(body.ddl, oboToken);

    logger.info("Metric view created via DDL", {
      runId,
      domain: decodedDomain,
      metricViewName: body.name,
    });

    // Extract the FQN from the DDL (CREATE OR REPLACE VIEW catalog.schema.name)
    const fqnMatch = body.ddl.match(
      /VIEW\s+(`?[a-zA-Z_]\w*`?\.`?[a-zA-Z_]\w*`?\.`?[a-zA-Z_]\w*`?)/i,
    );
    const metricViewFqn = fqnMatch ? fqnMatch[1].replace(/`/g, "") : body.name;

    const proposals = await getMetricViewProposalsByRunDomain(runId, decodedDomain);
    const match = proposals.find((p) => p.name.toLowerCase() === body.name.toLowerCase());
    if (match) {
      try {
        await promoteMetricViewDeployment(match.id, metricViewFqn);
      } catch (error) {
        logger.error("Metric view SQL succeeded but manifest promotion failed", {
          proposalId: match.id,
          metricViewFqn,
          error: safeErrorMessage(error),
        });
        return NextResponse.json(
          {
            success: false,
            deployed: true,
            manifestPromoted: false,
            metricViewFqn,
            error: `Metric view SQL succeeded but semantic manifest promotion failed: ${safeErrorMessage(error)}`,
          },
          { status: 502 },
        );
      }
    }

    // Add the metric view to the domain's serialized space (backward compat)
    await withPrisma(async (prisma) => {
      const rec = await prisma.forgeGenieRecommendation.findFirst({
        where: { runId, domain: decodedDomain },
      });

      if (rec) {
        try {
          const space = JSON.parse(rec.serializedSpace) as Record<string, unknown>;
          const dataSources = space.data_sources as Record<string, unknown[]> | undefined;

          if (dataSources) {
            const metricViews = (dataSources.metric_views ?? []) as Array<{
              identifier: string;
              description?: string[];
            }>;

            const alreadyExists = metricViews.some(
              (mv) => mv.identifier.toLowerCase() === metricViewFqn.toLowerCase(),
            );

            if (!alreadyExists) {
              metricViews.push({
                identifier: metricViewFqn,
                ...(body.description ? { description: [body.description] } : {}),
              });
              dataSources.metric_views = metricViews;

              const existingMvList: string[] = rec.metricViews
                ? (JSON.parse(rec.metricViews as string) as string[])
                : [];
              const updatedMvList = [...existingMvList, metricViewFqn];

              await prisma.forgeGenieRecommendation.update({
                where: { id: rec.id },
                data: {
                  serializedSpace: JSON.stringify(space),
                  metricViewCount: updatedMvList.length,
                  metricViews: JSON.stringify(updatedMvList),
                },
              });

              logger.info("Metric view added to serialized space", {
                runId,
                domain: decodedDomain,
                metricViewFqn,
              });
            }
          }
        } catch (parseErr) {
          logger.warn("Failed to update serialized space with new metric view", {
            error: parseErr instanceof Error ? parseErr.message : String(parseErr),
          });
        }
      }
    });

    return NextResponse.json({
      success: true,
      metricViewFqn,
      domain: decodedDomain,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Metric view deployment failed", {
      error: message,
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
