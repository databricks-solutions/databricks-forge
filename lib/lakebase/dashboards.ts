/**
 * CRUD operations for Dashboard tracking -- backed by Lakebase (Prisma).
 *
 * Records which dashboards were created/updated/trashed from which
 * pipeline runs and domains, so the UI can display status badges.
 */

import { withPrisma } from "@/lib/prisma";
import type {
  TrackedDashboard,
  DashboardStatus,
  DashboardPublicationStatus,
} from "@/lib/dashboard/types";

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function dbRowToTracked(row: {
  id: string;
  dashboardId: string;
  runId: string;
  domain: string;
  title: string;
  status: string;
  dashboardUrl: string | null;
  publicationStatus: string | null;
  publishedAt: Date | null;
  embedCredentials: boolean;
  ownerEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
}): TrackedDashboard {
  return {
    id: row.id,
    dashboardId: row.dashboardId,
    runId: row.runId,
    domain: row.domain,
    title: row.title,
    status: row.status as DashboardStatus,
    dashboardUrl: row.dashboardUrl,
    publicationStatus: row.publicationStatus as DashboardPublicationStatus | null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    embedCredentials: row.embedCredentials,
    ownerEmail: row.ownerEmail,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listTrackedDashboards(runId?: string): Promise<TrackedDashboard[]> {
  return withPrisma(async (prisma) => {
    const where = runId ? { runId } : {};
    const rows = await prisma.forgeDashboard.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(dbRowToTracked);
  });
}

export async function listOwnedTrackedDashboardsByIds(
  dashboardIds: string[],
  ownerEmail: string,
): Promise<TrackedDashboard[]> {
  if (dashboardIds.length === 0) return [];
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeDashboard.findMany({
      where: {
        dashboardId: { in: dashboardIds },
        ownerEmail,
        status: { not: "trashed" },
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(dbRowToTracked);
  });
}

export async function getTrackedDashboardByRunDomain(
  runId: string,
  domain: string,
): Promise<TrackedDashboard | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeDashboard.findUnique({
      where: { runId_domain: { runId, domain } },
    });
    return row ? dbRowToTracked(row) : null;
  });
}

export async function trackDashboardCreated(
  id: string,
  dashboardId: string,
  runId: string,
  domain: string,
  title: string,
  dashboardUrl: string | null,
  options?: {
    publicationStatus?: DashboardPublicationStatus;
    publishedAt?: Date | null;
    embedCredentials?: boolean;
    ownerEmail?: string | null;
  },
): Promise<TrackedDashboard> {
  return withPrisma(async (prisma) => {
    const publicationStatus = options?.publicationStatus ?? "draft";
    const observedPublishedAt = options?.publishedAt;
    if (publicationStatus === "published" && !observedPublishedAt) {
      throw new Error("Published dashboard tracking requires an observed publishedAt");
    }
    const publishedAt = publicationStatus === "published" ? observedPublishedAt : null;
    const row = await prisma.forgeDashboard.upsert({
      where: { runId_domain: { runId, domain } },
      create: {
        id,
        dashboardId,
        runId,
        domain,
        title,
        status: "created",
        dashboardUrl,
        publicationStatus,
        publishedAt,
        embedCredentials: options?.embedCredentials ?? false,
        ownerEmail: options?.ownerEmail ?? null,
      },
      update: {
        dashboardId,
        title,
        status: "created",
        dashboardUrl,
        publicationStatus,
        publishedAt,
        embedCredentials: options?.embedCredentials ?? false,
        ownerEmail: options?.ownerEmail ?? null,
      },
    });
    return dbRowToTracked(row);
  });
}

export async function trackDashboardUpdated(input: {
  id: string;
  title?: string;
  publicationStatus?: DashboardPublicationStatus;
  publishedAt?: Date | null;
  embedCredentials?: boolean;
}): Promise<void> {
  await withPrisma(async (prisma) => {
    const data: Record<string, unknown> = { status: "updated" };
    if (input.title) data.title = input.title;
    if (input.publicationStatus) {
      if (input.publicationStatus === "published" && !input.publishedAt) {
        throw new Error("Published dashboard tracking requires an observed publishedAt");
      }
      data.publicationStatus = input.publicationStatus;
      data.publishedAt = input.publicationStatus === "published" ? input.publishedAt : null;
    }
    if (input.embedCredentials !== undefined) {
      data.embedCredentials = input.embedCredentials;
    }
    const result = await prisma.forgeDashboard.updateMany({
      where: { id: input.id },
      data,
    });
    if (result.count !== 1) {
      throw new Error("Exact owner-bound dashboard tracking row was not found");
    }
  });
}

export async function trackExactDashboardUpdate(input: {
  id: string;
  dashboardId: string;
  runId: string;
  domain: string;
  title: string;
  dashboardUrl: string | null;
  publicationStatus: DashboardPublicationStatus;
  publishedAt?: Date | null;
  embedCredentials: boolean;
  ownerEmail: string;
}): Promise<TrackedDashboard> {
  if (input.publicationStatus === "published" && !input.publishedAt) {
    throw new Error("Published dashboard tracking requires an observed publishedAt");
  }
  const publishedAt =
    input.publicationStatus === "published" ? input.publishedAt : null;
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeDashboard.upsert({
      where: { runId_domain: { runId: input.runId, domain: input.domain } },
      create: {
        id: input.id,
        dashboardId: input.dashboardId,
        runId: input.runId,
        domain: input.domain,
        title: input.title,
        status: "updated",
        dashboardUrl: input.dashboardUrl,
        publicationStatus: input.publicationStatus,
        publishedAt,
        embedCredentials: input.embedCredentials,
        ownerEmail: input.ownerEmail,
      },
      update: {
        dashboardId: input.dashboardId,
        title: input.title,
        status: "updated",
        dashboardUrl: input.dashboardUrl,
        publicationStatus: input.publicationStatus,
        publishedAt,
        embedCredentials: input.embedCredentials,
        ownerEmail: input.ownerEmail,
      },
    });
    return dbRowToTracked(row);
  });
}

export async function trackDashboardTrashed(dashboardId: string): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeDashboard.updateMany({
      where: { dashboardId },
      data: { status: "trashed" },
    });
  });
}
