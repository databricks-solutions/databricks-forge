/**
 * Data Gap Analysis -- use-case to data-asset attribution.
 *
 * The Data Gap engine consumes `Array<{ fqn, dataAssetId }>` per-table
 * classifications. Pipeline runs do not persist a per-table `dataAssetId`
 * column (those classifications are computed in-memory by the schema-context
 * layer during a run), so the route layer derives them from generated use
 * cases by matching each `ForgeUseCase.name` to a master-repository
 * reference use case and propagating that reference's MC asset linkage to
 * every `tablesInvolved` FQN of the generated use case.
 *
 * The original implementation required exact case-insensitive name equality
 * between the generated and reference titles, but the use-case generation
 * prompt explicitly tells the LLM **not** to copy reference titles verbatim.
 * That meant attribution silently collapsed to zero on most real runs and
 * the Data Asset Coverage card reported every reference asset as missing
 * even when the run had relevant tables.
 *
 * This helper applies three fallbacks in order:
 *
 *   1. Case-insensitive exact name match (fast path).
 *   2. Token-Jaccard similarity above {@link JACCARD_THRESHOLD} on the
 *      tokenised, stop-word-filtered names.
 *   3. Whole-string substring containment when both names are long enough
 *      that the containment is unlikely to be coincidental.
 *
 * When a match succeeds, **every** Mission-Critical asset id linked to the
 * matched reference is attributed to **every** `tablesInvolved` FQN of the
 * generated use case. Pairs are de-duplicated so a given table is never
 * counted twice for the same asset.
 *
 * Pure: no DB, no LLM, no network. All state lives in the function call.
 */

import type {
  MasterRepoEnrichment,
  MasterRepoUseCase,
} from "@/lib/domain/industry-outcomes/master-repo-types";

/**
 * Subset of `UseCase` consumed by attribution. Kept narrow so callers can
 * pass either persisted Lakebase rows or pure in-memory objects without
 * dragging the full domain type along.
 *
 * `referenceUseCaseName`, when present, is a hard FK into the master-repo
 * namespace (verbatim copy of a `MasterRepoUseCase.name`). The attribution
 * routine prefers it over the fuzzy ladder in {@link findReferenceMatch}
 * so production runs are deterministic and immune to LLM phrasing drift.
 */
export interface UseCaseLike {
  name: string;
  tablesInvolved?: string[] | null;
  referenceUseCaseName?: string | null;
}

const JACCARD_THRESHOLD = 0.5;

const STOP_WORDS = new Set([
  "and",
  "or",
  "the",
  "a",
  "an",
  "of",
  "for",
  "to",
  "in",
  "on",
  "with",
  "by",
  "via",
  "into",
  "from",
  "at",
  "is",
  "are",
  "be",
  "as",
]);

/** Lowercased alphanumeric tokens of length ≥ 3, with stop words removed. */
function tokenize(name: string): Set<string> {
  return new Set(
    (name || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Match a generated use case name against a list of master-repo reference
 * use cases. Returns the best reference, or `null` if no tier matches.
 *
 * Exposed for direct unit testing; production code should prefer
 * {@link attributeTablesToAssets}, which additionally consults the
 * persisted `referenceUseCaseName` column before falling through to this
 * fuzzy ladder.
 *
 * The fuzzy ladder is retained as a backstop for:
 *   - Legacy runs generated before the `reference_use_case_name` field was
 *     introduced (until the Data Gap backfill populates the column).
 *   - Rows where the LLM emitted `null` for `reference_use_case_name` but
 *     the customer-facing `name` still resembles a master-repo title.
 */
export function findReferenceMatch(
  generatedName: string,
  refUseCases: readonly MasterRepoUseCase[],
): MasterRepoUseCase | null {
  if (!generatedName) return null;
  const lower = generatedName.toLowerCase();

  // Tier 1: exact case-insensitive match.
  for (const r of refUseCases) {
    if (r.name.toLowerCase() === lower) return r;
  }

  // Tier 2: token-Jaccard similarity. Threshold tuned so that titles that
  // share a clear majority of meaningful tokens (e.g. "Customer Lifetime
  // Value Modeling" vs "Customer Lifetime Value Prediction") match while
  // unrelated titles that share a single common word do not.
  const genTokens = tokenize(generatedName);
  let bestRef: MasterRepoUseCase | null = null;
  let bestScore = 0;
  if (genTokens.size > 0) {
    for (const r of refUseCases) {
      const score = jaccard(genTokens, tokenize(r.name));
      if (score > bestScore) {
        bestScore = score;
        bestRef = r;
      }
    }
  }
  if (bestRef && bestScore >= JACCARD_THRESHOLD) return bestRef;

  // Tier 3: substring containment. Guard with a length floor so two- or
  // three-character overlaps don't trigger false positives.
  for (const r of refUseCases) {
    const refLower = r.name.toLowerCase();
    if (refLower.length < 8 || lower.length < 8) continue;
    if (lower.includes(refLower) || refLower.includes(lower)) return r;
  }

  return null;
}

/**
 * Build the `classifiedTables` input for `runDataGapAnalysis()` from a list
 * of generated use cases plus the master-repo enrichment for the run's
 * industry.
 *
 * Resolution order for each use case:
 *   1. **Persisted reference link** — when `uc.referenceUseCaseName` is set
 *      and resolves to a master-repo UC by exact case-insensitive name, use
 *      that. This is the deterministic happy path for runs generated after
 *      the field shipped.
 *   2. **Fuzzy ladder** — fall through to {@link findReferenceMatch} against
 *      `uc.name` for legacy rows where the link is null or refers to an
 *      unknown title.
 *
 * When a match succeeds, every Mission-Critical asset id linked to the
 * matched reference is attributed to every `tablesInvolved` FQN of the
 * generated use case. Pairs are de-duplicated.
 */
export function attributeTablesToAssets(input: {
  useCases: readonly UseCaseLike[];
  enrichment: MasterRepoEnrichment;
}): Array<{ fqn: string; dataAssetId: string }> {
  const { useCases, enrichment } = input;
  const seen = new Set<string>();
  const out: Array<{ fqn: string; dataAssetId: string }> = [];

  // Pre-build a case-insensitive lookup of master-repo UCs so the persisted
  // link can be resolved in O(1) without iterating the full list per UC.
  const refByLowerName = new Map<string, MasterRepoUseCase>();
  for (const r of enrichment.useCases) {
    refByLowerName.set(r.name.toLowerCase(), r);
  }

  for (const uc of useCases) {
    const persistedKey = uc.referenceUseCaseName?.trim().toLowerCase();
    const refUc =
      (persistedKey ? refByLowerName.get(persistedKey) : undefined) ??
      findReferenceMatch(uc.name, enrichment.useCases);
    if (!refUc) continue;
    const mcAssetIds = (refUc.dataAssetIds ?? []).filter(
      (id) => refUc.dataAssetCriticality?.[id] === "MC",
    );
    if (mcAssetIds.length === 0) continue;
    for (const fqn of uc.tablesInvolved ?? []) {
      for (const assetId of mcAssetIds) {
        const key = `${fqn}::${assetId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ fqn, dataAssetId: assetId });
      }
    }
  }

  return out;
}
