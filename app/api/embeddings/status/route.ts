/**
 * API: /api/embeddings/status
 *
 * GET -- Returns the current embedding feature status.
 *
 * Used by UI components to decide whether to render embedding-dependent
 * features (search bar, knowledge base, etc.).
 */

import { NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { isEmbeddingEnabled } from "@/lib/embeddings/config";
import { embeddingsTableExists } from "@/lib/embeddings/store";
import { getEmbeddingStats } from "@/lib/embeddings/re-embed";
import { logger } from "@/lib/logger";
import { isDatabaseReady } from "@/lib/prisma";

export async function GET() {
  try {
    if (!isDatabaseReady()) {
      return NextResponse.json(
        { enabled: false, error: "Database is warming up. Please retry shortly." },
        { status: 503, headers: { "Retry-After": "3" } },
      );
    }

    const enabled = isEmbeddingEnabled();

    if (!enabled) {
      return NextResponse.json({
        enabled: false,
        tableExists: false,
        totalRecords: 0,
        byScope: { estate: 0, pipeline: 0, genie: 0, documents: 0 },
      });
    }

    const tableExists = await embeddingsTableExists();

    if (!tableExists) {
      return NextResponse.json({
        enabled: true,
        tableExists: false,
        totalRecords: 0,
        byScope: { estate: 0, pipeline: 0, genie: 0, documents: 0 },
      });
    }

    const stats = await getEmbeddingStats();

    return NextResponse.json({
      enabled: true,
      tableExists: true,
      totalRecords: stats.totalRecords,
      byScope: stats.byScope,
    });
  } catch (error) {
    logger.error("[api/embeddings/status] GET failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ enabled: false, error: safeErrorMessage(error) }, { status: 500 });
  }
}
