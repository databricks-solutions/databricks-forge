/**
 * API: /api/health
 *
 * GET -- health check for load balancers and monitoring.
 *
 * Checks:
 *   - Database connectivity (Prisma)
 *   - Databricks SQL Warehouse reachability
 *   - Application version
 */

import { NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { getDatabaseAuthRuntimeState, getPrisma } from "@/lib/prisma";
import { executeSQL } from "@/lib/dbx/sql";
import { getCurrentUserEmail, getConfig } from "@/lib/dbx/client";
import { isMetricViewsEnabled } from "@/lib/genie/metric-views-config";
import { isDemoModeEnabled } from "@/lib/demo/config";
import { getPoolAvailability } from "@/lib/dbx/model-registry";
import { getMemorySnapshot } from "@/lib/pipeline/memory-monitor";
import packageJson from "@/package.json";

interface HealthCheck {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  uptime: number;
  timestamp: string;
  checks: {
    database: CheckResult;
    warehouse: CheckResult;
  };
  authRuntime?: {
    ready: boolean;
    authMode: "oauth";
  };
}

interface CheckResult {
  status: "ok" | "error";
  latencyMs: number;
  error?: string;
}

const startTime = Date.now();

export async function GET(request: Request) {
  const checks = await Promise.allSettled([checkDatabase(), checkWarehouse(), isDemoModeEnabled()]);

  const database: CheckResult =
    checks[0].status === "fulfilled"
      ? (checks[0].value as CheckResult)
      : { status: "error", latencyMs: 0, error: String(checks[0].reason) };

  const warehouse: CheckResult =
    checks[1].status === "fulfilled"
      ? (checks[1].value as CheckResult)
      : { status: "error", latencyMs: 0, error: String(checks[1].reason) };

  const demoModeEnabled: boolean =
    checks[2].status === "fulfilled" ? (checks[2].value as boolean) : false;

  const overallStatus =
    database.status === "ok" && warehouse.status === "ok"
      ? "healthy"
      : database.status === "ok" || warehouse.status === "ok"
        ? "degraded"
        : "unhealthy";

  const hdrs = new Headers(request.headers);
  const isAuthenticated =
    !!hdrs.get("x-forwarded-email") ||
    !!hdrs.get("x-forwarded-access-token") ||
    !!hdrs.get("x-forwarded-preferred-username") ||
    !!process.env.DATABRICKS_HOST;

  // Genie Studio is hidden by default; a deployment opts in via env flag.
  const genieStudioEnabled =
    process.env.FORGE_GENIE_STUDIO_ENABLED === "true" ||
    process.env.FORGE_GENIE_STUDIO_ENABLED === "1";

  const base = {
    status: overallStatus as HealthCheck["status"],
    version: packageJson.version,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    demoModeEnabled,
    genieStudioEnabled,
  };

  const httpStatus = overallStatus === "unhealthy" ? 503 : 200;
  const cacheHeaders = {
    "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
  };

  if (!isAuthenticated) {
    return NextResponse.json(base, { status: httpStatus, headers: cacheHeaders });
  }

  let userEmail: string | null = null;
  let host: string | null = null;
  try {
    userEmail = await getCurrentUserEmail();
    host = getConfig().host;
  } catch {
    // Non-critical
  }

  const health: HealthCheck & {
    userEmail?: string | null;
    host?: string | null;
    metricViewsEnabled?: boolean;
    demoModeEnabled?: boolean;
    genieStudioEnabled?: boolean;
    modelPool?: { available: string[]; unavailable: string[]; total: number };
    memory?: ReturnType<typeof getMemorySnapshot>;
  } = {
    ...base,
    checks: { database, warehouse },
    authRuntime: getDatabaseAuthRuntimeState(),
    userEmail,
    host,
    metricViewsEnabled: isMetricViewsEnabled(),
    demoModeEnabled,
    modelPool: getPoolAvailability(),
    memory: getMemorySnapshot(),
  };

  return NextResponse.json(health, { status: httpStatus, headers: cacheHeaders });
}

async function checkDatabase(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const prisma = await getPrisma();
    await prisma.$queryRawUnsafe("SELECT 1");
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (error) {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      error: safeErrorMessage(error),
    };
  }
}

async function checkWarehouse(): Promise<CheckResult> {
  const start = Date.now();
  try {
    await executeSQL("SELECT 1");
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (error) {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      error: safeErrorMessage(error),
    };
  }
}
