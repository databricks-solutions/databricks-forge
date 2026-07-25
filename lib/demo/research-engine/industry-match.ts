/**
 * Pure helpers for matching free-form industry strings (LLM output, user
 * input) onto the registered industry outcome catalog. Lives in its own
 * module so it can be unit-tested without importing the rest of the
 * research engine (which pulls Databricks clients, Lakebase, etc.).
 */

/**
 * Normalize a free-form industry string to a known industry outcome ID.
 *
 * Tries (in order): exact id match -> kebab-case id match -> starts-with
 * match -> name substring match -> no match (returns null). The caller is
 * expected to fall through to `closestIndustryMatch` for the no-match case.
 */
export function normalizeIndustryId(
  raw: string,
  allOutcomes: Array<{ id: string; name: string }>,
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  if (allOutcomes.some((o) => o.id === trimmed)) return trimmed;

  const kebab = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  const exactKebab = allOutcomes.find((o) => o.id === kebab);
  if (exactKebab) return exactKebab.id;

  const startsWith = allOutcomes.find(
    (o) => o.id.startsWith(kebab) || kebab.startsWith(o.id),
  );
  if (startsWith) return startsWith.id;

  const lowerName = trimmed.toLowerCase();
  const nameMatch = allOutcomes.find(
    (o) =>
      o.name.toLowerCase() === lowerName ||
      o.name.toLowerCase().includes(lowerName) ||
      lowerName.includes(o.name.toLowerCase()),
  );
  if (nameMatch) return nameMatch.id;

  return null;
}

/**
 * Levenshtein edit distance between two strings. Iterative two-row DP so
 * memory is O(min(a, b)). Used by `closestIndustryMatch` for closed-list
 * fallback when the LLM emits an unrecognised industry id/name.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Closed-list closest-match fallback. Used only when the classifier returns
 * an id that `normalizeIndustryId` cannot resolve (a regression of the
 * closed-list prompt). Compares both the LLM's raw id and raw name against
 * every registered industry's id and name; picks the candidate with the
 * lowest minimum normalised edit distance. Returns null only when both
 * inputs are empty (degenerate LLM response) or the registry is empty -- the
 * caller then falls through to picking the first registered entry as a
 * last-ditch deterministic default.
 *
 * The score is normalised by candidate length so longer names don't get a
 * free penalty (e.g. "real money gaming" vs "games" against an LLM output
 * of "rmg" -- raw distance favours the shorter string, normalised distance
 * doesn't).
 */
export function closestIndustryMatch(
  rawId: string | undefined | null,
  rawName: string | undefined | null,
  allOutcomes: Array<{ id: string; name: string }>,
): { id: string; name: string } | null {
  if (!allOutcomes.length) return null;
  const idLower = rawId?.trim().toLowerCase() ?? "";
  const nameLower = rawName?.trim().toLowerCase() ?? "";
  if (!idLower && !nameLower) return null;

  let best: { id: string; name: string; score: number } | null = null;
  for (const o of allOutcomes) {
    const candId = o.id.toLowerCase();
    const candName = o.name.toLowerCase();
    const candidates = [
      idLower ? levenshtein(idLower, candId) / Math.max(candId.length, 1) : Infinity,
      idLower ? levenshtein(idLower, candName) / Math.max(candName.length, 1) : Infinity,
      nameLower ? levenshtein(nameLower, candId) / Math.max(candId.length, 1) : Infinity,
      nameLower ? levenshtein(nameLower, candName) / Math.max(candName.length, 1) : Infinity,
    ];
    const score = Math.min(...candidates);
    if (best === null || score < best.score) {
      best = { id: o.id, name: o.name, score };
    }
  }
  return best ? { id: best.id, name: best.name } : null;
}
