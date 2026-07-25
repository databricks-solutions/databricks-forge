/**
 * API: /api/runs/[runId]/usecases/[usecaseId]
 *
 * PATCH -- update a use case's name, statement, tablesInvolved, or user-adjusted scores.
 * Allows inline editing and score adjustment before export.
 */

import { NextRequest, NextResponse } from "next/server";
import { isValidUUID, isSafeId } from "@/lib/validation";
import { safeErrorMessage } from "@/lib/error-utils";
import { withPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { computeOverallScore } from "@/lib/domain/scoring";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; usecaseId: string }> },
) {
  try {
    const { runId, usecaseId } = await params;

    logger.info("[api/runs/usecases] PATCH request", { runId, usecaseId });

    if (!isValidUUID(runId)) {
      logger.warn("[api/runs/usecases] Invalid run ID", { runId });
      return NextResponse.json({ error: `Invalid run ID: "${runId}"` }, { status: 400 });
    }
    if (!isSafeId(usecaseId)) {
      logger.warn("[api/runs/usecases] Invalid use case ID", { usecaseId });
      return NextResponse.json({ error: `Invalid use case ID: "${usecaseId}"` }, { status: 400 });
    }

    const body = await request.json();
    logger.info("[api/runs/usecases] PATCH body", { fields: Object.keys(body) });

    const errorResult = await withPrisma(async (prisma) => {
      const existing = await prisma.forgeUseCase.findFirst({
        where: { id: usecaseId, runId },
        select: {
          id: true,
          priorityScore: true,
          feasibilityScore: true,
          impactScore: true,
          userPriorityScore: true,
          userFeasibilityScore: true,
          userImpactScore: true,
        },
      });

      if (!existing) {
        logger.warn("[api/runs/usecases] Use case not found", { runId, usecaseId });
        return { error: "Use case not found", status: 404 } as const;
      }

      const updateData: {
        name?: string;
        statement?: string;
        tablesInvolved?: string;
        userPriorityScore?: number | null;
        userFeasibilityScore?: number | null;
        userImpactScore?: number | null;
        userOverallScore?: number | null;
        feedback?: string | null;
        feedbackAt?: Date | null;
      } = {};

      if (typeof body.name === "string" && body.name.trim()) {
        updateData.name = body.name.trim();
      }
      if (typeof body.statement === "string" && body.statement.trim()) {
        updateData.statement = body.statement.trim();
      }
      if (Array.isArray(body.tablesInvolved)) {
        updateData.tablesInvolved = JSON.stringify(body.tablesInvolved);
      }

      const validFeedback = ["accepted", "rejected", "dismissed"];
      if (typeof body.feedback === "string" && validFeedback.includes(body.feedback)) {
        updateData.feedback = body.feedback;
        updateData.feedbackAt = new Date();
      } else if (body.feedback === null) {
        updateData.feedback = null;
        updateData.feedbackAt = null;
      }

      if (body.resetScores === true) {
        updateData.userPriorityScore = null;
        updateData.userFeasibilityScore = null;
        updateData.userImpactScore = null;
        updateData.userOverallScore = null;
      } else {
        const scoreFields = [
          "userPriorityScore",
          "userFeasibilityScore",
          "userImpactScore",
          "userOverallScore",
        ] as const;

        for (const field of scoreFields) {
          if (field in body) {
            const val = body[field];
            if (val === null) {
              updateData[field] = null;
            } else if (typeof val === "number" && val >= 0 && val <= 1) {
              updateData[field] = Number(val.toFixed(3));
            }
          }
        }

        if (
          ("userPriorityScore" in body ||
            "userFeasibilityScore" in body ||
            "userImpactScore" in body) &&
          !("userOverallScore" in body)
        ) {
          const p =
            updateData.userPriorityScore ??
            existing.userPriorityScore ??
            existing.priorityScore ??
            0;
          const f =
            updateData.userFeasibilityScore ??
            existing.userFeasibilityScore ??
            existing.feasibilityScore ??
            0;
          updateData.userOverallScore = computeOverallScore(p, f);
        }
      }

      if (Object.keys(updateData).length === 0) {
        logger.warn("[api/runs/usecases] No valid fields to update", {
          runId,
          usecaseId,
          bodyKeys: Object.keys(body),
        });
        return { error: "No valid fields to update", status: 400 } as const;
      }

      await prisma.forgeUseCase.update({
        where: { id: usecaseId },
        data: updateData,
      });

      return null;
    });

    if (errorResult) {
      return NextResponse.json({ error: errorResult.error }, { status: errorResult.status });
    }

    logger.info("[api/runs/usecases] Use case updated", { runId, usecaseId });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("[api/runs/usecases] PATCH failed", { error: msg });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
