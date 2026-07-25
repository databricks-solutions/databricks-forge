/**
 * API: GET / POST / DELETE /api/assessment/ignored
 *
 * Workspace-level WAF control exclusions. Each row carries a free-text reason
 * and an optional (resourceType, resourceId) pair for future resource-scope.
 *
 *   GET    -> list all current exclusions
 *   POST   -> upsert one  { wafId, reason, resourceType?, resourceId? }
 *   DELETE -> remove one  { id }
 *
 * V1 only honors entries with both resourceType and resourceId NULL -- those
 * skip the entire control across every assessment run.
 *
 * Authorization model:
 *   - GET is open to any signed-in user (read-only catalog).
 *   - POST / DELETE require an authenticated user. `ignoredBy` is ALWAYS
 *     derived from `requireUser(request).email` and the body field is
 *     ignored if present, so a user cannot impersonate a teammate.
 */

import { NextRequest, NextResponse } from "next/server";
import { ensureMigrated } from "@/lib/lakebase/schema";
import {
  addIgnoredResource,
  deleteIgnoredResource,
  listIgnoredResources,
} from "@/lib/engines/waf-assessment/service";
import { handleApiError } from "@/lib/api-utils";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";

function authError(e: unknown): NextResponse | null {
  if (e instanceof ForgeAuthError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return null;
}

export async function GET() {
  try {
    await ensureMigrated();
    const ignored = await listIgnoredResources();
    return NextResponse.json({ ignored });
  } catch (error) {
    return handleApiError(error, "/api/assessment/ignored");
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureMigrated();
    let user;
    try {
      user = await requireUser(request);
    } catch (e) {
      const r = authError(e);
      if (r) return r;
      throw e;
    }
    const body = await request.json().catch(() => ({}));
    const wafId = typeof body.wafId === "string" ? body.wafId : "";
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (!wafId) {
      return NextResponse.json({ error: "wafId is required" }, { status: 400 });
    }
    if (!reason.trim()) {
      return NextResponse.json({ error: "reason is required" }, { status: 400 });
    }
    const resourceType =
      typeof body.resourceType === "string" && body.resourceType ? body.resourceType : null;
    const resourceId =
      typeof body.resourceId === "string" && body.resourceId ? body.resourceId : null;
    // `ignoredBy` is server-derived from the authenticated user.
    // Any client-supplied `ignoredBy` field is intentionally ignored.
    const saved = await addIgnoredResource({
      wafId,
      resourceType,
      resourceId,
      reason,
      ignoredBy: user.email,
    });
    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    return handleApiError(error, "/api/assessment/ignored");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await ensureMigrated();
    try {
      await requireUser(request);
    } catch (e) {
      const r = authError(e);
      if (r) return r;
      throw e;
    }
    const body = await request.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    await deleteIgnoredResource(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error, "/api/assessment/ignored");
  }
}
