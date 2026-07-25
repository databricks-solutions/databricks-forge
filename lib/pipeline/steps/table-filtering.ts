/**
 * Pipeline Step 3: Table Filtering
 *
 * Classifies tables as business-relevant vs technical using Model Serving
 * (JSON mode). Returns a filtered list of FQNs to include in use case
 * generation.
 */

import { executeAIQuery } from "@/lib/ai/agent";
import { resolveEndpoint } from "@/lib/dbx/client";
import "@/lib/skills/content";
import { resolveForPipelineStep, formatContextSections } from "@/lib/skills/resolver";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import {
  updateRunMessage,
  updateRunFilteredTables,
  getSchemaSnapshot,
  updateSchemaSnapshot,
} from "@/lib/lakebase/runs";
import { logger as fallbackLogger } from "@/lib/logger";
import type { ColumnInfo, PipelineContext, TableInfo } from "@/lib/domain/types";

/** Classification record for a table — stored as audit trail in Lakebase. */
export interface TableClassification {
  fqn: string;
  classification: string;
  reason: string;
}

const BATCH_SIZE = 100; // tables per Model Serving call
const MAX_COLUMNS_PER_TABLE = 8; // top columns shown to aid classification
const MAX_FILTER_RETRIES = 2;
const TECHNICAL_TABLE_RE =
  /(logs?|audit|changelog|snapshot|backup|monitor|health|debug|error|etl|pipeline|staging|temp|tmp|config|setting|metric)/i;

/**
 * Build a markdown table list for the prompt, including top column names
 * to improve classification accuracy.
 */
function buildTablesMarkdown(tables: TableInfo[], columnsByTable: Map<string, string[]>): string {
  return tables
    .map((t) => {
      const comment = t.comment ? ` -- ${t.comment}` : "";
      const cols = columnsByTable.get(t.fqn);
      const colHint =
        cols && cols.length > 0
          ? ` [columns: ${cols.slice(0, MAX_COLUMNS_PER_TABLE).join(", ")}${cols.length > MAX_COLUMNS_PER_TABLE ? ", ..." : ""}]`
          : "";
      return `- ${t.fqn} (${t.tableType})${comment}${colHint}`;
    })
    .join("\n");
}

/**
 * Group columns by table FQN for efficient lookup.
 */
function buildColumnIndex(columns: ColumnInfo[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const col of columns) {
    const existing = index.get(col.tableFqn);
    if (existing) {
      existing.push(col.columnName);
    } else {
      index.set(col.tableFqn, [col.columnName]);
    }
  }
  return index;
}

