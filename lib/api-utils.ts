/**
 * Shared API route utilities.
 *
 * Eliminates repeated boilerplate across 100+ Next.js API routes:
 *   - Error handling with structured logging + safe client messages
 *   - Run/resource validation with consistent 400/404 responses
 *   - Databricks REST API response assertion
 */

import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";
import { isValidUUID, isSafeId } from "@/lib/validation";
import { getRunById } from "@/lib/lakebase/runs";
import type { PipelineRun } from "@/lib/domain/types";

/**
 * Standard catch-block handler for API routes.
 * Logs the raw error server-side and returns a sanitised message to the client.
 */
export function handleApiError(error: unknown, context: string, status = 500): NextResponse {
  const raw = error instanceof Error ? error.message : String(error);
  logger.error(`[${context}]`, { error: raw });
  return NextResponse.json({ error: safeErrorMessage(error) }, { status });
}

/**
 * Validate a run ID and fetch the run, returning an error response if invalid
 * or not found. Returns either the run or a NextResponse (error).
 */
export async function requireRun(runId: string): Promise<PipelineRun | NextResponse> {
  if (!isValidUUID(runId)) {
    return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
  }
  const run = await getRunById(runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return run;
}

/**
 * Validate a generic safe ID (alphanumeric + hyphens/underscores).
 * Returns null if valid, or a NextResponse error if invalid.
 */
export function requireSafeId(id: string, label = "ID"): NextResponse | null {
  if (!isSafeId(id)) {
    return NextResponse.json({ error: `Invalid ${label}` }, { status: 400 });
  }
  return null;
}

/**
 * Assert a fetch Response is OK; throw with context if not.
 * Use in Databricks REST API call sites to replace repeated
 * `if (!response.ok) { ... throw ... }` blocks.
 */
export async function assertOk(response: Response, context: string): Promise<void> {
  if (!response.ok) {
    const text = await response.text().catch(() => "(unreadable body)");
    throw new Error(`${context} failed (${response.status}): ${text}`);
  }
}

/**
 * Type guard: returns true if the value is a NextResponse (error).
 * Use after `requireRun()` or `requireSafeId()` to narrow the type.
 */
export function isErrorResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}
