/**
 * Demo data cleanup -- drops Unity Catalog objects and deletes the
 * Lakebase session record.
 *
 * Each DROP is individually wrapped so partial failures don't block
 * the rest of the cleanup.
 */

import { createScopedLogger } from "@/lib/logger";
import { getDemoSession, getDemoSessionTables, deleteDemoSession } from "@/lib/lakebase/demo-sessions";
import { logActivity } from "@/lib/lakebase/activity-log";
import { deleteEmbeddingsBySource } from "@/lib/embeddings/store";
import type { SqlExecutor } from "@/lib/ports/sql-executor";

const log = createScopedLogger({ origin: "DemoCleanup", module: "demo/cleanup" });

export interface CleanupResult {
  sessionId: string;
  tablesDropped: number;
  tablesFailed: string[];
  schemaDropped: boolean;
  catalogDropped: boolean;
  lakebaseDeleted: boolean;
}

export async function cleanupDemoSession(
  sessionId: string,
  sql: SqlExecutor,
): Promise<CleanupResult> {
  const result: CleanupResult = {
    sessionId,
    tablesDropped: 0,
    tablesFailed: [],
    schemaDropped: false,
    catalogDropped: false,
    lakebaseDeleted: false,
  };

  const session = await getDemoSession(sessionId);
  if (!session) {
    log.warn("Session not found", { sessionId });
    return result;
  }

  const { catalogName, schemaName } = session;
  const tableFqns = await getDemoSessionTables(sessionId);

  // Step 1: Drop each table
  for (const fqn of tableFqns) {
    try {
      await sql.execute(`DROP TABLE IF EXISTS ${fqn}`);
      result.tablesDropped++;
    } catch (err) {
      log.warn("Failed to drop table", { fqn, error: String(err) });
      result.tablesFailed.push(fqn);
    }
  }

  // Step 2: Drop the schema (only if empty)
  try {
    const remaining = await sql.execute(
      `SHOW TABLES IN ${quoteIdentifier(catalogName)}.${quoteIdentifier(schemaName)}`,
    );
    if (remaining.rows.length === 0) {
      await sql.execute(
        `DROP SCHEMA IF EXISTS ${quoteIdentifier(catalogName)}.${quoteIdentifier(schemaName)}`,
      );
      result.schemaDropped = true;
    } else {
      log.info("Schema not empty after table drops, skipping schema drop", {
        catalogName,
        schemaName,
        remaining: remaining.rows.length,
      });
    }
  } catch (err) {
    log.warn("Failed to drop schema", { catalogName, schemaName, error: String(err) });
  }

  // Step 3: Optionally drop catalog (if we created it and it's empty)
  try {
    // catalogCreated is tracked in the raw row -- check via a direct query.
    // For now, skip catalog drops (conservative default).
  } catch {
    // best-effort
  }

  // Step 4: Delete research embeddings
  try {
    await deleteEmbeddingsBySource(sessionId);
    log.info("Deleted research embeddings", { sessionId });
  } catch (err) {
    log.warn("Failed to delete research embeddings (non-fatal)", {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 5: Delete Lakebase record
  result.lakebaseDeleted = await deleteDemoSession(sessionId);

  // Step 6: Audit log
  await logActivity("demo_cleanup", {
    resourceId: sessionId,
    metadata: {
      customerName: session.customerName,
      catalogName,
      schemaName,
      tablesDropped: result.tablesDropped,
      tablesFailed: result.tablesFailed,
    },
  });

  log.info("Cleanup complete", { ...result });
  return result;
}

function quoteIdentifier(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}
