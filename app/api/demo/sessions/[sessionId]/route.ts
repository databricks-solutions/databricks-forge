import { NextResponse } from "next/server";
import { isDemoModeEnabled } from "@/lib/demo/config";
import {
  getDemoSession,
  getDemoSessionDataModel,
  getDemoSessionResearch,
} from "@/lib/lakebase/demo-sessions";
import { cleanupDemoSession } from "@/lib/demo/cleanup";
import { databricksSqlExecutor } from "@/lib/ports/defaults/databricks-sql-executor";
import { logger } from "@/lib/logger";
import { loadDemoSessionOrRespond } from "@/lib/auth/route-guards";
import { clearAclForResource } from "@/lib/lakebase/acl";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  if (!(await isDemoModeEnabled())) {
    return NextResponse.json({ error: "Demo mode is not enabled" }, { status: 404 });
  }

  const { sessionId } = await params;
  const guard = await loadDemoSessionOrRespond(request, sessionId, "read");
  if (!guard.ok) return guard.response;

  const session = await getDemoSession(sessionId);

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const [research, dataModel] = await Promise.all([
    getDemoSessionResearch(sessionId),
    getDemoSessionDataModel(sessionId),
  ]);

  return NextResponse.json({
    ...session,
    research,
    dateWindow: dataModel?.dateWindow ?? null,
    validationResults: dataModel?.validationResults ?? null,
    tableDesigns: dataModel?.designs ?? null,
    genieMode: dataModel?.genieMode ?? false,
    genieSpaceId: dataModel?.genieSpaceId ?? null,
    genieSpaceUrl: dataModel?.genieSpaceUrl ?? null,
    genieDeployError: dataModel?.genieDeployError ?? null,
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  if (!(await isDemoModeEnabled())) {
    return NextResponse.json({ error: "Demo mode is not enabled" }, { status: 404 });
  }

  const { sessionId } = await params;
  const guard = await loadDemoSessionOrRespond(request, sessionId, "edit");
  if (!guard.ok) return guard.response;
  if (guard.permission !== "owner") {
    return NextResponse.json(
      { error: "Only the owner can delete a demo session." },
      { status: 403 },
    );
  }

  try {
    const result = await cleanupDemoSession(sessionId, databricksSqlExecutor);
    await clearAclForResource("demo_session", sessionId);
    return NextResponse.json(result);
  } catch (err) {
    logger.error("[demo/sessions] Delete error", { sessionId, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
