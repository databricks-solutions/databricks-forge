/**
 * Comment Engine prerequisite for the Discovery Run pipeline.
 *
 * Before the Discovery Run proceeds to table filtering and use case generation,
 * this module checks whether a recent AI Comment Run exists for the scope.
 * If not, it runs the Comment Engine to enrich table and column metadata with
 * high-quality, industry-aware descriptions. The enriched comments are merged
 * back into the MetadataSnapshot so every subsequent pipeline step benefits.
 *
 * Three outcomes:
 * 1. Fresh job exists and covers the scope -> reuse its proposals (zero cost)
 * 2. No matching job -> run the Comment Engine inline (adds 2-4 min)
 * 3. Comment Engine fails -> continue with original UC comments (graceful degradation)
 */

import { listCommentJobs, type CommentJob, createCommentJob } from "@/lib/lakebase/comment-jobs";
import { getProposalsForJob, type CommentProposal } from "@/lib/lakebase/comment-proposals";
import { generateComments } from "@/lib/ai/comment-generator";
import { logger } from "@/lib/logger";
import type { MetadataSnapshot } from "@/lib/domain/types";
import {
  DEFAULT_COMMENT_OUTPUT_LANGUAGE,
  type CommentOutputLanguage,
} from "@/lib/ai/comment-engine/types";

const FRESHNESS_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CommentPrerequisiteResult {
  enriched: boolean;
  jobId: string | null;
  tablesEnriched: number;
  columnsEnriched: number;
  reused: boolean;
}

/**
 * Parse the scopeJson from a CommentJob to extract catalogs/schemas.
 */
function parseScopeJson(scopeJson: string): {
  catalogs: string[];
  schemas: string[];
} {
  try {
    const parsed = JSON.parse(scopeJson);
    return {
      catalogs: Array.isArray(parsed.catalogs) ? parsed.catalogs : [],
      schemas: Array.isArray(parsed.schemas) ? parsed.schemas : [],
    };
  } catch {
    return { catalogs: [], schemas: [] };
  }
}

/**
 * Check if a completed CommentJob covers the required scope and is fresh enough.
 */
function isJobFresh(
  job: CommentJob,
  requiredCatalogs: Set<string>,
  requiredSchemas: Set<string>,
  requiredLanguage: CommentOutputLanguage,
): boolean {
  if (job.status !== "ready" && job.status !== "completed" && job.status !== "applying") {
    return false;
  }

  const age = Date.now() - new Date(job.createdAt).getTime();
  if (age > FRESHNESS_THRESHOLD_MS) return false;

  if ((job.outputLanguage ?? DEFAULT_COMMENT_OUTPUT_LANGUAGE) !== requiredLanguage) {
    return false;
  }

  const { catalogs, schemas } = parseScopeJson(job.scopeJson);
  const jobCatalogs = new Set(catalogs.map((c) => c.toLowerCase()));
  const jobSchemas = new Set(schemas.map((s) => s.toLowerCase()));

  for (const cat of requiredCatalogs) {
    if (!jobCatalogs.has(cat.toLowerCase())) return false;
  }
  for (const sch of requiredSchemas) {
    if (!jobSchemas.has(sch.toLowerCase())) return false;
  }

  return true;
}

/**
 * Merge accepted/pending comment proposals into a MetadataSnapshot.
 *
 * For each table-level proposal (columnName is null), overwrites the table's
 * comment. For column-level proposals, overwrites the column's comment.
 * Only proposals with status "pending", "accepted", or "applied" are used.
 */
function mergeProposalsIntoMetadata(
  metadata: MetadataSnapshot,
  proposals: CommentProposal[],
): { tablesEnriched: number; columnsEnriched: number } {
  let tablesEnriched = 0;
  let columnsEnriched = 0;

  const usableStatuses = new Set(["pending", "accepted", "applied"]);
  const usable = proposals.filter((p) => usableStatuses.has(p.status));

  const tableCommentMap = new Map<string, string>();
  const columnCommentMap = new Map<string, string>();

  for (const p of usable) {
    const comment = p.editedComment ?? p.proposedComment;
    if (!comment) continue;

    if (!p.columnName) {
      tableCommentMap.set(p.tableFqn.toLowerCase(), comment);
    } else {
      columnCommentMap.set(`${p.tableFqn.toLowerCase()}.${p.columnName.toLowerCase()}`, comment);
    }
  }

  for (const table of metadata.tables) {
    const enriched = tableCommentMap.get(table.fqn.toLowerCase());
    if (enriched) {
      table.comment = enriched;
      tablesEnriched++;
    }
  }

  for (const col of metadata.columns) {
    const key = `${col.tableFqn.toLowerCase()}.${col.columnName.toLowerCase()}`;
    const enriched = columnCommentMap.get(key);
    if (enriched) {
      col.comment = enriched;
      columnsEnriched++;
    }
  }

  return { tablesEnriched, columnsEnriched };
}

