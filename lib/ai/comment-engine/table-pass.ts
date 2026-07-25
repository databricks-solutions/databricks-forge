/**
 * Table Comment Pass (Phase 2).
 *
 * Generates table descriptions in batches with full schema context,
 * industry data assets, lineage, and write-frequency signals.
 *
 * @module ai/comment-engine/table-pass
 */

import { cachedChatCompletion } from "@/lib/toolkit/llm-cache";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { buildTokenAwareBatches, estimateTokens } from "@/lib/toolkit/token-budget";
import { resolveEndpoint } from "@/lib/dbx/client";
import { logger as fallbackLogger } from "@/lib/logger";
import type { Logger } from "@/lib/ports/logger";
import type { ChatMessage } from "@/lib/dbx/model-serving";
import type {
  TableCommentInput,
  CommentProgressCallback,
  MetadataCounters,
  CommentOutputLanguage,
} from "./types";
import { TABLE_COMMENT_PROMPT, buildLanguageDirective } from "./prompts";

// ---------------------------------------------------------------------------
// Context blocks
// ---------------------------------------------------------------------------

export interface TablePassContext {
  industryContext: string;
  businessContext: string;
  dataAssetContext: string;
  useCaseLinkage: string;
  schemaSummary: string;
  lineageContext: string;
  outputLanguage: CommentOutputLanguage;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const MAX_COLS_TABLE_PASS = 20;

function renderTableInput(t: TableCommentInput): string {
  const cols = t.columns
    .slice(0, MAX_COLS_TABLE_PASS)
    .map((c) => c.name)
    .join(", ");
  const extra =
    t.columns.length > MAX_COLS_TABLE_PASS
      ? ` +${t.columns.length - MAX_COLS_TABLE_PASS} more`
      : "";

  const parts = [`- **${t.fqn}** [${cols}${extra}]`];

  const attrs: string[] = [];
  if (t.domain) attrs.push(`domain:${t.domain}`);
  if (t.role && t.role !== "unknown") attrs.push(`role:${t.role}`);
  if (t.dataAssetId) attrs.push(`asset:${t.dataAssetId}(${t.dataAssetName ?? ""})`);
  if (t.writeFrequency && t.writeFrequency !== "unknown") attrs.push(`writes:${t.writeFrequency}`);
  if (t.owner) attrs.push(`owner:${t.owner}`);
  if (attrs.length > 0) parts.push(`  Classification: ${attrs.join(", ")}`);

  if (t.existingComment) parts.push(`  Current comment: "${t.existingComment}"`);
  if (t.tags.length > 0) parts.push(`  Tags: [${t.tags.join(", ")}]`);
  if (t.relatedTableFqns.length > 0) {
    const shortNames = t.relatedTableFqns.slice(0, 5).map((fqn) => fqn.split(".").pop());
    parts.push(`  Related: ${shortNames.join(", ")}`);
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Build lineage context
// ---------------------------------------------------------------------------

export function buildLineageContextBlock(
  lineageEdges: Array<{ sourceTableFqn: string; targetTableFqn: string }>,
  targetFqns: Set<string>,
): string {
  if (lineageEdges.length === 0) return "No lineage data available.";

  const relevant = lineageEdges.filter(
    (e) =>
      targetFqns.has(e.sourceTableFqn.toLowerCase()) ||
      targetFqns.has(e.targetTableFqn.toLowerCase()),
  );

  if (relevant.length === 0) return "No lineage edges found for these tables.";

  const lines = [`${relevant.length} lineage edges:`];
  for (const edge of relevant.slice(0, 50)) {
    const src = edge.sourceTableFqn.split(".").pop();
    const tgt = edge.targetTableFqn.split(".").pop();
    lines.push(`  ${src} -> ${tgt}`);
  }

  if (relevant.length > 50) {
    lines.push(`  ... and ${relevant.length - 50} more edges`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main pass
// ---------------------------------------------------------------------------

export async function runTableCommentPass(
  tables: TableCommentInput[],
  context: TablePassContext,
  options: {
    signal?: AbortSignal;
    onProgress?: CommentProgressCallback;
    onCounters?: (counters: Partial<MetadataCounters>) => void;
    logger?: Logger;
  } = {},
): Promise<Map<string, string>> {
  const { signal, onProgress, onCounters, logger: log = fallbackLogger } = options;
  const descriptions = new Map<string, string>();

  if (tables.length === 0) return descriptions;

  const endpoint = resolveEndpoint("classification");
  const languageDirective = buildLanguageDirective(context.outputLanguage);

  const basePrompt = TABLE_COMMENT_PROMPT.replace("{language_directive}", languageDirective)
    .replace("{industry_context}", context.industryContext)
    .replace(
      "{business_context_block}",
      context.businessContext ? `### BUSINESS CONTEXT\n${context.businessContext}` : "",
    )
    .replace("{data_asset_context}", context.dataAssetContext)
    .replace("{use_case_linkage}", context.useCaseLinkage)
    .replace("{schema_summary}", context.schemaSummary)
    .replace("{lineage_context}", context.lineageContext)
    .replace("{table_list}", "");

  const baseTokens = estimateTokens(basePrompt);
  const batches = buildTokenAwareBatches(tables, renderTableInput, baseTokens);

  onCounters?.({ tableBatches: batches.length, tableBatchesDone: 0, tablesGenerated: 0 });

  let batchIdx = 0;

  for (const batch of batches) {
    if (signal?.aborted) throw new Error("Cancelled");

    const tableList = batch.map(renderTableInput).join("\n\n");

    const prompt = TABLE_COMMENT_PROMPT.replace("{language_directive}", languageDirective)
      .replace("{industry_context}", context.industryContext)
      .replace(
        "{business_context_block}",
        context.businessContext ? `### BUSINESS CONTEXT\n${context.businessContext}` : "",
      )
      .replace("{data_asset_context}", context.dataAssetContext)
      .replace("{use_case_linkage}", context.useCaseLinkage)
      .replace("{schema_summary}", context.schemaSummary)
      .replace("{lineage_context}", context.lineageContext)
      .replace("{table_list}", tableList);

    const messages: ChatMessage[] = [{ role: "user", content: prompt }];

    try {
      const resp = await cachedChatCompletion({
        endpoint,
        messages,
        temperature: 0.2,
        responseFormat: "json_object",
        signal,
      });

      const parsed = parseLLMJson(resp.content, "table-comments") as Array<{
        table_fqn: string;
        description: string;
      }>;

      for (const item of parsed) {
        if (item.table_fqn && item.description) {
          descriptions.set(item.table_fqn.toLowerCase(), item.description);
        }
      }
    } catch (err) {
      log.warn("Batch failed", {
        fn: "runTableCommentPass",
        errorCategory: "llm_batch",
        batchSize: batch.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    batchIdx++;
    const detail = `Batch ${batchIdx}/${batches.length} — ${descriptions.size}/${tables.length} tables described`;
    onProgress?.("tables", Math.round((batchIdx / batches.length) * 100), detail);
    onCounters?.({
      tableBatchesDone: batchIdx,
      tablesGenerated: descriptions.size,
    });
  }

  return descriptions;
}
