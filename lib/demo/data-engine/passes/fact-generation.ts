/**
 * Data Engine Pass 3: Fact Generation
 *
 * Generates CREATE TABLE AS SELECT (CTAS) SQL for each fact table,
 * referencing seed/dimension tables via FK lookups, with narrative
 * patterns embedded as temporal and distributional SQL expressions.
 */

import { resolveEndpoint } from "@/lib/dbx/client";
import { buildBatchColumnCommentDDL } from "@/lib/ai/comment-applier";
import type { LLMClient } from "@/lib/ports/llm-client";
import type { SqlExecutor } from "@/lib/ports/sql-executor";
import type { Logger } from "@/lib/ports/logger";
import type { TableDesign, TablePhase, DataNarrative } from "../../types";
import { FACT_TABLE_PROMPT, GENIE_FACT_BIAS } from "../prompts";
import type { DemoDateWindow } from "../date-window";

const MAX_RETRIES = 2;

function buildFactPrompt(
  table: TableDesign,
  catalog: string,
  schema: string,
  dims: TableDesign[],
  narratives: DataNarrative[],
  research: { customerName: string; industryId: string; nomenclature: Record<string, string> },
  dateWindow: DemoDateWindow,
  extraConstraints?: string,
  genieMode = false,
): string {
  const relatedNarratives = narratives.filter((n) =>
    n.affectedTables.includes(table.name),
  );
  const dimensionContext = dims
    .map((d) => `${d.name}: ${d.columns.map((c) => `${c.name} ${c.dataType}`).join(", ")}`)
    .join("\n");

  let prompt = FACT_TABLE_PROMPT
    .replace("{catalog}", catalog)
    .replace("{schema}", schema)
    .replace("{table_name}", table.name)
    .replace("{description}", table.description)
    .replace("{columns_json}", JSON.stringify(table.columns))
    .replace(/{row_target}/g, String(table.rowTarget))
    .replace("{dimension_tables_context}", dimensionContext)
    .replace("{narrative_context}", JSON.stringify(relatedNarratives))
    .replace("{customer_name}", research.customerName)
    .replace("{industry_name}", research.industryId)
    .replace("{nomenclature}", JSON.stringify(research.nomenclature))
    .replace(/{start_date}/g, dateWindow.startDate)
    .replace(/{end_date}/g, dateWindow.endDate)
    .replace(/{fy_label}/g, dateWindow.fyLabel)
    .replace(/{date_range_days}/g, String(dateWindow.dateRangeDays))
    .replace("{genie_bias}", genieMode ? GENIE_FACT_BIAS : "");

  if (extraConstraints) prompt += `\n\n${extraConstraints}`;
  return prompt;
}

