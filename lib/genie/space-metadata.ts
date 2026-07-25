/**
 * Shared utility for extracting structured metadata from a Genie Space's
 * serialized_space JSON. Used by the discover endpoint and the asset scanner.
 */

import type { SerializedSpace } from "./types";

export interface SpaceMetadata {
  tableCount: number;
  metricViewCount: number;
  measureCount: number;
  sampleQuestionCount: number;
  filterCount: number;
  expressionCount: number;
  joinCount: number;
  exampleSqlCount: number;
  benchmarkCount: number;
  instructionLength: number;
  tables: string[];
  metricViews: string[];
}

/**
 * Parse a serialized_space JSON string and extract metadata counts.
 * Returns null if parsing fails.
 */
export function extractSpaceMetadata(serializedSpace: string): SpaceMetadata | null {
  const parsed = parseSerializedSpace(serializedSpace);
  if (!parsed) return null;
  return extractMetadataFromParsed(parsed);
}

/** Extract metadata from an already-parsed SerializedSpace. */
export function extractMetadataFromParsed(space: SerializedSpace): SpaceMetadata {
  const tables = space.data_sources?.tables?.map((t) => t.identifier) ?? [];
  const metricViews = space.data_sources?.metric_views?.map((m) => m.identifier) ?? [];
  const snippets = space.instructions?.sql_snippets;

  return {
    tableCount: tables.length,
    metricViewCount: metricViews.length,
    measureCount: snippets?.measures?.length ?? 0,
    sampleQuestionCount: space.config?.sample_questions?.length ?? 0,
    filterCount: snippets?.filters?.length ?? 0,
    expressionCount: snippets?.expressions?.length ?? 0,
    joinCount: space.instructions?.join_specs?.length ?? 0,
    exampleSqlCount: space.instructions?.example_question_sqls?.length ?? 0,
    benchmarkCount: space.benchmarks?.questions?.length ?? 0,
    instructionLength:
      space.instructions?.text_instructions?.reduce(
        (sum, i) => sum + (i.content?.join(" ").length ?? 0),
        0,
      ) ?? 0,
    tables,
    metricViews,
  };
}

export function parseSerializedSpace(raw: string): SerializedSpace | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SerializedSpace;
  } catch {
    return null;
  }
}
