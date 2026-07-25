/**
 * /api/share -- list / grant / revoke ACL entries for a given resource.
 *
 *   GET    /api/share?resourceType=run&resourceId=<id>
 *     -> { acl: AclEntry[], owner: { email } }
 *
 *   POST   /api/share
 *     body: { resourceType, resourceId, viewerEmail, permission: "view"|"edit" }
 *     -> { entry: AclEntry }
 *
 *   DELETE /api/share?resourceType=&resourceId=&viewerEmail=
 *     -> { removed: number }
 *
 * Owner-only operations: only the resource's owner can mutate ACL. Users
 * with edit perms cannot re-share.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import {
  RESOURCE_TYPES,
  listAclForResource,
  share,
  unshare,
  type ResourceType,
} from "@/lib/lakebase/acl";
import { logActivity } from "@/lib/lakebase/activity-log";
import { withPrisma } from "@/lib/prisma";

const ResourceTypeSchema = z.enum(RESOURCE_TYPES as readonly [string, ...string[]]);

const PostBody = z.object({
  resourceType: ResourceTypeSchema,
  resourceId: z.string().min(1),
  viewerEmail: z.string().email(),
  permission: z.enum(["view", "edit"]),
});

interface OwnerLookup {
  ownerEmail: string | null | undefined;
  exists: boolean;
}

/**
 * Look up the owner of a resource. Returns `exists=false` for unknown
 * resources and `ownerEmail=null` for legacy rows that pre-date isolation.
 */
async function lookupOwner(
  resourceType: ResourceType,
  resourceId: string,
): Promise<OwnerLookup> {
  return withPrisma(async (prisma) => {
    switch (resourceType) {
      case "run": {
        const row = await prisma.forgeRun.findUnique({
          where: { runId: resourceId },
          select: { ownerEmail: true },
        });
        return row ? { ownerEmail: row.ownerEmail, exists: true } : { ownerEmail: null, exists: false };
      }
      case "scan": {
        const row = await prisma.forgeEnvironmentScan.findUnique({
          where: { scanId: resourceId },
          select: { ownerEmail: true },
        });
        return row ? { ownerEmail: row.ownerEmail, exists: true } : { ownerEmail: null, exists: false };
      }
      case "genie_space": {
        const row = await prisma.forgeGenieSpace.findUnique({
          where: { id: resourceId },
          select: { ownerEmail: true },
        });
        return row ? { ownerEmail: row.ownerEmail, exists: true } : { ownerEmail: null, exists: false };
      }
      case "demo_session": {
        const row = await prisma.forgeDemoSession.findUnique({
          where: { id: resourceId },
          select: { ownerEmail: true },
        });
        return row ? { ownerEmail: row.ownerEmail, exists: true } : { ownerEmail: null, exists: false };
      }
      case "comment_job": {
        const row = await prisma.forgeCommentJob.findUnique({
          where: { id: resourceId },
          select: { ownerEmail: true },
        });
        return row ? { ownerEmail: row.ownerEmail, exists: true } : { ownerEmail: null, exists: false };
      }
      case "strategy_document": {
        const row = await prisma.forgeStrategyDocument.findUnique({
          where: { id: resourceId },
          select: { ownerEmail: true },
        });
        return row ? { ownerEmail: row.ownerEmail, exists: true } : { ownerEmail: null, exists: false };
      }
      case "document": {
        const row = await prisma.forgeDocument.findUnique({
          where: { id: resourceId },
          select: { ownerEmail: true },
        });
        return row ? { ownerEmail: row.ownerEmail, exists: true } : { ownerEmail: null, exists: false };
      }
      case "fabric_scan": {
        const row = await prisma.forgeFabricScan.findUnique({
          where: { id: resourceId },
          select: { ownerEmail: true },
        });
        return row ? { ownerEmail: row.ownerEmail, exists: true } : { ownerEmail: null, exists: false };
      }
      case "fabric_migration": {
        const row = await prisma.forgeFabricMigration.findUnique({
          where: { id: resourceId },
          select: { ownerEmail: true },
        });
        return row ? { ownerEmail: row.ownerEmail, exists: true } : { ownerEmail: null, exists: false };
      }
      case "waf_assessment": {
        const row = await prisma.forgeWafAssessment.findUnique({
          where: { assessmentId: resourceId },
          select: { ownerEmail: true },
        });
        return row ? { ownerEmail: row.ownerEmail, exists: true } : { ownerEmail: null, exists: false };
      }
      case "estate_program": {
        const row = await prisma.forgeEstateProgram.findUnique({
          where: { id: resourceId },
          select: { ownerEmail: true },
        });
        return row ? { ownerEmail: row.ownerEmail, exists: true } : { ownerEmail: null, exists: false };
      }
      case "metric_view_proposal": {
        const row = await prisma.forgeMetricViewProposal.findUnique({
          where: { id: resourceId },
          select: { ownerEmail: true },
        });
        return row ? { ownerEmail: row.ownerEmail, exists: true } : { ownerEmail: null, exists: false };
      }
      default:
        // Other resource types are not yet shareable.
        return { ownerEmail: null, exists: false };
    }
  });
}

