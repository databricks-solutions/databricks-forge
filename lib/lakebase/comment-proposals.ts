/**
 * CRUD operations for AI Comment proposals -- backed by Lakebase (Prisma).
 */

import { withPrisma } from "@/lib/prisma";

export type ProposalStatus = "pending" | "accepted" | "rejected" | "applied" | "undone" | "failed";

export interface CommentProposal {
  id: string;
  jobId: string;
  tableFqn: string;
  columnName: string | null;
  originalComment: string | null;
  proposedComment: string;
  editedComment: string | null;
  status: ProposalStatus;
  errorMessage: string | null;
  appliedAt: Date | null;
  createdAt: Date;
}

export async function createProposals(
  jobId: string,
  proposals: Array<{
    tableFqn: string;
    columnName?: string | null;
    originalComment?: string | null;
    proposedComment: string;
  }>,
): Promise<number> {
  return withPrisma(async (prisma) => {
    const result = await prisma.forgeCommentProposal.createMany({
      data: proposals.map((p) => ({
        jobId,
        tableFqn: p.tableFqn,
        columnName: p.columnName ?? null,
        originalComment: p.originalComment ?? null,
        proposedComment: p.proposedComment,
      })),
    });
    return result.count;
  });
}

export async function getProposalsForJob(jobId: string): Promise<CommentProposal[]> {
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeCommentProposal.findMany({
      where: { jobId },
      orderBy: [{ tableFqn: "asc" }, { columnName: "asc" }],
    });
    return rows as CommentProposal[];
  });
}

export async function getProposalsForTable(
  jobId: string,
  tableFqn: string,
): Promise<CommentProposal[]> {
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeCommentProposal.findMany({
      where: { jobId, tableFqn },
      orderBy: { columnName: "asc" },
    });
    return rows as CommentProposal[];
  });
}

export async function updateProposalStatuses(
  updates: Array<{
    id: string;
    status: ProposalStatus;
    editedComment?: string | null;
  }>,
): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.$transaction(
      updates.map((u) =>
        prisma.forgeCommentProposal.update({
          where: { id: u.id },
          data: {
            status: u.status,
            ...(u.editedComment !== undefined && { editedComment: u.editedComment }),
          },
        }),
      ),
    );
  });
}

export async function markProposalsApplied(proposalIds: string[]): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeCommentProposal.updateMany({
      where: { id: { in: proposalIds } },
      data: { status: "applied", appliedAt: new Date() },
    });
  });
}

export async function markProposalFailed(proposalId: string, errorMessage: string): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeCommentProposal.update({
      where: { id: proposalId },
      data: { status: "failed", errorMessage },
    });
  });
}

export async function markProposalsUndone(proposalIds: string[]): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeCommentProposal.updateMany({
      where: { id: { in: proposalIds } },
      data: { status: "undone", appliedAt: null },
    });
  });
}

/** Batch-update the originalComment field on existing proposals. */
export async function updateOriginalComments(
  updates: Array<{ id: string; originalComment: string | null }>,
): Promise<void> {
  if (updates.length === 0) return;
  await withPrisma(async (prisma) => {
    await prisma.$transaction(
      updates.map((u) =>
        prisma.forgeCommentProposal.update({
          where: { id: u.id },
          data: { originalComment: u.originalComment },
        }),
      ),
    );
  });
}

/** Distinct table FQNs in a job, with aggregated status counts. */
export async function getJobTableSummary(jobId: string): Promise<
  Array<{
    tableFqn: string;
    total: number;
    pending: number;
    accepted: number;
    rejected: number;
    applied: number;
    failed: number;
  }>
> {
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeCommentProposal.groupBy({
      by: ["tableFqn", "status"],
      where: { jobId },
      _count: { id: true },
    });

    const map = new Map<
      string,
      {
        total: number;
        pending: number;
        accepted: number;
        rejected: number;
        applied: number;
        failed: number;
      }
    >();

    for (const row of rows) {
      if (!map.has(row.tableFqn)) {
        map.set(row.tableFqn, {
          total: 0,
          pending: 0,
          accepted: 0,
          rejected: 0,
          applied: 0,
          failed: 0,
        });
      }
      const entry = map.get(row.tableFqn)!;
      const count = row._count.id;
      entry.total += count;
      if (row.status in entry) {
        (entry as Record<string, number>)[row.status] += count;
      }
    }

    return Array.from(map.entries())
      .map(([tableFqn, counts]) => ({ tableFqn, ...counts }))
      .sort((a, b) => a.tableFqn.localeCompare(b.tableFqn));
  });
}
