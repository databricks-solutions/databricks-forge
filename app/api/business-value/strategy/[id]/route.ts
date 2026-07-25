/**
 * GET /api/business-value/strategy/[id]
 *
 * Returns a strategy document with alignments for the latest completed run.
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getStrategyDocument, getAlignmentsForStrategy } from "@/lib/lakebase/strategy-documents";
import { withPrisma } from "@/lib/prisma";
import { loadResourceOrRespond } from "@/lib/auth/route-guards";
import { listAccessibleIds } from "@/lib/lakebase/acl";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await loadResourceOrRespond({
      request: req,
      resourceType: "strategy_document",
      resourceId: id,
      fetchOwner: () =>
        withPrisma(async (prisma) => {
          const row = await prisma.forgeStrategyDocument.findUnique({
            where: { id },
            select: { ownerEmail: true },
          });
          return row ? row.ownerEmail : undefined;
        }),
      mode: "read",
    });
    if (!guard.ok) return guard.response;

    const doc = await getStrategyDocument(id);
    if (!doc) {
      return NextResponse.json({ error: "Strategy document not found" }, { status: 404 });
    }

    const accessibleRunIds = await listAccessibleIds(guard.user.email, "run");
    const latestRun = await withPrisma(async (prisma) => {
      return prisma.forgeRun.findFirst({
        where: {
          status: "completed",
          OR: [
            { ownerEmail: guard.user.email },
            ...(accessibleRunIds.length > 0 ? [{ runId: { in: accessibleRunIds } }] : []),
          ],
        },
        orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
        select: { runId: true },
      });
    });

    const alignments = latestRun ? await getAlignmentsForStrategy(id, latestRun.runId) : [];

    return NextResponse.json(
      { doc, alignments },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    logger.error("[api/business-value/strategy/[id]] GET failed", { error: String(err) });
    return NextResponse.json({ error: "Failed to load strategy document" }, { status: 500 });
  }
}
