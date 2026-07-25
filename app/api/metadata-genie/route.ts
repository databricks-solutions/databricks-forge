/**
 * API: /api/metadata-genie
 *
 * GET    -- List all metadata genie spaces
 * DELETE -- Trash a metadata genie space (drops views + trashes Genie Space)
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { executeSQL } from "@/lib/dbx/sql";
import { trashGenieSpace } from "@/lib/dbx/genie";
import { generateDropViewDDL } from "@/lib/metadata-genie/view-ddl";
import { DeleteBodySchema } from "@/lib/metadata-genie/schemas";
import {
  listMetadataGenieSpaces,
  getMetadataGenieSpace,
  updateMetadataGenieStatus,
} from "@/lib/lakebase/metadata-genie";
import { logger } from "@/lib/logger";
import type { GenieAuthMode } from "@/lib/settings";

export async function GET() {
  try {
    const spaces = await listMetadataGenieSpaces();
    return NextResponse.json({ spaces });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const raw = await request.json();
    const parsed = DeleteBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        { status: 400 },
      );
    }
    const { id, dropViews } = parsed.data;

    const space = await getMetadataGenieSpace(id);
    if (!space) {
      return NextResponse.json({ error: "Metadata Genie space not found" }, { status: 404 });
    }

    // Trash the Genie Space if deployed
    if (space.spaceId) {
      try {
        await trashGenieSpace(space.spaceId, space.authMode as GenieAuthMode);
      } catch (err) {
        logger.warn("Failed to trash Genie Space", {
          spaceId: space.spaceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Drop views if requested and they were deployed
    if (dropViews && space.viewNames && space.viewNames.length > 0) {
      const dropStatements = generateDropViewDDL(space.viewNames);
      for (const ddl of dropStatements) {
        try {
          await executeSQL(ddl);
        } catch (err) {
          logger.warn("Failed to drop view", {
            ddl,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    await updateMetadataGenieStatus(id, "trashed");

    logger.info("Metadata Genie space trashed", {
      id,
      viewsDropped: dropViews ?? false,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Metadata Genie trash failed", { error: message });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
