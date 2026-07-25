/**
 * V2 Portfolio aggregation — the cross-owner CDO roll-up.
 *
 * ⚠️ ISOLATION EXCEPTION: every read here intentionally spans ALL owners. This
 * module must only ever be reached through `requirePortfolioAccess`
 * (lib/auth/portfolio-guard.ts), which enforces the `FORGE_PORTFOLIO_ENABLED`
 * flag + the org-admin allowlist and activity-logs the access. It reads only
 * METADATA (scores, counts, names, provenance) — never row-level data.
 *
 * The aggregation itself (`aggregatePortfolio`) is a PURE function so it can be
 * unit-tested without a database; `getPortfolioOverview` is the thin Lakebase
 * fetch wrapper that feeds it.
 */

import { withPrisma } from "@/lib/prisma";
import type { EstateScores, EstateValueAtRisk } from "@/lib/domain/estate-synthesis-types";
import type { CanonicalEntity } from "@/lib/domain/types";
import {
  dedupePortfolioEntities,
  type PortfolioEntity,
} from "@/lib/ai/portfolio-synthesis/entity-resolution";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PortfolioProgramRow {
  id: string;
  name: string;
  industryId: string | null;
  ownerEmail: string | null;
  subVertical: string | null;
}

export interface PortfolioScanRow {
  scanId: string;
  programId: string | null;
  ownerEmail: string | null;
  workspaceId: string | null;
  ucPath: string;
  tableCount: number;
  domainCount: number;
  dataProductCount: number;
  piiTablesCount: number;
  avgGovernanceScore: number;
  genieSpaceCount: number;
  dashboardCount: number;
  metricViewCount: number;
  modelCount: number;
  /** Full discovered count from scanSummaryJson; identity rows may be capped. */
  functionCount: number;
  createdAt: string;
  /**
   * Distinct table FQNs discovered by this scan. When present, estate table
   * counts and enterprise totals are computed by de-duplicating identities
   * within each estate (overlapping scopes / re-scans collapse) rather than
   * summing scan headers. Omitted → falls back to `tableCount` (back-compat).
   */
  tableFqns?: string[];
}

export interface PortfolioSynthesisRow {
  /** Stable persistence id used to break equal createdAt ties. */
  id: string;
  estateId: string | null;
  scanId: string | null;
  scoresJson: string | null;
  valueAtRiskJson: string | null;
  createdAt: string;
}

export interface PortfolioDetailIdentityRow {
  id: string;
  scanId: string;
  tableFqn: string;
  dataDomain: string | null;
  isPii: boolean;
}

export type PortfolioAssetKind =
  | "data_product"
  | "model"
  | "function"
  | "genie_space"
  | "dashboard"
  | "metric_view";

export interface PortfolioAssetIdentityRow {
  scanId: string;
  kind: PortfolioAssetKind;
  /** Stable persisted id/FQN/name-derived semantic key. */
  identity: string;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function fqnOf(payload: Record<string, unknown>): string | null {
  const explicit = text(payload.fqn);
  if (explicit) return explicit;
  const catalog = text(payload.catalog);
  const schema = text(payload.schema);
  const name = text(payload.name);
  return catalog && schema && name ? `${catalog}.${schema}.${name}` : name;
}

/**
 * Convert persisted scan insight payloads into stable inventory identities.
 *
 * Identity precedence:
 * - model/function: UC FQN, then name, then stable canonical payload JSON
 * - data product: persisted id, else normalized domain + product/name
 * - Genie/dashboard: Databricks space/dashboard id, then title/display name
 * - metric view: UC FQN, then catalog.schema.name
 */
export function portfolioAssetIdentitiesFromInsight(
  scanId: string,
  insightType: string,
  payloadJson: string,
): PortfolioAssetIdentityRow[] {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(payloadJson) as Record<string, unknown>;
  } catch {
    return [];
  }
  const fallback = stableJson(payload);
  if (insightType === "uc_model" || insightType === "uc_function") {
    return [
      {
        scanId,
        kind: insightType === "uc_model" ? "model" : "function",
        identity: fqnOf(payload) ?? fallback,
      },
    ];
  }
  if (insightType === "data_product") {
    const id = text(payload.id) ?? text(payload.productId);
    const name = text(payload.productName) ?? text(payload.name);
    const domain = text(payload.primaryDomain) ?? text(payload.domain);
    const identity = id ?? (name ? `${domain ? `${domain.toLowerCase()}:` : ""}${name.toLowerCase()}` : fallback);
    return [{ scanId, kind: "data_product", identity }];
  }
  if (insightType !== "asset_discovery") return [];

