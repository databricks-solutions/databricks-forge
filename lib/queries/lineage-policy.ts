/**
 * Lineage policy — guards against lineage walks fanning out across the entire
 * metastore.
 *
 * Some catalogs (notably Databricks `samples`, e.g. `samples.bakehouse`) are
 * shared, public datasets that hundreds of demo / course / workshop catalogs
 * read FROM. A downstream lineage walk seeded from such a table discovers every
 * consumer across the whole metastore, blowing scan scope far beyond what the
 * user targeted. We therefore refuse to use tables in these catalogs as lineage
 * seeds.
 */

const DEFAULT_SHARED_CATALOGS = ["samples"];

/**
 * Catalogs whose tables must never be used as lineage seeds. Defaults to
 * `samples`; override via `FORGE_LINEAGE_SHARED_CATALOGS` (comma-separated).
 */
export function sharedSampleCatalogs(): Set<string> {
  const raw = process.env.FORGE_LINEAGE_SHARED_CATALOGS;
  const list = raw
    ? raw
        .split(",")
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean)
    : DEFAULT_SHARED_CATALOGS;
  return new Set(list);
}

/** Extract the catalog (first FQN segment) from a table FQN, lowercased. */
function catalogOf(fqn: string): string {
  return (fqn.split(".")[0] ?? "").toLowerCase();
}

/**
 * Split lineage seed tables into those safe to walk from and those skipped
 * because they live in a shared sample catalog.
 */
export function partitionLineageSeeds(seeds: string[]): {
  walkable: string[];
  skipped: string[];
} {
  const denylist = sharedSampleCatalogs();
  const walkable: string[] = [];
  const skipped: string[] = [];
  for (const fqn of seeds) {
    if (denylist.has(catalogOf(fqn))) {
      skipped.push(fqn);
    } else {
      walkable.push(fqn);
    }
  }
  return { walkable, skipped };
}
