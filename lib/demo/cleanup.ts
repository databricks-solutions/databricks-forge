/**
 * Demo data cleanup -- drops Unity Catalog objects and deletes the
 * Lakebase session record.
 *
 * Each DROP is individually wrapped so partial failures don't block
 * the rest of the cleanup.
 */

import { createScopedLogger } from "@/lib/logger";
import {
  getDemoSession,
  getDemoSessionTables,
  deleteDemoSession,
} from "@/lib/lakebase/demo-sessions";
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

const PROTECTED_SCHEMA_NAMES = new Set([
  "default",
  "information_schema",
  "public",
  "main",
  "gold",
  "silver",
  "bronze",
  "prod",
  "production",
  "raw",
  "staging",
]);

/**
 * Only allow `DROP SCHEMA` when the schema name carries an explicit demo
 * prefix/suffix (e.g. `forge_demo_*`, `demo_*`, or `*_demo` produced by
 * `buildSchemaName`) and is never a standard shared/production schema.
 */
export function isSafeDemoSchemaName(schemaName: string): boolean {
  const lower = schemaName.trim().toLowerCase();
  if (!lower || PROTECTED_SCHEMA_NAMES.has(lower)) return false;
  return lower.startsWith("forge_demo_") || lower.startsWith("demo_") || lower.endsWith("_demo");
}

/**
 * Verify a table FQN belongs to the session's `catalogName.schemaName`
 * before issuing `DROP TABLE`.
 */
export function isTableInSessionScope(
  fqn: string,
  catalogName: string,
  schemaName: string,
): boolean {
  const parts = fqn
    .split(".")
    .map((p) => p.replace(/`/g, "").trim().toLowerCase())
    .filter(Boolean);
  if (parts.length !== 3) return false;
  return (
    parts[0] === catalogName.trim().toLowerCase() && parts[1] === schemaName.trim().toLowerCase()
  );
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

  // Step 1: Drop each table (only if it belongs to catalogName.schemaName)
  for (const fqn of tableFqns) {
    if (!isTableInSessionScope(fqn, catalogName, schemaName)) {
      log.warn("Refusing to drop table outside demo session scope", {
        fqn,
        catalogName,
        schemaName,
      });
      result.tablesFailed.push(fqn);
      continue;
    }
    try {
      await sql.execute(`DROP TABLE IF EXISTS ${fqn}`);
      result.tablesDropped++;
    } catch (err) {
      log.warn("Failed to drop table", { fqn, error: String(err) });
      result.tablesFailed.push(fqn);
    }
  }

  // Step 2: Drop the schema (only if it is a demo-named schema AND empty)
  if (isSafeDemoSchemaName(schemaName)) {
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
  } else {
    log.warn("Refusing to drop non-demo schema", { catalogName, schemaName });
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
