/**
 * Route-level authorization helpers.
 *
 * These helpers consolidate the "load resource, check ACL, return 401/403"
 * boilerplate that would otherwise be repeated across every per-resource
 * API route. Each helper returns a tagged union: either a successful
 * `{ ok: true, ...resource, user }` shape or `{ ok: false, response }`
 * carrying the `NextResponse` to return immediately.
 *
 * Usage:
 *   const guarded = await loadRunOrRespond(request, runId, "read");
 *   if (!guarded.ok) return guarded.response;
 *   const { run, user, permission } = guarded;
 */

import { NextResponse } from "next/server";
import { requireUser, ForgeAuthError, type ForgeUser } from "@/lib/auth/route-user";
import { canRead, canEdit, type ResourceType, type AclPermission } from "@/lib/lakebase/acl";
import { getRunById } from "@/lib/lakebase/runs";
import {
  getMetricViewProposalById,
  type StoredMetricViewProposal,
} from "@/lib/lakebase/metric-view-proposals";
import { withPrisma } from "@/lib/prisma";
import type { PipelineRun } from "@/lib/domain/types";

export type GuardResult<T> =
  | { ok: true; value: T; user: ForgeUser; permission: "owner" | AclPermission }
  | { ok: false; response: NextResponse };

type Mode = "read" | "edit";

async function authenticate(
  request: Request,
): Promise<{ ok: true; user: ForgeUser } | { ok: false; response: NextResponse }> {
  try {
    const user = await requireUser(request);
    return { ok: true, user };
  } catch (e) {
    if (e instanceof ForgeAuthError) {
      return {
        ok: false,
        response: NextResponse.json({ error: e.message }, { status: e.status }),
      };
    }
    throw e;
  }
}

