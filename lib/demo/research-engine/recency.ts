/**
 * Source-recency bias.
 *
 * Centralises the weighting curve applied to sources across the
 * Research Engine so it can be tuned from a single place. Two layers:
 *
 *   1. Soft decay -- sources older than RECENT_YEARS get progressively
 *      penalised without being excluded.
 *   2. Hard floor -- sources older than HARD_FLOOR_YEARS are driven to a
 *      very small residual weight so they lose nearly every tie-break but
 *      are still retrievable when nothing else is available.
 *
 * Unknown-date sources are given a moderate default (see
 * UNKNOWN_DATE_WEIGHT) so we do not punish content we could not date
 * but do not let it dominate dated newer material.
 */

// ---------------------------------------------------------------------------
// Tunable constants (single source of truth)
// ---------------------------------------------------------------------------

/** Anything younger than this is full-weight (1.0). */
export const RECENT_YEARS = 2;

/** Between RECENT_YEARS and HARD_FLOOR_YEARS we apply soft decay. */
export const HARD_FLOOR_YEARS = 5;

/** Weight applied when we couldn't determine a date (neutral-lean). */
export const UNKNOWN_DATE_WEIGHT = 0.8;

/** Threshold (in years) above which UI should show a "stale" badge. */
export const STALE_YEARS = 3;

const ONE_YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecencyInput {
  /** ISO 8601 date string (e.g. 2024-06-15 or 2024-06-15T10:00:00Z). */
  publishedAt?: string | null;
  /** Year fallback (used when publishedAt is missing but a year was parsed). */
  publishedYear?: number | null;
  /** Confidence in the date attribution. Affects decay curve only at "low". */
  dateConfidence?: "high" | "medium" | "low" | "unknown";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a weight in [0, 1] reflecting how recent a source is.
 * Higher is better. Pure, no side effects, safe to call in hot paths.
 */
export function recencyWeight(input: RecencyInput, now: Date = new Date()): number {
  const ts = parseDate(input.publishedAt) ?? yearToTimestamp(input.publishedYear);
  if (ts == null) return UNKNOWN_DATE_WEIGHT;

  const ageYears = Math.max(0, (now.getTime() - ts) / ONE_YEAR_MS);

  // Full-weight window.
  if (ageYears <= RECENT_YEARS) return 1.0;

  // Hard floor: drive very old content to a small residual so it loses
  // ties but is still retrievable when nothing better exists.
  if (ageYears >= HARD_FLOOR_YEARS) return 0.25;

  // Soft decay between RECENT_YEARS and HARD_FLOOR_YEARS.
  //   ageYears=2 -> 1.0
  //   ageYears=3 -> ~0.85
  //   ageYears=4 -> ~0.70
  //   ageYears=5 -> 0.55 (then floor kicks in above)
  const span = HARD_FLOOR_YEARS - RECENT_YEARS; // 3
  const t = (ageYears - RECENT_YEARS) / span; // 0..1
  // Piecewise-linear 1.0 -> 0.55 across the decay band.
  const weight = 1.0 - t * 0.45;

  // Treat "low" confidence as half-penalty (move the curve toward the
  // unknown default so we're not aggressively punishing heuristics).
  if (input.dateConfidence === "low") {
    return Math.max(weight, UNKNOWN_DATE_WEIGHT);
  }

  return weight;
}

/** Is this source considered "stale" for UI badging purposes? */
export function isStale(input: RecencyInput, now: Date = new Date()): boolean {
  const ts = parseDate(input.publishedAt) ?? yearToTimestamp(input.publishedYear);
  if (ts == null) return false;
  const ageYears = (now.getTime() - ts) / ONE_YEAR_MS;
  return ageYears >= STALE_YEARS;
}

/** Year component for quick display (e.g. "Published 2016"). */
export function publishedYearOf(input: RecencyInput): number | undefined {
  if (typeof input.publishedYear === "number" && Number.isFinite(input.publishedYear)) {
    return input.publishedYear;
  }
  const ts = parseDate(input.publishedAt);
  if (ts == null) return undefined;
  return new Date(ts).getUTCFullYear();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDate(input: string | null | undefined): number | null {
  if (!input || typeof input !== "string") return null;
  const ts = Date.parse(input);
  return Number.isFinite(ts) ? ts : null;
}

function yearToTimestamp(year: number | null | undefined): number | null {
  if (typeof year !== "number" || !Number.isFinite(year)) return null;
  // Use Jan 1 of the year (conservative -- the source is at least that old).
  return Date.UTC(Math.trunc(year), 0, 1);
}
