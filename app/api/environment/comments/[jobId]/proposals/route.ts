/**
 * API: /api/environment/comments/[jobId]/proposals
 *
 * PATCH -- Bulk update proposal statuses (accept/reject/edit)
 */

import { NextRequest, NextResponse } from "next/server";
import { loadCommentJobOrRespond } from "@/lib/auth/route-guards";
import { safeErrorMessage } from "@/lib/error-utils";
import { updateProposalStatuses, type ProposalStatus } from "@/lib/lakebase/comment-proposals";

const VALID_STATUSES: ProposalStatus[] = [
  "pending",
  "accepted",
  "rejected",
  "applied",
  "undone",
  "failed",
];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params;
    const guard = await loadCommentJobOrRespond(request, jobId, "edit");
    if (!guard.ok) return guard.response;

    const body = await request.json();
    const { proposals } = body as {
      proposals: Array<{ id: string; status: ProposalStatus; editedComment?: string | null }>;
    };

    if (!Array.isArray(proposals) || proposals.length === 0) {
      return NextResponse.json({ error: "proposals array is required" }, { status: 400 });
    }

    for (const p of proposals) {
      if (!p.id || !p.status || !VALID_STATUSES.includes(p.status)) {
        return NextResponse.json(
          { error: `Invalid proposal update: id=${p.id}, status=${p.status}` },
          { status: 400 },
        );
      }
      if (p.editedComment != null && p.editedComment.length > 4000) {
        return NextResponse.json(
          { error: `Comment exceeds 4000 character limit for proposal ${p.id}` },
          { status: 400 },
        );
      }
    }

    await updateProposalStatuses(proposals);
    return NextResponse.json({ ok: true, updated: proposals.length });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
