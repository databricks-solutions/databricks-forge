/**
 * Ingestion-strategy recommendation for a Reference Data Asset.
 *
 * Logic (Phase 3.4 update):
 *
 *   1. Rank the four candidate strategies (Lakeflow Connect, UC Federation,
 *      Lakebridge Migrate, Bespoke) by their `High/Low` rating from the
 *      master repository, preferring the more "managed" path among ties
 *      per the order Lakeflow Connect > UC Federation > Lakebridge Migrate
 *      > Bespoke. This is the *generic* per-asset ranking.
 *
 *   2. **Source-system override** (Phase 3.4): when the caller supplies a
 *      resolved source-system list (Phase 3.3) and the highest-confidence
 *      entry has a `preferredStrategy`, promote that strategy to first
 *      position and rewrite its rationale to name the concrete source
 *      system. Example:
 *
 *        Before:  "Lakeflow Connect is preferred for 'Customer Master Data'."
 *        After:   "Source: Salesforce (confirmed from your lineage). Use the
 *                  Lakeflow Connect Salesforce connector."
 *
 *      The remaining strategies stay in their generic ranking order so the
 *      UI can still show alternatives ("you could also UC-Federate it…").
 */

import type { ReferenceDataAsset } from "@/lib/domain/industry-outcomes/master-repo-types";
import type { ResolvedSourceSystem } from "./source-systems";
import type { IngestionRecommendation, IngestionStrategy } from "./types";

const STRATEGY_ORDER: IngestionStrategy[] = [
  "lakeflow_connect",
  "uc_federation",
  "lakebridge_migrate",
  "bespoke",
];

function ratingFor(asset: ReferenceDataAsset, strategy: IngestionStrategy): "High" | "Low" {
  switch (strategy) {
    case "lakeflow_connect":
      return asset.lakeflowConnect;
    case "uc_federation":
      return asset.ucFederation;
    case "lakebridge_migrate":
      return asset.lakebridgeMigrate;
    case "bespoke":
      return asset.bespoke ?? "Low";
  }
}

function rationaleFor(
  strategy: IngestionStrategy,
  asset: ReferenceDataAsset,
  rating: "High" | "Low",
): string {
  // Prefer the per-asset rationale text when available -- it is the verbatim
  // quote from the master repo's "Ease of Data Access Analysis" sheet.
  if (asset.accessRationale && asset.accessRationale.length > 0) {
    return asset.accessRationale;
  }
  const verb = rating === "High" ? "preferred" : "not recommended";
  switch (strategy) {
    case "lakeflow_connect":
      return `Lakeflow Connect is ${verb} for "${asset.name}" (${asset.systemLocation || "system n/a"}).`;
    case "uc_federation":
      return `UC Federation is ${verb} for "${asset.name}".`;
    case "lakebridge_migrate":
      return `Lakebridge migration is ${verb} for "${asset.name}".`;
    case "bespoke":
      return `A bespoke connector is ${verb} for "${asset.name}".`;
  }
}

/**
 * Build a source-system-aware rationale string.
 *
 * Lineage rows name the concrete vendor + connector (we have evidence
 * the customer runs that system). Master-repo rows speak in CATEGORY
 * terms with example vendors so we never put words in the customer's
 * mouth about which CRM / ERP / DWH they actually run — sales asks them
 * in discovery. Unknown rows fall back to the generic asset-name
 * phrasing.
 */