  const discovery =
    payload.discovery !== null && typeof payload.discovery === "object"
      ? (payload.discovery as Record<string, unknown>)
      : {};
  const rows: PortfolioAssetIdentityRow[] = [];
  const add = (
    kind: PortfolioAssetKind,
    values: unknown,
    identity: (item: Record<string, unknown>) => string | null,
  ) => {
    if (!Array.isArray(values)) return;
    for (const value of values) {
      if (value === null || typeof value !== "object") continue;
      const item = value as Record<string, unknown>;
      rows.push({ scanId, kind, identity: identity(item) ?? stableJson(item) });
    }
  };
  add(
    "genie_space",
    discovery.genieSpaces,
    (item) => text(item.spaceId) ?? text(item.id) ?? text(item.title),
  );
  add(
    "dashboard",
    discovery.dashboards,
    (item) => text(item.dashboardId) ?? text(item.id) ?? text(item.displayName) ?? text(item.title),
  );
  add("metric_view", discovery.metricViews, (item) => fqnOf(item));
  return rows;
}

export interface PortfolioAggregationInput {
  programs: PortfolioProgramRow[];
  scans: PortfolioScanRow[];
  syntheses: PortfolioSynthesisRow[];
  /** Persisted completed-scan detail identities; enables semantic inventory. */
  details?: PortfolioDetailIdentityRow[];
  /** Persisted completed-scan asset identities; enables semantic inventory. */
  assets?: PortfolioAssetIdentityRow[];
}

export interface PortfolioEstateSummary {
  estateId: string;
  /** "program" (an Estate Program) or "standalone" (a scan adopted as an estate-of-one). */
  kind: "program" | "standalone";
  name: string;
  industryId: string | null;
  ownerEmail: string | null;
  workspaceId: string | null;
  scanCount: number;
  tableCount: number;
  scores: EstateScores | null;
  /** Overall readiness 0-100 (from synthesis, else a governance proxy). */
  readiness: number;
  valueAtRiskMid: number;
  lastScannedAt: string | null;
}

export interface EnterpriseInventory {
  estates: number;
  scans: number;
  tables: number;
  domains: number;
  dataProducts: number;
  piiTables: number;
  /** assetType-keyed counts; V2 adds jobs/pipelines/apps as new keys without a schema change. */
  workloads: Record<string, number>;
}

