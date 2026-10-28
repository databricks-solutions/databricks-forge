/**
 * API: /api/migrate
 *
 * POST -- run Lakebase migrations (create schema + tables)
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";
import { runMigrations } from "@/lib/lakebase/schema";
import { requireOrgAdmin } from "@/lib/auth/portfolio-guard";

export async function POST(request: NextRequest) {
  const guard = await requireOrgAdmin(request);
  if (!guard.ok) return guard.response;

  try {
    await runMigrations();
    return NextResponse.json({ message: "Migrations completed successfully" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("[migrate] Migration failed", { error: msg, userEmail: guard.user.email });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
