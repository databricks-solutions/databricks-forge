/**
 * Research source embedder for Ask Forge RAG.
 *
 * Chunks research source texts and embeds them in pgvector for semantic search.
 * Used by Demo Mode to make company research discoverable via Ask Forge.
 */

import { generateEmbeddings } from "@/lib/embeddings/client";
import { insertEmbeddings, deleteEmbeddingsBySource } from "@/lib/embeddings/store";
import { isEmbeddingEnabled } from "@/lib/embeddings/config";
import type { EmbeddingInput, EmbeddingKind } from "@/lib/embeddings/types";
import type { Logger } from "@/lib/ports/logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TARGET_CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;
const EMBEDDING_BATCH_SIZE = 16;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbedSourceInput {
  sessionId: string;
  customerName: string;
  industryId: string;
  sources: Array<{
    type: string;
    title: string;
    text: string;
    url?: string;
    publishedAt?: string;
    publishedYear?: number;
    dateConfidence?: "high" | "medium" | "low" | "unknown";
  }>;
}

/**
 * Default TTL for company research chunks. Paired with publishedAt, this
 * unlocks the freshness multiplier in lib/embeddings/retriever.ts so older
 * chunks are deprioritised at retrieval time.
 */
const RESEARCH_TTL_DAYS = 365;

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

function chunkText(text: string, targetSize: number, overlap: number): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length > targetSize && current.length > 0) {
      chunks.push(current.trim());
      // Keep overlap from end of current chunk
      const overlapText = current.slice(-overlap);
      current = overlapText + "\n\n" + para;
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  // Handle single paragraphs that are too large
  const result: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= targetSize * 1.5) {
      result.push(chunk);
    } else {
      // Split at sentence boundaries
      const sentences = chunk.split(/(?<=\. )/);
      let sub = "";
      for (const sentence of sentences) {
        if (sub.length + sentence.length > targetSize && sub.length > 0) {
          result.push(sub.trim());
          sub = sentence;
        } else {
          sub += sentence;
        }
      }
      if (sub.trim()) result.push(sub.trim());
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Text composition
// ---------------------------------------------------------------------------

function composeChunkText(
  customerName: string,
  sourceType: string,
  sourceTitle: string,
  chunkIndex: number,
  chunkText: string,
): string {
  return `Company: ${customerName}
Source: ${sourceType} -- ${sourceTitle}
Chunk ${chunkIndex}
${chunkText}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Chunk research sources, embed them, and insert into pgvector.
 * Deletes existing embeddings for this session before inserting.
 * Returns the number of chunks embedded. Returns 0 if embedding is disabled or fails.
 */
export async function embedResearchSources(
  input: EmbedSourceInput,
  logger: Logger,
): Promise<number> {
  try {
    if (!isEmbeddingEnabled()) {
      logger.warn("[research-embedder] Embedding not enabled, skipping");
      return 0;
    }

    const { sessionId, customerName, industryId, sources } = input;

    // Build chunks with metadata
    const chunks: Array<{
      composedText: string;
      sourceType: string;
      sourceTitle: string;
      chunkIndex: number;
      sourceUrl?: string;
      publishedAt?: string;
      publishedYear?: number;
      dateConfidence?: "high" | "medium" | "low" | "unknown";
    }> = [];

    for (const source of sources) {
      if (!source.text?.trim()) continue;

      const rawChunks = chunkText(source.text, TARGET_CHUNK_SIZE, CHUNK_OVERLAP);
      for (let i = 0; i < rawChunks.length; i++) {
        const composedText = composeChunkText(
          customerName,
          source.type,
          source.title,
          i + 1,
          rawChunks[i],
        );
        chunks.push({
          composedText,
          sourceType: source.type,
          sourceTitle: source.title,
          chunkIndex: i + 1,
          sourceUrl: source.url,
          publishedAt: source.publishedAt,
          publishedYear: source.publishedYear,
          dateConfidence: source.dateConfidence,
        });
      }
    }

    if (chunks.length === 0) {
      logger.debug("[research-embedder] No chunks to embed");
      return 0;
    }

    // Delete existing embeddings for this session
    await deleteEmbeddingsBySource(sessionId);

    // Generate embeddings in batches
    const texts = chunks.map((c) => c.composedText);
    const allVectors: number[][] = [];

    for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
      const vectors = await generateEmbeddings(batch);
      allVectors.push(...vectors);
    }

    // Build EmbeddingInput records
    const inputs: EmbeddingInput[] = chunks.map((chunk, idx) => ({
      kind: "company_research" as EmbeddingKind,
      sourceId: sessionId,
      contentText: chunk.composedText,
      metadataJson: {
        customerName,
        industryId,
        sourceType: chunk.sourceType,
        sourceTitle: chunk.sourceTitle,
        chunkIndex: chunk.chunkIndex,
        // Recency signals -- used by the retriever's freshness multiplier
        // and by prompts that show Published dates in source manifests.
        ...(chunk.sourceUrl ? { sourceUrl: chunk.sourceUrl } : {}),
        ...(chunk.publishedAt ? { publishedAt: chunk.publishedAt } : {}),
        ...(typeof chunk.publishedYear === "number" ? { publishedYear: chunk.publishedYear } : {}),
        ...(chunk.dateConfidence ? { dateConfidence: chunk.dateConfidence } : {}),
        ttlDays: RESEARCH_TTL_DAYS,
      },
      embedding: allVectors[idx],
    }));

    const inserted = await insertEmbeddings(inputs);
    logger.info("[research-embedder] Embedded research sources", {
      sessionId,
      chunkCount: inserted,
    });
    return inserted;
  } catch (err) {
    logger.warn("[research-embedder] Embedding failed, returning 0", {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
