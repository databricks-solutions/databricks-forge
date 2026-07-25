/**
 * CRUD operations for the prompt template archive — backed by Lakebase (Prisma).
 *
 * Content-addressable store: each template is keyed by its SHA-256 hash.
 * Old versions accumulate naturally as prompts evolve, enabling historical
 * retrieval and cross-run comparison.
 */

import { withPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { PROMPT_TEMPLATES, PROMPT_VERSIONS, type PromptKey } from "@/lib/ai/templates";

/**
 * Upsert all current prompt templates into the archive.
 * Called once per run creation. Idempotent: if the hash already exists,
 * the row is skipped (same hash = same text).
 */
export async function archiveCurrentPromptTemplates(): Promise<void> {
  try {
    await withPrisma(async (prisma) => {
      const entries = Object.entries(PROMPT_TEMPLATES) as [PromptKey, string][];

      for (const [key, text] of entries) {
        const hash = PROMPT_VERSIONS[key];
        try {
          await prisma.forgePromptTemplate.upsert({
            where: { versionHash: hash },
            create: {
              versionHash: hash,
              promptKey: key,
              templateText: text,
              charCount: text.length,
            },
            update: {},
          });
        } catch (err) {
          logger.warn("Failed to archive prompt template", {
            promptKey: key,
            versionHash: hash,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    });
  } catch (error) {
    logger.warn("Failed to archive prompt templates", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Retrieve a prompt template by its version hash.
 */
export async function getPromptTemplate(
  versionHash: string,
): Promise<{ promptKey: string; templateText: string; charCount: number } | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgePromptTemplate.findUnique({
      where: { versionHash },
    });
    if (!row) return null;
    return {
      promptKey: row.promptKey,
      templateText: row.templateText,
      charCount: row.charCount,
    };
  });
}

/**
 * Retrieve multiple prompt templates by their version hashes (batch).
 */
export async function getPromptTemplatesBatch(
  versionHashes: string[],
): Promise<Map<string, { promptKey: string; templateText: string }>> {
  if (versionHashes.length === 0) return new Map();
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgePromptTemplate.findMany({
      where: { versionHash: { in: versionHashes } },
    });
    const map = new Map<string, { promptKey: string; templateText: string }>();
    for (const row of rows) {
      map.set(row.versionHash, {
        promptKey: row.promptKey,
        templateText: row.templateText,
      });
    }
    return map;
  });
}
