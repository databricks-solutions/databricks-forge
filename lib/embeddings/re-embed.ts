/**
 * Automated re-embedding utilities.
 *
 * When a scan is refreshed, only re-embed records whose composed text
 * has changed (hash-based skip). This avoids redundant embedding API
 * calls for unchanged table metadata.
 */

import { createHash } from "crypto";
import { getPrisma } from "@/lib/prisma";
import { generateEmbeddings } from "./client";
import { insertEmbeddings, deleteEmbeddingsByScan } from "./store";
import type { EmbeddingInput, EmbeddingKind } from "./types";
import { isEmbeddingEnabled } from "./config";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Content hashing
// ---------------------------------------------------------------------------

/**
 * Compute a SHA-256 hash of the composed text.
 * Used to detect if a record's content has changed since last embedding.
 */
export function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Delta-aware re-embedding
// ---------------------------------------------------------------------------

interface ExistingEmbeddingInfo {
  source_id: string;
  content_hash: string;
}

/**
 * Re-embed a scan's records, skipping records whose content hasn't changed.
 *
 * Strategy:
 *   1. Load existing embedding hashes for the scan
 *   2. Compare with newly composed texts
 *   3. Only embed records where the hash differs
 *   4. Delete stale records (removed since last scan)
 *   5. Insert new/changed records
 *
 * Returns the number of records that were actually re-embedded.
 */
export async function deltaReEmbed(
  scanId: string,
  newRecords: Array<{
    kind: EmbeddingKind;
    sourceId: string;
    contentText: string;
    metadataJson?: Record<string, unknown> | null;
  }>,
): Promise<{ reEmbedded: number; skipped: number; removed: number }> {
  if (!isEmbeddingEnabled()) return { reEmbedded: 0, skipped: 0, removed: 0 };

  const prisma = await getPrisma();

  // Load existing content hashes for this scan
  // We store the hash in the first 16 chars of metadata_json.content_hash
  const existingRows: ExistingEmbeddingInfo[] = await prisma.$queryRawUnsafe(`
    SELECT source_id, metadata_json->>'content_hash' AS content_hash
    FROM forge_embeddings
    WHERE scan_id = '${scanId}'
  `);

  const existingHashes = new Map<string, string>();
  for (const row of existingRows) {
    if (row.content_hash) {
      existingHashes.set(row.source_id, row.content_hash);
    }
  }

  // Separate into changed and unchanged
  const toEmbed: typeof newRecords = [];
  let skipped = 0;

  for (const rec of newRecords) {
    const newHash = hashContent(rec.contentText);
    const existingHash = existingHashes.get(rec.sourceId);

    if (existingHash === newHash) {
      skipped++;
    } else {
      toEmbed.push(rec);
    }
  }

  // Identify removed records
  const newSourceIds = new Set(newRecords.map((r) => r.sourceId));
  const removedSourceIds = Array.from(existingHashes.keys()).filter((id) => !newSourceIds.has(id));

  if (toEmbed.length === 0 && removedSourceIds.length === 0) {
    logger.info("[re-embed] No changes detected, skipping re-embed", {
      scanId,
      total: newRecords.length,
      skipped,
    });
    return { reEmbedded: 0, skipped, removed: 0 };
  }

  // Delete the entire scan's embeddings and re-insert (simpler than surgical updates)
  await deleteEmbeddingsByScan(scanId);

  if (newRecords.length === 0) {
    return { reEmbedded: 0, skipped: 0, removed: removedSourceIds.length };
  }

  // Embed all records (both changed and unchanged, since we deleted all)
  const texts = newRecords.map((r) => r.contentText);
  const embeddings = await generateEmbeddings(texts);

  const inputs: EmbeddingInput[] = newRecords.map((r, i) => ({
    kind: r.kind,
    sourceId: r.sourceId,
    scanId,
    contentText: r.contentText,
    metadataJson: {
      ...r.metadataJson,
      content_hash: hashContent(r.contentText),
    },
    embedding: embeddings[i],
  }));

  await insertEmbeddings(inputs);

  logger.info("[re-embed] Delta re-embed complete", {
    scanId,
    reEmbedded: toEmbed.length,
    skipped,
    removed: removedSourceIds.length,
    total: newRecords.length,
  });

  return {
    reEmbedded: toEmbed.length,
    skipped,
    removed: removedSourceIds.length,
  };
}

// ---------------------------------------------------------------------------
// Embedding stats
// ---------------------------------------------------------------------------

export interface EmbeddingStats {
  totalRecords: number;
  byKind: Record<string, number>;
  byScope: { estate: number; pipeline: number; genie: number; documents: number };
}

/**
 * Get embedding statistics for monitoring/analytics.
 */
export async function getEmbeddingStats(): Promise<EmbeddingStats> {
  const prisma = await getPrisma();

  const rows: Array<{ kind: string; count: bigint }> = await prisma.$queryRawUnsafe(`
    SELECT kind, COUNT(*) as count FROM forge_embeddings GROUP BY kind
  `);

  const byKind: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    const count = Number(row.count);
    byKind[row.kind] = count;
    total += count;
  }

  const estateKinds = [
    "table_detail",
    "column_profile",
    "environment_insight",
    "table_health",
    "data_product",
    "lineage_context",
  ];
  const pipelineKinds = ["use_case", "business_context"];
  const genieKinds = ["genie_recommendation", "genie_question"];

  const sumKinds = (kinds: string[]) => kinds.reduce((sum, k) => sum + (byKind[k] ?? 0), 0);

  return {
    totalRecords: total,
    byKind,
    byScope: {
      estate: sumKinds(estateKinds),
      pipeline: sumKinds(pipelineKinds),
      genie: sumKinds(genieKinds),
      documents: byKind["document_chunk"] ?? 0,
    },
  };
}