export interface PortfolioOverview {
  estates: PortfolioEstateSummary[];
  inventory: EnterpriseInventory;
  totals: {
    estates: number;
    scans: number;
    tables: number;
    totalValueAtRisk: number;
    avgReadiness: number;
  };
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Pure aggregation
// ---------------------------------------------------------------------------

function safeParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

/** Latest-wins index of syntheses keyed by a selector. */
function latestByKey(
  syntheses: PortfolioSynthesisRow[],
  key: (s: PortfolioSynthesisRow) => string | null,
): Map<string, PortfolioSynthesisRow> {
  const out = new Map<string, PortfolioSynthesisRow>();
  for (const s of syntheses) {
    const k = key(s);
    if (!k) continue;
    const prev = out.get(k);
    const time = new Date(s.createdAt).getTime();
    const previousTime = prev ? new Date(prev.createdAt).getTime() : -Infinity;
    if (!prev || time > previousTime || (time === previousTime && s.id > prev.id)) {
      out.set(k, s);
    }
  }
  return out;
}

/**
 * Aggregate raw estate/scan/synthesis metadata into the portfolio overview.
 *
 * Estate Programs become one estate each (their scans rolled up). Standalone
 * scans (no programId) each become an "estate-of-one" per the V1 migration
 * model so nothing is lost in the portfolio view.
 */
export function aggregatePortfolio(input: PortfolioAggregationInput): PortfolioOverview {
  const { programs, scans, syntheses, details, assets } = input;
  const byEstate = latestByKey(syntheses, (s) => s.estateId);
  const byScan = latestByKey(syntheses, (s) => s.scanId);

  const scansByProgram = new Map<string, PortfolioScanRow[]>();
  const standaloneScans: PortfolioScanRow[] = [];
  const scanById = new Map(scans.map((scan) => [scan.scanId, scan]));
  const estateIdForScan = (scanId: string): string | null => {
    const scan = scanById.get(scanId);
    if (!scan) return null;
    return scan.programId ?? `scan:${scan.scanId}`;
  };
  for (const sc of scans) {
    if (sc.programId) {
      const arr = scansByProgram.get(sc.programId) ?? [];
      arr.push(sc);
      scansByProgram.set(sc.programId, arr);
    } else {
      standaloneScans.push(sc);
    }
  }

  const scoresOf = (synth: PortfolioSynthesisRow | undefined): EstateScores | null =>
    synth ? safeParse<EstateScores | null>(synth.scoresJson, null) : null;
  const varOf = (synth: PortfolioSynthesisRow | undefined): number => {
    const v = synth ? safeParse<EstateValueAtRisk | null>(synth.valueAtRiskJson, null) : null;
    return v?.mid ?? 0;
  };
  // Readiness proxy when no synthesis exists yet: lean on governance coverage.
  const proxyReadiness = (estateScans: PortfolioScanRow[]): number =>
    avg(estateScans.map((s) => s.avgGovernanceScore).filter((n) => n > 0));

  // Estate table count = max(semantic union, largest completed-scan header).
  // The header floor prevents undercount when identity persistence is missing
  // or capped, while max (never sum) avoids re-scan inflation.
  const detailWins = (
    candidate: PortfolioDetailIdentityRow,
    previous: PortfolioDetailIdentityRow,
  ): boolean => {
    const candidateScan = scanById.get(candidate.scanId);
    const previousScan = scanById.get(previous.scanId);
    const candidateTime = candidateScan ? new Date(candidateScan.createdAt).getTime() : 0;
    const previousTime = previousScan ? new Date(previousScan.createdAt).getTime() : 0;
    return (
      candidateTime > previousTime ||
      (candidateTime === previousTime && candidate.scanId > previous.scanId) ||
      (candidateTime === previousTime &&
        candidate.scanId === previous.scanId &&
        candidate.id > previous.id)
    );
  };

  const mergedDetailsByEstate = new Map<string, Map<string, PortfolioDetailIdentityRow>>();
  for (const detail of details ?? []) {
    const estateId = estateIdForScan(detail.scanId);
    if (!estateId) continue;
    const byFqn = mergedDetailsByEstate.get(estateId) ?? new Map();
    const key = detail.tableFqn.toLowerCase();
    const previous = byFqn.get(key);
    if (!previous || detailWins(detail, previous)) byFqn.set(key, detail);
    mergedDetailsByEstate.set(estateId, byFqn);
  }

  const assetSetsByEstate = new Map<string, Map<PortfolioAssetKind, Set<string>>>();
  for (const asset of assets ?? []) {
    const estateId = estateIdForScan(asset.scanId);
    if (!estateId || !asset.identity) continue;
    const byKind = assetSetsByEstate.get(estateId) ?? new Map();
    const identities = byKind.get(asset.kind) ?? new Set<string>();
    identities.add(asset.identity.toLowerCase());
    byKind.set(asset.kind, identities);
    assetSetsByEstate.set(estateId, byKind);
  }

  const estateTableCount = (estateId: string, estateScans: PortfolioScanRow[]): number => {
    const fqns = new Set<string>();
    for (const detail of mergedDetailsByEstate.get(estateId)?.values() ?? []) {
      fqns.add(detail.tableFqn.toLowerCase());
    }
    for (const sc of estateScans) {
      for (const f of sc.tableFqns ?? []) fqns.add(f.toLowerCase());
    }
    return Math.max(fqns.size, ...estateScans.map((scan) => scan.tableCount), 0);
  };

  const estates: PortfolioEstateSummary[] = [];

  for (const p of programs) {
    const estateScans = scansByProgram.get(p.id) ?? [];
    // Prefer an estate-level synthesis; else the latest scan's synthesis.
    const latestScan = [...estateScans].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
        b.scanId.localeCompare(a.scanId),
    )[0];
    const synth = byEstate.get(p.id) ?? (latestScan ? byScan.get(latestScan.scanId) : undefined);
    const scores = scoresOf(synth);
    estates.push({
      estateId: p.id,
      kind: "program",
      name: p.name,
      industryId: p.industryId,
      ownerEmail: p.ownerEmail,
      workspaceId: latestScan?.workspaceId ?? null,
      scanCount: estateScans.length,
      tableCount: estateTableCount(p.id, estateScans),
      scores,
      readiness: scores?.overall ?? proxyReadiness(estateScans),
      valueAtRiskMid: varOf(synth),
      lastScannedAt: latestScan?.createdAt ?? null,
    });
  }

  for (const sc of standaloneScans) {
    const synth = byScan.get(sc.scanId);
    const scores = scoresOf(synth);
    estates.push({
      estateId: `scan:${sc.scanId}`,
      kind: "standalone",
      name: sc.ucPath,
      industryId: null,
      ownerEmail: sc.ownerEmail,
      workspaceId: sc.workspaceId,
      scanCount: 1,
      tableCount: estateTableCount(`scan:${sc.scanId}`, [sc]),
      scores,
      readiness: scores?.overall ?? proxyReadiness([sc]),
      valueAtRiskMid: varOf(synth),
      lastScannedAt: sc.createdAt,
    });
  }

