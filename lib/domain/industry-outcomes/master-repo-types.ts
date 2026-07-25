/**
 * Types for Master Repository enrichment data.
 *
 * These types extend the base industry outcome model with structured
 * benchmark, data asset, and strategic alignment data sourced from
 * the Master Repository XLSX.
 *
 * Auto-generated enrichment modules (*.enrichment.ts) import these types.
 * The industry-enrichment skill reads these to build LLM prompt chunks.
 */

import type {
  EconomicImpactCategory,
  EconomicPatternName,
} from "@/lib/domain/economic-patterns";
import type { AccessDifficulty, LOELevel } from "@/lib/domain/loe-matrix";
import type { SystemKind } from "@/lib/domain/tech-to-system";

// ---------------------------------------------------------------------------
// Enriched use case (superset of ReferenceUseCase fields)
// ---------------------------------------------------------------------------

export interface MasterRepoUseCase {
  name: string;
  description: string;
  rationale?: string;
  modelType?: string;
  kpiTarget?: string;
  benchmarkImpact?: string;
  benchmarkSource?: string;
  benchmarkUrl?: string;
  strategicImperative?: string;
  strategicPillar?: string;
  dataAssetIds?: string[];
  dataAssetCriticality?: Record<string, "MC" | "VA">;

  // ---- Master Repository v2 fields (Phase 0) ------------------------------

  /**
   * Total Level-of-Effort estimate for the use case (Master Repository column
   * "Total Level of Effort Estimate"). Single source of truth; the LOE matrix
   * lookup is used as fallback when this field is absent.
   */
  totalLoeEstimate?: LOELevel;

  /**
   * Aggregate Difficulty of Data Accessibility for Mission-Critical assets
   * (Master Repository column "Difficulty of Data Accessibility: Aggregate"
   * under MC). Used with `modelType` in the canonical LOE matrix.
   */
  mcAccessDifficulty?: AccessDifficulty;

  /**
   * Aggregate Difficulty of Data Accessibility for Value-Add assets. Same
   * column under VA in the master repository.
   */
  vaAccessDifficulty?: AccessDifficulty;

  /** Economic pattern this use case maps to (one of 10 canonical patterns). */
  economicPatternName?: EconomicPatternName;

  /** Impact category the economic pattern rolls up to (one of 5). */
  economicImpactCategory?: EconomicImpactCategory;

  /**
   * Concrete formula sourced from the master repository, e.g.
   *   "Pipes_yr x Delta_hrs_pipe x Rate_hr x Adopt% x Cap%"
   * The formula may instantiate the canonical pattern's `defaultFormula`
   * placeholders with use-case-specific variables.
   */
  economicFormula?: string;

  /**
   * Variable definitions and units for `economicFormula`, e.g.
   *   "Pipes_yr = event sources / pipelines onboarded per year (count, from
   *   data catalog / Jira); Delta_hrs_pipe = ..."
   */
  economicFormulaDescription?: string;

  /**
   * "Why this use case maps to this economic pattern" rationale from the
   * Economic Patterns sheet of the master repository.
   */
  economicPatternRationale?: string;
}

// ---------------------------------------------------------------------------
// Reference data asset
// ---------------------------------------------------------------------------

export interface ReferenceDataAsset {
  id: string;
  name: string;
  description: string;
  systemLocation: string;
  assetFamily: string;
  easeOfAccess: string;
  lakeflowConnect: "High" | "Low";
  ucFederation: "High" | "Low";
  lakebridgeMigrate: "High" | "Low";

  // ---- Master Repository v2 fields (Phase 0) ------------------------------

  /**
   * 4th ingestion-strategy bucket from the master repository "Ease of Data
   * Access Analysis" sheet (column 9). Marks assets that have no first-class
   * Databricks integration path and require custom engineering.
   */
  bespoke?: "High" | "Low";

  /**
   * Rationale text explaining the High / Low ratings across all four
   * ingestion strategies (column 10 of the Ease of Data Access Analysis
   * sheet). Often includes concrete vendor names and citations.
   */
  accessRationale?: string;

  /**
   * Canonical system kind derived from `systemLocation` at build time via
   * `classifySystemLocation()` from `lib/domain/tech-to-system.ts`. Optional
   * because the master repo includes long-tail systems that cannot be cleanly
   * classified.
   */
  systemKind?: SystemKind;
}

// ---------------------------------------------------------------------------
// Enrichment bundle (per industry)
// ---------------------------------------------------------------------------

export interface MasterRepoEnrichment {
  useCases: MasterRepoUseCase[];
  dataAssets: ReferenceDataAsset[];
}
