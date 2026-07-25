/**
 * Pure derivation for the estate Relationships view.
 *
 * Takes raw table-to-table edges (lineage + inferred FK relationships) plus a
 * domain map and tags each edge with cross-boundary flags: does it cross a
 * catalog, a schema, or a business domain? Cross-boundary edges are the ones a
 * data architect cares about — they reveal coupling, undocumented dependencies,
 * and domains that aren't as self-contained as they look on the bubble map.
 *
 * No DB / network here so the flagging + summary maths are unit-testable.
 */

import { catalogOf, schemaOf } from "@/lib/environment/domain-explorer";
import {
  mergeInsights,
  normalizeSemanticName,
  type MergeableInsight,
} from "@/lib/environment/insight-merge";

export type EdgeVia = "lineage" | "foreign_key" | "inferred" | "relationship";

export interface RawEdge {
  source: string;
  target: string;
  via: EdgeVia;
  /** Supporting event/link count, when known. */
  weight?: number;
}

export interface DerivedEdge extends RawEdge {
  sourceDomain: string | null;
  targetDomain: string | null;
  crossCatalog: boolean;
  crossSchema: boolean;
  crossDomain: boolean;
}

export interface RelationshipSummary {
  total: number;
  crossCatalog: number;
  crossSchema: number;
  crossDomain: number;
  /** Distinct table FQNs that participate in at least one edge. */
  connectedTables: number;
}

function domainOf(map: Map<string, string | null>, fqn: string): string | null {
  const v = map.get(fqn);
  return v && v.trim() ? v : null;
}

/** Tag each edge with cross-catalog / cross-schema / cross-domain flags. */
export function deriveEdges(
  edges: RawEdge[],
  domainByFqn: Map<string, string | null>,
): DerivedEdge[] {
  return edges.map((e) => {
    const sourceDomain = domainOf(domainByFqn, e.source);
    const targetDomain = domainOf(domainByFqn, e.target);
    return {
      ...e,
      sourceDomain,
      targetDomain,
      crossCatalog: catalogOf(e.source) !== catalogOf(e.target),
      crossSchema: schemaOf(e.source) !== schemaOf(e.target),
      // Only a *known* cross-domain (both ends classified, and different).
      crossDomain: !!sourceDomain && !!targetDomain && sourceDomain !== targetDomain,
    };
  });
}

export function summarize(edges: DerivedEdge[]): RelationshipSummary {
  const connected = new Set<string>();
  let crossCatalog = 0;
  let crossSchema = 0;
  let crossDomain = 0;
  for (const e of edges) {
    connected.add(e.source);
    connected.add(e.target);
    if (e.crossCatalog) crossCatalog++;
    if (e.crossSchema) crossSchema++;
    if (e.crossDomain) crossDomain++;
  }
  return {
    total: edges.length,
    crossCatalog,
    crossSchema,
    crossDomain,
    connectedTables: connected.size,
  };
}

function normalizeVia(via: unknown): EdgeVia {
  if (via === "foreign_key" || via === "inferred" || via === "relationship") return via;
  return "lineage";
}

export interface RelationshipGraphInputs {
  /** Table-to-table lineage edges (raw, possibly from many scans). */
  lineage: Array<{
    sourceTableFqn: string;
    targetTableFqn: string;
    eventCount?: number | null;
  }>;
  /** `canonical_entity` insight payloads (entity name → tables). */
  canonicalEntities: Array<{ payloadJson: string }>;
  /** `entity_relationship` insight payloads (entity → entity edges). */
  entityRelationships: Array<{ payloadJson: string }>;
  /** Domain map (override-aware) keyed by table FQN. */
  domainByFqn: Map<string, string | null>;
  maxEdges?: number;
}

export interface RelationshipGraphResult {
  summary: RelationshipSummary;
  edges: DerivedEdge[];
  truncated: boolean;
}

export type ProgramRelationshipRow = {
  kind: "detail" | "canonical_entity" | "entity_relationship";
  id: string;
  scanId: string;
  scanCreatedAt: number;
  tableFqn: string | null;
  dataDomain: string | null;
  payloadJson: string | null;
};

export interface MergedProgramRelationshipInputs {
  details: Array<{ tableFqn: string; dataDomain: string | null }>;
  canonicalEntities: Array<{ payloadJson: string }>;
  entityRelationships: Array<{ payloadJson: string }>;
}

function winsLatest(a: ProgramRelationshipRow, b: ProgramRelationshipRow): boolean {
  return (
    a.scanCreatedAt > b.scanCreatedAt ||
    (a.scanCreatedAt === b.scanCreatedAt && a.scanId > b.scanId) ||
    (a.scanCreatedAt === b.scanCreatedAt && a.scanId === b.scanId && a.id > b.id)
  );
}

/**
 * Deterministically merge the raw rows used by the program Relationships API.
 *
 * - Table domains use latest completed scan per FQN, with scan id then row id
 *   tie-breakers. This matches aggregate latest-per-table semantics while
 *   removing PostgreSQL/Prisma result-order dependence.
 * - Canonical entities use the same semantic merge as the aggregate estate:
 *   normalized entity name + estate, latest scan wins.
 * - Entity relationships retain distinct semantic payloads while exact repeats
 *   across re-scans collapse.
 */