function err(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

function authError(e: unknown): NextResponse {
  if (e instanceof ForgeAuthError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return err(500, e instanceof Error ? e.message : "Internal error");
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const rawType = searchParams.get("resourceType");
    const resourceId = searchParams.get("resourceId");
    if (!rawType || !resourceId) {
      return err(400, "resourceType and resourceId are required");
    }
    const parsed = ResourceTypeSchema.safeParse(rawType);
    if (!parsed.success) return err(400, "Unsupported resourceType");
    const resourceType = parsed.data as ResourceType;

    const owner = await lookupOwner(resourceType, resourceId);
    if (!owner.exists) return err(404, "Resource not found");

    if (!owner.ownerEmail || owner.ownerEmail.toLowerCase() !== user.email) {
      return err(403, "Only the owner can view sharing settings.");
    }

    const acl = await listAclForResource(resourceType, resourceId);
    return NextResponse.json({
      acl,
      owner: { email: owner.ownerEmail },
    });
  } catch (e) {
    return authError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const json = await request.json().catch(() => null);
    const parsed = PostBody.safeParse(json);
    if (!parsed.success) {
      return err(400, "Invalid body: " + parsed.error.issues.map((i) => i.message).join(", "));
    }
    const { resourceType, resourceId, viewerEmail, permission } = parsed.data;

    const owner = await lookupOwner(resourceType as ResourceType, resourceId);
    if (!owner.exists) return err(404, "Resource not found");
    if (!owner.ownerEmail || owner.ownerEmail.toLowerCase() !== user.email) {
      return err(403, "Only the owner can share this resource.");
    }
    if (viewerEmail.toLowerCase() === user.email) {
      return err(400, "You cannot share with yourself.");
    }

    const entry = await share({
      resourceType: resourceType as ResourceType,
      resourceId,
      viewerEmail,
      permission,
      grantedBy: user.email,
    });

    await logActivity("resource_shared", {
      userId: user.email,
      resourceId,
      metadata: { resourceType, viewerEmail, permission },
    });

    return NextResponse.json({ entry });
  } catch (e) {
    return authError(e);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const rawType = searchParams.get("resourceType");
    const resourceId = searchParams.get("resourceId");
    const viewerEmail = searchParams.get("viewerEmail");
    if (!rawType || !resourceId || !viewerEmail) {
      return err(400, "resourceType, resourceId, viewerEmail are required");
    }
    const parsed = ResourceTypeSchema.safeParse(rawType);
    if (!parsed.success) return err(400, "Unsupported resourceType");
    const resourceType = parsed.data as ResourceType;

    const owner = await lookupOwner(resourceType, resourceId);
    if (!owner.exists) return err(404, "Resource not found");
    if (!owner.ownerEmail || owner.ownerEmail.toLowerCase() !== user.email) {
      return err(403, "Only the owner can revoke access.");
    }

    const removed = await unshare({
      resourceType,
      resourceId,
      viewerEmail,
    });

    if (removed > 0) {
      await logActivity("resource_unshared", {
        userId: user.email,
        resourceId,
        metadata: { resourceType, viewerEmail },
      });
    }

    return NextResponse.json({ removed });
  } catch (e) {
    return authError(e);
  }
}
