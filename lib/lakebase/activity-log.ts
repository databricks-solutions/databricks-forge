/**
 * CRUD operations for the activity audit log — backed by Lakebase (Prisma).
 *
 * Records user actions (run creation, deletion, exports, etc.) for
 * dashboard activity feeds and audit trails.
 */

import { randomUUID } from "crypto";
import { withPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActivityAction =
  | "created_run"
  | "started_pipeline"
  | "completed"
  | "failed"
  | "deleted_run"
  | "exported"
  | "updated_run_industry"
  | "created_comment_job"
  | "applied_comments"
  | "undone_comments"
  | "deleted_comment_job"
  | "scanned_schema"
  | "parsed_requirements"
  | "started_auto_improve"
  | "completed_auto_improve"
  | "synced_genie_spaces"
  | "rerun_business_value"
  | "demo_research"
  | "demo_generate"
  | "demo_cleanup"
  | "demo_genie_space_deployed"
  | "pipeline_queued"
  | "pipeline_promoted"
  | "pipeline_cancelled"
  | "endpoint_throttled"
  | "resource_shared"
  | "resource_unshared"
  | "waf_assessment_started"
  | "waf_assessment_completed"
  | "waf_assessment_failed"
  | "waf_dashboard_generated"
  | "waf_genie_generated"
  | "bv_step_degraded"
  | "app_config_updated"
  | "sql_engine_started"
  | "sql_engine_completed"
  | "sql_engine_failed"
  | "sql_engine_cancelled"
  | "sql_engine_regenerated"
  | "created_program"
  | "deleted_program"
  | "started_program_sequence"
  | "estate_synthesis_generated"
  | "estate_data_gap_computed"
  | "estate_domain_override_set"
  | "estate_domain_override_removed"
  | "estate_sequence_paused"
  | "estate_sequence_cancelled"
  | "estate_sequence_resumed"
  | "estate_sequence_scope_retried"
  | "portfolio_viewed"
  | "portfolio_exported"
  | "portfolio_admin_granted"
  | "portfolio_admin_revoked"
  | "metric_view_validated"
  | "metric_view_validation_failed"
  | "metric_view_validation_unverified"
  | "metric_view_deployed"
  | "dashboard_validated"
  | "dashboard_validation_failed"
  | "dashboard_deployed"
  | "metric_view_improve_planned"
  | "semantic_manifest_built"
  | "dashboard_draft_deployed"
  | "dashboard_readback_failed"
  | "dashboard_published"
  | "dashboard_publish_failed"
  | "dashboard_improved";

export interface ActivityLogEntry {
  activityId: string;
  userId: string | null;
  action: ActivityAction;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Insert (fire-and-forget safe)
// ---------------------------------------------------------------------------

/**
 * Log an activity event. Designed to be called fire-and-forget so logging
 * failures never block the main operation.
 */
export async function logActivity(
  action: ActivityAction,
  opts: {
    userId?: string | null;
    resourceId?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  try {
    await withPrisma(async (prisma) => {
      await prisma.forgeActivityLog.create({
        data: {
          activityId: randomUUID(),
          userId: opts.userId ?? null,
          action,
          resourceId: opts.resourceId ?? null,
          metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
        },
      });
    });
  } catch (error) {
    logger.warn("Failed to log activity", {
      action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Get the most recent activity entries for the dashboard feed.
 *
 * When `userEmail` is provided, results are scoped to entries owned by
 * that user (or with `userId IS NULL` for legacy/system entries). This
 * is the default for the per-user feed.
 */
export async function getRecentActivity(
  limit = 20,
  opts?: { userEmail?: string },
): Promise<ActivityLogEntry[]> {
  return withPrisma(async (prisma) => {
    const where = opts?.userEmail ? { userId: opts.userEmail } : undefined;
    const rows = await prisma.forgeActivityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(dbRowToActivity);
  });
}

/**
 * Get activity entries for a specific resource (run).
 */
export async function getActivityForResource(resourceId: string): Promise<ActivityLogEntry[]> {
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeActivityLog.findMany({
      where: { resourceId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(dbRowToActivity);
  });
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function dbRowToActivity(row: {
  activityId: string;
  userId: string | null;
  action: string;
  resourceId: string | null;
  metadata: string | null;
  createdAt: Date;
}): ActivityLogEntry {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      /* ignore */
    }
  }
  return {
    activityId: row.activityId,
    userId: row.userId,
    action: row.action as ActivityAction,
    resourceId: row.resourceId,
    metadata,
    createdAt: row.createdAt.toISOString(),
  };
}
