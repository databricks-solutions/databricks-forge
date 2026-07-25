/**
 * API: /api/estate-programs
 *
 * GET  -- list the caller's estate programs
 * POST -- create a new estate program
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { apiLogger } from "@/lib/logger";
import { toJsonSafe } from "@/lib/json-safe";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { createEstateProgram, listEstatePrograms } from "@/lib/lakebase/estate-programs";
import { logActivity } from "@/lib/lakebase/activity-log";
import { listAccessibleIds } from "@/lib/lakebase/acl";
import { getIndustryOutcome } from "@/lib/domain/industry-outcomes";
import {
  normalizeEstateProgramInput,
  type EstateProgramCreateInput,
} from "@/lib/domain/estate-program-input";

export async function GET(request: NextRequest) {
  const log = apiLogger("/api/estate-programs", "GET");
  try {
    let user;
    try {
      user = await requireUser(request);
    } catch (e) {
      if (e instanceof ForgeAuthError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
    await ensureMigrated();
    const limit = Math.min(
      Math.max(parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10) || 50, 1),
      200,
    );
    const sharedIds = await listAccessibleIds(user.email, "estate_program");
    const programs = await listEstatePrograms(user.email, limit, sharedIds);
    return NextResponse.json(
      { programs: toJsonSafe(programs) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    log.error("GET failed", {
      error: error instanceof Error ? error.message : String(error),
      errorCategory: "internal_error",
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const log = apiLogger("/api/estate-programs", "POST");
  try {
    await ensureMigrated();
    let user;
    try {
      user = await requireUser(request);
    } catch (e) {
      if (e instanceof ForgeAuthError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }

    const body = await request.json();
    const normalized = normalizeEstateProgramInput(body, {
      mode: "create",
      isRegisteredIndustry: (id) => Boolean(getIndustryOutcome(id)),
    });
    if (!normalized.success) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }
    const input = normalized.data as EstateProgramCreateInput;

    const programId = await createEstateProgram(
      {
        name: input.name,
        description: input.description || null,
        industryId: input.industryId,
        subVertical: input.subVertical,
        orgContext: input.orgContext,
      },
      user.email,
    );

    logActivity("created_program", {
      userId: user.email,
      resourceId: programId,
      metadata: { name: input.name },
    });

    return NextResponse.json({ programId }, { status: 201 });
  } catch (error) {
    log.error("POST failed", {
      error: error instanceof Error ? error.message : String(error),
      errorCategory: "internal_error",
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
