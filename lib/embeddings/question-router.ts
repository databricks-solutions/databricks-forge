/**
 * Question-to-Space router.
 *
 * Given a natural language question, finds the Genie Space most likely
 * to answer it by searching genie_question embeddings. Returns ranked
 * spaces with relevance scores and the matching sample question.
 */

import { generateEmbedding } from "./client";
import { searchByVector } from "./store";
import type { SearchResult } from "./types";
import { isEmbeddingEnabled } from "./config";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpaceMatch {
  domain: string;
  spaceTitle: string;
  runId: string;
  matchedQuestion: string;
  score: number;
  hasSql: boolean;
}

export interface RouteResult {
  matches: SpaceMatch[];
  query: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Route a question to the best-matching Genie Spaces.
 * Searches genie_question embeddings and groups by space/domain.
 */
export async function routeQuestionToSpace(
  question: string,
  opts: { topK?: number; minScore?: number; runId?: string } = {},
): Promise<RouteResult> {
  if (!isEmbeddingEnabled()) return { matches: [], query: question };

  const topK = opts.topK ?? 10;
  const minScore = opts.minScore ?? 0.5;

  const queryVector = await generateEmbedding(question);

  const results: SearchResult[] = await searchByVector(queryVector, {
    kinds: ["genie_question"],
    runId: opts.runId,
    topK,
    minScore,
  });

  // Deduplicate by domain, keeping the highest-scoring match per domain
  const domainBest = new Map<string, SearchResult>();
  for (const r of results) {
    const domain = (r.metadataJson?.domain as string) ?? "Unknown";
    const existing = domainBest.get(domain);
    if (!existing || r.score > existing.score) {
      domainBest.set(domain, r);
    }
  }

  const matches: SpaceMatch[] = Array.from(domainBest.values())
    .sort((a, b) => b.score - a.score)
    .map((r) => ({
      domain: (r.metadataJson?.domain as string) ?? "Unknown",
      spaceTitle: (r.metadataJson?.spaceTitle as string) ?? "Unknown",
      runId: r.runId ?? "",
      matchedQuestion: extractQuestion(r.contentText),
      score: r.score,
      hasSql: Boolean(r.metadataJson?.hasSql),
    }));

  logger.debug("[question-router] Routed question", {
    query: question.slice(0, 80),
    matchCount: matches.length,
    topScore: matches[0]?.score,
  });

  return { matches, query: question };
}

function extractQuestion(content: string): string {
  const match = content.match(/^Question:\s*(.+)/m);
  return match?.[1]?.trim() ?? content.split("\n")[0] ?? "";
}
