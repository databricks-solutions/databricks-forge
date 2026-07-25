/**
 * API: /api/connections
 *
 * GET  -- list all connections (summaries, no secrets)
 * POST -- create a new external connection
 */

import { NextRequest, NextResponse } from "next/server";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { listConnections, createConnection } from "@/lib/lakebase/connections";
import type { CreateConnectionInput } from "@/lib/connections/types";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { listAccessibleIds } from "@/lib/lakebase/acl";

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
    const view = (request.nextUrl.searchParams.get("view") ?? "all") as
      | "all"
      | "owned"
      | "shared";
    const sharedIds = view === "owned" ? [] : await listAccessibleIds(user.email, "connection");
    const connections = await listConnections(user.email, view, sharedIds);
    return NextResponse.json(connections, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list connections" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
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
    const body = (await request.json()) as CreateConnectionInput;

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (!body.tenantId?.trim() || !body.clientId?.trim() || !body.clientSecret?.trim()) {
      return NextResponse.json(
        { error: "tenantId, clientId, and clientSecret are required" },
        { status: 400 },
      );
    }
    if (!["fabric"].includes(body.connectorType)) {
      return NextResponse.json(
        { error: `Unsupported connector type: ${body.connectorType}` },
        { status: 400 },
      );
    }
    if (!["admin", "workspace"].includes(body.accessLevel)) {
      return NextResponse.json(
        { error: `accessLevel must be "admin" or "workspace"` },
        { status: 400 },
      );
    }

    const record = await createConnection(body, user.email, user.email);
    return NextResponse.json(record, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create connection" },
      { status: 500 },
    );
  }
}