export async function runTableFiltering(ctx: PipelineContext, runId?: string): Promise<string[]> {
  const log = ctx.logger ?? fallbackLogger;
  const { run, metadata } = ctx;
  if (!metadata) throw new Error("Metadata not available for table filtering");
  if (!run.businessContext) throw new Error("Business context not available");

  const tables = metadata.tables;
  const columnIndex = buildColumnIndex(metadata.columns);

  // If very few tables, skip filtering -- include all
  if (tables.length <= 5) {
    if (runId)
      await updateRunMessage(
        runId,
        `Skipping filter — only ${tables.length} tables, including all`,
      );
    return tables.map((t) => t.fqn);
  }

  const businessTables: string[] = [];
  const allClassifications: TableClassification[] = [];
  const totalBatches = Math.ceil(tables.length / BATCH_SIZE);

  // Process in batches
  for (let i = 0; i < tables.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = tables.slice(i, i + BATCH_SIZE);
    if (runId)
      await updateRunMessage(runId, `Filtering tables (batch ${batchNum} of ${totalBatches})...`);
    try {
      const { filteredFqns, classifications } = await filterBatchWithRetry(
        batch,
        columnIndex,
        run.config.businessName,
        run.businessContext,
        resolveEndpoint("classification"),
        runId,
      );
      businessTables.push(...filteredFqns);
      allClassifications.push(...classifications);
    } catch (error) {
      // Deterministic fallback to avoid broad fail-open behavior.
      log.warn("Table filtering batch failed, using deterministic fallback", {
        fn: "runTableFiltering",
        errorCategory: "llm_error",
        batch: batchNum,
        error: error instanceof Error ? error.message : String(error),
      });
      const fallback = deterministicFallbackClassify(batch);
      businessTables.push(...fallback.filteredFqns);
      allClassifications.push(...fallback.classifications);
    }
  }

  // Persist the full classification data for auditing
  if (runId && allClassifications.length > 0) {
    try {
      await updateRunFilteredTables(runId, allClassifications);
    } catch (error) {
      log.warn("Failed to persist table classifications", {
        fn: "runTableFiltering",
        errorCategory: "db",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Stamp isBusinessTable flag on the schema snapshot
    try {
      const snapshot = await getSchemaSnapshot(runId);
      if (snapshot) {
        const businessFqnSet = new Set(businessTables);
        for (const fqn of Object.keys(snapshot)) {
          snapshot[fqn].isBusinessTable = businessFqnSet.has(fqn);
        }
        await updateSchemaSnapshot(runId, snapshot);
      }
    } catch (error) {
      log.warn("Failed to update schema snapshot with business flags", {
        fn: "runTableFiltering",
        errorCategory: "db",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const lineageFqns = new Set(metadata.lineageDiscoveredFqns ?? []);
  const selectedCount = businessTables.filter((fqn) => !lineageFqns.has(fqn)).length;
  const lineageCount = businessTables.filter((fqn) => lineageFqns.has(fqn)).length;
  const lineageNote =
    lineageCount > 0
      ? `: ${selectedCount} from your selection + ${lineageCount} discovered via lineage`
      : "";
  if (runId)
    await updateRunMessage(
      runId,
      `Identified ${businessTables.length} business-relevant tables out of ${tables.length}${lineageNote}`,
    );

  log.info("Table filtering complete", {
    businessTables: businessTables.length,
    totalTables: tables.length,
    fromSelection: selectedCount,
    fromLineage: lineageCount,
  });

  return businessTables;
}

async function filterBatchWithRetry(
  tables: TableInfo[],
  columnIndex: Map<string, string[]>,
  businessName: string,
  businessContext: { industries: string },
  aiModel: string,
  runId?: string,
): Promise<{ filteredFqns: string[]; classifications: TableClassification[] }> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= MAX_FILTER_RETRIES; attempt++) {
    try {
      return await filterBatch(tables, columnIndex, businessName, businessContext, aiModel, runId);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_FILTER_RETRIES) {
        fallbackLogger.warn("Retrying table filtering batch", {
          fn: "runTableFiltering",
          errorCategory: "llm_error",
          attempt: attempt + 1,
          maxRetries: MAX_FILTER_RETRIES,
        });
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Table filtering failed after retries");
}

function deterministicFallbackClassify(tables: TableInfo[]): {
  filteredFqns: string[];
  classifications: TableClassification[];
} {
  const classifications: TableClassification[] = [];
  const filteredFqns: string[] = [];
  for (const t of tables) {
    const haystack = `${t.fqn} ${t.tableName} ${t.comment ?? ""}`;
    const technical = TECHNICAL_TABLE_RE.test(haystack);
    const classification = technical ? "technical" : "business";
    classifications.push({
      fqn: t.fqn,
      classification,
      reason: technical
        ? "deterministic fallback: technical naming pattern"
        : "deterministic fallback: business default",
    });
    if (!technical) filteredFqns.push(t.fqn);
  }
  if (filteredFqns.length === 0) {
    // Fail-safe: if deterministic classifier is too aggressive, keep all.
    return {
      filteredFqns: tables.map((t) => t.fqn),
      classifications: tables.map((t) => ({
        fqn: t.fqn,
        classification: "business",
        reason: "deterministic fallback safety override",
      })),
    };
  }
  return { filteredFqns, classifications };
}

/** Shape of each item in the JSON array returned by the LLM. */
interface TableClassificationItem {
  table_fqn?: string;
  classification?: string;
  reason?: string;
}

async function filterBatch(
  tables: TableInfo[],
  columnIndex: Map<string, string[]>,
  businessName: string,
  businessContext: { industries: string },
  aiModel: string,
  runId?: string,
): Promise<{ filteredFqns: string[]; classifications: TableClassification[] }> {
  const result = await executeAIQuery({
    promptKey: "FILTER_BUSINESS_TABLES_PROMPT",
    variables: {
      business_name: businessName,
      industry: businessContext.industries,
      business_context: JSON.stringify(businessContext),
      exclusion_strategy:
        "Exclude only tables that are PURELY technical infrastructure (system logs, audit trails, internal monitoring). When in doubt, classify as business.",
      additional_context_section: formatContextSections(
        resolveForPipelineStep("table-filtering", { contextBudget: 1500 }).contextSections,
      ),
      strategy_rules:
        "Default to BUSINESS classification. Only mark as TECHNICAL if the table has zero business relevance.",
      tables_markdown: buildTablesMarkdown(tables, columnIndex),
    },
    modelEndpoint: aiModel,
    responseFormat: "json_object",
    runId,
    step: "table-filtering",
    maxTokens: 128000,
  });

  let items: TableClassificationItem[];
  try {
    const parsed = parseLLMJson(result.rawResponse, "table-filtering") as
      | TableClassificationItem[]
      | { classifications: TableClassificationItem[] };
    items = Array.isArray(parsed) ? parsed : (parsed.classifications ?? []);
  } catch (parseErr) {
    fallbackLogger.warn("Failed to parse table filtering JSON", {
      fn: "runTableFiltering",
      errorCategory: "llm_parse",
      error: parseErr instanceof Error ? parseErr.message : String(parseErr),
    });
    throw parseErr instanceof Error ? parseErr : new Error("Parse failure in table filtering");
  }

  const businessFQNs: string[] = [];
  const classifications: TableClassification[] = [];

  for (const item of items) {
    const fqn = item.table_fqn?.trim();
    const classification = item.classification?.trim().toLowerCase();
    const reason = item.reason?.trim() ?? "";
    if (fqn) {
      classifications.push({ fqn, classification: classification || "unknown", reason });
      if (classification === "business") {
        businessFQNs.push(fqn);
      }
    }
  }

  // If the model classified nothing as business, include all (fail-open)
  if (businessFQNs.length === 0) {
    throw new Error("Model classified zero business tables in batch");
  }

  return { filteredFqns: businessFQNs, classifications };
}
