/**
 * Sales-Ready Onboarding Plan — Phase 3.7 (honesty refresh).
 *
 * Reshape a `DataGapResult` (which is per-asset) into a per-SOURCE-SYSTEM
 * onboarding plan: one row per upstream system, ranked by how much
 * annual business value the customer unlocks by onboarding that system
 * to Databricks first.
 *
 * Pure function. No I/O, no LLM. Unit-tested in
 * `__tests__/engines/data-gap-onboarding-plan.test.ts`.
 *
 * Each row tells a Sales / SA conversation directly:
 *
 *   "Onboard CRM systems next → unlocks $4.2M annual value across 7 use
 *    cases. Recommended path: Lakeflow Connect (typical for CRMs;
 *    confirm which CRM the customer uses — Salesforce / HubSpot /
 *    Dynamics 365)."
 *
 * Aggregation strategy:
 *
 *   1. For every entry in `result.valueAtRisk` (per-missing-asset
 *      attributed value-at-risk), look up the resolved source systems on
 *      the matching `result.coverage` row.
 *   2. If the asset has N resolved systems, the asset's contribution is
 *      split EVENLY across the N rows — the same arithmetic the engine
 *      uses for cross-asset attribution prevents over-counting when a
 *      single use case spans multiple onboarded systems.
 *   3. Group by `system.name`. Because `name` is the CATEGORY for
 *      master-repo rows (e.g. "CRM systems"), three CRM ref-arch hits
 *      naturally roll up into a single "CRM systems" row instead of
 *      surfacing as three fake-vendor rows (Salesforce / HubSpot /
 *      Dynamics).
 *   4. Carry the resolved source's `exampleVendors` and `systemKind`
 *      through to the row so the UI can render "e.g. Salesforce,
 *      HubSpot, Microsoft Dynamics 365" beneath the category name.
 *   5. Collapse all `origin: "unknown"` contributions into a single
 *      **"Unconfirmed sources"** row that sorts to the bottom; preserves
 *      the total without distorting the ranking. The unknown row also
 *      aggregates `likelyCategories` across contributors so the UI can
 *      hint which kinds of systems sales should ask the customer about.
 */

import type { IngestionStrategy } from "./types";
import type { SourceSystemOrigin } from "./source-systems";
import type { DataGapResult } from "./types";
import type { SystemKind } from "@/lib/domain/tech-to-system";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OnboardingPlanRow {
  /**
   * Display name. For `master-repo` rows this is the category
   * ("CRM systems", "Cloud data warehouse"); for `lineage` rows this is
   * the concrete vendor ("Salesforce", "SAP"); for unknown contributions
   * this is the literal string `"Unconfirmed sources"`.
   */
  systemName: string;
  /** Highest-confidence origin observed across the contributing rows. */
  origin: SourceSystemOrigin;
  /** Preferred ingestion strategy (null when origin is "unknown"). */
  preferredStrategy: IngestionStrategy | null;
  /** Number of distinct missing assets this row groups. */
  assetCount: number;
  /** Number of distinct blocked / reduced use cases unlocked by onboarding. */
  useCaseCount: number;
  /** Annual unlock value ($USD): low / mid / high — already attribution-weighted. */
  valueLow: number;
  valueMid: number;
  valueHigh: number;
  /**
   * Top assets unlocked by onboarding this system. Sorted by `mid` desc,
   * truncated to 8 entries for UI rendering. Each `mid` is the same
   * attribution-weighted value used by `valueMid` above.
   */
  assets: Array<{ assetId: string; assetName: string; valueMid: number }>;
  /**
   * Use cases unlocked when this system is onboarded (deduplicated by
   * name). Capped at 12 for UI rendering.
   */
  useCases: string[];
  /**
   * For `master-repo` rows: common vendors in the category, surfaced by
   * the UI as a muted subtitle so sales can ask the customer "which one
   * do you use?" instead of guessing. Undefined for lineage rows (we
   * have the actual vendor) and unknown rows (no signal).
   */
  exampleVendors?: string[];
  /**
   * For the "Unconfirmed sources" row only: the SystemKind(s) the
   * unattributed assets would typically come from in the industry
   * reference architecture. Lets the UI prompt sales with "Likely
   * categories: CRM, ERP, ITSM" so they ask targeted discovery
   * questions. Undefined for any row with a resolved source.
   */
  likelyCategories?: SystemKind[];
}

// ---------------------------------------------------------------------------
// Internal accumulator
// ---------------------------------------------------------------------------

interface PlanAccumulator {
  systemName: string;
  origin: SourceSystemOrigin;
  preferredStrategy: IngestionStrategy | null;
  assets: Map<string, { name: string; valueMid: number }>;
  useCases: Set<string>;
  totalLow: number;
  totalMid: number;
  totalHigh: number;
  /** First non-empty `exampleVendors` we see for this bucket. */
  exampleVendors: string[] | null;
  /** Accumulated `likelyCategories` across contributing unknown rows. */
  likelyCategories: Set<SystemKind>;
}

