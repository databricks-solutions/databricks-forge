/**
 * Factory-reset helper — deletes ALL application data from Lakebase.
 *
 * Deleting ForgeRun rows cascades to ~15 child tables (use cases,
 * exports, prompt logs, Genie data, dashboards, background jobs, value
 * estimates, roadmap phases, use case tracking, value captures,
 * stakeholder profiles, strategy alignments, Genie engine config, etc.).
 * Environment scans cascade to details, histories, lineage, insights,
 * discovered Genie spaces / dashboards, and asset coverage.
 * Deleting ForgeCommentJob cascades to ForgeCommentProposal.
 * Deleting ForgeConnection cascades to ForgeFabricScan, which cascades
 * to FabricWorkspace/Dataset/Report/Artifact.
 * Deleting ForgeStrategyDocument cascades to ForgeStrategyAlignment.
 *
 * Standalone tables (no cascade parent) are deleted explicitly. Anything
 * the user-isolation refactor added (ACL, usage, quality metrics, demo
 * sessions, fabric migrations, space benchmark/health, health check
 * config) is included so a factory reset really does take the system
 * back to a clean slate before a multi-user rollout.
 *
 * The forge_embeddings table (pgvector, managed outside Prisma) is
 * also truncated so no stale vectors survive a factory reset.
 */

import { withPrisma } from "@/lib/prisma";
import { cancelAllPipelines } from "@/lib/pipeline/engine";
import { logger } from "@/lib/logger";

