/**
 * Entity Extraction — processes cached sample data to identify columns
 * suitable for Genie entity matching.
 *
 * Entity matching helps Genie resolve conversational terms to actual data
 * values (e.g. "Florida" -> "FL"). This module analyzes sample rows to
 * find bounded-cardinality string columns and extracts their distinct values.
 */

import type { SampleDataCache, EntityMatchingCandidate } from "./types";
import type { SensitivityClassification } from "@/lib/domain/types";
import { logger } from "@/lib/logger";

const MAX_DISTINCT_FOR_ENTITY = 100;
const MAX_VALUE_LENGTH = 127;
const STRING_TYPE_PATTERNS = /^(string|varchar|char|text)/i;
const ENTITY_NAME_HINTS =
  /(_code|_status|_type|_category|_class|_level|_tier|_region|_state|_country|_dept|_group)$/i;

export interface EntityExtractionOptions {
  tableFqns: string[];
  sampleData: SampleDataCache;
  piiClassifications?: SensitivityClassification[];
}

/**
 * Analyze cached sample data to identify entity-matching candidate columns.
 *
 * A column is a candidate when:
 * 1. It is a string type
 * 2. It has bounded cardinality (distinct values <= threshold from sample)
 * 3. It is not flagged as PII
 * 4. Values are human-meaningful (not UUIDs, hashes, etc.)
 */
export function extractEntityCandidates(opts: EntityExtractionOptions): EntityMatchingCandidate[] {
  const { tableFqns, sampleData, piiClassifications } = opts;
  const candidates: EntityMatchingCandidate[] = [];

  const piiColumns = new Set<string>();
  if (piiClassifications) {
    for (const c of piiClassifications) {
      if (c.classification === "PII" || c.classification === "Authentication") {
        piiColumns.add(`${c.tableFqn.toLowerCase()}.${c.columnName.toLowerCase()}`);
      }
    }
  }

  for (const fqn of tableFqns) {
    const entry = sampleData.get(fqn) ?? sampleData.get(fqn.toLowerCase());
    if (!entry || entry.rows.length === 0) continue;

    for (let colIdx = 0; colIdx < entry.columns.length; colIdx++) {
      const colName = entry.columns[colIdx];
      const colType = entry.columnTypes[colIdx] ?? "string";

      if (!STRING_TYPE_PATTERNS.test(colType)) continue;

      const key = `${fqn.toLowerCase()}.${colName.toLowerCase()}`;
      if (piiColumns.has(key)) continue;

      const values = new Set<string>();
      let hasLongValues = false;
      let hasUuidPattern = false;

      for (const row of entry.rows) {
        const val = row[colIdx];
        if (val === null || val === undefined) continue;
        const s = String(val).trim();
        if (s.length === 0) continue;
        if (s.length > MAX_VALUE_LENGTH) {
          hasLongValues = true;
          continue;
        }
        values.add(s);
      }

      if (values.size === 0) continue;

      // Skip UUID-like columns
      const firstVal = [...values][0];
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(firstVal)) hasUuidPattern = true;
      if (hasUuidPattern) continue;

      // Skip if every value is unique (likely a natural key, not a category)
      if (values.size === entry.rows.length && values.size > 5) continue;

      if (values.size <= MAX_DISTINCT_FOR_ENTITY && !hasLongValues) {
        const sampleValues = [...values].sort().slice(0, 50);
        const nameHint = ENTITY_NAME_HINTS.test(colName);
        const ratio = values.size / Math.max(entry.rows.length, 1);
        const confidence: EntityMatchingCandidate["confidence"] =
          nameHint && ratio < 0.3 ? "high" : ratio < 0.5 ? "medium" : "low";

        candidates.push({
          tableFqn: fqn,
          columnName: colName,
          sampleValues,
          distinctCount: values.size,
          confidence,
          conversationalMappings: [],
        });
      }
    }
  }

  logger.info("Entity extraction complete", {
    tablesAnalyzed: tableFqns.length,
    candidatesFound: candidates.length,
  });

  return candidates;
}

/**
 * Fallback heuristic when no sample data is available.
 * Uses column names and types to guess entity-matching candidates.
 */
export function extractEntityCandidatesFromSchema(
  columns: Array<{ tableFqn: string; columnName: string; dataType: string }>,
  tableFqns: string[],
): EntityMatchingCandidate[] {
  const tableSet = new Set(tableFqns.map((f) => f.toLowerCase()));
  const candidates: EntityMatchingCandidate[] = [];

  for (const col of columns) {
    if (!tableSet.has(col.tableFqn.toLowerCase())) continue;
    if (!STRING_TYPE_PATTERNS.test(col.dataType)) continue;
    if (!ENTITY_NAME_HINTS.test(col.columnName)) continue;

    candidates.push({
      tableFqn: col.tableFqn,
      columnName: col.columnName,
      sampleValues: [],
      distinctCount: 0,
      confidence: "low",
      conversationalMappings: [],
    });
  }

  return candidates;
}
