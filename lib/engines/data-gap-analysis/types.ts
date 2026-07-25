/**
 * Data Gap Analysis -- types.
 *
 * The Data Gap engine evaluates a catalog scope (a scan or a pipeline run)
 * against the industry's Reference Data Assets from the Master Repository.
 * It produces a coverage matrix at the data-asset level (not at the use-case
 * level like `industry-coverage.ts`), surfaces the recommended ingestion path
 * for every missing asset, and quantifies the economic value-at-risk from
 * missing Mission-Critical assets.
 */

import type { ReferenceDataAsset, MasterRepoUseCase } from "@/lib/domain/industry-outcomes/master-repo-types";
import type { EconomicImpactCategory } from "@/lib/domain/economic-patterns";
import type { ResolvedSourceSystem } from "./source-systems";

export type IngestionStrategy =
  | "lakeflow_connect"
  | "uc_federation"
  | "lakebridge_migrate"
  | "bespoke";

export interface IngestionRecommendation {
  strategy: IngestionStrategy;
  /** "High" or "Low" rating sourced from the master repo. */
  rating: "High" | "Low";
  /** Plain-text reasoning surfaced to the UI. */
  rationale?: string;
}

/**
 * Per-Reference-Data-Asset coverage view. `present === true` means at least
 * one catalog table in the scope was classified onto this asset id.
 */
export interface AssetCoverage {
  assetId: string;
  assetName: string;
  assetFamily: string;
  systemLocation: string;
  systemKind?: string;
  present: boolean;
  /**
   * FQN list of catalog tables mapped to this asset. Empty when `present`
   * is false (a true gap) and non-empty when present.
   */
  matchedTables: string[];
  /** Count of master-repo use cases that need this asset as Mission-Critical. */
  mcUseCaseCount: number;
  /** Count of master-repo use cases that need this asset as Value-Add. */
  vaUseCaseCount: number;
  /** Names of MC use cases (truncated to 10 for readability). */
  mcUseCaseNames: string[];
  /**
   * Ranked list of ingestion strategies for this asset. First entry is
   * always the recommended path; populated even when `present` is true so
   * the UI can offer documentation links for the existing connection.
   */
  recommendations: IngestionRecommendation[];
  /**
   * Resolved source system(s) for this asset (Phase 3.3). Multiple entries
   * mean the asset is sourced from more than one upstream platform (e.g.
   * Customer Master = Salesforce + SAP). The first entry's
   * `preferredStrategy` is used by `buildIngestionRecommendations` to
   * override the generic per-asset ranking when origin is "lineage".
   *
   * Always non-empty — when no signal fires the resolver emits a single
   * `{ name: "Unknown", origin: "unknown" }` row so the UI can render a
   * stable badge.
   */
  resolvedSourceSystems: ResolvedSourceSystem[];
}

/**
 * Per-missing-asset economic value-at-risk: total annualized benefit of the
 * MC use cases blocked by the missing asset, aggregated by impact category.
 */
export interface AssetValueAtRisk {
  assetId: string;
  assetName: string;
  /** Use case names whose MC requirements are not met. */
  blockedUseCases: string[];
  /** Use case names whose VA requirements are not met (soft risk). */
  reducedUseCases: string[];
  /**
   * Per-use-case attribution for this missing asset. Each entry surfaces
   * the use case's contribution to this asset's value-at-risk so the UI
   * can render "Affects: Customer Churn ($2M MC), Cross-Sell ($450K VA)"
   * under each missing asset row. `valueMid` is the *attributed* value
   * (full for MC links, 30% for VA-only links per `VA_PARTIAL_LOSS_RATIO`)
   * to match the same arithmetic that produces `totalMid`. `useCaseId` is
   * the discovery-pipeline use case id when the engine could resolve a
   * Business Value estimate by name; `null` when the use case is in the
   * master repo but the customer's run did not produce a matching
   * use case.
   */
  impactedUseCases: Array<{
    useCaseId: string | null;
    name: string;
    criticality: "MC" | "VA";
    valueLow: number;
    valueMid: number;
    valueHigh: number;
  }>;
  /** Aggregate annualized $ value at risk, by impact category. */
  byImpactCategory: Partial<Record<EconomicImpactCategory, { low: number; mid: number; high: number }>>;
  totalLow: number;
  totalMid: number;
  totalHigh: number;
}

