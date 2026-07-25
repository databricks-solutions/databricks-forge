/**
 * API: /api/settings/feature-flags
 *
 * GET   -- return current workspace-shared runtime feature flags.
 * PATCH -- update one or more feature flags. Body: { demoModeEnabled?: boolean }.
 *
 * Workspace-shared (not per-user). Any authenticated user can toggle, mirroring
 * how every other setting in the Settings page works today. Toggle events are
 * recorded to the activity log for audit.
 */

import { NextResponse } from "next/server";
import {
  isDemoModeEnabled,
  setDemoModeEnabled,
} from "@/lib/demo/config";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { logActivity } from "@/lib/lakebase/activity-log";
import { logger } from "@/lib/logger";

export async function GET(request: Request) {
  try {
    await requireUser(request);
  } catch (e) {
    if (e instanceof ForgeAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  try {
    const demoModeEnabled = await isDemoModeEnabled();
    return NextResponse.json(
      { demoModeEnabled },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    logger.error("[settings/feature-flags] GET failed", { error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  let user;
  try {
    user = await requireUser(request);
  } catch (e) {
    if (e instanceof ForgeAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch = (body ?? {}) as { demoModeEnabled?: unknown };

  if (
    patch.demoModeEnabled !== undefined &&
    typeof patch.demoModeEnabled !== "boolean"
  ) {
    return NextResponse.json(
      { error: "demoModeEnabled must be a boolean" },
      { status: 400 },
    );
  }

  try {
    if (typeof patch.demoModeEnabled === "boolean") {
      const previous = await isDemoModeEnabled();
      if (previous !== patch.demoModeEnabled) {
        await setDemoModeEnabled(patch.demoModeEnabled, user.email);
        logActivity("app_config_updated", {
          userId: user.email,
          metadata: {
            field: "demoModeEnabled",
            previous,
            next: patch.demoModeEnabled,
          },
        }).catch(() => {});
      }
    }

    const demoModeEnabled = await isDemoModeEnabled();
    return NextResponse.json(
      { demoModeEnabled },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    logger.error("[settings/feature-flags] PATCH failed", { error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
