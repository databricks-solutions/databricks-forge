/**
 * GET  /api/business-value/value-capture -- list value captures
 * POST /api/business-value/value-capture -- record actual value delivered
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import {
  createValueCapture,
  getValueCapturesForRun,
  deleteValueCapture,
} from "@/lib/lakebase/value-captures";
import { withPrisma } from "@/lib/prisma";
import type { ValueType } from "@/lib/domain/types";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { listAccessibleIds } from "@/lib/lakebase/acl";
import { loadRunOrRespond } from "@/lib/auth/route-guards";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
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
    const runId = req.nextUrl.searchParams.get("runId");

    if (runId) {
      const guard = await loadRunOrRespond(req, runId, "read");
      if (!guard.ok) return guard.response;
      const captures = await getValueCapturesForRun(runId);
      return NextResponse.json(captures, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }

    const accessibleRunIds = await listAccessibleIds(user.email, "run");
    const userRunIds = await withPrisma(async (prisma) =>
      (
        await prisma.forgeRun.findMany({
          where: {
            OR: [
              { ownerEmail: user.email },
              ...(accessibleRunIds.length > 0 ? [{ runId: { in: accessibleRunIds } }] : []),
            ],
          },
          select: { runId: true },
        })
      ).map((r) => r.runId),
    );

    const rawCaptures = await withPrisma(async (prisma) => {
      const captures = await prisma.forgeValueCapture.findMany({
        where: userRunIds.length > 0 ? { runId: { in: userRunIds } } : { runId: "__no_run__" },
        orderBy: { captureDate: "desc" },
        take: 500,
      });
      const ucIds = [...new Set(captures.map((c) => c.useCaseId))];
      const useCases =
        ucIds.length > 0
          ? await prisma.forgeUseCase.findMany({
              where: { id: { in: ucIds } },
              select: { id: true, name: true, domain: true },
            })
          : [];
      const ucMap = new Map(useCases.map((uc) => [uc.id, uc]));
      return captures.map((c) => ({
        ...c,
        useCaseName: ucMap.get(c.useCaseId)?.name ?? null,
        useCaseDomain: ucMap.get(c.useCaseId)?.domain ?? null,
      }));
    });

    return NextResponse.json(rawCaptures, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    logger.error("[api/business-value/value-capture] GET failed", { error: String(err) });
    return NextResponse.json({ error: "Failed to load value captures" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { runId, useCaseId, valueType, amount, currency, evidence, capturedBy } = body as {
      runId: string;
      useCaseId: string;
      valueType: ValueType;
      amount: number;
      currency?: string;
      evidence?: string;
      capturedBy?: string;
    };

    if (!runId || !useCaseId || !valueType || amount == null) {
      return NextResponse.json(
        { error: "runId, useCaseId, valueType, and amount are required" },
        { status: 400 },
      );
    }

    const guard = await loadRunOrRespond(req, runId, "edit");
    if (!guard.ok) return guard.response;

    const entry = await createValueCapture({
      runId,
      useCaseId,
      captureDate: new Date(),
      valueType,
      amount,
      currency,
      evidence,
      capturedBy: capturedBy ?? guard.user.email,
    });

    return NextResponse.json(entry, { status: 201 });
  } catch (err) {
    logger.error("[api/business-value/value-capture] POST failed", { error: String(err) });
    return NextResponse.json({ error: "Failed to record value" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    // Capture id-owned run first to authorize.
    const capture = await withPrisma(async (prisma) =>
      prisma.forgeValueCapture.findUnique({ where: { id }, select: { runId: true } }),
    );
    if (!capture) {
      return NextResponse.json({ error: "Value capture not found" }, { status: 404 });
    }
    const guard = await loadRunOrRespond(req, capture.runId, "edit");
    if (!guard.ok) return guard.response;

    await deleteValueCapture(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("[api/business-value/value-capture] DELETE failed", { error: String(err) });
    return NextResponse.json({ error: "Failed to delete value capture" }, { status: 500 });
  }
}
