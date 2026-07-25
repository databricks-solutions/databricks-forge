/**
 * Economic value-at-risk aggregator for the Data Gap engine.
 *
 * Given the per-use-case Business Value estimates and the per-asset use-case
 * mapping from the master repo, compute the dollar value blocked or reduced
 * by every missing Reference Data Asset.
 *
 * MC vs VA semantics:
 *   - Missing MC asset      -> the use case is **blocked** (full value at risk)
 *   - Missing VA asset only -> the use case is **reduced** (partial value loss)
 *     We model the partial loss as 30% of the full estimate; this is a
 *     conservative heuristic until we have stronger empirical anchors.
 */

import type { EconomicImpactCategory } from "@/lib/domain/economic-patterns";
import type { MasterRepoUseCase } from "@/lib/domain/industry-outcomes/master-repo-types";
import type { AssetDescriptor, AssetValueAtRisk, DataGapInput } from "./types";
import { findReferenceMatch } from "./use-case-attribution";

const VA_PARTIAL_LOSS_RATIO = 0.3;

interface UseCaseEstimate {
  useCaseId: string;
  name: string;
  valueLow: number;
  valueMid: number;
  valueHigh: number;
  economicImpactCategory: EconomicImpactCategory | null;
  /**
   * Hard FK into the master-repo namespace, populated by the use-case
   * generation prompt (or the Data Gap backfill) and threaded through by
   * the API route. When set, {@link bridgeEstimatesToMasterRepo} keys the
   * estimate by this value instead of falling through to the fuzzy ladder
   * on `name`. Null on legacy runs / deliberately bespoke UCs.
   */
  referenceUseCaseName?: string | null;
}

/**
 * Bridge customer-side use-case estimates onto the master-repo namespace
 * before the value-at-risk computations run.
 *
 * The aggregators below ({@link computeValueAtRisk}, {@link
 * computeSummaryValueAtRisk}) key estimates by `name` and look them up by
 * `link.uc.name` which is the master-repo title. Customer `ForgeValueEstimate`
 * rows carry the LLM-generated UC name instead — the use-case-generation
 * prompt explicitly forbids verbatim copies of master-repo titles, so exact
 * name lookups miss almost every time and every estimate falls into the
 * "$0" passthrough.
 *
 * `findReferenceMatch()` already solves the same problem on the
 * table-attribution path (3-tier exact / Jaccard / containment matcher).
 * Reusing it here means there is ONE source of truth for "is this customer
 * UC the same outcome as that master-repo UC" across the whole engine.
 *
 * When multiple customer UCs collapse onto the same master-repo UC, we
 * **sum** their low/mid/high. Two customer estimates that describe distinct
 * implementations of the same business outcome both contribute economic
 * value to that outcome; dropping one would silently under-count value-at-
 * risk and is the more dangerous failure mode for a sales surface.
 *
 * Unmatched customer estimates pass through unchanged. Direct callers
 * (tests, future engines) that already pass master-repo names continue to
 * work — those simply hit the exact-match tier inside `findReferenceMatch`
 * and the bridge is a no-op rename.
 *
 * The `useCaseId` and `economicImpactCategory` of the FIRST matching
 * estimate are preserved on the aggregated row. Aggregated rows are pure
 * dollar containers; the `useCaseId` is informational only inside the
 * value-at-risk view.
 */
