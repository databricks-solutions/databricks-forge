/**
 * API: POST /api/assessment/genie
 *
 * Builds the Forge WAF Genie space `serialized_space`, then creates or
 * updates the space in the workspace under `/Shared/Forge Genie Spaces/`.
 * Idempotent: looks up an existing space by title; creates if absent,
 * updates the serialized payload if present.
 */

import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/dbx/client";
import {
  createGenieSpace,
  getGenieSpace,
  listGenieSpaces,
  updateGenieSpace,
  DEFAULT_GENIE_PARENT_PATH,
} from "@/lib/dbx/genie";
import {
  WAF_GENIE_DESCRIPTION,
  WAF_GENIE_TITLE,
  buildWafGenieSerializedSpace,
  mergeWafGenieSerializedSpace,
} from "@/lib/engines/waf-assessment/genie/builder";
import { handleApiError } from "@/lib/api-utils";
import { logger } from "@/lib/logger";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { logActivity } from "@/lib/lakebase/activity-log";

export async function POST(request: NextRequest) {
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
    const config = getConfig();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    // The WAF Genie space is a workspace-shared asset; any user with the
    // app open can regenerate it. We deliberately do NOT honor a
    // client-supplied `parentPath` -- accepting one would let any
    // signed-in user write the space into another user's private
    // workspace folder. Always use the canonical /Shared/... path.
    const parentPath = DEFAULT_GENIE_PARENT_PATH;
    const locale = typeof body.locale === "string" ? body.locale : undefined;

    const builtSpace = buildWafGenieSerializedSpace(locale);

    let pageToken: string | undefined;
    let existing: { space_id: string; title: string } | undefined;
    do {
      const page = await listGenieSpaces(100, pageToken);
      existing = (page.spaces ?? []).find((s) => s.title === WAF_GENIE_TITLE);
      if (existing) break;
      pageToken = page.next_page_token;
    } while (pageToken);

    let spaceId: string;
    let action: "created" | "updated";

    if (existing) {
      // Preserve user-curated joins, measures, filters, and expressions that
      // were added directly in the Genie UI on top of our defaults.
      let serializedSpace = builtSpace;
      try {
        const liveSpace = await getGenieSpace(existing.space_id);
        if (liveSpace.serialized_space) {
          serializedSpace = mergeWafGenieSerializedSpace(
            builtSpace,
            liveSpace.serialized_space,
          );
        }
      } catch (err) {
        logger.warn("WAF Genie space fetch-before-merge failed; using built space as-is", {
          spaceId: existing.space_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const result = await updateGenieSpace(existing.space_id, {
        title: WAF_GENIE_TITLE,
        description: WAF_GENIE_DESCRIPTION,
        serializedSpace,
        warehouseId: config.warehouseId,
      });
      spaceId = result.space_id;
      action = "updated";
    } else {
      const result = await createGenieSpace({
        title: WAF_GENIE_TITLE,
        description: WAF_GENIE_DESCRIPTION,
        serializedSpace: builtSpace,
        warehouseId: config.warehouseId,
        parentPath,
      });
      spaceId = result.space_id;
      action = "created";
    }

    const spaceUrl = `${config.host}/genie/rooms/${spaceId}`;

    logger.info(`WAF Genie space ${action}`, { spaceId, by: user.email });

    void logActivity("waf_genie_generated", {
      userId: user.email,
      resourceId: spaceId,
      metadata: { action },
    });

    return NextResponse.json({
      success: true,
      action,
      spaceId,
      spaceUrl,
    });
  } catch (error) {
    return handleApiError(error, "/api/assessment/genie");
  }
}
