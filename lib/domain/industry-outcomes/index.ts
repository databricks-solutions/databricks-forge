/**
 * Industry Outcome Maps -- Structured Knowledge Base
 *
 * Curated extraction from the 10 industry outcome maps in /docs/outcome maps/.
 * Each industry contains strategic objectives, priorities, reference use cases,
 * KPIs, and personas used to enrich the pipeline prompts.
 *
 * This is NOT a full copy of the documents -- it captures the most actionable
 * use cases and strategic context for prompt injection.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReferenceUseCase {
  name: string;
  description: string;
  businessValue?: string;
  /** Typical data entities/models needed to enable this use case */
  typicalDataEntities?: string[];
  /** Common source systems where this data typically resides */
  typicalSourceSystems?: string[];
}

export interface StrategicPriority {
  name: string;
  useCases: ReferenceUseCase[];

  kpis: string[];
  personas: string[];
}

export interface IndustryObjective {
  name: string;
  whyChange: string;
  priorities: StrategicPriority[];
}

export interface IndustryOutcome {
  id: string;
  name: string;
  subVerticals?: string[];
  objectives: IndustryObjective[];
  /** Suggested business domains when this industry is selected. */
  suggestedDomains: string[];
  /** Suggested business priorities when this industry is selected. */
  suggestedPriorities: string[];
}

// ---------------------------------------------------------------------------
// Per-industry imports
// ---------------------------------------------------------------------------

import { BANKING } from "./banking";
import { INSURANCE } from "./insurance";
import { MANUFACTURING } from "./manufacturing";
import { ENERGY_UTILITIES } from "./energy-utilities";
import { OIL_GAS_NOC } from "./oil-gas-noc";
import { WATER_UTILITIES } from "./water-utilities";
import { COMMUNICATIONS } from "./communications";
import { MEDIA_ADVERTISING } from "./media-advertising";
import { DIGITAL_NATIVES } from "./digital-natives";
import { GAMES } from "./games";
import { RAIL_TRANSPORT } from "./rail-transport";
import { AUTOMOTIVE_MOBILITY } from "./automotive-mobility";
import { SUPERANNUATION } from "./superannuation";
import { CONSTRUCTION_INFRASTRUCTURE } from "./construction-infrastructure";
import { MINING } from "./mining";

// Master Repo v2 canonical industries.
import { RETAIL } from "./retail";
import { CONSUMER_GOODS } from "./consumer-goods";
import { LIFE_SCIENCES } from "./life-sciences";
import { HEALTHCARE } from "./healthcare";
import { CAPITAL_MARKETS } from "./capital-markets";
import { CASINOS_RESORTS } from "./casinos-resorts";
import { REAL_MONEY_GAMING } from "./real-money-gaming";

// ---------------------------------------------------------------------------
// Registry -- Built-in (static) outcome maps
// ---------------------------------------------------------------------------

/**
 * Built-in industry outcome maps. As of the May 2026 registry consolidation
 * the legacy collapsed ids (`rcg`, `hls`, `sports-betting`) are no longer
 * registered as standalone modules -- their consultant-grade content was
 * lifted into the canonical v2 modules (RETAIL + CONSUMER_GOODS,
 * HEALTHCARE + LIFE_SCIENCES, REAL_MONEY_GAMING). Existing
 * `ForgeRun.config.industry` rows keyed by the legacy ids continue to
 * resolve via `INDUSTRY_ALIAS_MAP` below.
 */
export const INDUSTRY_OUTCOMES: IndustryOutcome[] = [
  RETAIL,
  CONSUMER_GOODS,
  LIFE_SCIENCES,
  HEALTHCARE,
  CAPITAL_MARKETS,
  CASINOS_RESORTS,
  REAL_MONEY_GAMING,
  BANKING,
  INSURANCE,
  MANUFACTURING,
  ENERGY_UTILITIES,
  OIL_GAS_NOC,
  WATER_UTILITIES,
  COMMUNICATIONS,
  MEDIA_ADVERTISING,
  DIGITAL_NATIVES,
  GAMES,
  RAIL_TRANSPORT,
  AUTOMOTIVE_MOBILITY,
  SUPERANNUATION,
  CONSTRUCTION_INFRASTRUCTURE,
  MINING,
];

/**
 * Maps legacy collapsed industry ids to the canonical v2 id used by the
 * Master Repository seed. Old `ForgeRun.config.industry='rcg'|'hls'|
 * 'sports-betting'` rows continue to resolve their outcome map via this
 * alias table after the May 2026 registry consolidation removed the
 * standalone legacy modules.
 */
export const INDUSTRY_ALIAS_MAP: Record<string, string> = {
  rcg: "retail",
  hls: "life-sciences",
  banking: "banking",
  "sports-betting": "real-money-gaming",
};

/**
 * Resolve a possibly-legacy industry id to the canonical v2 id used by the
 * Master Repository seed. Returns the input unchanged if no alias applies.
 */
export function resolveIndustryId(id: string | null | undefined): string | null {
  if (!id) return null;
  return INDUSTRY_ALIAS_MAP[id] ?? id;
}

/**
 * Look up an industry outcome by its id (built-in only, synchronous).
 * Resolves legacy collapsed ids (`rcg`, `hls`, `sports-betting`) via
 * `INDUSTRY_ALIAS_MAP` so old `ForgeRun.config.industry` rows still
 * resolve to a registered outcome map after the May 2026 consolidation.
 * For server-side code that should also check custom maps, use
 * `getIndustryOutcomeAsync` instead.
 */
export function getIndustryOutcome(id: string): IndustryOutcome | undefined {
  const direct = INDUSTRY_OUTCOMES.find((i) => i.id === id);
  if (direct) return direct;
  const aliased = INDUSTRY_ALIAS_MAP[id];
  if (aliased && aliased !== id) {
    return INDUSTRY_OUTCOMES.find((i) => i.id === aliased);
  }
  return undefined;
}

/**
 * Get all industry ids and names for populating dropdowns (built-in only).
 * For a full list including custom maps, use `getAllIndustryOutcomes`.
 */
export function getIndustryOptions(): { id: string; name: string }[] {
  return INDUSTRY_OUTCOMES.map((i) => ({ id: i.id, name: i.name }));
}

// ---------------------------------------------------------------------------
// Server-only async functions (DB-aware, support custom maps)
// ---------------------------------------------------------------------------
// The async functions (getAllIndustryOutcomes, getIndustryOutcomeAsync,
// buildReferenceUseCasesPrompt, buildIndustryContextPrompt, buildIndustryKPIsPrompt)
// live in ./industry-outcomes-server.ts to avoid pulling Prisma/pg into
// client bundles. Import from there in server-side code (pipeline steps, API routes).
