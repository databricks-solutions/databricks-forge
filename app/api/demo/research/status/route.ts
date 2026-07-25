import { NextResponse } from "next/server";
import { isDemoModeEnabled } from "@/lib/demo/config";
import { getResearchJobStatus } from "@/lib/demo/research-engine/engine-status";
import { loadDemoSessionOrRespond } from "@/lib/auth/route-guards";

export async function GET(request: Request) {
  if (!(await isDemoModeEnabled())) {
    return NextResponse.json({ error: "Demo mode is not enabled" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const guard = await loadDemoSessionOrRespond(request, sessionId, "read");
  if (!guard.ok) return guard.response;

  const status = await getResearchJobStatus(sessionId);
  if (!status) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json(status, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