export interface DataGapSummary {
  industryId: string;
  industryName: string;
  /** Number of Reference Data Assets defined for this industry. */
  totalAssets: number;
  /** Assets where the catalog has at least one matching table. */
  presentAssets: number;
  /** Assets with zero catalog matches. */
  missingAssets: number;
  /** Sum of MC requirements satisfied across all use cases. */
  mcCovered: number;
  /** Sum of MC requirements not satisfied. */
  mcMissing: number;
  vaCovered: number;
  vaMissing: number;
  /**
   * Overall coverage percentage (mcCovered / (mcCovered + mcMissing)). MC
   * gaps weigh more than VA gaps, hence the asymmetric formula. Returns 0
   * when there are no MC requirements.
   */
  mcCoveragePct: number;
  /** Total economic value-at-risk, summed across all blocked use cases. */
  valueAtRiskLow: number;
  valueAtRiskMid: number;
  valueAtRiskHigh: number;
}

export interface DataGapResult {
  industryId: string;
  industryName: string;
  generatedAt: string;
  summary: DataGapSummary;
  coverage: AssetCoverage[];
  valueAtRisk: AssetValueAtRisk[];
}

export interface DataGapInput {
  industryId: string;
  /**
   * Tables observed in the scope, with their classifier output. `null`
   * dataAssetId means the table was scanned but did not map to any industry
   * reference asset -- excluded from coverage but counted in scope size.
   */
  classifiedTables: Array<{ fqn: string; dataAssetId: string | null }>;
  /**
   * Optional dollar-value estimates per use case from the Business Value
   * engine. When provided, the engine computes economic value-at-risk per
   * missing asset by aggregating estimates of the use cases that asset
   * blocks. When omitted, the engine falls back to count-based ranking only.
   */
  useCaseValueEstimates?: Array<{
    useCaseId: string;
    name: string;
    valueLow: number;
    valueMid: number;
    valueHigh: number;
    economicImpactCategory: EconomicImpactCategory | null;
    /**
     * Hard FK into the master-repo namespace. When set, the bridge uses
     * this for an O(1) exact match instead of running the fuzzy ladder
     * on `name`. Threaded through by the Data Gap route from the
     * underlying `ForgeUseCase.referenceUseCaseName` column.
     */
    referenceUseCaseName?: string | null;
  }>;
  /**
   * Optional per-use-case source-system attribution from Phase 3.1.
   * Each entry pairs a use case `name` with the canonical source-system
   * names attributed by walking lineage upstream.
   *
   * When provided, the Data Gap engine threads these through to the
   * per-asset Source-System Resolver (Phase 3.3), upgrading the asset's
   * `resolvedSourceSystems[0].origin` from `"master-repo"` to `"lineage"`
   * for any asset whose linked master-repo use cases share a name with
   * one of the entries here.
   *
   * The matching is by case-insensitive use-case name (master-repo use
   * cases have no customer-side id).
   */
  useCaseSourceSystems?: Array<{
    name: string;
    sourceSystems: string[];
  }>;
  /**
   * Optional pre-resolved master-repo enrichment. When provided, the engine
   * uses this directly and skips its internal sync registry lookup.
   * Callers that need to support LLM-generated / custom industries (stored
   * in `ForgeOutcomeMap` via `getMasterRepoEnrichmentAsync`) should resolve
   * the enrichment up-front and inject it here. Keeping the engine pure
   * (no I/O) is the reason for this option.
   */
  enrichment?: {
    useCases: ReadonlyArray<MasterRepoUseCase>;
    dataAssets: ReadonlyArray<ReferenceDataAsset>;
  };
}

/**
 * Helper type used internally when building the engine output.
 */
export interface AssetDescriptor {
  asset: ReferenceDataAsset;
  /** Use cases that need this asset (MC or VA). */
  useCases: Array<{ uc: MasterRepoUseCase; criticality: "MC" | "VA" }>;
}
