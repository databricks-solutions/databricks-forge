/**
 * Consistency Review Pass (Phase 4).
 *
 * Reviews all generated comments for terminology consistency, cross-table
 * reference accuracy, and Genie-readiness. Produces a list of fixes that
 * the engine can auto-apply.
 *
 * This pass is optional and can be disabled via CommentEngineConfig.
 *
 * @module ai/comment-engine/consistency-pass
 */

import { cachedChatCompletion } from "@/lib/toolkit/llm-cache";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { buildTokenAwareBatches, estimateTokens } from "@/lib/toolkit/token-budget";
import { resolveEndpoint } from "@/lib/dbx/client";
import { logger as fallbackLogger } from "@/lib/logger";
import type { Logger } from "@/lib/ports/logger";
import type { ChatMessage } from "@/lib/dbx/model-serving";
import type { ConsistencyFix, CommentProgressCallback, CommentOutputLanguage } from "./types";
import { CONSISTENCY_REVIEW_PROMPT, buildLanguageDirective } from "./prompts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DescriptionEntry {
  tableFqn: string;
  columnName: string | null;
  description: string;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderDescriptionEntry(entry: DescriptionEntry): string {
  const target = entry.columnName
    ? `${entry.tableFqn}.${entry.columnName}`
    : `TABLE: ${entry.tableFqn}`;
  return `- ${target}: "${entry.description}"`;
}

// ---------------------------------------------------------------------------
// Main pass
// ---------------------------------------------------------------------------

export async function runConsistencyReview(
  tableComments: Map<string, string>,
  columnComments: Map<string, Map<string, string>>,
  schemaSummary: string,
  outputLanguage: CommentOutputLanguage,
  options: { signal?: AbortSignal; onProgress?: CommentProgressCallback; logger?: Logger } = {},
): Promise<ConsistencyFix[]> {
  const { signal, onProgress, logger: log = fallbackLogger } = options;
  const languageDirective = buildLanguageDirective(outputLanguage);
  const allFixes: ConsistencyFix[] = [];

  // Flatten all descriptions into entries
  const entries: DescriptionEntry[] = [];

  for (const [fqn, desc] of tableComments) {
    entries.push({ tableFqn: fqn, columnName: null, description: desc });
  }

  for (const [fqn, colMap] of columnComments) {
    for (const [colName, desc] of colMap) {
      entries.push({ tableFqn: fqn, columnName: colName, description: desc });
    }
  }

  if (entries.length === 0) return allFixes;

  onProgress?.("consistency", 0, `Reviewing ${entries.length} descriptions...`);

  const endpoint = resolveEndpoint("classification");

  const basePrompt = CONSISTENCY_REVIEW_PROMPT.replace("{language_directive}", languageDirective)
    .replace("{schema_summary}", schemaSummary)
    .replace("{descriptions_list}", "");

  const baseTokens = estimateTokens(basePrompt);
  const batches = buildTokenAwareBatches(entries, renderDescriptionEntry, baseTokens);

  let batchIdx = 0;

  for (const batch of batches) {
    if (signal?.aborted) throw new Error("Cancelled");

    const descList = batch.map(renderDescriptionEntry).join("\n");

    const prompt = CONSISTENCY_REVIEW_PROMPT.replace("{language_directive}", languageDirective)
      .replace("{schema_summary}", schemaSummary)
      .replace("{descriptions_list}", descList);

    const messages: ChatMessage[] = [{ role: "user", content: prompt }];

    try {
      const resp = await cachedChatCompletion({
        endpoint,
        messages,
        temperature: 0.1,
        responseFormat: "json_object",
        signal,
      });

      const parsed = parseLLMJson(resp.content, "consistency-review") as Array<{
        table_fqn: string;
        column_name: string | null;
        issue: string;
        original: string;
        fixed: string;
      }>;

      for (const item of parsed) {
        if (item.table_fqn && item.original && item.fixed && item.original !== item.fixed) {
          allFixes.push({
            tableFqn: item.table_fqn,
            columnName: item.column_name ?? null,
            issue: item.issue ?? "Consistency issue",
            original: item.original,
            fixed: item.fixed,
          });
        }
      }
    } catch (err) {
      log.warn("Review batch failed", {
        fn: "runConsistencyReview",
        errorCategory: "llm_batch",
        batchSize: batch.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    batchIdx++;
    onProgress?.(
      "consistency",
      Math.round((batchIdx / batches.length) * 100),
      `${allFixes.length} issues found`,
    );
  }

  return allFixes;
}

/**
 * Apply consistency fixes to the comment maps in-place.
 * Returns the count of fixes applied.
 */
export function applyConsistencyFixes(
  tableComments: Map<string, string>,
  columnComments: Map<string, Map<string, string>>,
  fixes: ConsistencyFix[],
): number {
  let applied = 0;

  for (const fix of fixes) {
    if (fix.columnName) {
      const colMap = columnComments.get(fix.tableFqn.toLowerCase());
      if (colMap) {
        const current = colMap.get(fix.columnName);
        if (current === fix.original) {
          colMap.set(fix.columnName, fix.fixed);
          applied++;
        }
      }
    } else {
      const current = tableComments.get(fix.tableFqn.toLowerCase());
      if (current === fix.original) {
        tableComments.set(fix.tableFqn.toLowerCase(), fix.fixed);
        applied++;
      }
    }
  }

  return applied;
}
