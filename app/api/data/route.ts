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
import { deleteAllData, deleteUserData } from "@/lib/lakebase/reset";
import { isRateLimitErrorMessage } from "@/lib/lakebase/auth-errors";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { isPortfolioAdmin } from "@/lib/lakebase/portfolio-admins";
import { logActivity } from "@/lib/lakebase/activity-log";

const CONFIRM_ALL_VALUE = "delete-all-data";
const CONFIRM_MY_DATA_VALUE = "delete-my-data";

export async function DELETE(request: NextRequest) {
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

    const confirm = request.headers.get("x-confirm-delete");
    if (confirm !== CONFIRM_ALL_VALUE && confirm !== CONFIRM_MY_DATA_VALUE) {
      return NextResponse.json(
        {
          error:
            "Missing or invalid confirmation header. Set x-confirm-delete: delete-my-data (own data) or delete-all-data (org-admin factory reset) to proceed.",
        },
        { status: 400 },
      );
    }

    await ensureMigrated();

    if (confirm === CONFIRM_MY_DATA_VALUE) {
      await deleteUserData(user.email);
      await logActivity("user_data_deleted", {
        userId: user.email,
        metadata: { scope: "user" },
      }).catch(() => {});
      revalidatePath("/", "layout");
      logger.info("[api/data] User-scoped data deleted", { userEmail: user.email });
      return NextResponse.json({ deleted: true, scope: "user" });
    }

    const isAdmin = await isPortfolioAdmin(user.email);
    if (!isAdmin) {
      logger.warn("[api/data] Non-admin attempted workspace factory reset", {
        userEmail: user.email,
      });
      return NextResponse.json(
        {
          error:
            "Forbidden. Workspace-wide factory reset requires organisation-admin privileges. Use x-confirm-delete: delete-my-data to delete only your own data.",
        },
        { status: 403 },
      );
    }

    await deleteAllData();
    await logActivity("factory_reset", {
      userId: user.email,
      metadata: { scope: "workspace" },
    }).catch(() => {});

    revalidatePath("/", "layout");

    logger.info("[api/data] All application data deleted (factory reset)", {
      triggeredBy: user.email,
    });
    return NextResponse.json({ deleted: true, scope: "workspace" });
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
