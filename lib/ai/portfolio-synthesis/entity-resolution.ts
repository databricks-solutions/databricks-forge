/**
 * Cross-team entity resolution for the V2 Portfolio fragmentation analysis.
 *
 * Each estate's V1 ontology pass emits `canonical_entity` insights (e.g.
 * "Customer", "Well", "Cargo"). At portfolio scope the same business entity is
 * frequently modelled independently in different estates — that fragmentation
 * is exactly what a CDO needs to see. This module clusters per-estate entities
 * into cross-estate groups.
 *
 * Strategy (matches plan §11.5): embeddings-based with a name-normalisation
 * fallback. The `embed` function is injected so the pure clustering logic is
 * unit-testable without the model-serving endpoint; when no embedder is
 * provided (or it fails) we fall back to normalised-name grouping alone.
 */

export interface PortfolioEntity {
  /** Stable id, e.g. `${estateId}:${name}`. */
  id: string;
  estateId: string;
  estateName: string;
  name: string;
  domain: string;
  description: string;
  tableCount: number;
}

export interface EntityCluster {
  /** Display label (the most common normalised name in the cluster). */
  label: string;
  members: PortfolioEntity[];
  /** Distinct estates that independently model this entity. */
  estates: string[];
  /** True when >1 estate models the same entity (the fragmentation signal). */
  fragmented: boolean;
  totalTables: number;
}

export interface EntityResolutionDeps {
  /** Returns one embedding vector per input text (same order). */
  embed?: (texts: string[]) => Promise<number[][]>;
  /** Cosine-similarity threshold for the embedding clusterer (default 0.82). */
  threshold?: number;
}

/** Normalise an entity name to a comparison key (singularised, alnum-only). */
export function normaliseEntityName(name: string): string {
  let n = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  // Drop common qualifier tokens that don't change the entity identity.
  n = n.replace(/\b(master|dim|dimension|fact|table|data|the|a|an)\b/g, " ").replace(/\s+/g, " ").trim();
  // Naive singularisation of the final token.
  const parts = n.split(" ").filter(Boolean);
  if (parts.length) {
    const last = parts[parts.length - 1];
    parts[parts.length - 1] = last
      .replace(/ies$/, "y")
      .replace(/ses$/, "s")
      .replace(/s$/, "");
  }
  return parts.join(" ");
}

/**
 * De-duplicate canonical entities WITHIN each estate before cross-estate
 * clustering. The same business entity is frequently re-emitted across a
 * program's member scans (overlapping scopes, re-scans); collapsing them by
 * `(estateId, normalized name)` and keeping the LATEST semantic record ensures
 * the fragmentation signal reflects distinct ESTATES, not scan multiplicity.
 *
 * Latest wins by `scanCreatedAt`; ties break on the larger table footprint then
 * the higher id for determinism.
 */
export function dedupePortfolioEntities(
  entities: Array<PortfolioEntity & { scanCreatedAt: number }>,
): PortfolioEntity[] {
  const best = new Map<string, PortfolioEntity & { scanCreatedAt: number }>();
  for (const e of entities) {
    const key = `${e.estateId}\u0000${normaliseEntityName(e.name) || e.name.toLowerCase()}`;
    const prev = best.get(key);
    if (
      !prev ||
      e.scanCreatedAt > prev.scanCreatedAt ||
      (e.scanCreatedAt === prev.scanCreatedAt && e.tableCount > prev.tableCount) ||
      (e.scanCreatedAt === prev.scanCreatedAt && e.tableCount === prev.tableCount && e.id > prev.id)
    ) {
      best.set(key, e);
    }
  }
  return [...best.values()].map(({ scanCreatedAt: _drop, ...rest }) => rest);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function buildCluster(members: PortfolioEntity[]): EntityCluster {
  // Label = most frequent normalised name, displayed from its first member.
  const freq = new Map<string, { count: number; display: string }>();
  for (const m of members) {
    const key = normaliseEntityName(m.name) || m.name.toLowerCase();
    const cur = freq.get(key) ?? { count: 0, display: m.name };
    cur.count += 1;
    freq.set(key, cur);
  }
  const label = [...freq.entries()].sort((a, b) => b[1].count - a[1].count)[0]?.[1].display ?? members[0].name;
  // Distinct estates (by id), displayed by name, that independently model this entity.
  const estateNames = new Map<string, string>();
  for (const m of members) estateNames.set(m.estateId, m.estateName);
  const estates = [...estateNames.values()];
  return {
    label,
    members,
    estates,
    fragmented: estateNames.size > 1,
    totalTables: members.reduce((s, m) => s + m.tableCount, 0),
  };
}

/** Group purely by normalised name (the deterministic fallback). */
function clusterByName(entities: PortfolioEntity[]): EntityCluster[] {
  const groups = new Map<string, PortfolioEntity[]>();
  for (const e of entities) {
    const key = normaliseEntityName(e.name) || e.name.toLowerCase();
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }
  return [...groups.values()].map(buildCluster);
}

/**
 * Cluster entities by embedding similarity, then merge any singletons that
 * share a normalised name (so the name fallback always applies on top).
 * Greedy single-linkage over the similarity threshold — fine for the scale of
 * a portfolio's distinct entities.
 */
function clusterByEmbedding(
  entities: PortfolioEntity[],
  vectors: number[][],
  threshold: number,
): EntityCluster[] {
  const n = entities.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sameName = normaliseEntityName(entities[i].name) === normaliseEntityName(entities[j].name);
      if (sameName || cosine(vectors[i], vectors[j]) >= threshold) {
        union(i, j);
      }
    }
  }

  const byRoot = new Map<number, PortfolioEntity[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const arr = byRoot.get(r) ?? [];
    arr.push(entities[i]);
    byRoot.set(r, arr);
  }
  return [...byRoot.values()].map(buildCluster);
}

export async function resolveEntityClusters(
  entities: PortfolioEntity[],
  deps: EntityResolutionDeps = {},
): Promise<EntityCluster[]> {
  if (entities.length === 0) return [];

  let clusters: EntityCluster[];
  if (deps.embed) {
    try {
      const vectors = await deps.embed(
        entities.map((e) => `${e.name} — ${e.domain}: ${e.description}`.slice(0, 512)),
      );
      if (vectors.length === entities.length && vectors.every((v) => v.length > 0)) {
        clusters = clusterByEmbedding(entities, vectors, deps.threshold ?? 0.82);
      } else {
        clusters = clusterByName(entities);
      }
    } catch {
      clusters = clusterByName(entities);
    }
  } else {
    clusters = clusterByName(entities);
  }

  // Fragmented (multi-team) clusters first, then by table footprint.
  return clusters.sort((a, b) => {
    if (a.fragmented !== b.fragmented) return a.fragmented ? -1 : 1;
    return b.totalTables - a.totalTables;
  });
}
