/**
 * Casing profile -- detect the dominant character casing style of string
 * column samples so prompts and instructions can suggest case-insensitive
 * matching where appropriate.
 *
 * Pure function, zero IO. Pass the column samples in; receive a per-column
 * profile out. Used by:
 *   - `lib/genie/passes/instruction-generation.ts` (DATA QUALITY NOTES)
 *   - `lib/genie/health-checks/evaluators.ts` (`casing_inconsistency`)
 *   - profile-grounding prompt prefix (Phase 2.5)
 */

export type DominantCasing = "title" | "upper" | "lower" | "mixed" | "unknown";

export interface CasingProfile {
  /** Total sample values inspected. */
  total: number;
  /** Title-case count (e.g. "Acme Corp"). */
  titleCount: number;
  /** ALL UPPERCASE count. */
  upperCount: number;
  /** all lowercase count. */
  lowerCount: number;
  /** Anything else (mixed casing, leading lowercase + trailing uppercase, etc.). */
  otherCount: number;
  /** The dominant casing style if it covers >= dominantThreshold of samples. */
  dominant: DominantCasing;
  /** Coverage of the dominant style, 0..1. `0` when total === 0. */
  dominantCoverage: number;
}

export interface ColumnCasingProfile extends CasingProfile {
  tableFqn: string;
  columnName: string;
}

const DEFAULT_DOMINANT_THRESHOLD = 0.7;

/**
 * Inspect a list of string sample values and return the dominant casing style
 * if any one bucket exceeds `threshold` of the total. Otherwise returns
 * `dominant: "mixed"`.
 *
 * Empty / non-string entries are skipped (and not counted toward total).
 */
export function profileCasing(
  samples: ReadonlyArray<unknown>,
  threshold: number = DEFAULT_DOMINANT_THRESHOLD,
): CasingProfile {
  let titleCount = 0;
  let upperCount = 0;
  let lowerCount = 0;
  let otherCount = 0;
  let total = 0;

  for (const raw of samples) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    total++;
    switch (classifyCasing(trimmed)) {
      case "title":
        titleCount++;
        break;
      case "upper":
        upperCount++;
        break;
      case "lower":
        lowerCount++;
        break;
      default:
        otherCount++;
    }
  }

  if (total === 0) {
    return {
      total: 0,
      titleCount: 0,
      upperCount: 0,
      lowerCount: 0,
      otherCount: 0,
      dominant: "unknown",
      dominantCoverage: 0,
    };
  }

  const counts: Array<{ key: Exclude<DominantCasing, "mixed" | "unknown">; n: number }> = [
    { key: "title", n: titleCount },
    { key: "upper", n: upperCount },
    { key: "lower", n: lowerCount },
  ];
  counts.sort((a, b) => b.n - a.n);
  const top = counts[0];
  const coverage = top.n / total;

  return {
    total,
    titleCount,
    upperCount,
    lowerCount,
    otherCount,
    dominant: coverage >= threshold ? top.key : "mixed",
    dominantCoverage: coverage,
  };
}

type CharBucket = "title" | "upper" | "lower" | "other";

function classifyCasing(s: string): CharBucket {
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (!letters) return "other";

  // Identify pure cases first.
  const allUpper = letters === letters.toUpperCase();
  const allLower = letters === letters.toLowerCase();
  if (allUpper) return "upper";
  if (allLower) return "lower";

  // Title case: each word starts with uppercase, rest lowercase.
  const words = s.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (words.length === 0) return "other";
  const isTitle = words.every((w) => {
    const wl = w.replace(/[^A-Za-z]/g, "");
    if (!wl) return true;
    if (wl[0] !== wl[0].toUpperCase()) return false;
    if (wl.length > 1 && wl.slice(1) !== wl.slice(1).toLowerCase()) return false;
    return true;
  });
  if (isTitle) return "title";

  return "other";
}

/**
 * Convenience: build per-column casing profiles from a list of entity
 * candidates (which carry `sampleValues`). Skips columns with no usable
 * samples and columns whose dominant style coverage is below `threshold`.
 */
export function casingProfilesFromCandidates(
  candidates: ReadonlyArray<{
    tableFqn: string;
    columnName: string;
    sampleValues: ReadonlyArray<string>;
  }>,
  threshold: number = DEFAULT_DOMINANT_THRESHOLD,
): ColumnCasingProfile[] {
  const out: ColumnCasingProfile[] = [];
  for (const c of candidates) {
    if (!Array.isArray(c.sampleValues) || c.sampleValues.length === 0) continue;
    const profile = profileCasing(c.sampleValues, threshold);
    if (profile.dominant === "unknown" || profile.dominant === "mixed") continue;
    out.push({ ...profile, tableFqn: c.tableFqn, columnName: c.columnName });
  }
  return out;
}

/**
 * Build a one-line human-readable note about a column's casing profile,
 * suitable for inclusion in `DATA QUALITY NOTES` instructions.
 *
 * Returns `null` when the profile is `unknown` or `mixed`.
 */
export function casingNoteFor(profile: ColumnCasingProfile): string | null {
  if (profile.dominant === "unknown" || profile.dominant === "mixed") return null;
  const styleLabel: Record<DominantCasing, string> = {
    title: "TitleCase",
    upper: "UPPERCASE",
    lower: "lowercase",
    mixed: "mixed",
    unknown: "unknown",
  };
  const pct = Math.round(profile.dominantCoverage * 100);
  const fqnSuffix = profile.columnName ? `\`${profile.columnName}\`` : "";
  return `Column ${fqnSuffix} on \`${profile.tableFqn}\` is ${pct}% ${styleLabel[profile.dominant]}; query with \`LOWER()\` or \`ILIKE\` for safe matching.`;
}