export async function deleteAllData(): Promise<void> {
  const cancelled = await cancelAllPipelines();
  if (cancelled > 0) {
    logger.info("[reset] Cancelled active pipelines before deleting data", { cancelled });
  }

  // Demo Mode UC objects live outside Lakebase. Drop them BEFORE we
  // truncate the ForgeDemoSession rows, otherwise the synthetic catalogs
  // and schemas will be orphaned in the customer's Unity Catalog.
  // Failures here are logged but non-fatal -- a missing UC catalog is fine.
  try {
    const { cleanupDemoSession } = await import("@/lib/demo/cleanup");
    const { databricksSqlExecutor } = await import("@/lib/ports/defaults/databricks-sql-executor");
    const sessions = await withPrisma((p) => p.forgeDemoSession.findMany({ select: { id: true } }));
    if (sessions.length > 0) {
      logger.info("[reset] Cleaning up demo session UC objects", { count: sessions.length });
      for (const { id: sessionId } of sessions) {
        try {
          await cleanupDemoSession(sessionId, databricksSqlExecutor);
        } catch (err) {
          logger.warn("[reset] Demo session cleanup failed (continuing)", {
            sessionId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  } catch (err) {
    logger.warn("[reset] Demo cleanup module unavailable (skipping UC cleanup)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await withPrisma(async (prisma) => {
    // Truncate the pgvector embeddings table (not managed by Prisma)
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE forge_embeddings`);
    } catch {
      // Table may not exist yet if pgvector was never initialised
      try {
        await prisma.$executeRawUnsafe(`DELETE FROM forge_embeddings`);
      } catch {
        logger.debug("[reset] forge_embeddings table does not exist, skipping");
      }
    }

    await prisma.$transaction([
      // Connections cascade through fabric scans / workspaces / datasets / reports / artifacts
      prisma.forgeFabricMigration.deleteMany(),
      prisma.forgeConnection.deleteMany(),
      // Data gap analyses can be linked to either a scan (cascades) or a run
      // (no cascade) -- delete explicitly so run-linked rows are not orphaned.
      prisma.forgeDataGapAnalysis.deleteMany(),
      // Estate syntheses linked to a scan cascade with the scan, but
      // estate-level rows (scanId null, estateId set) do not -- delete all.
      prisma.forgeEstateSynthesis.deleteMany(),
      // Estate programs cascade to their scopes; member scans are detached
      // (programId -> null) but are deleted below via forgeEnvironmentScan.
      prisma.forgeEstateProgram.deleteMany(),
      // Manual domain overrides cascade from their scan, but delete explicitly
      // so a factory reset is order-independent and unambiguous.
      prisma.forgeDomainOverride.deleteMany(),
      // Environment scans cascade to all per-scan child tables
      prisma.forgeEnvironmentScan.deleteMany(),
      // Strategy documents cascade to alignments before runs are dropped
      prisma.forgeStrategyDocument.deleteMany(),
      // Runs cascade to ~15 child tables (use cases, BV, Genie/Dashboard, exports, BG jobs, ...)
      prisma.forgeRun.deleteMany(),
      // Standalone metric-view proposals have runId=null and therefore do not
      // cascade from ForgeRun.
      prisma.forgeMetricViewProposal.deleteMany(),
      // Quality metrics may have null runId rows — clean those up explicitly
      prisma.forgeQualityMetric.deleteMany(),
      prisma.forgeCommentJob.deleteMany(),
      prisma.forgeMetadataCache.deleteMany(),
      prisma.forgePromptTemplate.deleteMany(),
      prisma.forgeActivityLog.deleteMany(),
      prisma.forgeOutcomeMap.deleteMany(),
      prisma.forgeDocument.deleteMany(),
      prisma.forgeConversation.deleteMany(),
      prisma.forgeAssistantLog.deleteMany(),
      prisma.forgeBenchmarkRecord.deleteMany(),
      prisma.forgeMetadataGenieSpace.deleteMany(),
      prisma.forgeGenieSpaceCache.deleteMany(),
      prisma.forgeDemoSession.deleteMany(),
      prisma.forgeSpaceBenchmarkRun.deleteMany(),
      prisma.forgeSpaceHealthScore.deleteMany(),
      prisma.forgeHealthCheckConfig.deleteMany(),
      // WAF Assessment tables. ForgeWafControlResult cascades from
      // ForgeWafAssessment, so it does not need an explicit deleteMany.
      // The catalog (ForgeWafControl) is workspace-shared seed data and
      // gets re-populated by ensureCatalogSeeded() on the next run, but
      // we drop it here so factory reset is truly a clean slate.
      prisma.forgeWafAssessment.deleteMany(),
      prisma.forgeWafQualitativeResponse.deleteMany(),
      prisma.forgeWafIgnoredResource.deleteMany(),
      prisma.forgeWafControl.deleteMany(),
      // Isolation/accounting tables
      prisma.forgeResourceAcl.deleteMany(),
      prisma.forgeUsage.deleteMany(),
      // Workspace-shared runtime feature flags (singleton row). Next read
      // re-seeds from FORGE_DEMO_MODE_ENABLED so the env var stays the
      // initial default after a factory reset.
      prisma.forgeAppConfig.deleteMany(),
      // Portfolio org-admin allowlist. The deployer bootstrap admin re-seeds
      // from FORGE_PORTFOLIO_BOOTSTRAP_ADMIN on the next portfolio access.
      prisma.forgePortfolioAdmin.deleteMany(),
    ]);
  });

  // Drop the in-memory demo mode cache so the next read re-seeds the row
  // from the env var instead of returning a stale `true` from before reset.
  try {
    const { invalidateDemoModeCache } = await import("@/lib/demo/config");
    invalidateDemoModeCache();
  } catch {
    // demo config module unavailable in tests / partial builds — non-fatal
  }
}

/**
 * Delete only the data owned by a specific user (`ownerEmail`), preserving
 * all other users' resources and workspace-shared configuration.
 */
export async function deleteUserData(ownerEmail: string): Promise<void> {
  const normalized = ownerEmail.toLowerCase().trim();
  if (!normalized) {
    throw new Error("ownerEmail is required for user-scoped data deletion");
  }

  try {
    const { cleanupDemoSession } = await import("@/lib/demo/cleanup");
    const { databricksSqlExecutor } = await import("@/lib/ports/defaults/databricks-sql-executor");
    const sessions = await withPrisma((p) =>
      p.forgeDemoSession.findMany({
        where: { ownerEmail: normalized },
        select: { id: true },
      }),
    );
    for (const { id: sessionId } of sessions) {
      try {
        await cleanupDemoSession(sessionId, databricksSqlExecutor);
      } catch (err) {
        logger.warn("[reset] User demo session cleanup failed (continuing)", {
          sessionId,
          ownerEmail: normalized,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch {
    // non-fatal
  }

  await withPrisma(async (prisma) => {
    await prisma.$transaction([
      prisma.forgeFabricMigration.deleteMany({ where: { ownerEmail: normalized } }),
      prisma.forgeConnection.deleteMany({ where: { ownerEmail: normalized } }),
      prisma.forgeDataGapAnalysis.deleteMany({ where: { ownerEmail: normalized } }),
      prisma.forgeEstateSynthesis.deleteMany({ where: { ownerEmail: normalized } }),
      prisma.forgeEstateProgram.deleteMany({ where: { ownerEmail: normalized } }),
      prisma.forgeEnvironmentScan.deleteMany({ where: { ownerEmail: normalized } }),
      prisma.forgeStrategyDocument.deleteMany({ where: { ownerEmail: normalized } }),
      prisma.forgeRun.deleteMany({ where: { ownerEmail: normalized } }),
      prisma.forgeMetricViewProposal.deleteMany({ where: { ownerEmail: normalized } }),
      prisma.forgeQualityMetric.deleteMany({ where: { ownerEmail: normalized } }),
      prisma.forgeCommentJob.deleteMany({ where: { ownerEmail: normalized } }),
      prisma.forgeDocument.deleteMany({ where: { ownerEmail: normalized } }),
      prisma.forgeConversation.deleteMany({ where: { userId: normalized } }),
      prisma.forgeAssistantLog.deleteMany({ where: { userId: normalized } }),
      prisma.forgeMetadataGenieSpace.deleteMany({ where: { ownerEmail: normalized } }),
      prisma.forgeGenieSpace.deleteMany({ where: { ownerEmail: normalized } }),
      prisma.forgeDemoSession.deleteMany({ where: { ownerEmail: normalized } }),
      prisma.forgeSpaceBenchmarkRun.deleteMany({ where: { ownerEmail: normalized } }),
      prisma.forgeSpaceHealthScore.deleteMany({ where: { ownerEmail: normalized } }),
      prisma.forgeWafAssessment.deleteMany({ where: { ownerEmail: normalized } }),
      prisma.forgeResourceAcl.deleteMany({
        where: { OR: [{ grantedBy: normalized }, { viewerEmail: normalized }] },
      }),
    ]);
  });
}
