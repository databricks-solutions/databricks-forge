/**
 * Strategy alignment utility -- deterministic matching of use cases
 * against the Master Repository strategic taxonomy.
 *
 * Uses the strategic imperatives and pillars from the enrichment data
 * to classify and score use cases without requiring an LLM call.
 */

import { getMasterRepoEnrichment } from "@/lib/domain/industry-outcomes/master-repo-registry";
import type { MasterRepoUseCase } from "@/lib/domain/industry-outcomes/master-repo-types";

export interface StrategicImperativeAlignment {
  imperative: string;
  pillars: Map<string, string[]>;
  useCaseCount: number;
}

export interface StrategyAlignmentMap {
  industryId: string;
  imperatives: StrategicImperativeAlignment[];
  alignedCount: number;
  unalignedCount: number;
  score: number;
}

/**
 * Build a strategy alignment map for a set of use cases against the
 * Master Repository's strategic taxonomy for the given industry.
 *
 * Performs fuzzy name matching between pipeline-generated use cases
 * and Master Repository reference use cases to assign strategic
 * imperatives and pillars.
 */
export function buildStrategyAlignmentMap(
  industryId: string,
  useCaseNames: string[],
): StrategyAlignmentMap | null {
  const enrichment = getMasterRepoEnrichment(industryId);
  if (!enrichment) return null;

  const refIndex = buildReferenceIndex(enrichment.useCases);

  const imperativeMap = new Map<string, Map<string, string[]>>();
  let aligned = 0;

  for (const ucName of useCaseNames) {
    const ref = matchReference(ucName, refIndex);
    if (!ref?.strategicImperative) continue;

    aligned++;
    const imp = ref.strategicImperative;
    const pillar = ref.strategicPillar || "General";

    if (!imperativeMap.has(imp)) imperativeMap.set(imp, new Map());
    const pillarMap = imperativeMap.get(imp)!;
    if (!pillarMap.has(pillar)) pillarMap.set(pillar, []);
    pillarMap.get(pillar)!.push(ucName);
  }

  const imperatives: StrategicImperativeAlignment[] = [];
  for (const [imp, pillars] of imperativeMap) {
    let count = 0;
    for (const names of pillars.values()) count += names.length;
    imperatives.push({ imperative: imp, pillars, useCaseCount: count });
  }
  imperatives.sort((a, b) => b.useCaseCount - a.useCaseCount);

  const total = useCaseNames.length;

  return {
    industryId,
    imperatives,
    alignedCount: aligned,
    unalignedCount: total - aligned,
    score: total > 0 ? aligned / total : 0,
  };
}

/**
 * Build a compact strategy alignment summary for prompt injection.
 * Returns null if no alignment data is available.
 */
export function buildStrategyAlignmentPrompt(
  industryId: string,
  useCaseNames: string[],
): string | null {
  const map = buildStrategyAlignmentMap(industryId, useCaseNames);
  if (!map || map.imperatives.length === 0) return null;

  const lines: string[] = [
    `### STRATEGIC ALIGNMENT (${map.alignedCount}/${useCaseNames.length} use cases mapped)`,
    "",
  ];

  for (const imp of map.imperatives) {
    lines.push(`**${imp.imperative}** (${imp.useCaseCount} use cases)`);
    for (const [pillar, names] of imp.pillars) {
      const display = names.slice(0, 3).join(", ");
      const more = names.length > 3 ? ` +${names.length - 3} more` : "";
      lines.push(`  - ${pillar}: ${display}${more}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Internal matching helpers
// ---------------------------------------------------------------------------

type RefEntry = { normalized: string; tokens: Set<string>; ref: MasterRepoUseCase };

function buildReferenceIndex(refs: MasterRepoUseCase[]): RefEntry[] {
  return refs
    .filter((r) => r.strategicImperative)
    .map((ref) => ({
      normalized: normalize(ref.name),
      tokens: new Set(tokenize(ref.name)),
      ref,
    }));
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

function tokenize(s: string): string[] {
  return normalize(s)
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/**
 * Fuzzy match a pipeline use case name against reference entries.
 * Uses token overlap (Jaccard-like) scoring.
 */
function matchReference(ucName: string, index: RefEntry[]): MasterRepoUseCase | null {
  const norm = normalize(ucName);
  const tokens = new Set(tokenize(ucName));

  // Exact normalized match
  const exact = index.find((e) => e.normalized === norm);
  if (exact) return exact.ref;

  // Substring containment (either direction)
  const substring = index.find((e) => norm.includes(e.normalized) || e.normalized.includes(norm));
  if (substring) return substring.ref;

  // Token overlap scoring
  let bestScore = 0;
  let bestRef: MasterRepoUseCase | null = null;

  for (const entry of index) {
    if (tokens.size === 0 || entry.tokens.size === 0) continue;
    let overlap = 0;
    for (const t of tokens) {
      if (entry.tokens.has(t)) overlap++;
    }
    const score = overlap / Math.max(tokens.size, entry.tokens.size);
    if (score > bestScore) {
      bestScore = score;
      bestRef = entry.ref;
    }
  }

  // Require at least 40% token overlap
  return bestScore >= 0.4 ? bestRef : null;
}
