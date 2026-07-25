/**
 * API: /api/fabric/migrate
 *
 * POST -- start a new migration (step 1: Gold schema proposal)
 * GET  -- list migrations
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { runGoldSchemaStep } from "@/lib/fabric/migration-orchestrator";
import { withPrisma } from "@/lib/prisma";
import { loadResourceOrRespond } from "@/lib/auth/route-guards";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { listAccessibleIds } from "@/lib/lakebase/acl";

export async function GET(request: NextRequest) {
  try {
    await ensureMigrated();
    const user = await requireUser(request);
    const sharedIds = await listAccessibleIds(user.email, "fabric_migration");
    const migrations = await withPrisma(async (prisma) => {
      return prisma.forgeFabricMigration.findMany({
        where: {
          OR: [{ ownerEmail: user.email }, { id: { in: sharedIds } }],
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
    });
    return NextResponse.json(migrations, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    if (err instanceof ForgeAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list migrations" },
      { status: 500 },
    );
  }
}

async function fetchFabricScanOwner(scanId: string) {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeFabricScan.findUnique({
      where: { id: scanId },
      select: { ownerEmail: true },
    });
    return row ? row.ownerEmail : undefined;
  });
}

export async function POST(request: NextRequest) {
  try {
    await ensureMigrated();
    const body = (await request.json()) as {
      scanId: string;
      targetCatalog: string;
      targetSchema: string;
      resourcePrefix?: string;
    };

    if (!body.scanId || !body.targetCatalog || !body.targetSchema) {
      return NextResponse.json(
        { error: "scanId, targetCatalog, and targetSchema are required" },
        { status: 400 },
      );
    }

    const guard = await loadResourceOrRespond({
      request,
      resourceType: "fabric_scan",
      resourceId: body.scanId,
      fetchOwner: () => fetchFabricScanOwner(body.scanId),
      mode: "edit",
    });
    if (!guard.ok) return guard.response;

    const migrationId = randomUUID();
    const state = await runGoldSchemaStep(
      migrationId,
      body.scanId,
      body.targetCatalog,
      body.targetSchema,
      body.resourcePrefix,
      guard.user.email,
    );

    return NextResponse.json(state, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start migration" },
      { status: 500 },
    );
  }
}