  estates.sort((a, b) => b.readiness - a.readiness);

  // Enterprise inventory is the sum of per-estate
  // max(semantic identity union, largest trustworthy scan header). Identity
  // persistence is intentionally capped for some scan outputs (e.g. 500
  // models/functions), and pipeline scans may have metric-view headers without
  // asset_discovery payloads. The header floor prevents undercount; taking max
  // rather than summing repeated headers prevents overlap/re-scan inflation.
  //
  // Known limitation: when identities are wholly absent for multiple genuinely
  // disjoint member scans, only the largest header is trustworthy without
  // double-counting overlap. The floor therefore remains conservative and may
  // understate the true disjoint union; it will never inflate repeated scans.
  // Identical FQNs/assets in overlapping program scopes or re-scans collapse;
  // standalone estates remain independent and therefore still add.
  const dedupedTables = estates.reduce((s, e) => s + e.tableCount, 0);
  const scansForEstate = (estateId: string): PortfolioScanRow[] =>
    estateId.startsWith("scan:")
      ? scans.filter((scan) => `scan:${scan.scanId}` === estateId)
      : scansByProgram.get(estateId) ?? [];
  const headerFloor = (
    estateId: string,
    select: (scan: PortfolioScanRow) => number,
  ): number => Math.max(0, ...scansForEstate(estateId).map(select));
  const countAcrossEstates = (
    semanticCount: (estateId: string) => number,
    header: (scan: PortfolioScanRow) => number,
  ): number =>
    estates.reduce(
      (total, estate) =>
        total + Math.max(semanticCount(estate.estateId), headerFloor(estate.estateId, header)),
      0,
    );
  const domains = countAcrossEstates(
    (estateId) =>
      new Set(
        [...(mergedDetailsByEstate.get(estateId)?.values() ?? [])]
          .map((detail) => detail.dataDomain?.trim().toLowerCase())
          .filter((domain): domain is string => Boolean(domain)),
      ).size,
    (scan) => scan.domainCount,
  );
  const piiTables = countAcrossEstates(
    (estateId) =>
      [...(mergedDetailsByEstate.get(estateId)?.values() ?? [])].filter(
        (detail) => detail.isPii,
      ).length,
    (scan) => scan.piiTablesCount,
  );
  const countAssets = (
    kind: PortfolioAssetKind,
    header: (scan: PortfolioScanRow) => number,
  ): number =>
    countAcrossEstates(
      (estateId) => assetSetsByEstate.get(estateId)?.get(kind)?.size ?? 0,
      header,
    );
  const inventory: EnterpriseInventory = {
    estates: estates.length,
    scans: scans.length,
    tables: dedupedTables,
    domains,
    dataProducts: countAssets("data_product", (scan) => scan.dataProductCount),
    piiTables,
    workloads: {
      model: countAssets("model", (scan) => scan.modelCount),
      function: countAssets("function", (scan) => scan.functionCount),
      genie_space: countAssets("genie_space", (scan) => scan.genieSpaceCount),
      dashboard: countAssets("dashboard", (scan) => scan.dashboardCount),
      metric_view: countAssets("metric_view", (scan) => scan.metricViewCount),
    },
  };

