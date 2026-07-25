/**
 * pgvector CRUD operations for the forge_embeddings table.
 *
 * All vector operations use raw SQL ($queryRawUnsafe / $executeRawUnsafe)
 * because Prisma does not natively support the pgvector vector(N) type.
 *
 * The HNSW index on `embedding vector_cosine_ops` enables sub-50ms
 * approximate nearest-neighbour queries at the volumes we operate at.
 */

import { getPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { EmbeddingInput, EmbeddingKind, SearchResult } from "./types";

// ---------------------------------------------------------------------------
// Insert / Upsert
// ---------------------------------------------------------------------------

/**
 * Insert a batch of embedding records. Generates UUIDs server-side.
 */
export async function insertEmbeddings(inputs: EmbeddingInput[]): Promise<number> {
  if (inputs.length === 0) return 0;

  const prisma = await getPrisma();
  let inserted = 0;

  const BATCH_SIZE = 50;
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const batch = inputs.slice(i, i + BATCH_SIZE);
    const params: Array<string | null> = [];
    const values: string[] = [];

    for (const inp of batch) {
      const base = params.length;
      params.push(inp.kind);
      params.push(inp.sourceId);
      params.push(inp.runId ?? null);
      params.push(inp.scanId ?? null);
      params.push(inp.contentText);
      params.push(inp.metadataJson ? JSON.stringify(inp.metadataJson) : null);
      params.push(`[${inp.embedding.join(",")}]`);

      values.push(
        `(gen_random_uuid(), $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::jsonb, $${base + 7}::vector, NOW())`,
      );
    }

    const sql = `
      INSERT INTO forge_embeddings (id, kind, source_id, run_id, scan_id, content_text, metadata_json, embedding, created_at)
      VALUES ${values.join(",\n")}
    `;
    await prisma.$executeRawUnsafe(sql, ...params);

    inserted += batch.length;
  }

  logger.debug("[embeddings] Inserted records", { count: inserted });
  return inserted;
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/** Delete all embeddings for a given scan. */
export async function deleteEmbeddingsByScan(scanId: string): Promise<number> {
  const prisma = await getPrisma();
  const result = await prisma.$executeRawUnsafe(
    "DELETE FROM forge_embeddings WHERE scan_id = $1",
    scanId,
  );
  logger.debug("[embeddings] Deleted by scan", { scanId, count: result });
  return result;
}

/** Delete all embeddings for a given run. */
export async function deleteEmbeddingsByRun(runId: string): Promise<number> {
  const prisma = await getPrisma();
  const result = await prisma.$executeRawUnsafe(
    "DELETE FROM forge_embeddings WHERE run_id = $1",
    runId,
  );
  logger.debug("[embeddings] Deleted by run", { runId, count: result });
  return result;
}

/** Delete all embeddings for a given source record. */
export async function deleteEmbeddingsBySource(sourceId: string): Promise<number> {
  const prisma = await getPrisma();
  const result = await prisma.$executeRawUnsafe(
    "DELETE FROM forge_embeddings WHERE source_id = $1",
    sourceId,
  );
  return result;
}

/** Delete ALL embeddings (factory reset). */
export async function deleteAllEmbeddings(): Promise<number> {
  const prisma = await getPrisma();
  try {
    const result = await prisma.$executeRawUnsafe(`TRUNCATE TABLE forge_embeddings`);
    logger.debug("[embeddings] Truncated all embeddings");
    return result;
  } catch {
    // TRUNCATE may fail if table doesn't exist; fall back to DELETE
    try {
      const result = await prisma.$executeRawUnsafe(`DELETE FROM forge_embeddings`);
      logger.debug("[embeddings] Deleted all embeddings", { count: result });
      return result;
    } catch {
      logger.debug("[embeddings] forge_embeddings table does not exist");
      return 0;
    }
  }
}

/** Delete all embeddings of a given kind (e.g. skill_chunk, industry_kpi). */
export async function deleteByKind(kind: EmbeddingKind): Promise<number> {
  const prisma = await getPrisma();
  try {
    const result = await prisma.$executeRawUnsafe(
      "DELETE FROM forge_embeddings WHERE kind = $1",
      kind,
    );
    logger.debug("[embeddings] Deleted by kind", { kind, count: result });
    return result;
  } catch {
    logger.debug("[embeddings] deleteByKind failed (table may not exist)", { kind });
    return 0;
  }
}

/** Delete all embeddings of a given kind for a scan. */
export async function deleteEmbeddingsByKindAndScan(
  kind: EmbeddingKind,
  scanId: string,
): Promise<number> {
  const prisma = await getPrisma();
  const result = await prisma.$executeRawUnsafe(
    "DELETE FROM forge_embeddings WHERE kind = $1 AND scan_id = $2",
    kind,
    scanId,
  );
  return result;
}

/** Delete all embeddings of a given kind for a run. */
export async function deleteEmbeddingsByKindAndRun(
  kind: EmbeddingKind,
  runId: string,
): Promise<number> {
  const prisma = await getPrisma();
  const result = await prisma.$executeRawUnsafe(
    "DELETE FROM forge_embeddings WHERE kind = $1 AND run_id = $2",
    kind,
    runId,
  );
  return result;
}

// ---------------------------------------------------------------------------
// Search (vector similarity)
// ---------------------------------------------------------------------------

/**
 * Search embeddings by vector similarity using pgvector's <=> operator
 * (cosine distance). Returns results sorted by descending similarity score.
 *
 * User isolation is enforced via the `userScope` option (Phase 4 of the
 * isolation refactor). When `userScope` is provided, results are limited to
 * embeddings whose parent resource (run / scan / source) is owned by or
 * shared with the calling user, plus any kinds in `userScope.globalKinds`
 * which are always readable.
 *
 * When `userScope` is omitted, the legacy "see everything" behaviour is
 * preserved for callers that haven't been migrated yet (system jobs,
 * admin tasks, tests). In production all read paths should pass userScope.
 */
export interface UserScope {
  /** Run ids the user can read (owner or shared via ACL). */
  accessibleRunIds: string[];
  /** Scan ids the user can read (owner or shared via ACL). */
  accessibleScanIds: string[];
  /**
   * Source-id-keyed embeddings the user can read, mapped to the kind that
   * uses that source-id (so we don't accidentally widen visibility from a
   * document into, say, demo research with the same UUID).
   */
  accessibleSourceIds: Array<{ sourceId: string; kind: EmbeddingKind }>;
  /** Kinds always readable regardless of parent ownership (catalog kinds). */
  globalKinds: readonly EmbeddingKind[];
}

export async function searchByVector(
  queryVector: number[],
  options: {
    kinds?: readonly EmbeddingKind[];
    runId?: string;
    scanId?: string;
    metadataFilter?: Record<string, unknown>;
    topK?: number;
    minScore?: number;
    userScope?: UserScope;
  } = {},
): Promise<SearchResult[]> {
  const prisma = await getPrisma();
  const topK = Math.min(Math.max(options.topK ?? 20, 1), 100);
  const minScore = options.minScore ?? 0.3;
  const vecLiteral = `[${queryVector.join(",")}]`;
  const params: Array<string | number> = [vecLiteral];
  const conditions: string[] = [];

  if (options.kinds && options.kinds.length > 0) {
    const placeholders = options.kinds.map((_, idx) => `$${params.length + idx + 1}`);
    conditions.push(`kind IN (${placeholders.join(",")})`);
    params.push(...options.kinds);
  }

  if (options.runId) {
    params.push(options.runId);
    conditions.push(`run_id = $${params.length}`);
  }

  if (options.scanId) {
    params.push(options.scanId);
    conditions.push(`scan_id = $${params.length}`);
  }

  if (options.metadataFilter && Object.keys(options.metadataFilter).length > 0) {
    params.push(JSON.stringify(options.metadataFilter));
    conditions.push(`metadata_json @> $${params.length}::jsonb`);
  }

  if (options.userScope) {
    const scope = options.userScope;
    const orParts: string[] = [];

    if (scope.globalKinds.length > 0) {
      const placeholders = scope.globalKinds.map((_, idx) => `$${params.length + idx + 1}`);
      orParts.push(`kind IN (${placeholders.join(",")})`);
      params.push(...scope.globalKinds);
    }

    if (scope.accessibleRunIds.length > 0) {
      const placeholders = scope.accessibleRunIds.map((_, idx) => `$${params.length + idx + 1}`);
      orParts.push(`run_id IN (${placeholders.join(",")})`);
      params.push(...scope.accessibleRunIds);
    }

    if (scope.accessibleScanIds.length > 0) {
      const placeholders = scope.accessibleScanIds.map(
        (_, idx) => `$${params.length + idx + 1}`,
      );
      orParts.push(`scan_id IN (${placeholders.join(",")})`);
      params.push(...scope.accessibleScanIds);
    }

    // Group source-ids by kind so each kind only matches its own source-ids.
    const byKind = new Map<EmbeddingKind, string[]>();
    for (const entry of scope.accessibleSourceIds) {
      const arr = byKind.get(entry.kind) ?? [];
      arr.push(entry.sourceId);
      byKind.set(entry.kind, arr);
    }
    for (const [kind, sourceIds] of byKind.entries()) {
      if (sourceIds.length === 0) continue;
      params.push(kind);
      const kindParam = `$${params.length}`;
      const idPlaceholders = sourceIds.map((_, idx) => `$${params.length + idx + 1}`);
      params.push(...sourceIds);
      orParts.push(`(kind = ${kindParam} AND source_id IN (${idPlaceholders.join(",")}))`);
    }

    if (orParts.length === 0) {
      // User has access to nothing relevant -- return empty without hitting
      // the database. (Bare `WHERE FALSE` is also safe; short-circuit is
      // simpler and avoids a wasted query.)
      return [];
    }

    conditions.push(`(${orParts.join(" OR ")})`);
  }

  params.push(topK);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows: Array<{
    id: string;
    kind: string;
    source_id: string;
    run_id: string | null;
    scan_id: string | null;
    content_text: string;
    metadata_json: Record<string, unknown> | null;
    score: number;
  }> = await prisma.$queryRawUnsafe(
    `
    SELECT
      id,
      kind,
      source_id,
      run_id,
      scan_id,
      content_text,
      metadata_json,
      1 - (embedding <=> $1::vector) AS score
    FROM forge_embeddings
    ${whereClause}
    ORDER BY embedding <=> $1::vector
    LIMIT $${params.length}
  `,
    ...params,
  );

  return rows
    .filter((r) => r.score >= minScore)
    .map((r) => ({
      id: r.id,
      kind: r.kind as EmbeddingKind,
      sourceId: r.source_id,
      runId: r.run_id,
      scanId: r.scan_id,
      contentText: r.content_text,
      metadataJson: r.metadata_json,
      score: r.score,
    }));
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/** Count embeddings, optionally filtered by kind. */
export async function countEmbeddings(kind?: EmbeddingKind, sourceId?: string): Promise<number> {
  const prisma = await getPrisma();
  const conditions: string[] = [];
  const params: string[] = [];
  if (kind) {
    params.push(kind);
    conditions.push(`kind = $${params.length}`);
  }
  if (sourceId) {
    params.push(sourceId);
    conditions.push(`source_id = $${params.length}`);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows: Array<{ count: bigint }> = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) as count FROM forge_embeddings ${whereClause}`,
    ...params,
  );
  return Number(rows[0]?.count ?? 0);
}

/** Check if the forge_embeddings table exists. */
export async function embeddingsTableExists(): Promise<boolean> {
  const prisma = await getPrisma();
  try {
    const rows: Array<{ exists: boolean }> = await prisma.$queryRawUnsafe(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'forge_embeddings'
      ) AS exists
    `);
    return rows[0]?.exists ?? false;
  } catch {
    return false;
  }
}