export function bridgeEstimatesToMasterRepo(
  estimates: ReadonlyArray<UseCaseEstimate>,
  refUseCases: readonly MasterRepoUseCase[],
): UseCaseEstimate[] {
  const byRefName = new Map<string, UseCaseEstimate>();
  const passthrough: UseCaseEstimate[] = [];

  // Pre-build a case-insensitive lookup of master-repo UCs so the persisted
  // `referenceUseCaseName` can resolve in O(1) without re-running the fuzzy
  // ladder. Falls through to `findReferenceMatch` for legacy rows.
  const refByLowerName = new Map<string, MasterRepoUseCase>();
  for (const r of refUseCases) refByLowerName.set(r.name.toLowerCase(), r);

  for (const e of estimates) {
    const persistedKey = e.referenceUseCaseName?.trim().toLowerCase();
    const ref =
      (persistedKey ? refByLowerName.get(persistedKey) : undefined) ??
      findReferenceMatch(e.name, refUseCases);
    if (!ref) {
      passthrough.push(e);
      continue;
    }
    const key = ref.name.toLowerCase();
    const existing = byRefName.get(key);
    if (existing) {
      byRefName.set(key, {
        ...existing,
        valueLow: existing.valueLow + e.valueLow,
        valueMid: existing.valueMid + e.valueMid,
        valueHigh: existing.valueHigh + e.valueHigh,
      });
    } else {
      byRefName.set(key, { ...e, name: ref.name });
    }
  }

  return [...byRefName.values(), ...passthrough];
}

export function computeValueAtRisk(
  assetDescriptors: AssetDescriptor[],
  missingAssetIds: Set<string>,
  presentAssetIds: Set<string>,
  estimates: NonNullable<DataGapInput["useCaseValueEstimates"]>,
): AssetValueAtRisk[] {
  const estByName = new Map<string, UseCaseEstimate>();
  for (const e of estimates) estByName.set(e.name.toLowerCase(), e);

  /**
   * For a use case to be "blocked" by a single missing MC asset, we want to
   * avoid double-counting: a UC with three MC assets all missing should not
   * appear three times. We attribute the loss to ONE asset -- the first one
   * processed in iteration order. To keep the attribution stable, we walk
   * assets sorted by id and only attribute to the first missing MC asset.
   *
   * However for the per-asset value-at-risk report (this function), it is
   * useful to surface the union: every missing MC asset shows the same UC.
   * Aggregating summaries by summing across assets would double-count, so
   * the summary computation does its own deduplication.
   */

  const out: AssetValueAtRisk[] = [];

  for (const descriptor of assetDescriptors) {
    if (!missingAssetIds.has(descriptor.asset.id)) continue;

    const blockedUcs = new Set<string>();
    const reducedUcs = new Set<string>();

    for (const link of descriptor.useCases) {
      const isMC = link.criticality === "MC";
      const ucName = link.uc.name;

      if (isMC) {
        // The use case is blocked only if at least one MC asset is missing
        // (which we know is true -- this descriptor is missing). Add to set.
        blockedUcs.add(ucName);
      } else {
        // VA-only link: reduced impact unless any MC is also missing for the
        // same UC (in which case it's already counted as blocked). Compute by
        // checking the UC's full MC set.
        const ucMcAssets = link.uc.dataAssetIds?.filter(
          (id) => link.uc.dataAssetCriticality?.[id] === "MC",
        ) ?? [];
        const anyMcMissing = ucMcAssets.some((id) => missingAssetIds.has(id));
        if (!anyMcMissing) reducedUcs.add(ucName);
      }
    }

    // Aggregate dollar values + per-UC attribution for the UI.
    const byCat: AssetValueAtRisk["byImpactCategory"] = {};
    let lo = 0;
    let mi = 0;
    let hi = 0;
    const impactedUseCases: AssetValueAtRisk["impactedUseCases"] = [];

    function add(name: string, ratio: number, criticality: "MC" | "VA") {
      const est = estByName.get(name.toLowerCase());
      if (est) {
        const category = est.economicImpactCategory ?? "Cost";
        const bucket = byCat[category] ?? { low: 0, mid: 0, high: 0 };
        bucket.low += est.valueLow * ratio;
        bucket.mid += est.valueMid * ratio;
        bucket.high += est.valueHigh * ratio;
        byCat[category] = bucket;
        lo += est.valueLow * ratio;
        mi += est.valueMid * ratio;
        hi += est.valueHigh * ratio;
        impactedUseCases.push({
          useCaseId: est.useCaseId,
          name: est.name,
          criticality,
          valueLow: est.valueLow * ratio,
          valueMid: est.valueMid * ratio,
          valueHigh: est.valueHigh * ratio,
        });
      } else {
        // Use case is in the master repo but the customer's run produced
        // no matching estimate. Still surface it for the consumer with $0
        // attribution so they know the missing asset blocks more than the
        // dollar number suggests.
        impactedUseCases.push({
          useCaseId: null,
          name,
          criticality,
          valueLow: 0,
          valueMid: 0,
          valueHigh: 0,
        });
      }
    }

    for (const ucName of blockedUcs) add(ucName, 1.0, "MC");
    for (const ucName of reducedUcs) add(ucName, VA_PARTIAL_LOSS_RATIO, "VA");

    // Stable order: MC before VA, descending by attributed valueMid, name asc as a tiebreaker.
    impactedUseCases.sort((a, b) => {
      if (a.criticality !== b.criticality) return a.criticality === "MC" ? -1 : 1;
      if (b.valueMid !== a.valueMid) return b.valueMid - a.valueMid;
      return a.name.localeCompare(b.name);
    });

    out.push({
      assetId: descriptor.asset.id,
      assetName: descriptor.asset.name,
      blockedUseCases: [...blockedUcs].sort(),
      reducedUseCases: [...reducedUcs].sort(),
      impactedUseCases,
      byImpactCategory: byCat,
      totalLow: lo,
      totalMid: mi,
      totalHigh: hi,
    });
  }

  // Sort assets by descending mid value-at-risk
  out.sort((a, b) => b.totalMid - a.totalMid);
  // Ensure presentAssetIds is referenced so callers cannot accidentally pass
  // stale data; not strictly used here but documents the API surface.
  void presentAssetIds;
  return out;
}

