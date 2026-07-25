import { NextResponse } from "next/server";
import { isDemoModeEnabled } from "@/lib/demo/config";
import { runDataEngine } from "@/lib/demo/data-engine/engine";
import {
  DEMO_GENIE_ROW_BAND,
  DEMO_GENIE_TABLE_BAND,
  DEMO_STANDARD_ROW_BAND,
} from "@/lib/demo/types";
import {
  startDataJob,
  completeDataJob,
  failDataJob,
  initTableList,
  updateTablePhase,
  updateDataJob,
} from "@/lib/demo/data-engine/engine-status";
import {
  getDemoSessionResearch,
  serializeDemoSessionDataModel,
  updateDemoSessionStatus,
} from "@/lib/lakebase/demo-sessions";
import { logActivity } from "@/lib/lakebase/activity-log";
import { logger } from "@/lib/logger";
import { loadDemoSessionOrRespond } from "@/lib/auth/route-guards";

export async function POST(request: Request) {
  if (!(await isDemoModeEnabled())) {
    return NextResponse.json({ error: "Demo mode is not enabled" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const {
      sessionId,
      catalog,
      schema,
      catalogCreated: _catalogCreated = false,
      targetRowCount,
      genieMode = false,
    } = body as {
      sessionId: string;
      catalog: string;
      schema: string;
      catalogCreated?: boolean;
      targetRowCount?: { min: number; max: number };
      genieMode?: boolean;
    };

    if (!sessionId || !catalog || !schema) {
      return NextResponse.json(
        { error: "sessionId, catalog, and schema are required" },
        { status: 400 },
      );
    }

    const guard = await loadDemoSessionOrRespond(request, sessionId, "edit");
    if (!guard.ok) return guard.response;

    const research = await getDemoSessionResearch(sessionId);
    if (!research) {
      return NextResponse.json(
        { error: "Research not found for session" },
        { status: 404 },
      );
    }

    // Genie Mode widens the default row + table bands so the resulting
    // Genie Space has enough data to look production-grade.
    const resolvedRowCount =
      targetRowCount ?? (genieMode ? { ...DEMO_GENIE_ROW_BAND } : { ...DEMO_STANDARD_ROW_BAND });
    const resolvedTableCount = genieMode ? { ...DEMO_GENIE_TABLE_BAND } : undefined;

    // IMPORTANT: Capture OBO token NOW, in request context. The background
    // closure below runs outside any request, so header access is lost.
    // Genie Space creation REQUIRES the user's OBO token (see AGENTS.md).
    const oboToken =
      request.headers.get("x-forwarded-access-token") ??
      request.headers.get("X-Forwarded-Access-Token") ??
      undefined;

    await updateDemoSessionStatus(sessionId, "generating", {
      catalogName: catalog,
      schemaName: schema,
      tablesJson: JSON.stringify([]),
    });

    const controller = await startDataJob(sessionId);

    // Fire-and-forget
    (async () => {
      try {
        const result = await runDataEngine({
          sessionId,
          research,
          catalog,
          schema,
          targetRowCount: resolvedRowCount,
          targetTableCount: resolvedTableCount,
          genieMode,
          oboToken,
          ownerEmail: guard.user.email,
          signal: controller.signal,
          onProgress: (message, percent) => {
            updateDataJob(sessionId, message, percent);
          },
          onTablePhase: (tableName, phase) => {
            updateTablePhase(sessionId, tableName, phase);
          },
          onTablesReady: (tables) => {
            initTableList(
              sessionId,
              tables.map((t) => ({ tableName: t.name })),
            );
          },
        });

        const tableFqns = result.tables.map((t) => t.fqn);

        await updateDemoSessionStatus(sessionId, "completed", {
          dataModelJson: serializeDemoSessionDataModel(
            result.designs,
            result.dateWindow,
            result.validationSummary,
            {
              genieMode,
              genieSpaceId: result.genieSpaceId,
              genieSpaceUrl: result.genieSpaceUrl,
              genieDeployError: result.genieDeployError,
            },
          ),
          tablesJson: JSON.stringify(tableFqns),
          catalogName: catalog,
          schemaName: schema,
          tablesCreated: result.totalTables,
          totalRows: result.totalRows,
          durationMs: result.durationMs,
          completedAt: new Date(),
        });

        await completeDataJob(sessionId);
        await logActivity("demo_generate", {
          userId: guard.user.email,
          resourceId: sessionId,
          metadata: {
            catalog,
            schema,
            tables: result.totalTables,
            rows: result.totalRows,
            durationMs: result.durationMs,
            genieMode,
          },
        });
        if (result.genieSpaceId) {
          await logActivity("demo_genie_space_deployed", {
            userId: guard.user.email,
            resourceId: sessionId,
            metadata: {
              catalog,
              schema,
              spaceId: result.genieSpaceId,
              spaceUrl: result.genieSpaceUrl,
            },
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("[demo/generate] Engine failed", { sessionId, error: msg });
        await failDataJob(sessionId, msg);
        await updateDemoSessionStatus(sessionId, "failed", { errorMessage: msg });
      }
    })();

    return NextResponse.json({ sessionId });
  } catch (err) {
    logger.error("[demo/generate] Request error", { error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