/**
 * Run the Comment Engine prerequisite check. Either reuses a fresh existing
 * job or runs the Comment Engine inline. Merges results into the metadata.
 *
 * On failure, logs a warning and returns gracefully -- the pipeline continues
 * with whatever comments UC already has.
 */
export async function ensureCommentEnrichment(
  metadata: MetadataSnapshot,
  industryId?: string,
  businessContext?: string,
  runId?: string,
  signal?: AbortSignal,
  outputLanguage: CommentOutputLanguage = DEFAULT_COMMENT_OUTPUT_LANGUAGE,
  ownerEmail?: string | null,
): Promise<CommentPrerequisiteResult> {
  try {
    // Parse the metadata scope to determine catalogs and schemas
    const ucPath = metadata.ucPath;
    const parts = ucPath.split(".");
    const requiredCatalogs = new Set<string>();
    const requiredSchemas = new Set<string>();

    if (parts.length >= 1) requiredCatalogs.add(parts[0]);
    if (parts.length >= 2) requiredSchemas.add(`${parts[0]}.${parts[1]}`);

    // Also collect any additional catalogs/schemas from the tables
    for (const table of metadata.tables) {
      const tParts = table.fqn.split(".");
      if (tParts.length >= 1) requiredCatalogs.add(tParts[0]);
      if (tParts.length >= 2) requiredSchemas.add(`${tParts[0]}.${tParts[1]}`);
    }

    // Check for a fresh existing job
    const existingJobs = await listCommentJobs();
    const freshJob = existingJobs.find((job) =>
      isJobFresh(job, requiredCatalogs, requiredSchemas, outputLanguage),
    );

    if (freshJob) {
      logger.info("Found fresh Comment Engine run, reusing proposals", {
        jobId: freshJob.id,
        age: `${Math.round((Date.now() - new Date(freshJob.createdAt).getTime()) / 60000)}min`,
        tableCount: freshJob.tableCount,
        columnCount: freshJob.columnCount,
      });

      const proposals = await getProposalsForJob(freshJob.id);
      const { tablesEnriched, columnsEnriched } = mergeProposalsIntoMetadata(metadata, proposals);

      return {
        enriched: tablesEnriched > 0 || columnsEnriched > 0,
        jobId: freshJob.id,
        tablesEnriched,
        columnsEnriched,
        reused: true,
      };
    }

    // No fresh job -- run the Comment Engine inline
    logger.info("No fresh Comment Engine run found, running inline", {
      catalogs: Array.from(requiredCatalogs),
      schemas: Array.from(requiredSchemas),
    });

    const job = await createCommentJob({
      scopeJson: JSON.stringify({
        catalogs: Array.from(requiredCatalogs),
        schemas: Array.from(requiredSchemas),
      }),
      industryId,
      outputLanguage,
      runId,
      // Carry through the run's owner so the inline-created comment job
      // never lands in the database with NULL owner_email (which would
      // make it invisible under per-user isolation and trip the startup
      // integrity guard on the next deploy).
      ownerEmail: ownerEmail ?? null,
    });

    const result = await generateComments({
      jobId: job.id,
      catalogs: Array.from(requiredCatalogs),
      schemas: Array.from(requiredSchemas),
      industryId,
      businessContext,
      outputLanguage,
      signal,
    });

    logger.info("Inline Comment Engine run complete", {
      jobId: job.id,
      tableCount: result.tableCount,
      columnCount: result.columnCount,
    });

    const proposals = await getProposalsForJob(job.id);
    const { tablesEnriched, columnsEnriched } = mergeProposalsIntoMetadata(metadata, proposals);

    return {
      enriched: tablesEnriched > 0 || columnsEnriched > 0,
      jobId: job.id,
      tablesEnriched,
      columnsEnriched,
      reused: false,
    };
  } catch (err) {
    logger.warn("Comment Engine prerequisite failed, continuing with original UC comments", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      enriched: false,
      jobId: null,
      tablesEnriched: 0,
      columnsEnriched: 0,
      reused: false,
    };
  }
}
