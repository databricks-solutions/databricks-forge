/**
 * Estate readiness + metadata-quality coverage (Workstream B).
 *
 * Deterministic, rule-based rollups computed from persisted table details.
 * Feeds the C-level Estate Overview ("what's ready, what needs work, what's
 * missing") and the per-entity/per-domain readiness scores in the ontology
 * tree. No LLM — pure aggregation over fields the scan already captures.
 */

import type { TableDetail } from "@/lib/domain/types";

export interface MetadataQualityCoverage {
  tableCount: number;
  /** % of tables with a comment (human or generated). */
  tablesWithCommentPct: number;
  /** % of columns with a comment (across all tables with column data). */
  columnsWithCommentPct: number;
  /** % of tables with at least one tag. */
  tablesWithTagsPct: number;
  /** % of tables with an owner. */
  tablesWithOwnerPct: number;
  /** % of tables with an assigned medallion tier (not unknown/null). */
  tablesWithTierPct: number;
  /** % of tables with an assigned business domain. */
  tablesWithDomainPct: number;
}

export interface TierDistribution {
  bronze: number;
  silver: number;
  gold: number;
  /** Tables tagged as system/audit/log layer. */
  system: number;
  /** Tables with no tier assigned. */
  unknown: number;
}

export type ReadinessBand = "ready" | "needs_work" | "missing";

export interface ReadinessScore {
  score: number; // 0-100
  band: ReadinessBand;
}

/** Lightweight column shape parsed from ForgeTableDetail.columnsJson. */
interface ColumnLite {
  name: string;
  comment: string | null;
}

function parseColumns(columnsJson: string | null | undefined): ColumnLite[] {
  if (!columnsJson) return [];
  try {
    const parsed = JSON.parse(columnsJson) as Array<{ name: string; comment: string | null }>;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

/**
 * Compute estate-level metadata-quality coverage from a set of table details.
 * Accepts an optional per-table tag-presence lookup and a per-table
 * columnsJson lookup (the persisted column arrays).
 */
export function computeMetadataQualityCoverage(
  details: Array<
    Pick<TableDetail, "fqn" | "comment" | "generatedDescription" | "owner" | "dataTier" | "dataDomain">
  >,
  opts: {
    hasTags?: (fqn: string) => boolean;
    columnsByFqn?: (fqn: string) => string | null | undefined;
  } = {},
): MetadataQualityCoverage {
  const tableCount = details.length;
  let tablesWithComment = 0;
  let tablesWithTags = 0;
  let tablesWithOwner = 0;
  let tablesWithTier = 0;
  let tablesWithDomain = 0;
  let totalColumns = 0;
  let columnsWithComment = 0;

  for (const d of details) {
    if (d.comment || d.generatedDescription) tablesWithComment++;
    if (opts.hasTags?.(d.fqn)) tablesWithTags++;
    if (d.owner) tablesWithOwner++;
    if (d.dataTier) tablesWithTier++;
    if (d.dataDomain) tablesWithDomain++;

    const cols = parseColumns(opts.columnsByFqn?.(d.fqn));
    totalColumns += cols.length;
    columnsWithComment += cols.filter((c) => c.comment && c.comment.trim().length > 0).length;
  }

  return {
    tableCount,
    tablesWithCommentPct: pct(tablesWithComment, tableCount),
    columnsWithCommentPct: pct(columnsWithComment, totalColumns),
    tablesWithTagsPct: pct(tablesWithTags, tableCount),
    tablesWithOwnerPct: pct(tablesWithOwner, tableCount),
    tablesWithTierPct: pct(tablesWithTier, tableCount),
    tablesWithDomainPct: pct(tablesWithDomain, tableCount),
  };
}

/** Count tables by medallion tier (null tier -> unknown bucket). */
export function computeTierDistribution(
  details: Array<Pick<TableDetail, "dataTier">>,
): TierDistribution {
  const dist: TierDistribution = { bronze: 0, silver: 0, gold: 0, system: 0, unknown: 0 };
  for (const d of details) {
    switch (d.dataTier) {
      case "bronze":
        dist.bronze++;
        break;
      case "silver":
        dist.silver++;
        break;
      case "gold":
        dist.gold++;
        break;
      case "system":
        dist.system++;
        break;
      default:
        dist.unknown++;
    }
  }
  return dist;
}

function bandFor(score: number): ReadinessBand {
  if (score >= 70) return "ready";
  if (score >= 40) return "needs_work";
  return "missing";
}

/**
 * Blend a set of tables into a 0-100 readiness score for a domain / data
 * product / canonical entity. Combines:
 *   - documentation coverage (comments)
 *   - ownership coverage
 *   - tier maturity (gold > silver > bronze > unknown)
 *   - governance score (when provided, 0-100 per table)
 *
 * Equal-weighted; missing inputs simply contribute their measured share.
 */
export function computeReadinessScore(
  tableFqns: string[],
  details: Map<
    string,
    Pick<TableDetail, "comment" | "generatedDescription" | "owner" | "dataTier">
  >,
  governanceByFqn?: Map<string, number>,
): ReadinessScore {
  if (tableFqns.length === 0) return { score: 0, band: "missing" };

  const tierWeight: Record<string, number> = {
    gold: 100,
    silver: 70,
    bronze: 40,
    unknown: 10,
  };

  let docSum = 0;
  let ownerSum = 0;
  let tierSum = 0;
  let govSum = 0;
  let govCount = 0;
  let n = 0;

  for (const fqn of tableFqns) {
    const d = details.get(fqn);
    if (!d) continue;
    n++;
    docSum += d.comment || d.generatedDescription ? 100 : 0;
    ownerSum += d.owner ? 100 : 0;
    tierSum += tierWeight[d.dataTier ?? "unknown"] ?? 10;
    const gov = governanceByFqn?.get(fqn);
    if (typeof gov === "number") {
      govSum += gov;
      govCount++;
    }
  }
  if (n === 0) return { score: 0, band: "missing" };

  const docPct = docSum / n;
  const ownerPct = ownerSum / n;
  const tierPct = tierSum / n;
  const components = [docPct, ownerPct, tierPct];
  if (govCount > 0) components.push(govSum / govCount);

  const score = Math.round(components.reduce((a, b) => a + b, 0) / components.length);
  return { score, band: bandFor(score) };
}

export { bandFor as readinessBandForScore };
