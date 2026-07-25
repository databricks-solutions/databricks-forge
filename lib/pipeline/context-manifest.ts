/**
 * Run-level enrichment provenance manifest.
 *
 * Tracks which benchmarks, outcome maps, and RAG documents were used
 * across all pipeline steps so users can see what influenced generation.
 */

import { withPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { BenchmarkSourceMeta } from "@/lib/domain/benchmark-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunContextManifest {
  benchmarks: BenchmarkSourceMeta;
  outcomeMap: {
    industryId: string | null;
    sections: string[];
  };
  documents: {
    sourceIds: string[];
    kinds: string[];
    chunkCount: number;
  };
  fabric: {
    scanId: string | null;
    datasetCount: number;
    measureCount: number;
    reportCount: number;
  };
  steps: string[];
}

export type EnrichmentTag = "benchmark" | "outcome_map" | "document" | "fabric";

// ---------------------------------------------------------------------------
// Factory + merge
// ---------------------------------------------------------------------------

export function emptyManifest(): RunContextManifest {
  return {
    benchmarks: { strategy: "default", recordIds: [], chunkCount: 0 },
    outcomeMap: { industryId: null, sections: [] },
    documents: { sourceIds: [], kinds: [], chunkCount: 0 },
    fabric: { scanId: null, datasetCount: 0, measureCount: 0, reportCount: 0 },
    steps: [],
  };
}

/**
 * Merge new provenance data into an existing manifest.
 * Arrays are unioned (deduplicated); scalars take the latest non-null value.
 */
export function mergeManifest(
  base: RunContextManifest,
  partial: Partial<RunContextManifest>,
): RunContextManifest {
  const merged = { ...base };

  if (partial.benchmarks) {
    const b = partial.benchmarks;
    if (b.strategy !== "default") {
      merged.benchmarks = {
        strategy: b.strategy,
        recordIds: dedupe([...base.benchmarks.recordIds, ...b.recordIds]),
        chunkCount: base.benchmarks.chunkCount + b.chunkCount,
      };
    }
  }

  if (partial.outcomeMap) {
    const o = partial.outcomeMap;
    merged.outcomeMap = {
      industryId: o.industryId ?? base.outcomeMap.industryId,
      sections: dedupe([...base.outcomeMap.sections, ...o.sections]),
    };
  }

  if (partial.documents) {
    const d = partial.documents;
    merged.documents = {
      sourceIds: dedupe([...base.documents.sourceIds, ...d.sourceIds]),
      kinds: dedupe([...base.documents.kinds, ...d.kinds]),
      chunkCount: base.documents.chunkCount + d.chunkCount,
    };
  }

  if (partial.fabric) {
    const f = partial.fabric;
    merged.fabric = {
      scanId: f.scanId ?? base.fabric.scanId,
      datasetCount: f.datasetCount || base.fabric.datasetCount,
      measureCount: f.measureCount || base.fabric.measureCount,
      reportCount: f.reportCount || base.fabric.reportCount,
    };
  }

  if (partial.steps) {
    merged.steps = dedupe([...base.steps, ...partial.steps]);
  }

  return merged;
}

/**
 * Derive the lightweight enrichment tags from a manifest.
 */
export function deriveTags(
  manifest: Partial<RunContextManifest> &
    Pick<RunContextManifest, "benchmarks" | "outcomeMap" | "documents">,
): EnrichmentTag[] {
  const tags: EnrichmentTag[] = [];
  if (manifest.benchmarks.strategy !== "default" && manifest.benchmarks.recordIds.length > 0) {
    tags.push("benchmark");
  }
  if (manifest.outcomeMap.sections.length > 0) {
    tags.push("outcome_map");
  }
  if (manifest.documents.sourceIds.length > 0) {
    tags.push("document");
  }
  if (manifest.fabric?.scanId) {
    tags.push("fabric");
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Read-merge-write the manifest for a run.
 * Safe to call from multiple pipeline steps -- each call merges
 * into the existing value rather than overwriting.
 */
export async function persistManifest(
  runId: string,
  partial: Partial<RunContextManifest>,
): Promise<void> {
  try {
    await withPrisma(async (prisma) => {
      const row = await prisma.forgeRun.findUnique({
        where: { runId },
        select: { contextSourcesJson: true },
      });

      let existing: RunContextManifest;
      try {
        existing = row?.contextSourcesJson ? JSON.parse(row.contextSourcesJson) : emptyManifest();
      } catch {
        existing = emptyManifest();
      }

      const merged = mergeManifest(existing, partial);

      await prisma.forgeRun.update({
        where: { runId },
        data: { contextSourcesJson: JSON.stringify(merged) },
      });
    });
  } catch (err) {
    logger.warn("[context-manifest] Failed to persist manifest", {
      runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}
