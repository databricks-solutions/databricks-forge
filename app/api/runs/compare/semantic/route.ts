/**
 * GET /api/runs/compare/semantic -- Semantic use case overlap between two runs.
 *
 * For each use case in Run A, finds the nearest neighbor in Run B using
 * embedding similarity. Categorises pairs as near-duplicate (>0.85),
 * related (0.6-0.85), or unique (no match).
 *
 * Query params:
 *   runA   (required)  Run ID for the first run
 *   runB   (required)  Run ID for the second run
 */

import { NextRequest } from "next/server";
import { isEmbeddingEnabled } from "@/lib/embeddings/config";
import { withPrisma } from "@/lib/prisma";
import { generateEmbedding } from "@/lib/embeddings/client";
import { searchByVector } from "@/lib/embeddings/store";
import { logger } from "@/lib/logger";
import { loadRunOrRespond } from "@/lib/auth/route-guards";

interface OverlapPair {
  useCaseA: { id: string; name: string };
  useCaseB: { id: string; name: string } | null;
  similarity: number;
  category: "near-duplicate" | "related" | "unique";
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const runA = params.get("runA");
    const runB = params.get("runB");

    if (!runA || !runB) {
      return Response.json({ error: "runA and runB are required" }, { status: 400 });
    }

    const guardA = await loadRunOrRespond(req, runA, "read");
    if (!guardA.ok) return guardA.response;
    const guardB = await loadRunOrRespond(req, runB, "read");
    if (!guardB.ok) return guardB.response;

    if (!isEmbeddingEnabled()) {
      return Response.json({ enabled: false, pairs: [] });
    }

    const useCasesA = await withPrisma(async (prisma) =>
      prisma.forgeUseCase.findMany({
        where: { runId: runA },
        select: { id: true, name: true, statement: true },
      }),
    );

    if (useCasesA.length === 0) {
      return Response.json({ enabled: true, pairs: [] });
    }

    const pairs: OverlapPair[] = [];

    for (const uc of useCasesA) {
      const text = `${uc.name ?? ""} ${uc.statement ?? ""}`.trim();
      if (!text) {
        pairs.push({
          useCaseA: { id: uc.id, name: uc.name ?? "Unnamed" },
          useCaseB: null,
          similarity: 0,
          category: "unique",
        });
        continue;
      }

      try {
        const vector = await generateEmbedding(text);
        const results = await searchByVector(vector, {
          kinds: ["use_case"],
          runId: runB,
          topK: 1,
          minScore: 0.4,
        });

        if (results.length > 0) {
          const best = results[0];
          const similarity = best.score;
          const category: OverlapPair["category"] =
            similarity > 0.85 ? "near-duplicate" : similarity > 0.6 ? "related" : "unique";

          pairs.push({
            useCaseA: { id: uc.id, name: uc.name ?? "Unnamed" },
            useCaseB: {
              id: best.sourceId,
              name: best.contentText.split("\n")[0].slice(0, 120),
            },
            similarity,
            category,
          });
        } else {
          pairs.push({
            useCaseA: { id: uc.id, name: uc.name ?? "Unnamed" },
            useCaseB: null,
            similarity: 0,
            category: "unique",
          });
        }
      } catch (err) {
        logger.warn("[api/compare/semantic] Failed for use case", {
          ucId: uc.id,
          error: String(err),
        });
        pairs.push({
          useCaseA: { id: uc.id, name: uc.name ?? "Unnamed" },
          useCaseB: null,
          similarity: 0,
          category: "unique",
        });
      }
    }

    pairs.sort((a, b) => b.similarity - a.similarity);

    const stats = {
      nearDuplicate: pairs.filter((p) => p.category === "near-duplicate").length,
      related: pairs.filter((p) => p.category === "related").length,
      unique: pairs.filter((p) => p.category === "unique").length,
    };

    return Response.json({ enabled: true, pairs, stats });
  } catch (err) {
    logger.error("[api/compare/semantic] Error", { error: String(err) });
    return Response.json({ error: "Semantic comparison failed" }, { status: 500 });
  }
}
