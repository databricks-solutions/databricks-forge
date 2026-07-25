/**
 * Manual domain overrides — non-destructive, replayable corrections to the
 * LLM's domain/subdomain grouping.
 *
 * The estate scan assigns `dataDomain` / `dataSubdomain` via LLM. Analysts can
 * disagree: a table grouped under the wrong domain, or a whole `_staging`
 * schema that shouldn't appear in the estate map at all. Rather than mutating
 * the scan output (which a re-scan would clobber, and which loses the original
 * signal), we record overrides as a separate layer and *apply* them on read.
 *
 * Two actions:
 *  - `remap`  → reassign domain (and optionally subdomain).
 *  - `evict`  → hide the target from the domain map entirely.
 *
 * Three scopes, most-specific wins: `table` > `schema` > `catalog`.
 *
 * This module is pure (no DB / network) so precedence is unit-testable and the
 * exact same logic runs client-side (instant feedback) and server-side
 * (exports, synthesis).
 */

import type { TableDetailRow } from "@/app/environment/types";
import { catalogOf, schemaOf } from "@/lib/environment/domain-explorer";

export type OverrideScope = "table" | "schema" | "catalog";
export type OverrideAction = "remap" | "evict";

export interface DomainOverride {
  id?: string;
  scope: OverrideScope;
  /** FQN (table), `catalog.schema` (schema), or `catalog` (catalog). */
  target: string;
  action: OverrideAction;
  /** For `remap`: the domain to move the target into. */
  newDomain?: string | null;
  /** For `remap`: optional subdomain. */
  newSubdomain?: string | null;
  createdByEmail?: string | null;
  createdAt?: string;
}

const SCOPE_RANK: Record<OverrideScope, number> = { table: 3, schema: 2, catalog: 1 };

/** Does this override target the given table FQN? */
export function matchesOverride(fqn: string, o: DomainOverride): boolean {
  if (o.scope === "table") return fqn === o.target;
  if (o.scope === "schema") return schemaOf(fqn) === o.target;
  if (o.scope === "catalog") return catalogOf(fqn) === o.target;
  return false;
}

/**
 * Resolve the single winning override for a table — the most specific one. Ties
 * within a scope are broken by recency (later `createdAt` wins).
 */
export function resolveOverride(fqn: string, overrides: DomainOverride[]): DomainOverride | null {
  let best: DomainOverride | null = null;
  let bestRank = -1;
  for (const o of overrides) {
    if (!matchesOverride(fqn, o)) continue;
    const rank = SCOPE_RANK[o.scope];
    if (rank > bestRank || (rank === bestRank && (o.createdAt ?? "") > (best?.createdAt ?? ""))) {
      best = o;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * A domain override annotated with its owning scan and a scan-recency rank
 * (higher = later scan). Used for program-level (multi-scan) roll-ups where the
 * same FQN can be overridden in more than one member scan.
 */
export interface ScopedDomainOverride extends DomainOverride {
  scanId: string;
  /** Higher wins. Typically the owning scan's createdAt epoch or an index. */
  scanRank: number;
}

/**
 * Resolve the winning override for a table across MANY scans. Precedence:
 *   1. latest scan wins (`scanRank` desc),
 *   2. then most-specific scope (table > schema > catalog),
 *   3. then recency within the scope (`createdAt` desc).
 *
 * This is the program/estate analog of `resolveOverride` (which is single-scan
 * and uses scope-first precedence).
 */
export function resolveProgramOverride(
  fqn: string,
  overrides: ScopedDomainOverride[],
): ScopedDomainOverride | null {
  let best: ScopedDomainOverride | null = null;
  for (const o of overrides) {
    if (!matchesOverride(fqn, o)) continue;
    if (best === null) {
      best = o;
      continue;
    }
    if (o.scanRank !== best.scanRank) {
      if (o.scanRank > best.scanRank) best = o;
      continue;
    }
    const rank = SCOPE_RANK[o.scope];
    const bestRank = SCOPE_RANK[best.scope];
    if (rank !== bestRank) {
      if (rank > bestRank) best = o;
      continue;
    }
    if ((o.createdAt ?? "") > (best.createdAt ?? "")) best = o;
  }
  return best;
}

/**
 * Build an (override-aware) domain map from merged program details. Evicted
 * tables are dropped from the map; remapped tables carry their new domain.
 * Program-level precedence (latest scan wins) is applied per FQN.
 */
export function buildProgramDomainMap(
  details: Array<{ tableFqn: string; dataDomain: string | null }>,
  overrides: ScopedDomainOverride[],
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const d of details) {
    const o = resolveProgramOverride(d.tableFqn, overrides);
    if (o?.action === "evict") continue;
    map.set(d.tableFqn, o?.action === "remap" ? (o.newDomain ?? d.dataDomain) : d.dataDomain);
  }
  return map;
}

/**
 * Apply overrides to a detail list: evicted tables are dropped; remapped tables
 * get their `dataDomain` (and `dataSubdomain` when provided) rewritten. Returns
 * a new array; inputs are not mutated.
 */
export function applyDomainOverrides(
  details: TableDetailRow[],
  overrides: DomainOverride[],
): TableDetailRow[] {
  if (!overrides || overrides.length === 0) return details;
  const out: TableDetailRow[] = [];
  for (const d of details) {
    const o = resolveOverride(d.tableFqn, overrides);
    if (!o) {
      out.push(d);
      continue;
    }
    if (o.action === "evict") continue;
    // remap
    out.push({
      ...d,
      dataDomain: o.newDomain ?? d.dataDomain,
      dataSubdomain: o.newSubdomain !== undefined ? o.newSubdomain : d.dataSubdomain,
    });
  }
  return out;
}
