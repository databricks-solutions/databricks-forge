/**
 * API: /api/environment/comments/generate
 *
 * POST -- Start comment generation for a job (fire-and-forget).
 *         Returns { jobId } immediately. Client polls
 *         /api/environment/comments/[jobId]/progress for status.
 *
 * Same pattern as /api/runs/[runId]/execute and /api/environment-scan.
 */

import { NextRequest, NextResponse } from "next/server";
import { loadCommentJobOrRespond } from "@/lib/auth/route-guards";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { safeErrorMessage } from "@/lib/error-utils";
import { getCommentJob, createCommentJob } from "@/lib/lakebase/comment-jobs";
import { generateComments } from "@/lib/ai/comment-generator";
import { isCommentOutputLanguage } from "@/lib/ai/comment-engine/types";
import { apiLogger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const log = apiLogger("/api/environment/comments/generate", "POST");
  try {
    const user = await requireUser(request);
    const body = await request.json();
    const {
      jobId,
      catalogs,
      schemas,
      tables,
      industryId,
      scanId,
      runId,
      businessContext,
      excludedSchemas,
      excludedTables,
      exclusionPatterns,
      outputLanguage,
    } = body;

    const validatedOutputLanguage = isCommentOutputLanguage(outputLanguage)
      ? outputLanguage
      : undefined;

    let effectiveJobId = jobId;
    if (!effectiveJobId) {
      if (!catalogs || !Array.isArray(catalogs) || catalogs.length === 0) {
        return NextResponse.json({ error: "catalogs required" }, { status: 400 });
      }
      const job = await createCommentJob({
        scopeJson: JSON.stringify({
          catalogs,
          schemas,
          tables,
          ...(excludedSchemas?.length && { excludedSchemas }),
          ...(excludedTables?.length && { excludedTables }),
          ...(exclusionPatterns?.length && { exclusionPatterns }),
        }),
        industryId,
        outputLanguage: validatedOutputLanguage,
        scanId,
        runId,
        ownerEmail: user.email,
      });
      effectiveJobId = job.id;
    } else {
      const existing = await getCommentJob(effectiveJobId);
      if (!existing) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }
    }

    const guard = await loadCommentJobOrRespond(request, effectiveJobId, "edit");
    if (!guard.ok) return guard.response;

    const job = await getCommentJob(effectiveJobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const scope = JSON.parse(job.scopeJson) as {
      catalogs: string[];
      schemas?: string[];
      tables?: string[];
      excludedSchemas?: string[];
      excludedTables?: string[];
      exclusionPatterns?: string[];
    };

    // Fire-and-forget -- do NOT await.
    // Progress is tracked via in-memory store, polled by the client.
    generateComments({
      jobId: effectiveJobId,
      catalogs: scope.catalogs,
      schemas: scope.schemas,
      tables: scope.tables,
      excludedSchemas: scope.excludedSchemas,
      excludedTables: scope.excludedTables,
      exclusionPatterns: scope.exclusionPatterns,
      industryId: job.industryId ?? undefined,
      businessContext: businessContext ?? undefined,
      outputLanguage: job.outputLanguage,
    }).catch((err) => {
      log.error("Generation failed", {
        jobId: effectiveJobId,
        error: err instanceof Error ? err.message : String(err),
        errorCategory: "generation_failed",
      });
    });

    return NextResponse.json({ jobId: effectiveJobId, status: "generating" });
  } catch (error) {
    if (error instanceof ForgeAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    log.error("Request failed", {
      error: safeErrorMessage(error),
      errorCategory: "internal_error",
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