/** Pick the highest-confidence origin from two observed values. */
function pickOrigin(a: SourceSystemOrigin, b: SourceSystemOrigin): SourceSystemOrigin {
  if (a === "lineage" || b === "lineage") return "lineage";
  if (a === "master-repo" || b === "master-repo") return "master-repo";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export function buildOnboardingPlan(result: DataGapResult): OnboardingPlanRow[] {
  if (result.valueAtRisk.length === 0) return [];

  // Map every assetId -> resolvedSourceSystems via the coverage matrix.
  const sourcesByAsset = new Map(
    result.coverage.map((c) => [c.assetId, c.resolvedSourceSystems ?? []] as const),
  );

  const accByName = new Map<string, PlanAccumulator>();

  for (const v of result.valueAtRisk) {
    const sources = sourcesByAsset.get(v.assetId) ?? [];
    if (sources.length === 0) continue;
    // Split the asset's contribution evenly across N systems so we don't
    // over-count. Single-source assets carry their full value; two-source
    // assets attribute 50/50 to each, etc.
    const N = sources.length;
    const lowShare = v.totalLow / N;
    const midShare = v.totalMid / N;
    const highShare = v.totalHigh / N;

    for (const s of sources) {
      const key = s.origin === "unknown" ? "__UNCONFIRMED__" : s.name;
      const displayName = s.origin === "unknown" ? "Unconfirmed sources" : s.name;
      const acc = accByName.get(key);
      if (acc) {
        acc.origin = pickOrigin(acc.origin, s.origin);
        if (!acc.preferredStrategy && s.preferredStrategy) {
          acc.preferredStrategy = s.preferredStrategy;
        }
        if (!acc.exampleVendors && s.exampleVendors && s.exampleVendors.length > 0) {
          acc.exampleVendors = [...s.exampleVendors];
        }
        if (s.likelyCategories) {
          for (const k of s.likelyCategories) acc.likelyCategories.add(k);
        }
        const existing = acc.assets.get(v.assetId);
        if (existing) existing.valueMid += midShare;
        else acc.assets.set(v.assetId, { name: v.assetName, valueMid: midShare });
        for (const uc of v.blockedUseCases) acc.useCases.add(uc);
        for (const uc of v.reducedUseCases) acc.useCases.add(uc);
        acc.totalLow += lowShare;
        acc.totalMid += midShare;
        acc.totalHigh += highShare;
      } else {
        accByName.set(key, {
          systemName: displayName,
          origin: s.origin,
          preferredStrategy: s.preferredStrategy,
          assets: new Map([[v.assetId, { name: v.assetName, valueMid: midShare }]]),
          useCases: new Set([...v.blockedUseCases, ...v.reducedUseCases]),
          totalLow: lowShare,
          totalMid: midShare,
          totalHigh: highShare,
          exampleVendors:
            s.exampleVendors && s.exampleVendors.length > 0 ? [...s.exampleVendors] : null,
          likelyCategories: new Set<SystemKind>(s.likelyCategories ?? []),
        });
      }
    }
  }

  const rows: OnboardingPlanRow[] = [...accByName.values()].map((acc) => {
    const topAssets = [...acc.assets.entries()]
      .map(([assetId, a]) => ({ assetId, assetName: a.name, valueMid: a.valueMid }))
      .sort((a, b) => b.valueMid - a.valueMid)
      .slice(0, 8);
    const row: OnboardingPlanRow = {
      systemName: acc.systemName,
      origin: acc.origin,
      preferredStrategy: acc.preferredStrategy,
      assetCount: acc.assets.size,
      useCaseCount: acc.useCases.size,
      valueLow: Math.round(acc.totalLow),
      valueMid: Math.round(acc.totalMid),
      valueHigh: Math.round(acc.totalHigh),
      assets: topAssets,
      useCases: [...acc.useCases].slice(0, 12),
    };
    if (acc.exampleVendors && acc.exampleVendors.length > 0) {
      row.exampleVendors = acc.exampleVendors;
    }
    if (acc.origin === "unknown" && acc.likelyCategories.size > 0) {
      row.likelyCategories = [...acc.likelyCategories].sort();
    }
    return row;
  });

  // Sort by mid value descending — Unconfirmed bucket pinned to the bottom
  // so it never wins the ranking on a quiet, ambiguous run.
  rows.sort((a, b) => {
    if (a.origin === "unknown" && b.origin !== "unknown") return 1;
    if (b.origin === "unknown" && a.origin !== "unknown") return -1;
    return b.valueMid - a.valueMid;
  });

  return rows;
}
