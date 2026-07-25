/**
 * API: /api/genie-spaces/health-config
 *
 * GET  -- Retrieve health check configuration (overrides, custom checks, weights)
 * PUT  -- Update health check configuration
 */

import { NextRequest, NextResponse } from "next/server";
import { getHealthCheckConfig, saveHealthCheckConfig } from "@/lib/lakebase/space-health";
import { resolveRegistry } from "@/lib/genie/health-checks/registry";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";

export async function GET() {
  try {
    const config = await getHealthCheckConfig();
    const registry = resolveRegistry(
      config.overrides.length > 0 ? config.overrides : undefined,
      config.customChecks.length > 0 ? config.customChecks : undefined,
      config.categoryWeights ?? undefined,
    );

    return NextResponse.json({
      config,
      resolvedChecks: registry.checks,
      categories: registry.categories,
      validationErrors: registry.validationErrors,
    });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { overrides, customChecks, categoryWeights } = body;

    const registry = resolveRegistry(overrides, customChecks, categoryWeights);
    if (registry.validationErrors.length > 0) {
      return NextResponse.json(
        { error: "Validation errors", details: registry.validationErrors },
        { status: 400 },
      );
    }

    await saveHealthCheckConfig({
      overrides: overrides ?? [],
      customChecks: customChecks ?? [],
      categoryWeights: categoryWeights ?? null,
    });

    logger.info("Health check config updated");
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
