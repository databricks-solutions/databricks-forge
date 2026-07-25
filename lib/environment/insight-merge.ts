/**
 * Deterministic, type-aware merge of estate insights across multiple scans.
 *
 * A single Estate rolls up many scans (overlapping scopes, re-scans, sequenced
 * programs). Naively de-duplicating insights by `(insight_type, table_fqn)` or
 * by a raw payload hash is wrong in two opposite ways:
 *
 *   1. It collapses genuinely-distinct multi-valued findings — a table can have
 *      many PII columns, many implicit/entity relationships — into one row.
 *   2. It preserves *stale* ontology rows: when a re-scan changes a canonical
 *      entity's or glossary term's payload, a payload-hash key treats the new
 *      row as unrelated and keeps BOTH the old and the new.
 *
 * The fix is an explicit, per-type semantic key:
 *
 *   - Semantic-identity types (`canonical_entity`, `business_glossary_term`)
 *     are keyed by their normalized name + estate scope, so a changed payload
 *     REPLACES the stale one (latest scan wins) instead of piling up. Scoping
 *     by estate prevents two different estates that both model "Customer" from
 *     collapsing into one in a global roll-up.
 *   - Table-singleton types (`governance_gap`, `analytics_maturity`) are keyed
 *     by `(type, fqn)` — one assessment per table, latest scan wins.
 *   - Everything else is multi-valued: keyed by `(type, fqn, payloadHash)` so
 *     every distinct finding survives.
 *
 * This module is pure (no DB / network) so the key function and merge are
 * unit-testable, and the same logic can be reused wherever insights are rolled
 * up (aggregate estate view, Excel export, synthesis input).
 */

/** Insight types whose identity is a normalized name, not a payload hash. */
export const SEMANTIC_NAME_INSIGHT_TYPES = new Set<string>([
  "canonical_entity",
  "business_glossary_term",
]);

/** Insight types with exactly one row per table (or per scan when fqn-less). */
export const TABLE_SINGLETON_INSIGHT_TYPES = new Set<string>([
  "governance_gap",
  "analytics_maturity",
]);

export interface MergeableInsight {
  id: string;
  insightType: string;
  tableFqn: string | null;
  payloadJson: string;
  /** `programId` for program scans, else `scan:${scanId}` for standalone. */
  estateId: string;
  /** Epoch ms of the owning scan's createdAt (latest wins). */
  scanCreatedAt: number;
}

/** Lowercase, trim, collapse internal whitespace — the stable semantic key. */
export function normalizeSemanticName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Small, stable, dependency-free string hash (FNV-1a, base36). */
function stableHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Pull the semantic name from an ontology payload (entity / glossary term). */
function extractSemanticName(payloadJson: string): string | null {
  try {
    const p = JSON.parse(payloadJson) as Record<string, unknown>;
    const candidate = p.name ?? p.term ?? p.concept ?? p.entity ?? p.label;
    return typeof candidate === "string" && candidate.trim() ? candidate : null;
  } catch {
    return null;
  }
}

const SEP = "\u0000";

/**
 * The stable de-dup key for an insight. See the module doc for the three
 * strategies. Semantic types without an extractable name fall back to a
 * payload-hash key so unnamed rows are never silently collapsed.
 */
export function insightDedupKey(ins: {
  insightType: string;
  tableFqn: string | null;
  payloadJson: string;
  estateId: string;
}): string {
  const type = ins.insightType;

  if (SEMANTIC_NAME_INSIGHT_TYPES.has(type)) {
    const name = extractSemanticName(ins.payloadJson);
    const norm = name ? normalizeSemanticName(name) : "";
    if (norm) {
      return `${type}${SEP}${ins.estateId}${SEP}n${SEP}${norm}`;
    }
    // Unnamed ontology row — preserve it rather than collapsing to one.
    return `${type}${SEP}${ins.estateId}${SEP}h${SEP}${stableHash(ins.payloadJson)}`;
  }

  if (TABLE_SINGLETON_INSIGHT_TYPES.has(type)) {
    return `${type}${SEP}s${SEP}${ins.tableFqn ?? ""}`;
  }

  // Multi-valued: every distinct finding survives.
  return `${type}${SEP}m${SEP}${ins.tableFqn ?? ""}${SEP}${stableHash(ins.payloadJson)}`;
}

/**
 * Merge insight rows to one winner per semantic key. Latest owning scan wins
 * (`scanCreatedAt`); ties break deterministically on the higher `id` so the
 * result is stable regardless of input order.
 */
export function mergeInsights<T extends MergeableInsight>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const key = insightDedupKey(r);
    const prev = best.get(key);
    if (
      !prev ||
      r.scanCreatedAt > prev.scanCreatedAt ||
      (r.scanCreatedAt === prev.scanCreatedAt && r.id > prev.id)
    ) {
      best.set(key, r);
    }
  }
  return [...best.values()];
}