function extractMissingTable(error: string): string | null {
  const m = error.match(/`([^`]+)`\.`([^`]+)`\.`([^`]+)`\s+cannot be found/);
  return m ? m[3] : null;
}

export async function runFactGeneration(
  table: TableDesign,
  catalog: string,
  schema: string,
  dimensionTables: TableDesign[],
  narratives: DataNarrative[],
  research: { customerName: string; industryId: string; nomenclature: Record<string, string> },
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

  const prompt = buildFactPrompt(table, catalog, schema, dimensionTables, narratives, research, dateWindow, undefined, genieMode);
  const endpoint = resolveEndpoint("sql");

  const response = await llm.chat({
    endpoint,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
    maxTokens: 16_384,
    signal,
  });

  let sqlText = response.content.trim();
  sqlText = sqlText.replace(/^```(?:sql)?\n?/i, "").replace(/\n?```$/i, "");

  onPhase?.("executing");

  let retries = 0;
  let currentSql = sqlText;
  const excludedTables = new Set<string>();

  while (retries <= MAX_RETRIES) {
    try {
      await sql.execute(currentSql, catalog, schema);
      break;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn("Fact SQL failed", { table: table.name, retry: retries, error });

      if (retries >= MAX_RETRIES) {
        onPhase?.("failed");
        return { rowCount: 0, error };
      }

      onPhase?.("retrying");
      retries++;

      if (error.includes("TABLE_OR_VIEW_NOT_FOUND")) {
        const missingTable = extractMissingTable(error);
        if (missingTable) excludedTables.add(missingTable);

        const filteredDims = dimensionTables.filter((d) => !excludedTables.has(d.name));
        const constraint = excludedTables.size > 0
          ? `IMPORTANT: These tables do NOT exist -- do NOT reference them: ${[...excludedTables].join(", ")}. Generate all date/time values inline using DATE_ADD(CURRENT_DATE(), ...) and built-in functions.`
          : undefined;

        log.info("Re-generating SQL excluding missing tables", {
          table: table.name,
          excluded: [...excludedTables],
        });

        const retryPrompt = buildFactPrompt(table, catalog, schema, filteredDims, narratives, research, dateWindow, constraint, genieMode);
        const retryResponse = await llm.chat({
          endpoint,
          messages: [{ role: "user", content: retryPrompt }],
          temperature: 0.2,
          maxTokens: 16_384,
          signal,
        });
        currentSql = retryResponse.content.trim();
        currentSql = currentSql.replace(/^```(?:sql)?\n?/i, "").replace(/\n?```$/i, "");
      } else if (reviewAndFixSql) {
        currentSql = await reviewAndFixSql(currentSql, error, `Fact table: ${table.name}`);
      }
    }
  }

  await applyColumnComments(table, catalog, schema, sql, log);

  onPhase?.("completed");
  return { rowCount: table.rowTarget };
}

/**
 * Regenerate a fact table's data when the freshness validation check flagged
 * it as outside the demo window. This is a single-shot retry triggered from
 * the engine, separate from the inline MAX_RETRIES loop above.
 */
export async function regenerateFactForFreshness(
  table: TableDesign,
  catalog: string,
  schema: string,
  dimensionTables: TableDesign[],
  narratives: DataNarrative[],
  research: { customerName: string; industryId: string; nomenclature: Record<string, string> },
  dateWindow: DemoDateWindow,
  observed: { columnName: string; minDate: string; maxDate: string },
  opts: {
    llm: LLMClient;
    sql: SqlExecutor;
    logger: Logger;
    signal?: AbortSignal;
    onPhase?: (phase: TablePhase) => void;
    genieMode?: boolean;
  },
): Promise<{ rowCount: number; error?: string }> {
  const { llm, sql, logger: log, signal, onPhase, genieMode = false } = opts;

  const corrective = `IMPORTANT: Previous run produced \`${observed.columnName}\` values between ${observed.minDate} and ${observed.maxDate}, which is outside the demo window (${dateWindow.startDate} to today). Regenerate so every date/timestamp lies between DATE '${dateWindow.startDate}' and CURRENT_DATE(). Do NOT use any hardcoded year literal. Bias at least 40% of rows into the last 90 days.`;

  onPhase?.("retrying");

  const prompt = buildFactPrompt(
    table,
    catalog,
    schema,
    dimensionTables,
    narratives,
    research,
    dateWindow,
    corrective,
    genieMode,
  );
  const endpoint = resolveEndpoint("sql");

  const response = await llm.chat({
    endpoint,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
    maxTokens: 16_384,
    signal,
  });

  let sqlText = response.content.trim();
  sqlText = sqlText.replace(/^```(?:sql)?\n?/i, "").replace(/\n?```$/i, "");

  onPhase?.("executing");

  try {
    await sql.execute(sqlText, catalog, schema);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn("Fact freshness retry failed", { table: table.name, error });
    onPhase?.("failed");
    return { rowCount: 0, error };
  }

  onPhase?.("completed");
  log.info("Fact freshness retry succeeded", {
    table: table.name,
    priorMin: observed.minDate,
    priorMax: observed.maxDate,
    window: `${dateWindow.startDate}..${dateWindow.endDate}`,
  });

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
