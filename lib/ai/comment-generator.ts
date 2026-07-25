/**
 * AI Comment generation -- facade layer.
 *
 * Delegates to the Comment Engine (`lib/ai/comment-engine/engine.ts`)
 * for the actual generation, then persists proposals to Lakebase and
 * updates the job record. Uses the in-memory progress tracker so the
 * frontend can poll `/api/environment/comments/[jobId]/progress`.
 *
 * Two entry paths:
 * 1. Fresh generation from UC metadata + Comment Engine (LLM-powered).
 * 2. Import from an existing estate scan (pre-populated, no LLM call).
 */

import { runCommentEngine } from "./comment-engine/engine";
import {
  initCommentProgress,
  updateCommentProgress,
  type CommentPhase,
} from "./comment-engine/progress";
import type { CommentOutputLanguage } from "./comment-engine/types";
import { createProposals } from "@/lib/lakebase/comment-proposals";
import { updateCommentJobStatus } from "@/lib/lakebase/comment-jobs";
import { logger } from "@/lib/logger";

export interface GenerateCommentsInput {
  jobId: string;
  catalogs: string[];
  schemas?: string[];
  tables?: string[];
  excludedSchemas?: string[];
  excludedTables?: string[];
  exclusionPatterns?: string[];
  industryId?: string;
  businessContext?: string;
  outputLanguage?: CommentOutputLanguage;
  signal?: AbortSignal;
}

export interface GenerateCommentsResult {
  tableCount: number;
  columnCount: number;
}

// Phase mapping from engine callback strings to our progress tracker phases
const ENGINE_PHASE_MAP: Record<string, CommentPhase> = {
  "schema-context": "fetching-metadata",
  tables: "generating-tables",
  columns: "generating-columns",
  consistency: "consistency-review",
  done: "complete",
};

/**
 * Run full Comment Engine generation for the given scope.
 * Writes proposals to Lakebase and updates the job record.
 * Reports progress via the in-memory tracker (poll-friendly).
 */
export async function generateComments(
  input: GenerateCommentsInput,
): Promise<GenerateCommentsResult> {
  const {
    jobId,
    catalogs,
    schemas,
    tables,
    excludedSchemas,
    excludedTables,
    exclusionPatterns,
    industryId,
    businessContext,
    outputLanguage,
    signal,
  } = input;

  initCommentProgress(jobId);

  try {
    await updateCommentJobStatus(jobId, "generating");

    const result = await runCommentEngine(
      {
        catalogs,
        schemas,
        tables,
        ...(excludedSchemas?.length && { excludedSchemas }),
        ...(excludedTables?.length && { excludedTables }),
        ...(exclusionPatterns?.length && { exclusionPatterns }),
      },
      {
        industryId,
        businessContext,
        outputLanguage,
        enableConsistencyReview: true,
        enableLineage: true,
        enableHistory: true,
        signal,
        onProgress: (phase, _pct, detail) => {
          const mappedPhase = ENGINE_PHASE_MAP[phase] ?? "fetching-metadata";
          updateCommentProgress(jobId, {
            phase: mappedPhase,
            message: detail ?? "",
          });
        },
        onMetadataProgress: (counters) => {
          updateCommentProgress(jobId, counters);
        },
      },
    );

    // Persist proposals to Lakebase
    updateCommentProgress(jobId, {
      phase: "saving",
      message: "Persisting proposals to database...",
    });

    const proposals: Array<{
      tableFqn: string;
      columnName?: string | null;
      originalComment?: string | null;
      proposedComment: string;
    }> = [];

    for (const [fqnLower, description] of result.tableComments) {
      const table = result.schemaContext.tables.find((t) => t.fqn.toLowerCase() === fqnLower);
      proposals.push({
        tableFqn: table?.fqn ?? fqnLower,
        columnName: null,
        originalComment: table?.comment ?? null,
        proposedComment: description,
      });
    }

    for (const [fqnLower, colMap] of result.columnComments) {
      const table = result.schemaContext.tables.find((t) => t.fqn.toLowerCase() === fqnLower);
      for (const [colName, description] of colMap) {
        const col = table?.columns.find((c) => c.name.toLowerCase() === colName.toLowerCase());
        proposals.push({
          tableFqn: table?.fqn ?? fqnLower,
          columnName: colName,
          originalComment: col?.comment ?? null,
          proposedComment: description,
        });
      }
    }

    if (proposals.length > 0) {
      await createProposals(jobId, proposals);
    }

    const tableCount = result.stats.tables;
    const columnCount = result.stats.columns;

    await updateCommentJobStatus(jobId, "ready", { tableCount, columnCount });

    updateCommentProgress(jobId, {
      phase: "complete",
      message: `${tableCount} table + ${columnCount} column descriptions ready`,
      tablesGenerated: tableCount,
      columnsGenerated: columnCount,
      consistencyFixes: result.stats.consistencyFixesApplied,
    });

    logger.info("[comment-generator] Generation complete", {
      jobId,
      tableCount,
      columnCount,
      durationMs: result.stats.durationMs,
      consistencyFixesApplied: result.stats.consistencyFixesApplied,
    });

    return { tableCount, columnCount };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateCommentJobStatus(jobId, "failed", { errorMessage: msg });
    updateCommentProgress(jobId, {
      phase: "failed",
      message: msg,
    });
    throw err;
  }
}

/**
 * Import comments from an existing estate scan (ForgeTableDetail records).
 * Pre-populates proposals from generatedDescription without an LLM call.
 */
export async function importFromScan(
  jobId: string,
  scanDetails: Array<{
    tableFqn: string;
    comment: string | null;
    generatedDescription: string | null;
    columnsJson: string | null;
  }>,
): Promise<GenerateCommentsResult> {
  const proposals: Array<{
    tableFqn: string;
    columnName?: string | null;
    originalComment?: string | null;
    proposedComment: string;
  }> = [];

  for (const detail of scanDetails) {
    if (detail.generatedDescription) {
      proposals.push({
        tableFqn: detail.tableFqn,
        columnName: null,
        originalComment: detail.comment ?? null,
        proposedComment: detail.generatedDescription,
      });
    }
  }

  if (proposals.length > 0) {
    await createProposals(jobId, proposals);
  }

  const tableCount = proposals.filter((p) => !p.columnName).length;
  await updateCommentJobStatus(jobId, "ready", { tableCount, columnCount: 0 });

  return { tableCount, columnCount: 0 };
}
