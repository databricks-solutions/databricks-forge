/**
 * API: /api/environment/comments/[jobId]/apply
 *
 * POST -- Apply accepted proposals as DDL to Unity Catalog
 */

import { NextRequest, NextResponse } from "next/server";
import { loadCommentJobOrRespond } from "@/lib/auth/route-guards";
import { safeErrorMessage } from "@/lib/error-utils";
import { getProposalsForJob } from "@/lib/lakebase/comment-proposals";
import { applyProposals } from "@/lib/ai/comment-applier";
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

    let toApply;
    if (all) {
      toApply = allProposals.filter((p) => p.status === "accepted");
    } else if (proposalIds && proposalIds.length > 0) {
      const idSet = new Set(proposalIds);
      toApply = allProposals.filter(
        (p) => idSet.has(p.id) && (p.status === "accepted" || p.status === "pending"),
      );
    } else {
      return NextResponse.json({ error: "Provide proposalIds or set all=true" }, { status: 400 });
    }

    if (toApply.length === 0) {
      return NextResponse.json({ error: "No eligible proposals to apply" }, { status: 400 });
    }

    const result = await applyProposals(jobId, toApply);

    logActivity("applied_comments", {
      resourceId: jobId,
      metadata: { applied: result.applied, failed: result.failed, skipped: result.skipped },
    });

    return NextResponse.json({
      applied: result.applied,
      failed: result.failed,
      errors: result.errors,
    });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
