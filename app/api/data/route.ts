/**
 * API: /api/data
 *
 * DELETE -- wipe all application data (factory reset)
 *
 * Requires the `x-confirm-delete` header set to "delete-all-data" to
 * prevent accidental invocation.
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { deleteAllData } from "@/lib/lakebase/reset";
import { isRateLimitErrorMessage } from "@/lib/lakebase/auth-errors";

const CONFIRMATION_VALUE = "delete-all-data";

export async function DELETE(request: NextRequest) {
  try {
    const confirm = request.headers.get("x-confirm-delete");
    if (confirm !== CONFIRMATION_VALUE) {
      return NextResponse.json(
        {
          error:
            "Missing or invalid confirmation header. Set x-confirm-delete: delete-all-data to proceed.",
        },
        { status: 400 },
      );
    }

    await ensureMigrated();
    await deleteAllData();

    revalidatePath("/", "layout");

    logger.info("[api/data] All application data deleted (factory reset)");
    return NextResponse.json({ deleted: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("[api/data] DELETE failed", { error: msg });

    if (isRateLimitErrorMessage(msg)) {
      return NextResponse.json(
        {
          error:
            "Delete request was rate-limited by the database. Please wait 30-60 seconds and retry.",
        },
        { status: 429 },
      );
    }

    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
