/**
 * API: /api/environment/comments
 *
 * GET  -- List all comment jobs
 * POST -- Create a new comment job
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { listCommentJobs, createCommentJob } from "@/lib/lakebase/comment-jobs";
import { isCommentOutputLanguage } from "@/lib/ai/comment-engine/types";
import { logActivity } from "@/lib/lakebase/activity-log";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { listAccessibleIds } from "@/lib/lakebase/acl";

export async function GET(request: NextRequest) {
  try {
    let user;
    try {
      user = await requireUser(request);
    } catch (e) {
      if (e instanceof ForgeAuthError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
    const view = (request.nextUrl.searchParams.get("view") ?? "all") as
      | "all"
      | "owned"
      | "shared";
    const sharedIds = view === "owned" ? [] : await listAccessibleIds(user.email, "comment_job");
    const jobs = await listCommentJobs(user.email, view, sharedIds);
    return NextResponse.json(
      { jobs },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    let user;
    try {
      user = await requireUser(request);
    } catch (e) {
      if (e instanceof ForgeAuthError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
    const body = await request.json();
    const {
      catalogs,
      schemas,
      tables,
      industryId,
      scanId,
      runId,
      excludedSchemas,
      excludedTables,
      exclusionPatterns,
      outputLanguage,
    } = body;

    if (!catalogs || !Array.isArray(catalogs) || catalogs.length === 0) {
      return NextResponse.json({ error: "At least one catalog is required" }, { status: 400 });
    }

    const scopeJson = JSON.stringify({
      catalogs,
      schemas,
      tables,
      ...(excludedSchemas?.length && { excludedSchemas }),
      ...(excludedTables?.length && { excludedTables }),
      ...(exclusionPatterns?.length && { exclusionPatterns }),
    });
    const job = await createCommentJob({
      scopeJson,
      industryId: industryId ?? undefined,
      outputLanguage: isCommentOutputLanguage(outputLanguage) ? outputLanguage : undefined,
      scanId: scanId ?? undefined,
      runId: runId ?? undefined,
      ownerEmail: user.email,
    });

    logActivity("created_comment_job", {
      userId: user.email,
      resourceId: job.id,
      metadata: { catalogs, industryId },
    });

    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
