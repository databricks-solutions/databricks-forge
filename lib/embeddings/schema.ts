/**
 * Raw SQL for pgvector schema management.
 *
 * Called during startup (after prisma db push) to ensure the vector
 * extension and forge_embeddings table exist. All statements are
 * idempotent (IF NOT EXISTS).
 *
 * Prisma does not natively support the pgvector `vector(N)` type,
 * so this table is managed outside of the Prisma schema.
 */

import { getPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

const EMBEDDING_DIM = 1024;

/**
 * Ensure the pgvector extension and forge_embeddings table exist.
 * Safe to call on every startup -- all statements are idempotent.
 */
export async function ensureEmbeddingSchema(): Promise<void> {
  const prisma = await getPrisma();

  try {
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
    logger.info("[embeddings] pgvector extension ensured");
  } catch (err) {
    logger.warn("[embeddings] Failed to create pgvector extension (may already exist)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Table creation — Prisma db push normally handles this at startup, but
  // this serves as a fallback for deployments where embeddings were enabled
  // after initial provisioning.
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS forge_embeddings (
        id            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
        kind          TEXT NOT NULL,
        source_id     TEXT NOT NULL,
        run_id        TEXT,
        scan_id       TEXT,
        content_text  TEXT NOT NULL,
        metadata_json JSONB,
        embedding     vector(${EMBEDDING_DIM}) NOT NULL,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } catch (err) {
    logger.warn(
      "[embeddings] Table creation skipped (may already exist or insufficient privileges)",
      {
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }

  // B-tree indexes — Prisma also creates these via @@index directives (with
  // different names).  Each is independently try/caught so a permission error
  // (e.g. runtime user is not the table owner) does not abort the backfill.
  const btreeIndexes = [
    { name: "idx_embeddings_kind", col: "kind" },
    { name: "idx_embeddings_source", col: "source_id" },
    { name: "idx_embeddings_run", col: "run_id" },
    { name: "idx_embeddings_scan", col: "scan_id" },
  ];
  for (const { name, col } of btreeIndexes) {
    try {
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS ${name} ON forge_embeddings(${col})`,
      );
    } catch (err) {
      logger.debug(
        `[embeddings] Index ${name} creation skipped (may exist or insufficient privileges)`,
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  try {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw ON forge_embeddings
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    `);
  } catch (err) {
    logger.warn(
      "[embeddings] HNSW index creation skipped (may already exist or insufficient privileges)",
      {
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }

  logger.info("[embeddings] Schema bootstrap complete");
}
