/**
 * API: /api/outcome-maps/[id]
 *
 * GET    -- get a single custom outcome map by record ID
 * DELETE -- delete a custom outcome map
 * PATCH  -- update a custom outcome map (name, parsedOutcome)
 */

import { NextRequest, NextResponse } from "next/server";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { getOutcomeMap, deleteOutcomeMap, updateOutcomeMap } from "@/lib/lakebase/outcome-maps";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { isPortfolioAdmin } from "@/lib/lakebase/portfolio-admins";
import type { IndustryOutcome } from "@/lib/domain/industry-outcomes";

async function canModifyOutcomeMap(
  createdBy: string | null | undefined,
  userEmail: string,
): Promise<boolean> {
  if (createdBy && createdBy.toLowerCase().trim() === userEmail.toLowerCase().trim()) {
    return true;
  }
  return isPortfolioAdmin(userEmail);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    try {
      await requireUser(request);
    } catch (e) {
      if (e instanceof ForgeAuthError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }

    await ensureMigrated();
    const { id } = await params;
    const record = await getOutcomeMap(id);
    if (!record) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(record);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch outcome map" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
    const { id } = await params;
    const existing = await getOutcomeMap(id);
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!(await canModifyOutcomeMap(existing.createdBy, user.email))) {
      return NextResponse.json(
        {
          error:
            "Forbidden. Only the creator or an organisation admin can delete this outcome map.",
        },
        { status: 403 },
      );
    }

    const deleted = await deleteOutcomeMap(id);
    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete outcome map" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const { id } = await params;
    const existing = await getOutcomeMap(id);
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!(await canModifyOutcomeMap(existing.createdBy, user.email))) {
      return NextResponse.json(
        {
          error:
            "Forbidden. Only the creator or an organisation admin can update this outcome map.",
        },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { name, industryId, rawMarkdown, parsedOutcome } = body as {
      name?: string;
      industryId?: string;
      rawMarkdown?: string;
      parsedOutcome?: IndustryOutcome;
    };

    const record = await updateOutcomeMap(id, {
      name,
      industryId,
      rawMarkdown,
      parsedOutcome,
    });

    if (!record) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(record);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update outcome map" },
      { status: 500 },
    );
  }
}
