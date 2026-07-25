/**
 * API: /api/fabric/migrate/[migrationId]
 *
 * GET  -- get migration state
 * POST -- execute next step (deploy-gold, metric-views, dashboards, genie)
 */

import { NextRequest, NextResponse } from "next/server";
import { ensureMigrated } from "@/lib/lakebase/schema";
import {
  getMigrationState,
  deployGoldTables,
  runMetricViewStep,
  runDashboardStep,
  runGenieStep,
} from "@/lib/fabric/migration-orchestrator";
import { withPrisma } from "@/lib/prisma";
import { loadResourceOrRespond } from "@/lib/auth/route-guards";

interface RouteParams {
  params: Promise<{ migrationId: string }>;
}

async function fetchMigrationOwner(migrationId: string) {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeFabricMigration.findUnique({
      where: { id: migrationId },
      select: { ownerEmail: true },
    });
    return row ? row.ownerEmail : undefined;
  });
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    await ensureMigrated();
    const { migrationId } = await params;
    const guard = await loadResourceOrRespond({
      request: req,
      resourceType: "fabric_migration",
      resourceId: migrationId,
      fetchOwner: () => fetchMigrationOwner(migrationId),
      mode: "read",
    });
    if (!guard.ok) return guard.response;

    const state = getMigrationState(migrationId);
    if (state) return NextResponse.json(state);

    const row = await withPrisma(async (prisma) => {
      return prisma.forgeFabricMigration.findUnique({ where: { id: migrationId } });
    });
    if (!row) {
      return NextResponse.json({ error: "Migration not found" }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to get migration" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    await ensureMigrated();
    const { migrationId } = await params;
    const guard = await loadResourceOrRespond({
      request,
      resourceType: "fabric_migration",
      resourceId: migrationId,
      fetchOwner: () => fetchMigrationOwner(migrationId),
      mode: "edit",
    });
    if (!guard.ok) return guard.response;
    const body = (await request.json()) as { action: string };

    switch (body.action) {
      case "deploy-gold": {
        const state = await deployGoldTables(migrationId);
        return NextResponse.json(state);
      }
      case "metric-views": {
        const state = await runMetricViewStep(migrationId);
        return NextResponse.json(state);
      }
      case "dashboards": {
        const state = await runDashboardStep(migrationId);
        return NextResponse.json(state);
      }
      case "genie": {
        const state = await runGenieStep(migrationId);
        return NextResponse.json(state);
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to execute migration step" },
      { status: 500 },
    );
  }
}