  return {
    estates,
    inventory,
    totals: {
      estates: estates.length,
      scans: scans.length,
      tables: inventory.tables,
      totalValueAtRisk: estates.reduce((s, e) => s + e.valueAtRiskMid, 0),
      avgReadiness: avg(estates.map((e) => e.readiness)),
    },
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Lakebase fetch wrapper (cross-owner — guarded callers only)
// ---------------------------------------------------------------------------

export async function getPortfolioOverview(): Promise<PortfolioOverview> {
  const input = await withPrisma(async (prisma) => {
    const [programs, scans, syntheses, detailRows, inventoryInsights] = await Promise.all([
      prisma.forgeEstateProgram.findMany({
        select: { id: true, name: true, industryId: true, ownerEmail: true, subVertical: true },
      }),
      prisma.forgeEnvironmentScan.findMany({
        // Portfolio metadata roll-up excludes in-progress/failed checkpoints.
        where: { scanStatus: "complete" },
        select: {
          scanId: true,
          programId: true,
          ownerEmail: true,
          workspaceId: true,
          ucPath: true,
          tableCount: true,
          domainCount: true,
          dataProductCount: true,
          piiTablesCount: true,
          avgGovernanceScore: true,
          genieSpaceCount: true,
          dashboardCount: true,
          metricViewCount: true,
          scanSummaryJson: true,
          createdAt: true,
        },
      }),
      prisma.forgeEstateSynthesis.findMany({
        select: {
          id: true,
          estateId: true,
          scanId: true,
          scoresJson: true,
          valueAtRiskJson: true,
          createdAt: true,
        },
      }),
      // Persisted completed-scan table identities and semantic fields. The pure
      // aggregator selects latest-per-(estate,FQN) before counting domains/PII.
      prisma.forgeTableDetail.findMany({
        where: { scan: { scanStatus: "complete" } },
        select: {
          id: true,
          scanId: true,
          tableFqn: true,
          dataDomain: true,
          sensitivityLevel: true,
        },
      }),
      // Stable workload/data-product identities come from persisted scan
      // insights: UC FQNs, Databricks asset IDs, and semantic payload keys.
      prisma.forgeTableInsight.findMany({
        where: {
          scan: { scanStatus: "complete" },
          insightType: { in: ["uc_model", "uc_function", "data_product", "asset_discovery"] },
        },
        select: { scanId: true, insightType: true, payloadJson: true },
      }),
    ]);

    const fqnsByScan = new Map<string, string[]>();
    for (const d of detailRows) {
      const arr = fqnsByScan.get(d.scanId) ?? [];
      arr.push(d.tableFqn);
      fqnsByScan.set(d.scanId, arr);
    }

    return {
      programs: programs as PortfolioProgramRow[],
      scans: scans.map((s) => {
        const summary = safeParse<{
          assets?: { models?: number; functions?: number };
        } | null>(s.scanSummaryJson, null);
        const { scanSummaryJson: _summary, ...scan } = s;
        return {
          ...scan,
          modelCount: summary?.assets?.models ?? 0,
          functionCount: summary?.assets?.functions ?? 0,
          tableFqns: fqnsByScan.get(s.scanId) ?? [],
          createdAt: s.createdAt.toISOString(),
        };
      }) as PortfolioScanRow[],
      syntheses: syntheses.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
      })) as PortfolioSynthesisRow[],
      details: detailRows.map((detail) => ({
        id: detail.id,
        scanId: detail.scanId,
        tableFqn: detail.tableFqn,
        dataDomain: detail.dataDomain,
        isPii:
          detail.sensitivityLevel === "confidential" ||
          detail.sensitivityLevel === "restricted",
      })),
      assets: inventoryInsights.flatMap((insight) =>
        portfolioAssetIdentitiesFromInsight(
          insight.scanId,
          insight.insightType,
          insight.payloadJson,
        ),
      ),
    } satisfies PortfolioAggregationInput;
  });

  return aggregatePortfolio(input);
}

/**
 * Read every `canonical_entity` insight across ALL owners and map each to a
 * `PortfolioEntity` with its estate provenance, for cross-estate fragmentation
 * analysis. Cross-owner — guarded callers only.
 */
export async function getPortfolioEntities(): Promise<PortfolioEntity[]> {
  return withPrisma(async (prisma) => {
    const insights = await prisma.forgeTableInsight.findMany({
      where: { insightType: "canonical_entity", scan: { scanStatus: "complete" } },
      select: {
        payloadJson: true,
        scan: {
          select: {
            scanId: true,
            programId: true,
            ucPath: true,
            createdAt: true,
            program: { select: { name: true } },
          },
        },
      },
    });

    const raw: Array<PortfolioEntity & { scanCreatedAt: number }> = [];
    for (const ins of insights) {
      let entity: CanonicalEntity;
      try {
        entity = JSON.parse(ins.payloadJson) as CanonicalEntity;
      } catch {
        continue;
      }
      if (!entity?.name) continue;
      const scan = ins.scan;
      const estateId = scan.programId ?? `scan:${scan.scanId}`;
      const estateName = scan.program?.name ?? scan.ucPath;
      raw.push({
        id: `${estateId}:${entity.name}`,
        estateId,
        estateName,
        name: entity.name,
        domain: entity.domain ?? "",
        description: entity.description ?? "",
        tableCount: Array.isArray(entity.tables) ? entity.tables.length : 0,
        scanCreatedAt: scan.createdAt.getTime(),
      });
    }
    // Collapse within-estate duplicates (latest semantic record wins) BEFORE
    // cross-estate clustering, so fragmentation counts distinct estates.
    return dedupePortfolioEntities(raw);
  });
}
