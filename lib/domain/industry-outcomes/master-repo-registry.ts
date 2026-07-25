/**
 * Master Repository Enrichment Registry
 *
 * Loads all auto-generated enrichment modules and provides lookup by industry ID.
 * The industry-enrichment skill uses this to build additional LLM prompt chunks.
 *
 * Post Master Repo v2 split: registers 15 canonical industry ids. Legacy
 * collapsed ids (`rcg`, `hls`, `sports-betting`) resolve via `INDUSTRY_ALIAS_MAP`
 * in `index.ts`. The reverse-alias fallback below is retained as a safety net.
 */

import type { MasterRepoEnrichment } from "./master-repo-types";

import { BANKING_USE_CASES, BANKING_DATA_ASSETS } from "./banking.enrichment";
import {
  CAPITAL_MARKETS_USE_CASES,
  CAPITAL_MARKETS_DATA_ASSETS,
} from "./capital-markets.enrichment";
import { INSURANCE_USE_CASES, INSURANCE_DATA_ASSETS } from "./insurance.enrichment";
import { LIFE_SCIENCES_USE_CASES, LIFE_SCIENCES_DATA_ASSETS } from "./life-sciences.enrichment";
import { HEALTHCARE_USE_CASES, HEALTHCARE_DATA_ASSETS } from "./healthcare.enrichment";
import { RETAIL_USE_CASES, RETAIL_DATA_ASSETS } from "./retail.enrichment";
import { CONSUMER_GOODS_USE_CASES, CONSUMER_GOODS_DATA_ASSETS } from "./consumer-goods.enrichment";
import { MANUFACTURING_USE_CASES, MANUFACTURING_DATA_ASSETS } from "./manufacturing.enrichment";
import {
  ENERGY_UTILITIES_USE_CASES,
  ENERGY_UTILITIES_DATA_ASSETS,
} from "./energy-utilities.enrichment";
import { OIL_GAS_NOC_USE_CASES, OIL_GAS_NOC_DATA_ASSETS } from "./oil-gas-noc.enrichment";
import { COMMUNICATIONS_USE_CASES, COMMUNICATIONS_DATA_ASSETS } from "./communications.enrichment";
import {
  MEDIA_ADVERTISING_USE_CASES,
  MEDIA_ADVERTISING_DATA_ASSETS,
} from "./media-advertising.enrichment";
import {
  DIGITAL_NATIVES_USE_CASES,
  DIGITAL_NATIVES_DATA_ASSETS,
} from "./digital-natives.enrichment";
import { GAMES_USE_CASES, GAMES_DATA_ASSETS } from "./games.enrichment";
import {
  CASINOS_RESORTS_USE_CASES,
  CASINOS_RESORTS_DATA_ASSETS,
} from "./casinos-resorts.enrichment";
import {
  REAL_MONEY_GAMING_USE_CASES,
  REAL_MONEY_GAMING_DATA_ASSETS,
} from "./real-money-gaming.enrichment";
import { MINING_USE_CASES, MINING_DATA_ASSETS } from "./mining.enrichment";

const REGISTRY = new Map<string, MasterRepoEnrichment>([
  // Canonical v2 industries (15)
  ["banking", { useCases: BANKING_USE_CASES, dataAssets: BANKING_DATA_ASSETS }],
  [
    "capital-markets",
    { useCases: CAPITAL_MARKETS_USE_CASES, dataAssets: CAPITAL_MARKETS_DATA_ASSETS },
  ],
  ["insurance", { useCases: INSURANCE_USE_CASES, dataAssets: INSURANCE_DATA_ASSETS }],
  ["life-sciences", { useCases: LIFE_SCIENCES_USE_CASES, dataAssets: LIFE_SCIENCES_DATA_ASSETS }],
  ["healthcare", { useCases: HEALTHCARE_USE_CASES, dataAssets: HEALTHCARE_DATA_ASSETS }],
  ["retail", { useCases: RETAIL_USE_CASES, dataAssets: RETAIL_DATA_ASSETS }],
  [
    "consumer-goods",
    { useCases: CONSUMER_GOODS_USE_CASES, dataAssets: CONSUMER_GOODS_DATA_ASSETS },
  ],
  ["manufacturing", { useCases: MANUFACTURING_USE_CASES, dataAssets: MANUFACTURING_DATA_ASSETS }],
  [
    "energy-utilities",
    { useCases: ENERGY_UTILITIES_USE_CASES, dataAssets: ENERGY_UTILITIES_DATA_ASSETS },
  ],
  ["oil-gas-noc", { useCases: OIL_GAS_NOC_USE_CASES, dataAssets: OIL_GAS_NOC_DATA_ASSETS }],
  [
    "communications",
    { useCases: COMMUNICATIONS_USE_CASES, dataAssets: COMMUNICATIONS_DATA_ASSETS },
  ],
  [
    "media-advertising",
    { useCases: MEDIA_ADVERTISING_USE_CASES, dataAssets: MEDIA_ADVERTISING_DATA_ASSETS },
  ],
  [
    "digital-natives",
    { useCases: DIGITAL_NATIVES_USE_CASES, dataAssets: DIGITAL_NATIVES_DATA_ASSETS },
  ],
  ["games", { useCases: GAMES_USE_CASES, dataAssets: GAMES_DATA_ASSETS }],
  [
    "casinos-resorts",
    { useCases: CASINOS_RESORTS_USE_CASES, dataAssets: CASINOS_RESORTS_DATA_ASSETS },
  ],
  [
    "real-money-gaming",
    { useCases: REAL_MONEY_GAMING_USE_CASES, dataAssets: REAL_MONEY_GAMING_DATA_ASSETS },
  ],
  // Handcrafted (non-master-repo) industry
  ["mining", { useCases: MINING_USE_CASES, dataAssets: MINING_DATA_ASSETS }],
]);

/**
 * Reverse alias map: legacy collapsed ids fall back to their canonical v2 id.
 * Used when a caller asks for `hls` / `rcg` / `sports-betting` directly.
 */
const REVERSE_ALIAS: Record<string, string> = {
  rcg: "retail",
  hls: "life-sciences",
  "sports-betting": "real-money-gaming",
};

/** Get Master Repository enrichment data for an industry (built-in first, then custom). */
export function getMasterRepoEnrichment(industryId: string): MasterRepoEnrichment | undefined {
  const direct = REGISTRY.get(industryId);
  if (direct) return direct;
  const fallback = REVERSE_ALIAS[industryId];
  if (fallback) return REGISTRY.get(fallback);
  return undefined;
}

/**
 * Async version that falls back to custom enrichment stored on ForgeOutcomeMap.
 * Use this when the caller can await -- it checks built-in first (fast path),
 * then queries Lakebase for LLM-generated enrichment.
 */
export async function getMasterRepoEnrichmentAsync(
  industryId: string,
): Promise<MasterRepoEnrichment | undefined> {
  const builtIn = getMasterRepoEnrichment(industryId);
  if (builtIn) return builtIn;
  try {
    const { getCustomEnrichment } = await import("@/lib/lakebase/outcome-maps");
    return (await getCustomEnrichment(industryId)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Get all industry IDs that have Master Repository enrichment. */
export function getMasterRepoIndustryIds(): string[] {
  return Array.from(REGISTRY.keys());
}