/**
 * Compute the deduplicated total value-at-risk across all missing assets.
 * Each UC's full or reduced value contributes exactly once even when many
 * of its assets are missing.
 */
export function computeSummaryValueAtRisk(
  assetDescriptors: AssetDescriptor[],
  missingAssetIds: Set<string>,
  estimates: NonNullable<DataGapInput["useCaseValueEstimates"]>,
): { low: number; mid: number; high: number } {
  const estByName = new Map<string, UseCaseEstimate>();
  for (const e of estimates) estByName.set(e.name.toLowerCase(), e);

  // For each UC, determine if it is blocked (any MC missing) or reduced.
  const blockedUcs = new Set<string>();
  const reducedUcs = new Set<string>();

  for (const descriptor of assetDescriptors) {
    for (const link of descriptor.useCases) {
      const ucName = link.uc.name;
      const mcIds = link.uc.dataAssetIds?.filter(
        (id) => link.uc.dataAssetCriticality?.[id] === "MC",
      ) ?? [];
      const vaIds = link.uc.dataAssetIds?.filter(
        (id) => link.uc.dataAssetCriticality?.[id] === "VA",
      ) ?? [];
      const anyMcMissing = mcIds.some((id) => missingAssetIds.has(id));
      const anyVaMissing = vaIds.some((id) => missingAssetIds.has(id));

      if (anyMcMissing) blockedUcs.add(ucName);
      else if (anyVaMissing) reducedUcs.add(ucName);
    }
  }

  let lo = 0;
  let mi = 0;
  let hi = 0;
  for (const ucName of blockedUcs) {
    const est = estByName.get(ucName.toLowerCase());
    if (!est) continue;
    lo += est.valueLow;
    mi += est.valueMid;
    hi += est.valueHigh;
  }
  for (const ucName of reducedUcs) {
    if (blockedUcs.has(ucName)) continue;
    const est = estByName.get(ucName.toLowerCase());
    if (!est) continue;
    lo += est.valueLow * VA_PARTIAL_LOSS_RATIO;
    mi += est.valueMid * VA_PARTIAL_LOSS_RATIO;
    hi += est.valueHigh * VA_PARTIAL_LOSS_RATIO;
  }
  return { low: lo, mid: mi, high: hi };
}
