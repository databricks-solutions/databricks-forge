/**
 * CRUD operations for export records — backed by Lakebase (Prisma).
 *
 * Tracks every export (Excel, PDF, PPTX, Notebooks) with format,
 * file path, and timestamp. Used for the Exports tab on run detail.
 */

import { randomUUID } from "crypto";
import { withPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { ExportFormat } from "@/lib/domain/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportRecordRow {
  exportId: string;
  runId: string;
  format: ExportFormat;
  filePath: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

/**
 * Record an export. Fire-and-forget safe — failures are logged but don't
 * block the export itself.
 */
export async function insertExportRecord(
  runId: string,
  format: ExportFormat,
  filePath?: string | null,
): Promise<void> {
  try {
    await withPrisma(async (prisma) => {
      await prisma.forgeExport.create({
        data: {
          exportId: randomUUID(),
          runId,
          format,
          filePath: filePath ?? null,
        },
      });
    });
  } catch (error) {
    logger.warn("Failed to insert export record", {
      runId,
      format,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Get all exports for a run, ordered by creation time descending.
 */
export async function getExportsByRunId(runId: string): Promise<ExportRecordRow[]> {
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeExport.findMany({
      where: { runId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => ({
      exportId: row.exportId,
      runId: row.runId,
      format: row.format as ExportFormat,
      filePath: row.filePath,
      createdAt: row.createdAt.toISOString(),
    }));
  });
}
