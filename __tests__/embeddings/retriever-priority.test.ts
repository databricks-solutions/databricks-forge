import { describe, expect, it } from "vitest";
import type { SearchResult } from "@/lib/embeddings/types";
import { rerankByProvenanceForTest } from "@/lib/embeddings/retriever";

function mk(partial: Partial<SearchResult>): SearchResult {
  return {
    id: partial.id ?? "1",
    kind: partial.kind ?? "outcome_map",
    sourceId: partial.sourceId ?? "src",
    runId: partial.runId ?? null,
    scanId: partial.scanId ?? null,
    contentText: partial.contentText ?? "",
    metadataJson: partial.metadataJson ?? null,
    score: partial.score ?? 0.7,
  };
}

describe("retriever source-priority ranking", () => {
  it("prefers customer facts over advisory context at similar similarity", () => {
    const ranked = rerankByProvenanceForTest([
      mk({ id: "a", kind: "outcome_map", score: 0.73 }),
      mk({ id: "b", kind: "table_detail", score: 0.71 }),
    ]);
    expect(ranked[0].id).toBe("b");
  });

  it("penalizes stale benchmark context", () => {
    const ranked = rerankByProvenanceForTest([
      mk({
        id: "fresh",
        kind: "benchmark_context",
        score: 0.7,
        metadataJson: { sourcePriority: "IndustryBenchmark", validUntil: "2099-01-01T00:00:00Z" },
      }),
      mk({
        id: "stale",
        kind: "benchmark_context",
        score: 0.8,
        metadataJson: { sourcePriority: "IndustryBenchmark", validUntil: "2020-01-01T00:00:00Z" },
      }),
    ]);
    expect(ranked[0].id).toBe("fresh");
  });
});