function notFound(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

function forbidden(): NextResponse {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

async function authorizeAcl(
  user: ForgeUser,
  resourceType: ResourceType,
  resourceId: string,
  ownerEmail: string | null | undefined,
  mode: Mode,
): Promise<
  { ok: true; permission: "owner" | AclPermission } | { ok: false; response: NextResponse }
> {
  if (mode === "edit") {
    const allowed = await canEdit({ userEmail: user.email, resourceType, resourceId, ownerEmail });
    if (!allowed) return { ok: false, response: forbidden() };
    const perm = ownerEmail && ownerEmail.toLowerCase() === user.email ? "owner" : "edit";
    return { ok: true, permission: perm };
  }
  const perm = await canRead({ userEmail: user.email, resourceType, resourceId, ownerEmail });
  if (!perm) return { ok: false, response: forbidden() };
  return { ok: true, permission: perm };
}

// ---------------------------------------------------------------------------
// Run guard
// ---------------------------------------------------------------------------

export async function loadRunOrRespond(
  request: Request,
  runId: string,
  mode: Mode = "read",
): Promise<GuardResult<{ run: PipelineRun }>> {
  const auth = await authenticate(request);
  if (!auth.ok) return { ok: false, response: auth.response };

  const run = await getRunById(runId);
  if (!run) return { ok: false, response: notFound() };

  const az = await authorizeAcl(auth.user, "run", runId, run.ownerEmail, mode);
  if (!az.ok) return { ok: false, response: az.response };

  return { ok: true, value: { run }, user: auth.user, permission: az.permission };
}

// ---------------------------------------------------------------------------
// Generic resource guard (lighter weight: only checks ownership/ACL).
//
// For tables we don't have a typed loader for. Pass in a function that
// returns just the owner email.
// ---------------------------------------------------------------------------

export async function loadResourceOrRespond(args: {
  request: Request;
  resourceType: ResourceType;
  resourceId: string;
  fetchOwner: () => Promise<string | null | undefined> | (string | null | undefined);
  mode?: Mode;
}): Promise<GuardResult<{ ownerEmail: string | null | undefined }>> {
  const auth = await authenticate(args.request);
  if (!auth.ok) return { ok: false, response: auth.response };

  const ownerEmail = await Promise.resolve(args.fetchOwner());
  if (ownerEmail === undefined) {
    return { ok: false, response: notFound() };
  }

  const az = await authorizeAcl(
    auth.user,
    args.resourceType,
    args.resourceId,
    ownerEmail,
    args.mode ?? "read",
  );
  if (!az.ok) return { ok: false, response: az.response };

  return { ok: true, value: { ownerEmail }, user: auth.user, permission: az.permission };
}

// ---------------------------------------------------------------------------
// Specialised loaders for common resource types
// ---------------------------------------------------------------------------

export async function loadEstateProgramOrRespond(
  request: Request,
  programId: string,
  mode: Mode = "read",
): Promise<GuardResult<{ ownerEmail: string | null | undefined }>> {
  const { getEstateProgramOwner } = await import("@/lib/lakebase/estate-programs");
  return loadResourceOrRespond({
    request,
    resourceType: "estate_program",
    resourceId: programId,
    fetchOwner: () => getEstateProgramOwner(programId),
    mode,
  });
}

export async function loadScanOrRespond(
  request: Request,
  scanId: string,
  mode: Mode = "read",
): Promise<GuardResult<{ ownerEmail: string | null | undefined }>> {
  return loadResourceOrRespond({
    request,
    resourceType: "scan",
    resourceId: scanId,
    fetchOwner: () =>
      withPrisma(async (prisma) => {
        const row = await prisma.forgeEnvironmentScan.findUnique({
          where: { scanId },
          select: { ownerEmail: true },
        });
        return row ? row.ownerEmail : undefined;
      }),
    mode,
  });
}

export async function loadGenieSpaceOrRespond(
  request: Request,
  trackingId: string,
  mode: Mode = "read",
): Promise<GuardResult<{ ownerEmail: string | null | undefined; spaceId: string | null }>> {
  const auth = await authenticate(request);
  if (!auth.ok) return { ok: false, response: auth.response };

  const row = await withPrisma(async (prisma) =>
    prisma.forgeGenieSpace.findUnique({
      where: { id: trackingId },
      select: { ownerEmail: true, spaceId: true },
    }),
  );
  if (!row) return { ok: false, response: notFound() };

  const az = await authorizeAcl(auth.user, "genie_space", trackingId, row.ownerEmail, mode);
  if (!az.ok) return { ok: false, response: az.response };

  return {
    ok: true,
    value: { ownerEmail: row.ownerEmail, spaceId: row.spaceId },
    user: auth.user,
    permission: az.permission,
  };
}

/**
 * Load a Genie space by its Databricks `spaceId` (not the tracking ID).
 *
 * Many of our routes accept the Databricks-side `spaceId` in the URL
 * (e.g. `/api/genie-spaces/[spaceId]`). For sharing/ACL purposes we still
 * key on the tracking row, so this helper resolves the tracking row first
 * then runs the ACL check against `genie_space` with that tracking id.
 *
 * Spaces that exist in Databricks but have no Forge tracking row (i.e. were
 * created outside this app) are treated as "off-platform": authenticated
 * users can read them but cannot edit/delete via Forge ownership rules.
 */
export async function loadGenieSpaceBySpaceIdOrRespond(
  request: Request,
  spaceId: string,
  mode: Mode = "read",
): Promise<
  GuardResult<{
    trackingId: string | null;
    ownerEmail: string | null | undefined;
    spaceId: string;
    offPlatform: boolean;
  }>
> {
  const auth = await authenticate(request);
  if (!auth.ok) return { ok: false, response: auth.response };

  const row = await withPrisma(async (prisma) =>
    prisma.forgeGenieSpace.findFirst({
      where: { spaceId },
      select: { id: true, ownerEmail: true, spaceId: true },
    }),
  );

  if (!row) {
    // Off-platform space: authenticated users can read, but Forge ownership
    // rules cannot grant edit/delete. Routes that try to mutate via this
    // helper get 403; those that only read get a `read` permission.
    if (mode === "edit") {
      return { ok: false, response: forbidden() };
    }
    return {
      ok: true,
      value: {
        trackingId: null,
        ownerEmail: null,
        spaceId,
        offPlatform: true,
      },
      user: auth.user,
      permission: "view",
    };
  }

  const az = await authorizeAcl(auth.user, "genie_space", row.id, row.ownerEmail, mode);
  if (!az.ok) return { ok: false, response: az.response };

  return {
    ok: true,
    value: {
      trackingId: row.id,
      ownerEmail: row.ownerEmail,
      spaceId: row.spaceId,
      offPlatform: false,
    },
    user: auth.user,
    permission: az.permission,
  };
}

export async function loadDemoSessionOrRespond(
  request: Request,
  sessionId: string,
  mode: Mode = "read",
): Promise<GuardResult<{ ownerEmail: string | null | undefined }>> {
  return loadResourceOrRespond({
    request,
    resourceType: "demo_session",
    resourceId: sessionId,
    fetchOwner: () =>
      withPrisma(async (prisma) => {
        const row = await prisma.forgeDemoSession.findUnique({
          where: { id: sessionId },
          select: { ownerEmail: true },
        });
        return row ? row.ownerEmail : undefined;
      }),
    mode,
  });
}

export async function loadCommentJobOrRespond(
  request: Request,
  jobId: string,
  mode: Mode = "read",
): Promise<GuardResult<{ ownerEmail: string | null | undefined }>> {
  return loadResourceOrRespond({
    request,
    resourceType: "comment_job",
    resourceId: jobId,
    fetchOwner: () =>
      withPrisma(async (prisma) => {
        const row = await prisma.forgeCommentJob.findUnique({
          where: { id: jobId },
          select: { ownerEmail: true },
        });
        return row ? row.ownerEmail : undefined;
      }),
    mode,
  });
}

export async function loadMetricViewProposalOrRespond(
  request: Request,
  proposalId: string,
  mode: Mode = "read",
): Promise<GuardResult<{ proposal: StoredMetricViewProposal }>> {
  const auth = await authenticate(request);
  if (!auth.ok) return { ok: false, response: auth.response };

  const proposal = await getMetricViewProposalById(proposalId);
  if (!proposal) return { ok: false, response: notFound() };

  const az = await authorizeAcl(
    auth.user,
    "metric_view_proposal",
    proposalId,
    proposal.ownerEmail,
    mode,
  );
  if (!az.ok) return { ok: false, response: az.response };

  return {
    ok: true,
    value: { proposal },
    user: auth.user,
    permission: az.permission,
  };
}
