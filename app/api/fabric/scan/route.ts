/**
 * API: /api/fabric/scan
 *
 * GET  -- list all scans (optionally filtered by connectionId)
 * POST -- trigger a new Fabric scan for a given connection
 */

import { NextRequest, NextResponse } from "next/server";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { getConnection } from "@/lib/lakebase/connections";
import { listFabricScans } from "@/lib/lakebase/fabric-scans";
import { runFabricScan } from "@/lib/fabric/scan-orchestrator";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { listAccessibleIds } from "@/lib/lakebase/acl";
import { loadResourceOrRespond } from "@/lib/auth/route-guards";
import { withPrisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    await ensureMigrated();
    let user;
    try {
      user = await requireUser(request);
    } catch (e) {
      if (e instanceof ForgeAuthError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
    const connectionId = request.nextUrl.searchParams.get("connectionId") ?? undefined;
    const view = (request.nextUrl.searchParams.get("view") ?? "all") as
      | "all"
      | "owned"
      | "shared";
    const sharedIds = view === "owned" ? [] : await listAccessibleIds(user.email, "scan");
    const scans = await listFabricScans(connectionId, user.email, view, sharedIds);
    return NextResponse.json(scans, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list scans" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureMigrated();
    const body = (await request.json()) as { connectionId: string; incremental?: boolean };

    if (!body.connectionId) {
      return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
    }

    const guard = await loadResourceOrRespond({
      request,
      resourceType: "connection",
      resourceId: body.connectionId,
      fetchOwner: () =>
        withPrisma(async (prisma) => {
          const row = await prisma.forgeConnection.findUnique({
            where: { id: body.connectionId },
            select: { ownerEmail: true },
          });
          return row ? row.ownerEmail : undefined;
        }),
      mode: "edit",
    });
    if (!guard.ok) return guard.response;

    const conn = await getConnection(body.connectionId);
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const scanId = await runFabricScan(conn, guard.user.email, body.incremental, guard.user.email);
    return NextResponse.json({ scanId }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start scan" },
      { status: 500 },
    );
  }
}
