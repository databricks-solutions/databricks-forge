/**
 * Build the C-level estate tree (Workstream D) from an aggregate estate view.
 *
 * Hierarchy: company -> domain -> canonical entity -> table. Domains come from
 * the per-table `dataDomain`; canonical entities + their table membership come
 * from the `canonical_entity` insights (Workstream B ontology). Tables not
 * claimed by any entity are grouped under a synthetic "Ungrouped tables"
 * entity within their domain so nothing is lost.
 *
 * Pure / deterministic — safe to run client-side from the aggregate payload.
 */

import type { CanonicalEntity, DataTier } from "@/lib/domain/types";

export interface EstateTreeTable {
  fqn: string;
  tableName: string;
  tier: DataTier | null;
  domain: string | null;
  hasComment: boolean;
  owner: string | null;
  governanceScore: number | null;
}

export interface EstateTreeEntity {
  name: string;
  description: string;
  readinessScore: number | null;
  readiness: "ready" | "needs_work" | "missing" | null;
  tables: EstateTreeTable[];
}

export interface EstateTreeDomain {
  domain: string;
  tableCount: number;
  entities: EstateTreeEntity[];
}

export interface EstateTree {
  domains: EstateTreeDomain[];
  tableCount: number;
  entityCount: number;
  unassignedTableCount: number;
}

/** Minimal shape of an aggregate `details` row (serialised). */
export interface AggregateDetailRow {
  tableFqn?: string;
  fqn?: string;
  tableName?: string;
  dataDomain?: string | null;
  dataTier?: string | null;
  comment?: string | null;
  generatedDescription?: string | null;
  owner?: string | null;
  governanceScore?: number | null;
}

/** Minimal shape of an aggregate `insights` row (serialised). */
export interface AggregateInsightRow {
  insightType: string;
  payloadJson: string;
}

const UNGROUPED = "Ungrouped tables";
const UNCATEGORISED = "Uncategorised";

function detailFqn(d: AggregateDetailRow): string {
  return (d.tableFqn ?? d.fqn ?? "").toString();
}

function shortName(fqn: string): string {
  const parts = fqn.split(".");
  return parts.length >= 3 ? parts.slice(2).join(".") : fqn;
}

function toTreeTable(d: AggregateDetailRow): EstateTreeTable {
  const fqn = detailFqn(d);
  return {
    fqn,
    tableName: d.tableName ?? shortName(fqn),
    tier: (d.dataTier ?? null) as DataTier | null,
    domain: d.dataDomain ?? null,
    hasComment: Boolean(d.comment || d.generatedDescription),
    owner: d.owner ?? null,
    governanceScore: typeof d.governanceScore === "number" ? d.governanceScore : null,
  };
}

/**
 * Assemble the estate tree. `entities` are parsed `canonical_entity` insight
 * payloads; pass an empty array when the ontology pass produced none (the tree
 * then degrades gracefully to domain -> ungrouped -> table).
 */
export function buildEstateTree(
  details: AggregateDetailRow[],
  entities: CanonicalEntity[],
): EstateTree {
  const tableByFqn = new Map<string, EstateTreeTable>();
  for (const d of details) {
    const t = toTreeTable(d);
    if (t.fqn) tableByFqn.set(t.fqn.toLowerCase(), t);
  }

  const claimed = new Set<string>();
  // domain -> entity name -> entity
  const domainMap = new Map<string, Map<string, EstateTreeEntity>>();

  const ensureDomain = (domain: string) => {
    let m = domainMap.get(domain);
    if (!m) {
      m = new Map();
      domainMap.set(domain, m);
    }
    return m;
  };

  // Place canonical entities first.
  for (const e of entities) {
    const tables: EstateTreeTable[] = [];
    for (const fqn of e.tables) {
      const t = tableByFqn.get(fqn.toLowerCase());
      if (t) {
        tables.push(t);
        claimed.add(fqn.toLowerCase());
      }
    }
    if (tables.length === 0) continue;
    const domain = e.domain || UNCATEGORISED;
    const entityMap = ensureDomain(domain);
    entityMap.set(e.name, {
      name: e.name,
      description: e.description ?? "",
      readinessScore: typeof e.readinessScore === "number" ? e.readinessScore : null,
      readiness: e.readiness ?? null,
      tables,
    });
  }

  // Place any unclaimed tables under an "Ungrouped tables" entity per domain.
  let unassigned = 0;
  for (const [fqnLower, t] of tableByFqn) {
    if (claimed.has(fqnLower)) continue;
    unassigned++;
    const domain = t.domain || UNCATEGORISED;
    const entityMap = ensureDomain(domain);
    let ungrouped = entityMap.get(UNGROUPED);
    if (!ungrouped) {
      ungrouped = {
        name: UNGROUPED,
        description: "Tables not yet grouped into a canonical entity.",
        readinessScore: null,
        readiness: null,
        tables: [],
      };
      entityMap.set(UNGROUPED, ungrouped);
    }
    ungrouped.tables.push(t);
  }

  const domains: EstateTreeDomain[] = Array.from(domainMap.entries())
    .map(([domain, entityMap]) => {
      const entities = Array.from(entityMap.values()).sort((a, b) =>
        a.name === UNGROUPED ? 1 : b.name === UNGROUPED ? -1 : a.name.localeCompare(b.name),
      );
      const tableCount = entities.reduce((s, e) => s + e.tables.length, 0);
      return { domain, entities, tableCount };
    })
    .sort((a, b) => b.tableCount - a.tableCount);

  const entityCount = domains.reduce(
    (s, d) => s + d.entities.filter((e) => e.name !== UNGROUPED).length,
    0,
  );

  return {
    domains,
    tableCount: tableByFqn.size,
    entityCount,
    unassignedTableCount: unassigned,
  };
}

/** Parse `canonical_entity` insight payloads from an aggregate insights array. */
export function parseCanonicalEntities(insights: AggregateInsightRow[]): CanonicalEntity[] {
  const out: CanonicalEntity[] = [];
  for (const ins of insights) {
    if (ins.insightType !== "canonical_entity") continue;
    try {
      out.push(JSON.parse(ins.payloadJson) as CanonicalEntity);
    } catch {
      // skip malformed
    }
  }
  return out;
}
