/**
 * Next.js Instrumentation -- runs once when the server starts.
 *
 * Registers a SIGTERM handler so Databricks Apps can gracefully stop
 * the process within its 15-second timeout. Without this, the platform
 * force-kills the process and logs:
 *   "[ERROR] App did not respect SIGTERM timeout of 15 seconds."
 */

export async function onRequestError() {
  // Required export -- Next.js uses this for error reporting instrumentation.
  // We don't need custom behavior here.
}

export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const expected: [string, string][] = [
      ["DATABRICKS_HOST", "Databricks workspace URL"],
      ["DATABRICKS_WAREHOUSE_ID", "SQL Warehouse resource binding"],
    ];
    const missing = expected.filter(([key]) => !process.env[key]);
    if (missing.length > 0) {
      const list = missing.map(([k, desc]) => `  - ${k} (${desc})`).join("\n");
      console.warn(
        `[startup] Expected environment variables not yet available:\n${list}\n` +
          "These are normally injected by the Databricks Apps platform or set in .env.local for local dev.",
      );
    } else {
      console.log("[instrumentation] Environment variables validated.");
    }

    process.on("SIGTERM", async () => {
      console.log("[shutdown] SIGTERM received, closing connections...");

      try {
        // Disconnect Prisma / pg pool if it was initialized
        const globalForPrisma = globalThis as unknown as {
          __prisma: { $disconnect: () => Promise<void> } | undefined;
        };
        if (globalForPrisma.__prisma) {
          await globalForPrisma.__prisma.$disconnect();
          console.log("[shutdown] Prisma disconnected.");
        }
      } catch (err) {
        console.error("[shutdown] Error during cleanup:", err);
      }

      console.log("[shutdown] Exiting.");
      process.exit(0);
    });

    console.log("[instrumentation] SIGTERM handler registered.");

    // Proactively warm the database connection so the first user request
    // (typically the dashboard with 10 parallel queries) doesn't trigger a
    // cold credential rotation. If the startup credential is stale, withPrisma
    // handles the retry/rotation cycle here — well before any user request.
    //
    // After the connection is established, mark orphaned background jobs as
    // failed (leftovers from a prior process killed mid-generation).
    const warmupAndOrphanCheck = async () => {
      try {
        const { withPrisma } = await import("@/lib/prisma");
        await withPrisma((prisma) => prisma.forgeRun.count());
        console.log("[instrumentation] Database connection warmed up.");
      } catch (err) {
        console.warn(
          "[instrumentation] Database warm-up failed (will retry on first request):",
          err instanceof Error ? err.message : String(err),
        );
        return;
      }

      try {
        const { markOrphanedJobsFailed, markOrphanCheckComplete } =
          await import("@/lib/lakebase/background-jobs");
        await markOrphanedJobsFailed();
        markOrphanCheckComplete();
      } catch {
        // The lazy check in getPersistedJobStatus will catch any remaining orphans.
      }

      // Re-queue orphan running pipelines (graceful redeploy). The scheduler
      // tick (started below) will promote them when capacity allows.
      try {
        const { requeueOrphanedRunsOnStartup } = await import("@/lib/lakebase/runs");
        const requeued = await requeueOrphanedRunsOnStartup();
        if (requeued > 0) {
          console.log(`[instrumentation] Re-queued ${requeued} orphan running run(s).`);
        }
      } catch (err) {
        console.warn(
          "[instrumentation] Failed to re-queue orphan runs:",
          err instanceof Error ? err.message : String(err),
        );
      }

      // Defensive: refuse to come up if any root table has NULL owner_email
      // rows. These would be invisible under per-user isolation. The check
      // is non-fatal when FORGE_USER_ISOLATION=false (escape hatch).
      try {
        const { assertOwnerEmailIntegrity } = await import("@/lib/lakebase/isolation-guard");
        await assertOwnerEmailIntegrity();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[startup] Isolation integrity check failed:", message);
        // Exit so the platform retries with a visible failure instead of
        // booting with corrupt visibility state.
        process.exit(1);
      }
    };

    setTimeout(() => {
      void warmupAndOrphanCheck();
    }, 500);

    setTimeout(() => {
      void (async () => {
        try {
          await import("@/lib/pipeline/engine");
          const { startScheduler } = await import("@/lib/pipeline/scheduler");
          startScheduler();
          console.log("[instrumentation] Pipeline scheduler started.");
        } catch (err) {
          console.warn(
            "[instrumentation] Failed to start pipeline scheduler:",
            err instanceof Error ? err.message : String(err),
          );
        }

        try {
          const { startDeferredQueue } = await import("@/lib/scheduler/deferred-queue");
          startDeferredQueue();
          console.log("[instrumentation] Deferred-job queue started.");
        } catch (err) {
          console.warn(
            "[instrumentation] Failed to start deferred-job queue:",
            err instanceof Error ? err.message : String(err),
          );
        }
      })();
    }, 1000);
  }
}
