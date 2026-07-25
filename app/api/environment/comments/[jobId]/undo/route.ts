/**
 * API: /api/environment/comments/[jobId]/undo
 *
 * POST -- Undo previously applied proposals (restore original comments)
 */

import { NextRequest, NextResponse } from "next/server";
import { loadCommentJobOrRespond } from "@/lib/auth/route-guards";
import { safeErrorMessage } from "@/lib/error-utils";
import { getProposalsForJob } from "@/lib/lakebase/comment-proposals";
import { undoProposals } from "@/lib/ai/comment-applier";
import { logActivity } from "@/lib/lakebase/activity-log";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params;
    const guard = await loadCommentJobOrRespond(request, jobId, "edit");
    if (!guard.ok) return guard.response;

    const body = await request.json();
    const { proposalIds, all } = body as {
      proposalIds?: string[];
      all?: boolean;
    };

    const allProposals = await getProposalsForJob(jobId);

    let toUndo;
    if (all) {
      toUndo = allProposals.filter((p) => p.status === "applied");
    } else if (proposalIds && proposalIds.length > 0) {
      const idSet = new Set(proposalIds);
      toUndo = allProposals.filter((p) => idSet.has(p.id) && p.status === "applied");
    } else {
      return NextResponse.json({ error: "Provide proposalIds or set all=true" }, { status: 400 });
    }

    if (toUndo.length === 0) {
      return NextResponse.json({ error: "No applied proposals to undo" }, { status: 400 });
    }

    const result = await undoProposals(jobId, toUndo);

    logActivity("undone_comments", {
      resourceId: jobId,
      metadata: { undone: result.applied, failed: result.failed },
    });

    return NextResponse.json({
      undone: result.applied,
      failed: result.failed,
      errors: result.errors,
    });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
