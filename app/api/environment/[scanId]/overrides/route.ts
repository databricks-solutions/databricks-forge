/**
 * API: /api/environment/[scanId]/overrides
 *
 * GET    -- list manual domain overrides for the scan.
 * POST   -- create/replace an override (remap or evict).
 * DELETE -- remove an override by ?id=.
 *
 * Owner-scoped via loadScanOrRespond ("read" for GET, "edit" for mutations).
 * Overrides are applied on read by lib/environment/domain-overrides.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { apiLogger } from "@/lib/logger";
import { loadScanOrRespond } from "@/lib/auth/route-guards";
import {
  listDomainOverrides,
  upsertDomainOverride,
  deleteDomainOverride,
  isValidScope,
  isValidAction,
} from "@/lib/lakebase/domain-overrides";
import { logActivity } from "@/lib/lakebase/activity-log";

export async function GET(request: NextRequest, ctx: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await ctx.params;
  const log = apiLogger(`/api/environment/${scanId}/overrides`, "GET");
  try {
    const guarded = await loadScanOrRespond(request, scanId, "read");
    if (!guarded.ok) return guarded.response;
    const overrides = await listDomainOverrides(scanId);
    return NextResponse.json({ overrides }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    log.error("GET failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await ctx.params;
  const log = apiLogger(`/api/environment/${scanId}/overrides`, "POST");
  try {
    const guarded = await loadScanOrRespond(request, scanId, "edit");
    if (!guarded.ok) return guarded.response;
    const { user } = guarded;

    const body = await request.json().catch(() => ({}));
    const scope = typeof body.scope === "string" ? body.scope : "";
    const target = typeof body.target === "string" ? body.target.trim() : "";
    const action = typeof body.action === "string" ? body.action : "";

    if (!isValidScope(scope)) {
      return NextResponse.json({ error: "scope must be table|schema|catalog" }, { status: 400 });
    }
    if (!isValidAction(action)) {
      return NextResponse.json({ error: "action must be remap|evict" }, { status: 400 });
    }
    if (!target) {
      return NextResponse.json({ error: "target is required" }, { status: 400 });
    }
    if (action === "remap" && !(typeof body.newDomain === "string" && body.newDomain.trim())) {
      return NextResponse.json({ error: "newDomain is required for remap" }, { status: 400 });
    }

    const override = await upsertDomainOverride({
      scanId,
      scope,
      target,
      action,
      newDomain: typeof body.newDomain === "string" ? body.newDomain : null,
      newSubdomain: typeof body.newSubdomain === "string" ? body.newSubdomain : null,
      createdByEmail: user.email,
    });

    logActivity("estate_domain_override_set", {
      userId: user.email,
      resourceId: scanId,
      metadata: { scope, target, action, newDomain: override.newDomain ?? undefined },
    }).catch(() => {});

    return NextResponse.json({ override }, { status: 201 });
  } catch (error) {
    log.error("POST failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await ctx.params;
  const log = apiLogger(`/api/environment/${scanId}/overrides`, "DELETE");
  try {
    const guarded = await loadScanOrRespond(request, scanId, "edit");
    if (!guarded.ok) return guarded.response;
    const { user } = guarded;

    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id query param is required" }, { status: 400 });
    }
    const removed = await deleteDomainOverride(scanId, id);
    if (!removed) {
      return NextResponse.json({ error: "Override not found" }, { status: 404 });
    }
    logActivity("estate_domain_override_removed", {
      userId: user.email,
      resourceId: scanId,
      metadata: { id },
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("DELETE failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
