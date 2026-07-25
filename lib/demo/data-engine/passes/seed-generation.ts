/**
 * Data Engine Pass 2: Seed Generation
 *
 * Generates CREATE TABLE + INSERT INTO VALUES SQL for each dimension
 * table, then executes via SqlExecutor with retry on failure.
 */

import { resolveEndpoint } from "@/lib/dbx/client";
import { buildBatchColumnCommentDDL } from "@/lib/ai/comment-applier";
import type { LLMClient } from "@/lib/ports/llm-client";
import type { SqlExecutor } from "@/lib/ports/sql-executor";
import type { Logger } from "@/lib/ports/logger";
import type { TableDesign, TablePhase } from "../../types";
import { GENIE_SEED_BIAS, SEED_TABLE_PROMPT } from "../prompts";
import type { DemoDateWindow } from "../date-window";

const MAX_RETRIES = 2;

export async function runSeedGeneration(
  table: TableDesign,
  catalog: string,
  schema: string,
  research: { customerName: string; industryId: string; nomenclature: Record<string, string>; scope?: { division?: string } },
  dateWindow: DemoDateWindow,
  opts: {
    llm: LLMClient;
    sql: SqlExecutor;
    logger: Logger;
    signal?: AbortSignal;
    onPhase?: (phase: TablePhase) => void;
    reviewAndFixSql?: (sql: string, error: string, context?: string) => Promise<string>;
    genieMode?: boolean;
  },
): Promise<{ rowCount: number; error?: string }> {
  const { llm, sql, logger: log, signal, onPhase, reviewAndFixSql, genieMode = false } = opts;

  onPhase?.("generating-sql");

  const prompt = SEED_TABLE_PROMPT
    .replace("{catalog}", catalog)
    .replace("{schema}", schema)
    .replace("{table_name}", table.name)
    .replace("{description}", table.description)
    .replace("{columns_json}", JSON.stringify(table.columns))
    .replace("{customer_name}", research.customerName)
    .replace("{industry_name}", research.industryId)
    .replace("{division}", research.scope?.division ?? "Full Enterprise")
    .replace("{nomenclature}", JSON.stringify(research.nomenclature))
    .replace("{row_target}", String(table.rowTarget))
    .replace(/{start_date}/g, dateWindow.startDate)
    .replace(/{end_date}/g, dateWindow.endDate)
    .replace(/{fy_label}/g, dateWindow.fyLabel)
    .replace(/{date_range_days}/g, String(dateWindow.dateRangeDays))
    .replace("{genie_bias}", genieMode ? GENIE_SEED_BIAS : "");

  const endpoint = resolveEndpoint("sql");

  const response = await llm.chat({
    endpoint,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
    maxTokens: 16_384,
    signal,
  });

  let sqlText = response.content.trim();
  // Strip markdown fences if present
  sqlText = sqlText.replace(/^```(?:sql)?\n?/i, "").replace(/\n?```$/i, "");

  // Split into statements
  const statements = splitStatements(sqlText);

  onPhase?.("executing");

  let retries = 0;
  let lastError = "";

  for (const stmt of statements) {
    let currentSql = stmt;

    while (retries <= MAX_RETRIES) {
      try {
        await sql.execute(currentSql, catalog, schema);
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        log.warn("Seed SQL failed", { table: table.name, retry: retries, error: lastError });

        if (retries >= MAX_RETRIES) {
          onPhase?.("failed");
          return { rowCount: 0, error: lastError };
        }

        onPhase?.("retrying");
        retries++;

        if (reviewAndFixSql) {
          currentSql = await reviewAndFixSql(currentSql, lastError, `Seed table: ${table.name}`);
        }
      }
    }
  }

  await applyColumnComments(table, catalog, schema, sql, log);

  onPhase?.("completed");
  return { rowCount: table.rowTarget };
}

async function applyColumnComments(
  table: TableDesign,
  catalog: string,
  schema: string,
  sql: SqlExecutor,
  log: Logger,
): Promise<void> {
  const fqn = `${catalog}.${schema}.${table.name}`;
  try {
    const columnsWithComments = table.columns
      .filter((c) => c.description)
      .map((c) => ({ columnName: c.name, comment: c.description }));
    if (columnsWithComments.length > 0) {
      await sql.execute(buildBatchColumnCommentDDL(fqn, columnsWithComments));
    }
  } catch (err) {
    log.warn("Failed to apply column comments (non-fatal)", {
      table: table.name,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?=\s*(?:CREATE|INSERT|ALTER|DROP)\b)/i)
    .map((s) => s.trim())
    .filter(Boolean);
}
