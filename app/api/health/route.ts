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
import { evaluateEndpointReadiness } from "@/lib/dbx/model-admission.mjs";
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

type EndpointValidationState = "completed" | "auth_skipped" | "not_run";

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

  const infrastructureStatus =
    database.status === "ok" && warehouse.status === "ok"
      ? "healthy"
      : database.status === "ok" || warehouse.status === "ok"
        ? "degraded"
        : "unhealthy";
  const modelPool = getPoolAvailability();
  const validationState = endpointValidationState();
  const exhausted = modelPool.available.length === 0;
  // Startup admission is the only fatal endpoint condition: when completed
  // validation admitted no required endpoint, the process can never recover and
  // a restart is the correct remedy. Endpoints that were admitted at startup and
  // later rotated out by runtime 404 handling are reported as degraded instead,
  // because restarting the container cannot bring a deleted endpoint back and a
  // 503 here would put the app into a restart loop.
  const startupAdmissionFatal =
    validationState === "completed" && !evaluateEndpointReadiness(process.env).shouldStart;
  const validationStatus = startupAdmissionFatal
    ? "unhealthy"
    : validationState === "completed" && !exhausted
      ? "healthy"
      : "degraded";
  const overallStatus =
    infrastructureStatus === "unhealthy" || validationStatus === "unhealthy"
      ? "unhealthy"
      : infrastructureStatus === "degraded" || validationStatus === "degraded"
        ? "degraded"
        : "healthy";
  // Unauthenticated callers (load balancers, local probes) get the coarse
  // liveness signal only. Pool sizing is an operational diagnostic and stays
  // behind authentication, alongside the other authenticated-only details.
  const endpointValidationSummary = {
    state: validationState,
    status: validationStatus,
  };
  const endpointValidationDetail = {
    ...endpointValidationSummary,
    configured: modelPool.total,
    available: modelPool.available.length,
    unavailable: modelPool.unavailable.length,
    exhausted,
  };

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
    endpointValidation: endpointValidationSummary,
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
    endpointValidation?: typeof endpointValidationDetail;
    modelPool?: { available: string[]; unavailable: string[]; total: number };
    memory?: ReturnType<typeof getMemorySnapshot>;
  } = {
    ...base,
    endpointValidation: endpointValidationDetail,
    checks: { database, warehouse },
    authRuntime: getDatabaseAuthRuntimeState(),
    userEmail,
    host,
    metricViewsEnabled: isMetricViewsEnabled(),
    demoModeEnabled,
    modelPool,
    memory: getMemorySnapshot(),
  };

  return NextResponse.json(health, { status: httpStatus, headers: cacheHeaders });
}

function endpointValidationState(): EndpointValidationState {
  const state = process.env.FORGE_ENDPOINT_VALIDATION_STATE;
  return state === "completed" || state === "auth_skipped" ? state : "not_run";
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
