/**
 * CRUD operations for AI Comment generation jobs -- backed by Lakebase (Prisma).
 */

import { withPrisma } from "@/lib/prisma";
import {
  DEFAULT_COMMENT_OUTPUT_LANGUAGE,
  type CommentOutputLanguage,
} from "@/lib/ai/comment-engine/types";

export type CommentJobStatus =
  | "draft"
  | "generating"
  | "ready"
  | "applying"
  | "completed"
  | "failed";

export interface CommentJob {
  id: string;
  scanId: string | null;
  runId: string | null;
  scopeJson: string;
  industryId: string | null;
  outputLanguage: CommentOutputLanguage;
  status: CommentJobStatus;
  tableCount: number;
  columnCount: number;
  appliedCount: number;
  errorMessage: string | null;
  ownerEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function createCommentJob(input: {
  scopeJson: string;
  industryId?: string;
  outputLanguage?: CommentOutputLanguage;
  scanId?: string;
  runId?: string;
  ownerEmail?: string | null;
}): Promise<CommentJob> {
  const owner = input.ownerEmail ? input.ownerEmail.toLowerCase().trim() : null;
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeCommentJob.create({
      data: {
        scopeJson: input.scopeJson,
        industryId: input.industryId ?? null,
        outputLanguage: input.outputLanguage ?? DEFAULT_COMMENT_OUTPUT_LANGUAGE,
        scanId: input.scanId ?? null,
        runId: input.runId ?? null,
        status: "draft",
        ownerEmail: owner,
      },
    });
    return row as CommentJob;
  });
}

export async function getCommentJob(jobId: string): Promise<CommentJob | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeCommentJob.findUnique({ where: { id: jobId } });
    return (row as CommentJob) ?? null;
  });
}

export async function listCommentJobs(
  userEmail?: string | null,
  viewMode: "all" | "owned" | "shared" = "all",
  sharedIds: string[] = [],
): Promise<CommentJob[]> {
  return withPrisma(async (prisma) => {
    const owner = userEmail ? userEmail.toLowerCase().trim() : null;
    const where: Record<string, unknown> = {};
    if (owner) {
      if (viewMode === "owned") {
        where.ownerEmail = owner;
      } else if (viewMode === "shared") {
        where.id = { in: sharedIds };
      } else {
        where.OR = [{ ownerEmail: owner }, { id: { in: sharedIds } }];
      }
    }
    const rows = await prisma.forgeCommentJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return rows as CommentJob[];
  });
}

export async function updateCommentJobStatus(
  jobId: string,
  status: CommentJobStatus,
  extra?: {
    tableCount?: number;
    columnCount?: number;
    appliedCount?: number;
    errorMessage?: string;
  },
): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeCommentJob.update({
      where: { id: jobId },
      data: {
        status,
        ...(extra?.tableCount !== undefined && { tableCount: extra.tableCount }),
        ...(extra?.columnCount !== undefined && { columnCount: extra.columnCount }),
        ...(extra?.appliedCount !== undefined && { appliedCount: extra.appliedCount }),
        ...(extra?.errorMessage !== undefined && { errorMessage: extra.errorMessage }),
      },
    });
  });
}

export async function deleteCommentJob(jobId: string): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeCommentJob.delete({ where: { id: jobId } });
  });
}
