/**
 * API: POST /api/environment/comments/[jobId]/resync
 *
 * Fetches live table and column comments from Unity Catalog for a single
 * table and updates the `originalComment` field on matching proposals.
 * This lets the UI reflect the current state after applying or external edits.
 */

import { NextRequest, NextResponse } from "next/server";
import { loadCommentJobOrRespond } from "@/lib/auth/route-guards";
import { safeErrorMessage } from "@/lib/error-utils";
import { getCommentJob } from "@/lib/lakebase/comment-jobs";
import { getProposalsForTable, updateOriginalComments } from "@/lib/lakebase/comment-proposals";
import { fetchTableComments, listColumns } from "@/lib/queries/metadata";
import { validateFqn } from "@/lib/validation";
import { logger } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params;
    const guard = await loadCommentJobOrRespond(request, jobId, "edit");
    if (!guard.ok) return guard.response;

    const body = await request.json();
    const { tableFqn } = body;

    if (!tableFqn || typeof tableFqn !== "string") {
      return NextResponse.json({ error: "tableFqn is required" }, { status: 400 });
    }

    const safeFqn = validateFqn(tableFqn, "table");
    const parts = safeFqn.split(".");
    if (parts.length !== 3) {
      return NextResponse.json({ error: "tableFqn must be catalog.schema.table" }, { status: 400 });
    }

    const job = await getCommentJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const [catalog, schema, table] = parts;

    // Fetch live comments from UC in parallel
    const [tableComments, allColumns] = await Promise.all([
      fetchTableComments(catalog, schema),
      listColumns(catalog, schema),
    ]);

    const liveTableComment = tableComments.get(safeFqn) ?? null;
    const tableColumns = allColumns.filter(
      (c) => c.tableFqn.toLowerCase() === safeFqn.toLowerCase(),
    );
    const columnCommentMap = new Map(tableColumns.map((c) => [c.columnName, c.comment]));

    // Match proposals and build updates
    const proposals = await getProposalsForTable(jobId, tableFqn);
    const updates: Array<{ id: string; originalComment: string | null }> = [];

    for (const p of proposals) {
      if (!p.columnName) {
        updates.push({ id: p.id, originalComment: liveTableComment });
      } else {
        const liveComment = columnCommentMap.get(p.columnName) ?? null;
        updates.push({ id: p.id, originalComment: liveComment });
      }
    }

    await updateOriginalComments(updates);

    logger.info("[resync] Refreshed original comments from UC", {
      jobId,
      tableFqn,
      table,
      updated: updates.length,
    });

    return NextResponse.json({ updated: updates.length });
  } catch (error) {
    logger.error("[resync] Failed", { error });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
