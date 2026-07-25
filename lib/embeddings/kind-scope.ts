/**
 * Maps each `EmbeddingKind` to its isolation scope.
 *
 * The forge_embeddings table has no `owner_email` column. Instead, each
 * row is implicitly owned by its parent resource (run / scan / source-id).
 * Visibility is derived at query time from the parent's ownership +
 * `forge_resource_acl` table.
 *
 * Categories:
 *   - "run"     -- ownership inherited from ForgeRun (key: run_id)
 *   - "scan"    -- ownership inherited from ForgeEnvironmentScan or
 *                  ForgeFabricScan (key: scan_id)
 *   - "source"  -- ownership inherited from a sourceId-keyed parent;
 *                  consult the `sourceParent` map for which model owns it
 *   - "global"  -- read-only catalog content, visible to everyone
 *                  (skills, industry KPIs, outcome maps, benchmarks)
 */

import type { EmbeddingKind } from "./types";

export type ScopeCategory = "run" | "scan" | "source" | "global";

/**
 * Lookup table covering every value of `EmbeddingKind`. If a new kind is
 * added to `EMBEDDING_KINDS` without updating this map, TypeScript will
 * complain at the `Record<EmbeddingKind, ScopeCategory>` declaration site.
 */
export const KIND_SCOPE: Record<EmbeddingKind, ScopeCategory> = {
  // Estate / scan inherits
  table_detail: "scan",
  column_profile: "scan",
  environment_insight: "scan",
  table_health: "scan",
  data_product: "scan",
  lineage_context: "scan",

  // Pipeline run inherits
  use_case: "run",
  business_context: "run",
  genie_recommendation: "run",
  genie_question: "run",

  // Business value (run-scoped)
  value_estimate: "run",
  roadmap_phase: "run",
  stakeholder_profile: "run",
  executive_synthesis: "run",

  // Fabric scan inherits
  fabric_dataset: "scan",
  fabric_measure: "scan",
  fabric_report: "scan",
  fabric_artifact: "scan",

  // Source-id keyed (need separate parent lookup)
  document_chunk: "source", // owned by ForgeDocument
  company_research: "source", // owned by ForgeDemoSession

  // Global catalog
  outcome_map: "global", // industry-level, admin-managed
  benchmark_context: "global", // admin-curated benchmark catalog
  skill_chunk: "global", // platform skills catalog
  industry_kpi: "global",
  industry_benchmark: "global",
  industry_data_asset: "global",

  // Portfolio (V2): cross-owner canonical-entity vectors for fragmentation
  // analysis. Only ever read behind the org-admin portfolio guard, so it is
  // classified "global" (the guard is the access boundary, not the ACL join).
  portfolio_entity: "global",
};

/**
 * For "source"-scoped kinds, declare which model owns the sourceId.
 * Used by the retriever to compute `accessibleSourceIds` for that kind.
 */
export const SOURCE_PARENT: Partial<Record<EmbeddingKind, "document" | "demo_session">> = {
  document_chunk: "document",
  company_research: "demo_session",
};

/** All kinds in the global catalog -- always readable. */
export const GLOBAL_KINDS: readonly EmbeddingKind[] = (
  Object.keys(KIND_SCOPE) as EmbeddingKind[]
).filter((k) => KIND_SCOPE[k] === "global");

/** All kinds inheriting from a ForgeRun. */
export const RUN_SCOPED_KINDS: readonly EmbeddingKind[] = (
  Object.keys(KIND_SCOPE) as EmbeddingKind[]
).filter((k) => KIND_SCOPE[k] === "run");

/** All kinds inheriting from a scan (estate or fabric). */
export const SCAN_SCOPED_KINDS: readonly EmbeddingKind[] = (
  Object.keys(KIND_SCOPE) as EmbeddingKind[]
).filter((k) => KIND_SCOPE[k] === "scan");

/** All kinds keyed by sourceId. */
export const SOURCE_SCOPED_KINDS: readonly EmbeddingKind[] = (
  Object.keys(KIND_SCOPE) as EmbeddingKind[]
).filter((k) => KIND_SCOPE[k] === "source");

export function scopeOf(kind: EmbeddingKind): ScopeCategory {
  return KIND_SCOPE[kind];
}
