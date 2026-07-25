/**
 * API: /api/search/stats
 *
 * GET -- Return embedding statistics (counts by kind and scope).
 */

import { NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { getEmbeddingStats } from "@/lib/embeddings/re-embed";
import { embeddingsTableExists } from "@/lib/embeddings/store";
import { isEmbeddingEnabled } from "@/lib/embeddings/config";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const enabled = isEmbeddingEnabled();
    if (!enabled) {
      return NextResponse.json({
        enabled: false,
        totalRecords: 0,
        byKind: {},
        byScope: { estate: 0, pipeline: 0, genie: 0, documents: 0 },
      });
    }

    const exists = await embeddingsTableExists();
    if (!exists) {
      return NextResponse.json({
        enabled: true,
        tableExists: false,
        totalRecords: 0,
        byKind: {},
        byScope: { estate: 0, pipeline: 0, genie: 0, documents: 0 },
      });
    }

    const stats = await getEmbeddingStats();
    return NextResponse.json({ enabled: true, tableExists: true, ...stats });
  } catch (error) {
    logger.error("[api/search/stats] GET failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
