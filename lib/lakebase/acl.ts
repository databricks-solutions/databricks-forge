/**
 * Resource Access Control List (ACL) helpers.
 *
 * The team-shared isolation model works like this:
 *
 *   - Every "root" resource (run, scan, genie space, demo session, etc.)
 *     has an `ownerEmail` column on its model.
 *   - When the owner wants to share with a teammate, a row is written here
 *     with (resource_type, resource_id, viewer_email, permission).
 *   - Visibility query everywhere becomes:
 *
 *       owner_email = $user OR id IN
 *         (SELECT resource_id FROM forge_resource_acl
 *          WHERE resource_type = $type AND viewer_email = $user)
 *
 * Permission semantics:
 *   - view  -- can read
 *   - edit  -- view + can re-run / regenerate / edit metadata
 *   - delete and re-share are owner-only and not represented in the ACL.
 *
 * All helpers here are SQL-driven and side-effect-free (except share/unshare).
 */

import { withPrisma } from "@/lib/prisma";

export type ResourceType =
  | "run"
  | "scan"
  | "genie_space"
  | "metadata_genie_space"
  | "demo_session"
  | "comment_job"
  | "strategy_document"
  | "connection"
  | "document"
  | "bv_portfolio"
  | "benchmark_run"
  | "health_score"
  | "metric_view_proposal"
  | "fabric_scan"
  | "fabric_migration"
  | "waf_assessment"
  | "estate_program";

export const RESOURCE_TYPES: readonly ResourceType[] = [
  "run",
  "scan",
  "genie_space",
  "metadata_genie_space",
  "demo_session",
  "comment_job",
  "strategy_document",
  "connection",
  "document",
  "bv_portfolio",
  "benchmark_run",
  "health_score",
  "metric_view_proposal",
  "fabric_scan",
  "fabric_migration",
  "waf_assessment",
  "estate_program",
] as const;

export type AclPermission = "view" | "edit";

export interface AclEntry {
  id: string;
  resourceType: ResourceType;
  resourceId: string;
  viewerEmail: string;
  permission: AclPermission;
  grantedBy: string;
  createdAt: Date;
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Return the list of resource ids of `resourceType` that `userEmail` has
 * been granted access to via the ACL (does NOT include resources the user
 * owns -- callers compose owner OR shared themselves).
 *
 * Designed to be called once per request and the result reused across the
 * various visibility filters. The result list is bounded by the number of
 * shares targeting this user, which should stay small.
 */
export async function listAccessibleIds(
  userEmail: string,
  resourceType: ResourceType,
): Promise<string[]> {
  const email = normaliseEmail(userEmail);
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeResourceAcl.findMany({
      where: { viewerEmail: email, resourceType },
      select: { resourceId: true },
    });
    return rows.map((r) => r.resourceId);
  });
}

/**
 * Per-request memo wrapper. Many list endpoints call `listAccessibleIds`
 * once for the resource type they're listing; this helper caches by
 * (userEmail, resourceType) for the lifetime of the calling closure.
 */
