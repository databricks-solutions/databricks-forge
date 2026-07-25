import { NextRequest, NextResponse } from "next/server";
import { isDemoModeEnabled } from "@/lib/demo/config";
import { listDemoSessions } from "@/lib/lakebase/demo-sessions";
import { logger } from "@/lib/logger";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { listAccessibleIds } from "@/lib/lakebase/acl";

export async function GET(req: NextRequest) {
  if (!(await isDemoModeEnabled())) {
    return NextResponse.json({ error: "Demo mode is not enabled" }, { status: 404 });
  }

  try {
    let user;
    try {
      user = await requireUser(req);
    } catch (e) {
      if (e instanceof ForgeAuthError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
    const view = (req.nextUrl.searchParams.get("view") ?? "all") as "all" | "owned" | "shared";
    const sharedIds = view === "owned" ? [] : await listAccessibleIds(user.email, "demo_session");
    const sessions = await listDemoSessions(user.email, view, sharedIds);
    return NextResponse.json(sessions, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    logger.error("[demo/sessions] Error", { error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
