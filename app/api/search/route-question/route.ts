/**
 * API: /api/search/route-question
 *
 * GET -- Route a natural language question to the best Genie Space.
 *
 * Query params:
 *   q      (required)  Natural language question
 *   runId  (optional)  Restrict to a specific run
 *   topK   (optional)  Max spaces to return (default: 5)
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { routeQuestionToSpace } from "@/lib/embeddings/question-router";
import { isEmbeddingEnabled } from "@/lib/embeddings/config";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    if (!isEmbeddingEnabled()) {
      return NextResponse.json({ matches: [], query: "", enabled: false });
    }

    const params = request.nextUrl.searchParams;
    const q = params.get("q");

    if (!q || q.trim().length === 0) {
      return NextResponse.json({ error: "Query parameter 'q' is required" }, { status: 400 });
    }

    const runId = params.get("runId") || undefined;
    const topK = parseInt(params.get("topK") || "5", 10) || 5;

    const result = await routeQuestionToSpace(q.trim(), {
      runId,
      topK,
      minScore: 0.4,
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error("[api/search/route-question] GET failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
