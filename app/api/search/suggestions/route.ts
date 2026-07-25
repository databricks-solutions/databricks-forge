/**
 * API: /api/search/suggestions
 *
 * GET -- Find similar use cases from previous runs based on a query.
 *
 * Query params:
 *   q             (required)  Business context or search description
 *   excludeRunId  (optional)  Exclude a specific run from results
 *   topK          (optional)  Max results (default: 10)
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { suggestSimilarUseCases } from "@/lib/embeddings/run-suggestions";
import { isEmbeddingEnabled } from "@/lib/embeddings/config";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    if (!isEmbeddingEnabled()) {
      return NextResponse.json({ suggestions: [], enabled: false });
    }

    const params = request.nextUrl.searchParams;
    const q = params.get("q");

    if (!q || q.trim().length === 0) {
      return NextResponse.json({ error: "Query parameter 'q' is required" }, { status: 400 });
    }

    const excludeRunId = params.get("excludeRunId") || undefined;
    const topK = parseInt(params.get("topK") || "10", 10) || 10;

    const suggestions = await suggestSimilarUseCases(q.trim(), {
      excludeRunId,
      topK,
      minScore: 0.5,
    });

    return NextResponse.json({ suggestions, query: q.trim() });
  } catch (error) {
    logger.error("[api/search/suggestions] GET failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