export function makeAccessibleIdsCache(): {
  get: (email: string, type: ResourceType) => Promise<string[]>;
} {
  const cache = new Map<string, Promise<string[]>>();
  return {
    get(email: string, type: ResourceType) {
      const key = `${normaliseEmail(email)}::${type}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const promise = listAccessibleIds(email, type);
      cache.set(key, promise);
      return promise;
    },
  };
}

/**
 * Check whether `userEmail` can see a specific resource. Returns the
 * permission level if accessible, otherwise null. The owner check requires
 * the caller to pass `ownerEmail` (we already have the row in hand at the
 * call site so an extra DB round-trip is wasteful).
 */
export async function canRead(args: {
  userEmail: string;
  resourceType: ResourceType;
  resourceId: string;
  ownerEmail: string | null | undefined;
}): Promise<AclPermission | "owner" | null> {
  const email = normaliseEmail(args.userEmail);
  if (args.ownerEmail && normaliseEmail(args.ownerEmail) === email) return "owner";

  return withPrisma(async (prisma) => {
    const row = await prisma.forgeResourceAcl.findUnique({
      where: {
        resourceType_resourceId_viewerEmail: {
          resourceType: args.resourceType,
          resourceId: args.resourceId,
          viewerEmail: email,
        },
      },
      select: { permission: true },
    });
    if (!row) return null;
    return row.permission as AclPermission;
  });
}

/**
 * Check whether `userEmail` can EDIT (re-run / regenerate / mutate metadata)
 * a specific resource. Owners always pass; viewers need permission='edit'.
 */
export async function canEdit(args: {
  userEmail: string;
  resourceType: ResourceType;
  resourceId: string;
  ownerEmail: string | null | undefined;
}): Promise<boolean> {
  const perm = await canRead(args);
  return perm === "owner" || perm === "edit";
}

export async function listAclForResource(
  resourceType: ResourceType,
  resourceId: string,
): Promise<AclEntry[]> {
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeResourceAcl.findMany({
      where: { resourceType, resourceId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      resourceType: r.resourceType as ResourceType,
      resourceId: r.resourceId,
      viewerEmail: r.viewerEmail,
      permission: r.permission as AclPermission,
      grantedBy: r.grantedBy,
      createdAt: r.createdAt,
    }));
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Grant `viewerEmail` access to a resource. Idempotent: re-granting updates
 * the permission level.
 */
export async function share(args: {
  resourceType: ResourceType;
  resourceId: string;
  viewerEmail: string;
  permission: AclPermission;
  grantedBy: string;
}): Promise<AclEntry> {
  const viewer = normaliseEmail(args.viewerEmail);
  const granter = normaliseEmail(args.grantedBy);
  if (viewer === granter) {
    throw new Error("Cannot share a resource with yourself.");
  }

  return withPrisma(async (prisma) => {
    const row = await prisma.forgeResourceAcl.upsert({
      where: {
        resourceType_resourceId_viewerEmail: {
          resourceType: args.resourceType,
          resourceId: args.resourceId,
          viewerEmail: viewer,
        },
      },
      create: {
        resourceType: args.resourceType,
        resourceId: args.resourceId,
        viewerEmail: viewer,
        permission: args.permission,
        grantedBy: granter,
      },
      update: {
        permission: args.permission,
      },
    });
    return {
      id: row.id,
      resourceType: row.resourceType as ResourceType,
      resourceId: row.resourceId,
      viewerEmail: row.viewerEmail,
      permission: row.permission as AclPermission,
      grantedBy: row.grantedBy,
      createdAt: row.createdAt,
    };
  });
}

/**
 * Revoke a single viewer's access to a resource. Returns the number of rows
 * removed (0 or 1).
 */
export async function unshare(args: {
  resourceType: ResourceType;
  resourceId: string;
  viewerEmail: string;
}): Promise<number> {
  const viewer = normaliseEmail(args.viewerEmail);
  return withPrisma(async (prisma) => {
    const result = await prisma.forgeResourceAcl.deleteMany({
      where: {
        resourceType: args.resourceType,
        resourceId: args.resourceId,
        viewerEmail: viewer,
      },
    });
    return result.count;
  });
}

/**
 * Remove ALL ACL rows for a resource. Call this when the resource itself is
 * being deleted -- application-level "cascade" since we do not have a real
 * polymorphic FK.
 */
export async function clearAclForResource(
  resourceType: ResourceType,
  resourceId: string,
): Promise<number> {
  return withPrisma(async (prisma) => {
    const result = await prisma.forgeResourceAcl.deleteMany({
      where: { resourceType, resourceId },
    });
    return result.count;
  });
}

/**
 * Remove all ACL rows touching a given user (as viewer or granter). Used
 * for right-to-erasure flows; not called by any code path in the MVP.
 */
export async function eraseAclForUser(userEmail: string): Promise<number> {
  const email = normaliseEmail(userEmail);
  return withPrisma(async (prisma) => {
    const result = await prisma.forgeResourceAcl.deleteMany({
      where: {
        OR: [{ viewerEmail: email }, { grantedBy: email }],
      },
    });
    return result.count;
  });
}
