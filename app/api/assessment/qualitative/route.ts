/**
 * API: GET / POST / DELETE /api/assessment/qualitative
 *
 * Workspace-level qualitative answers for the 6 qualitative WAF controls
 * (FMA / DR drill / SDLC / FinOps / ops standardization / identity audit).
 *
 *   GET    -> list every saved response
 *   POST   -> upsert one response  { wafId, response, notes? }
 *   DELETE -> remove one response  { wafId }
 *
 * Responses are reused across assessment runs -- they are configuration,
 * not a per-run artifact. The schema is workspace-shared (one row per
 * waf_id) by design, but every mutation is recorded against the calling
 * user's email via `respondedBy` so we have an audit trail of who last
 * touched each control.
 *
 * Authorization model:
 *   - GET is open to any signed-in user (read-only catalog).
 *   - POST / DELETE require an authenticated user. `respondedBy` is
 *     ALWAYS derived from `requireUser(request).email` and the body
 *     field is rejected if present, so a user cannot impersonate a
 *     teammate.
 */

import { NextRequest, NextResponse } from "next/server";
import { ensureMigrated } from "@/lib/lakebase/schema";
import {
  deleteQualitativeResponse,
  listQualitativeResponses,
  saveQualitativeResponse,
} from "@/lib/engines/waf-assessment/service";
import type { WafQualitativeAnswer } from "@/lib/engines/waf-assessment/types";
import { handleApiError } from "@/lib/api-utils";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";

const VALID_RESPONSES: ReadonlySet<WafQualitativeAnswer> = new Set([
  "yes",
  "partial",
  "no",
  "not_applicable",
]);

function authError(e: unknown): NextResponse | null {
  if (e instanceof ForgeAuthError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return null;
}

export async function GET() {
  try {
    await ensureMigrated();
    const responses = await listQualitativeResponses();
    return NextResponse.json({ responses });
  } catch (error) {
    return handleApiError(error, "/api/assessment/qualitative");
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
    const response = typeof body.response === "string" ? body.response : "";
    if (!wafId) {
      return NextResponse.json({ error: "wafId is required" }, { status: 400 });
    }
    if (!VALID_RESPONSES.has(response as WafQualitativeAnswer)) {
      return NextResponse.json(
        { error: "response must be one of yes | partial | no | not_applicable" },
        { status: 400 },
      );
    }
    const notes = typeof body.notes === "string" ? body.notes : null;
    // `respondedBy` is server-derived from the authenticated user.
    // Any client-supplied `respondedBy` field is intentionally ignored
    // so a user cannot record a response under another teammate's email.
    const saved = await saveQualitativeResponse({
      wafId,
      response: response as WafQualitativeAnswer,
      notes,
      respondedBy: user.email,
    });
    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    return handleApiError(error, "/api/assessment/qualitative");
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
    const wafId = typeof body.wafId === "string" ? body.wafId : "";
    if (!wafId) {
      return NextResponse.json({ error: "wafId is required" }, { status: 400 });
    }
    await deleteQualitativeResponse(wafId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error, "/api/assessment/qualitative");
  }
}