export function mergeProgramRelationshipInputs(
  programId: string,
  rows: ProgramRelationshipRow[],
): MergedProgramRelationshipInputs {
  const details = new Map<string, ProgramRelationshipRow>();
  for (const row of rows) {
    if (row.kind !== "detail" || !row.tableFqn) continue;
    const previous = details.get(row.tableFqn);
    if (!previous || winsLatest(row, previous)) details.set(row.tableFqn, row);
  }

  const mergeInsightKind = (kind: "canonical_entity" | "entity_relationship") => {
    const candidates: MergeableInsight[] = rows
      .filter((row) => row.kind === kind && row.payloadJson !== null)
      .map((row) => ({
        id: row.id,
        insightType: kind,
        tableFqn: null,
        payloadJson: row.payloadJson!,
        estateId: programId,
        scanCreatedAt: row.scanCreatedAt,
      }));
    return mergeInsights(candidates)
      .sort((a, b) => {
        if (kind === "canonical_entity") {
          const nameOf = (value: string): string => {
            try {
              const parsed = JSON.parse(value) as { name?: unknown };
              return typeof parsed.name === "string"
                ? normalizeSemanticName(parsed.name)
                : value;
            } catch {
              return value;
            }
          };
          return nameOf(a.payloadJson).localeCompare(nameOf(b.payloadJson)) || a.id.localeCompare(b.id);
        }
        return a.payloadJson.localeCompare(b.payloadJson) || a.id.localeCompare(b.id);
      })
      .map(({ payloadJson }) => ({ payloadJson }));
  };

  return {
    details: [...details.values()]
      .sort((a, b) => a.tableFqn!.localeCompare(b.tableFqn!))
      .map((row) => ({ tableFqn: row.tableFqn!, dataDomain: row.dataDomain })),
    canonicalEntities: mergeInsightKind("canonical_entity"),
    entityRelationships: mergeInsightKind("entity_relationship"),
  };
}

/**
 * Build the estate Relationships graph from raw lineage + ontology insights and
 * an (override-aware) domain map. Pure so both the per-scan and the program-
 * aware (multi-scan) routes can share exactly one derivation — the program
 * route simply passes the merged lineage/insights/domain map from ALL completed
 * member scans.
 */
export function buildRelationshipGraph(input: RelationshipGraphInputs): RelationshipGraphResult {
  const maxEdges = input.maxEdges ?? 1000;

  const rawEdges: RawEdge[] = input.lineage.map((l) => ({
    source: l.sourceTableFqn,
    target: l.targetTableFqn,
    via: "lineage" as EdgeVia,
    weight: l.eventCount ?? undefined,
  }));

  // Map each canonical entity to its representative tables.
  const entityTables = new Map<string, string[]>();
  for (const e of input.canonicalEntities) {
    try {
      const ent = JSON.parse(e.payloadJson);
      if (typeof ent?.name === "string" && Array.isArray(ent.tables)) {
        entityTables.set(normalizeSemanticName(ent.name), ent.tables);
      }
    } catch {
      /* skip malformed */
    }
  }
  for (const r of input.entityRelationships) {
    try {
      const rel = JSON.parse(r.payloadJson);
      const src =
        typeof rel?.sourceEntity === "string"
          ? entityTables.get(normalizeSemanticName(rel.sourceEntity))?.[0]
          : undefined;
      const tgt =
        typeof rel?.targetEntity === "string"
          ? entityTables.get(normalizeSemanticName(rel.targetEntity))?.[0]
          : undefined;
      if (src && tgt) {
        rawEdges.push({
          source: src,
          target: tgt,
          via: normalizeVia(rel?.via),
          weight: typeof rel?.edgeCount === "number" ? rel.edgeCount : 1,
        });
      }
    } catch {
      /* skip malformed */
    }
  }

  const deduped = dedupeEdges(
    [...rawEdges].sort(
      (a, b) =>
        a.source.localeCompare(b.source) ||
        a.target.localeCompare(b.target) ||
        a.via.localeCompare(b.via) ||
        (b.weight ?? 0) - (a.weight ?? 0),
    ),
  );
  const derived = deriveEdges(deduped, input.domainByFqn);
  const summary = summarize(derived);

  // Most-interesting first: cross-domain, then cross-catalog, then weight.
  derived.sort((a, b) => {
    const score = (e: typeof a) =>
      (e.crossDomain ? 4 : 0) + (e.crossCatalog ? 2 : 0) + (e.crossSchema ? 1 : 0);
    return (
      score(b) - score(a) ||
      (b.weight ?? 0) - (a.weight ?? 0) ||
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target) ||
      a.via.localeCompare(b.via)
    );
  });

  return {
    summary,
    edges: derived.slice(0, maxEdges),
    truncated: derived.length > maxEdges,
  };
}

/**
 * De-duplicate undirected duplicate edges (A→B and B→A collapse) while keeping
 * the highest weight and preferring an FK/inferred `via` over plain lineage.
 * Self-edges (A→A) are dropped.
 */
export function dedupeEdges(edges: RawEdge[]): RawEdge[] {
  const viaRank: Record<EdgeVia, number> = {
    foreign_key: 3,
    inferred: 2,
    relationship: 2,
    lineage: 1,
  };
  const map = new Map<string, RawEdge>();
  for (const e of edges) {
    if (e.source === e.target) continue;
    const key = [e.source, e.target].sort().join("\u0000");
    const existing = map.get(key);
    if (!existing) {
      map.set(key, e);
      continue;
    }
    const better =
      (e.weight ?? 0) > (existing.weight ?? 0) || viaRank[e.via] > viaRank[existing.via];
    if (better) map.set(key, { ...e, weight: Math.max(e.weight ?? 0, existing.weight ?? 0) });
  }
  return [...map.values()];
}
