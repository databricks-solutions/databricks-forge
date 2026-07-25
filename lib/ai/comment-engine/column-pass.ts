/**
 * Column Comment Pass (Phase 3).
 *
 * Generates column descriptions per-table with domain context, related
 * table awareness, data asset descriptions, and deterministic column
 * role hints. Runs in parallel with bounded concurrency.
 *
 * @module ai/comment-engine/column-pass
 */

import { cachedChatCompletion } from "@/lib/toolkit/llm-cache";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { mapWithConcurrency } from "@/lib/toolkit/concurrency";
import { resolveEndpoint } from "@/lib/dbx/client";
import { logger as fallbackLogger } from "@/lib/logger";
import type { Logger } from "@/lib/ports/logger";
import type { ChatMessage } from "@/lib/dbx/model-serving";
import type {
  ColumnCommentInput,
  CommentProgressCallback,
  MetadataCounters,
  CommentOutputLanguage,
} from "./types";
import { COLUMN_COMMENT_PROMPT, buildLanguageDirective } from "./prompts";

const COLUMN_CONCURRENCY = 8;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderColumnList(columns: ColumnCommentInput["columns"]): string {
  return columns
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => {
      const parts = [`- **${c.name}**: ${c.dataType}${c.isNullable ? " (nullable)" : ""}`];

      const hints: string[] = [];
      if (c.inferredRole) hints.push(`role:${c.inferredRole}`);
      if (c.inferredFkTarget) hints.push(`FK->${c.inferredFkTarget.split(".").pop()}`);
      if (hints.length > 0) parts.push(`  [${hints.join(", ")}]`);

      if (c.existingComment) parts.push(`  Current: "${c.existingComment}"`);
      return parts.join("\n");
    })
    .join("\n");
}

function renderRelatedTables(related: ColumnCommentInput["relatedTables"]): string {
  if (related.length === 0) return "No closely related tables identified.";

  return related
    .slice(0, 10)
    .map((t) => `- ${t.fqn}: ${t.description}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Main pass
// ---------------------------------------------------------------------------

export async function runColumnCommentPass(
  inputs: ColumnCommentInput[],
  industryContext: string,
  outputLanguage: CommentOutputLanguage,
  options: {
    signal?: AbortSignal;
    onProgress?: CommentProgressCallback;
    onCounters?: (counters: Partial<MetadataCounters>) => void;
    logger?: Logger;
  } = {},
): Promise<Map<string, Map<string, string>>> {
  const { signal, onProgress, onCounters, logger: log = fallbackLogger } = options;
  const results = new Map<string, Map<string, string>>();

  if (inputs.length === 0) return results;

  const endpoint = resolveEndpoint("classification");
  const languageDirective = buildLanguageDirective(outputLanguage);
  let completed = 0;
  let totalColumnsGenerated = 0;

  const tasks = inputs.map((input) => async () => {
    if (signal?.aborted) return;

    if (input.columns.length === 0) {
      completed++;
      return;
    }

    onCounters?.({
      currentTable: input.tableFqn.split(".").pop() ?? input.tableFqn,
      columnTablesProcessed: completed,
    });

    const dataAssetBlock =
      input.dataAssetId && input.dataAssetDescription
        ? `Data Asset: ${input.dataAssetId} -- ${input.dataAssetDescription}`
        : "";

    const prompt = COLUMN_COMMENT_PROMPT.replace("{language_directive}", languageDirective)
      .replace("{industry_context}", industryContext)
      .replace("{table_fqn}", input.tableFqn)
      .replace("{table_description}", input.tableDescription)
      .replace("{table_domain}", input.tableDomain ?? "Unknown")
      .replace("{table_role}", input.tableRole ?? "Unknown")
      .replace("{data_asset_block}", dataAssetBlock)
      .replace("{related_tables}", renderRelatedTables(input.relatedTables))
      .replace("{column_list}", renderColumnList(input.columns));

    const messages: ChatMessage[] = [{ role: "user", content: prompt }];

    try {
      const resp = await cachedChatCompletion({
        endpoint,
        messages,
        temperature: 0.2,
        responseFormat: "json_object",
        signal,
      });

      const parsed = parseLLMJson(resp.content, "column-comments") as Array<{
        column_name: string;
        description: string | null;
      }>;

      const tableResults = new Map<string, string>();
      for (const item of parsed) {
        if (item.column_name && item.description) {
          tableResults.set(item.column_name, item.description);
        }
      }

      if (tableResults.size > 0) {
        results.set(input.tableFqn.toLowerCase(), tableResults);
        totalColumnsGenerated += tableResults.size;
      }
    } catch (err) {
      log.warn("Table failed", {
        fn: "runColumnCommentPass",
        errorCategory: "llm_table",
        table: input.tableFqn,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    completed++;
    const tableName = input.tableFqn.split(".").pop() ?? input.tableFqn;
    const detail = `${completed}/${inputs.length} tables — ${tableName}`;
    onProgress?.("columns", Math.round((completed / inputs.length) * 100), detail);
    onCounters?.({
      columnTablesProcessed: completed,
      columnsGenerated: totalColumnsGenerated,
      currentTable: completed < inputs.length ? null : null,
    });
  });

  await mapWithConcurrency(tasks, COLUMN_CONCURRENCY);

  return results;
}
