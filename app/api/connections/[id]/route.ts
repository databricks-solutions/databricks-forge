/**
 * API: /api/connections/[id]
 *
 * GET    -- get connection detail (no secret)
 * PATCH  -- update connection (name, secret, workspace filter)
 * DELETE -- delete connection and all associated scans
 */

import { NextRequest, NextResponse } from "next/server";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { getConnection, updateConnection, deleteConnection } from "@/lib/lakebase/connections";
import type { UpdateConnectionInput } from "@/lib/connections/types";
import { loadResourceOrRespond } from "@/lib/auth/route-guards";
import { withPrisma } from "@/lib/prisma";
import { clearAclForResource } from "@/lib/lakebase/acl";

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function fetchConnectionOwner(id: string) {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeConnection.findUnique({
      where: { id },
      select: { ownerEmail: true },
    });
    return row ? row.ownerEmail : undefined;
  });
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    await ensureMigrated();
    const { id } = await params;
    const guard = await loadResourceOrRespond({
      request: req,
      resourceType: "connection",
      resourceId: id,
      fetchOwner: () => fetchConnectionOwner(id),
      mode: "read",
    });
    if (!guard.ok) return guard.response;
    const conn = await getConnection(id);
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    return NextResponse.json(conn, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to get connection" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    await ensureMigrated();
    const { id } = await params;
    const guard = await loadResourceOrRespond({
      request,
      resourceType: "connection",
      resourceId: id,
      fetchOwner: () => fetchConnectionOwner(id),
      mode: "edit",
    });
    if (!guard.ok) return guard.response;
    const body = (await request.json()) as UpdateConnectionInput;
    const updated = await updateConnection(id, body);
    if (!updated) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update connection" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    await ensureMigrated();
    const { id } = await params;
    const guard = await loadResourceOrRespond({
      request: req,
      resourceType: "connection",
      resourceId: id,
      fetchOwner: () => fetchConnectionOwner(id),
      mode: "edit",
    });
    if (!guard.ok) return guard.response;
    if (guard.permission !== "owner") {
      return NextResponse.json(
        { error: "Only the owner can delete a connection." },
        { status: 403 },
      );
    }
    const deleted = await deleteConnection(id);
    if (!deleted) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    await clearAclForResource("connection", id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete connection" },
      { status: 500 },
    );
  }
}
