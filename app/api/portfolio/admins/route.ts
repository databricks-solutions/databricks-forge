/**
 * API: /api/portfolio/admins (V2 — in-tool org-admin management)
 *
 * Lets existing portfolio admins manage the cross-estate Portfolio allowlist
 * from the UI without a redeploy. All verbs require the caller to already be a
 * portfolio admin (via `requirePortfolioAccess`).
 *
 *   GET    -- list current admins (DB-managed ∪ env-configured read-only).
 *   POST   -- grant admin to { email }.
 *   DELETE -- revoke admin for ?email= (cannot remove the last admin or an
 *             env-configured one).
 *
 * ⚠️ This manages the audited isolation exception. See lib/config/portfolio-flag.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { apiLogger } from "@/lib/logger";
import { requirePortfolioAccess } from "@/lib/auth/portfolio-guard";
import {
  listPortfolioAdmins,
  addPortfolioAdmin,
  removePortfolioAdmin,
} from "@/lib/lakebase/portfolio-admins";
import { logActivity } from "@/lib/lakebase/activity-log";

export async function GET(request: NextRequest) {
  const log = apiLogger("/api/portfolio/admins", "GET");
  try {
    const guard = await requirePortfolioAccess(request);
    if (!guard.ok) return guard.response;
    await ensureMigrated();
    const admins = await listPortfolioAdmins();
    return NextResponse.json(
      { admins },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    log.error("GET failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const log = apiLogger("/api/portfolio/admins", "POST");
  try {
    const guard = await requirePortfolioAccess(request);
    if (!guard.ok) return guard.response;
    await ensureMigrated();

    const body = (await request.json().catch(() => ({}))) as { email?: unknown };
    if (typeof body.email !== "string" || !body.email.includes("@")) {
      return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
    }

    const email = await addPortfolioAdmin(body.email, guard.user.email);
    logActivity("portfolio_admin_granted", {
      userId: guard.user.email,
      resourceId: null,
      metadata: { email },
    });
    return NextResponse.json({ ok: true, email });
  } catch (error) {
    log.error("POST failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const log = apiLogger("/api/portfolio/admins", "DELETE");
  try {
    const guard = await requirePortfolioAccess(request);
    if (!guard.ok) return guard.response;
    await ensureMigrated();

    const email = request.nextUrl.searchParams.get("email");
    if (!email) {
      return NextResponse.json({ error: "An email query parameter is required." }, { status: 400 });
    }

    await removePortfolioAdmin(email);
    logActivity("portfolio_admin_revoked", {
      userId: guard.user.email,
      resourceId: null,
      metadata: { email: email.toLowerCase() },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("DELETE failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 400 });
  }
}