function sourceAwareRationale(
  strategy: IngestionStrategy,
  source: ResolvedSourceSystem,
  asset: ReferenceDataAsset,
  rating: "High" | "Low",
): string {
  // Master-repo branch: do NOT pretend to know the vendor. The asset's
  // category came from the industry reference architecture; sales must
  // still confirm which vendor in that category the customer runs.
  if (source.origin === "master-repo") {
    const exampleHint =
      source.exampleVendors && source.exampleVendors.length > 0
        ? ` (${source.exampleVendors.slice(0, 3).join(" / ")})`
        : "";
    const categoryNoun = friendlyCategoryNoun(source.name);
    switch (strategy) {
      case "lakeflow_connect":
        return `Typical for ${source.name}${exampleHint} — pick the Lakeflow Connect connector that matches the customer's ${categoryNoun}, then land "${asset.name}" into Unity Catalog.`;
      case "uc_federation":
        return `Typical for ${source.name}${exampleHint} — UC Federation queries the customer's ${categoryNoun} in place without copying "${asset.name}". Confirm the vendor before picking the foreign-catalog driver.`;
      case "lakebridge_migrate":
        return `Typical for ${source.name}${exampleHint} — a Lakebridge-led migration retires the legacy ${categoryNoun} and consolidates "${asset.name}" onto Databricks. Confirm vendor + version with the customer first.`;
      case "bespoke":
        return `Typical for ${source.name}${exampleHint} — no managed connector for the category; use Auto Loader / a custom consumer to land "${asset.name}" into the bronze layer. Rating: ${rating}.`;
    }
  }

  if (source.origin === "unknown") {
    // No signal at all — defer naming a strategy and prompt sales.
    switch (strategy) {
      case "lakeflow_connect":
        return `Source not yet detected. Lakeflow Connect is preferred for "${asset.name}" if the upstream system is a SaaS app — confirm with the customer.`;
      case "uc_federation":
        return `Source not yet detected. UC Federation is preferred for "${asset.name}" if the upstream system is a cloud warehouse — confirm with the customer.`;
      case "lakebridge_migrate":
        return `Source not yet detected. A Lakebridge migration is preferred for "${asset.name}" if the upstream system is a legacy on-prem platform — confirm with the customer.`;
      case "bespoke":
        return `Source not yet detected. A bespoke connector (Auto Loader / custom consumer) is the fallback for "${asset.name}" — confirm the source with the customer.`;
    }
  }

  // Lineage branch — we have evidence; name the vendor + connector.
  const confidenceLabel = "confirmed from your lineage";
  switch (strategy) {
    case "lakeflow_connect":
      return `Source: ${source.name} (${confidenceLabel}). Use the Lakeflow Connect ${source.name} connector to land "${asset.name}" into Unity Catalog.`;
    case "uc_federation":
      return `Source: ${source.name} (${confidenceLabel}). UC Federation gives Databricks queries against ${source.name} without copying "${asset.name}" — fastest path to value when the workload is exploration-heavy.`;
    case "lakebridge_migrate":
      return `Source: ${source.name} (${confidenceLabel}). A Lakebridge-led migration consolidates "${asset.name}" onto Databricks and retires the legacy platform.`;
    case "bespoke":
      return `Source: ${source.name} (${confidenceLabel}). No managed connector today — use Auto Loader / a custom consumer to land "${asset.name}" into the bronze layer. Rating: ${rating}.`;
  }
}

/**
 * Convert a category display name ("CRM systems", "Cloud data warehouse",
 * "Marketing automation / ESP") into a friendly noun usable mid-sentence
 * ("CRM", "cloud data warehouse", "marketing automation platform"). Keeps
 * the rationale text grammatical — saying "the customer's CRM systems"
 * reads oddly; "the customer's CRM" reads naturally.
 */
function friendlyCategoryNoun(categoryName: string): string {
  // Strip a trailing " systems" / " platforms" / " platform" suffix.
  let s = categoryName
    .replace(/\s+systems$/i, "")
    .replace(/\s+platforms?$/i, "");
  // Slash-separated category labels: pick the most concise alternative.
  if (s.includes("/")) {
    s = s.split("/")[0]!.trim();
  }
  return s;
}

export function buildIngestionRecommendations(
  asset: ReferenceDataAsset,
  resolved?: ResolvedSourceSystem[],
): IngestionRecommendation[] {
  const ratings = STRATEGY_ORDER.map((s) => ({ strategy: s, rating: ratingFor(asset, s) }));
  // Stable sort: High first (preserving STRATEGY_ORDER), then Low.
  ratings.sort((a, b) => {
    if (a.rating === b.rating) return 0;
    return a.rating === "High" ? -1 : 1;
  });

  // Default (no source-system override): generic ranking + asset-name rationale.
  const generic: IngestionRecommendation[] = ratings.map((r) => ({
    strategy: r.strategy,
    rating: r.rating,
    rationale: rationaleFor(r.strategy, asset, r.rating),
  }));

  // Phase 3.4: source-system override — only fires when a resolver result
  // names a concrete preferredStrategy. Unknown rows and rows missing a
  // strategy fall through to the generic ranking above untouched.
  const topResolved = resolved?.find(
    (r) => r.origin !== "unknown" && r.preferredStrategy !== null,
  );
  if (!topResolved || !topResolved.preferredStrategy) return generic;

  // Promote the preferred strategy to position 0; preserve relative order
  // among the rest. Rewrite the preferred entry's rationale to name the
  // concrete source system.
  const preferred = topResolved.preferredStrategy;
  const promoted = generic.find((r) => r.strategy === preferred);
  if (!promoted) return generic;
  const rest = generic.filter((r) => r.strategy !== preferred);
  return [
    {
      strategy: promoted.strategy,
      rating: promoted.rating,
      rationale: sourceAwareRationale(promoted.strategy, topResolved, asset, promoted.rating),
    },
    ...rest,
  ];
}
