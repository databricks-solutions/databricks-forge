/**
 * Source-System Attribution — Phase 3.1
 *
 * Given a set of use cases, their `tablesInvolved` FQNs, an optional
 * `LineageGraph` (from `ForgeTableLineage` / the Estate Scan), and the
 * `TableInfo` list with comments, attribute each use case to a list of
 * canonical source-system names ("Salesforce", "SAP", "Snowflake", …).
 *
 * Strategy:
 *
 *   1. **Upstream root-walk**: BFS upstream via `LineageEdge.targetTableFqn
 *      === current → sourceTableFqn`. Stop on `sourceType === "CONNECTION"`
 *      (Lakehouse Federation foreign table — gold signal for an external
 *      source) or `sourceType === "PATH"` (file source), or when no more
 *      upstream edges exist (table is a root in our graph).
 *   2. **Signal collection**: for each root + the seed table itself, gather
 *      three signals — FQN tokens (catalog / schema / table), the table
 *      `comment`, and the lineage `sourceType`.
 *   3. **Match against `TECH_TO_SYSTEM_MAP`**: produce a canonical
 *      source-system name per signal source. The matcher uses
 *      word-boundary regexes and is intentionally conservative — only
 *      well-known platforms emit an attribution.
 *   4. **Dedup + provenance**: collapse the per-table results into a set
 *      per use case; record which signal types contributed so the UI can
 *      label confidence (`lineage` > `naming` > `comment` > `mixed`).
 *
 * The function is **pure**: no I/O, no Prisma, no LLM. It is unit-tested
 * in `__tests__/domain/source-system-attribution.test.ts`.
 *
 * Designed to also work with `LineageGraph === null` — discovery-only
 * runs without an Estate Scan still get attribution from naming +
 * comments. Origin will simply be `"naming"` / `"comment"` / `"mixed"`
 * with no `"lineage"` contribution.
 */

import type { LineageEdge, LineageGraph, TableInfo, UseCase } from "./types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SourceSystemAttributionInput {
  useCases: Pick<UseCase, "id" | "tablesInvolved">[];
  lineageGraph: LineageGraph | null;
  tables: Pick<TableInfo, "fqn" | "catalog" | "schema" | "tableName" | "comment">[];
  /** Max BFS hops upstream per seed (default 6, safety cap on noisy graphs). */
  maxUpstreamHops?: number;
}

export interface SourceSystemAttributionResult {
  useCaseId: string;
  sourceSystems: string[];
  origin: "lineage" | "naming" | "comment" | "mixed";
}

// ---------------------------------------------------------------------------
// Canonical source-system catalogue
// ---------------------------------------------------------------------------

/**
 * Word-boundary patterns for detecting source systems in FQN tokens and
 * table comments. Order matters — more specific patterns must precede
 * shorter ones (`salesforce` before `sf`). Each pattern emits a single
 * canonical name.
 *
 * Intentionally conservative — patterns must be specific enough to avoid
 * false positives on generic table names like `customer_data` or `fact_*`.
 */
interface SourcePattern {
  /** Canonical name to emit. */
  name: string;
  /** FQN-token patterns: matched against catalog / schema / table tokens. */
  tokenPatterns: RegExp[];
  /** Comment patterns: matched against the table `comment` text. */
  commentPatterns: RegExp[];
}

// Common token noise that should NOT count as a source-system attribution.
// (Layered storage tiers, generic landing zones, etc.)
const TOKEN_NOISE = new Set([
  "bronze",
  "silver",
  "gold",
  "raw",
  "stage",
  "staging",
  "landing",
  "source",
  "main",
  "default",
  "hive_metastore",
  "samples",
  "tpch",
]);

const SOURCE_PATTERNS: readonly SourcePattern[] = [
  // -- CRM / sales ---------------------------------------------------------
  {
    name: "Salesforce",
    tokenPatterns: [/^salesforce$/, /^sfdc$/, /^salesforce_/, /_salesforce$/, /^sfdc_/, /_sfdc$/],
    commentPatterns: [/\bsalesforce\b/i, /\bsfdc\b/i],
  },
  {
    name: "HubSpot",
    tokenPatterns: [/^hubspot$/, /^hubspot_/, /_hubspot$/],
    commentPatterns: [/\bhubspot\b/i],
  },
  {
    name: "Microsoft Dynamics",
    tokenPatterns: [/^dynamics$/, /^msdynamics$/, /^dynamics_/, /^msdyn_/],
    commentPatterns: [/\bdynamics ?365\b/i, /\bmicrosoft dynamics\b/i],
  },
  // -- ERP / finance -------------------------------------------------------
  {
    name: "SAP",
    tokenPatterns: [/^sap$/, /^sap_/, /^s4_/, /^ecc_/, /_sap$/, /^sap4hana$/, /^s4hana_/],
    commentPatterns: [/\bsap\b/i, /\bs\/4 ?hana\b/i, /\bs4hana\b/i],
  },
  {
    name: "Oracle",
    tokenPatterns: [/^oracle$/, /^oracle_/, /^ebs_/, /_oracle$/, /^orcl_/],
    commentPatterns: [/\boracle e-?business suite\b/i, /\boracle ebs\b/i, /\boracle db\b/i],
  },
  {
    name: "NetSuite",
    tokenPatterns: [/^netsuite$/, /^netsuite_/, /^ns_/],
    commentPatterns: [/\bnetsuite\b/i],
  },
  {
    name: "Workday",
    tokenPatterns: [/^workday$/, /^workday_/, /^wd_/, /_workday$/],
    commentPatterns: [/\bworkday\b/i],
  },
  // -- Service / ITSM ------------------------------------------------------
  {
    name: "ServiceNow",
    tokenPatterns: [/^servicenow$/, /^servicenow_/, /^snow_/, /_servicenow$/],
    commentPatterns: [/\bservicenow\b/i],
  },
  {
    name: "Zendesk",
    tokenPatterns: [/^zendesk$/, /^zendesk_/],
    commentPatterns: [/\bzendesk\b/i],
  },
  // -- Marketing -----------------------------------------------------------
  {
    name: "Marketo",
    tokenPatterns: [/^marketo$/, /^marketo_/],
    commentPatterns: [/\bmarketo\b/i],
  },
  {
    name: "Mailchimp",
    tokenPatterns: [/^mailchimp$/, /^mailchimp_/],
    commentPatterns: [/\bmailchimp\b/i],
  },
  // -- Cloud warehouses (treated as upstream sources when federated) -------
  {
    name: "Snowflake",
    tokenPatterns: [/^snowflake$/, /^snowflake_/, /^sf_warehouse_/, /^snow_warehouse_/],
    commentPatterns: [/\bsnowflake\b/i],
  },
  {
    name: "BigQuery",
    tokenPatterns: [/^bigquery$/, /^bigquery_/, /^bq_/, /^gcp_bq_/],
    commentPatterns: [/\bbigquery\b/i, /\bbig ?query\b/i],
  },
  {
    name: "Amazon Redshift",
    tokenPatterns: [/^redshift$/, /^redshift_/, /^rs_/],
    commentPatterns: [/\bredshift\b/i],
  },
  {
    name: "Azure Synapse",
    tokenPatterns: [/^synapse$/, /^synapse_/],
    commentPatterns: [/\bsynapse\b/i, /\bsql data warehouse\b/i],
  },
  {
    name: "Teradata",
    tokenPatterns: [/^teradata$/, /^teradata_/, /^td_/],
    commentPatterns: [/\bteradata\b/i],
  },
  // -- Object storage / data lake ------------------------------------------
  {
    name: "Amazon S3",
    tokenPatterns: [/^s3$/, /^s3_/, /_s3$/, /^aws_s3_/],
    commentPatterns: [/\bamazon s3\b/i, /\bs3 bucket\b/i],
  },
  {
    name: "Azure Data Lake Storage",
    tokenPatterns: [/^adls$/, /^adls_/, /^azure_dl_/, /^abfss_/],
    commentPatterns: [/\badls\b/i, /\bazure data lake\b/i],
  },
  {
    name: "Google Cloud Storage",
    tokenPatterns: [/^gcs$/, /^gcs_/, /^gs_/],
    commentPatterns: [/\bgcs\b/i, /\bgoogle cloud storage\b/i],
  },
  // -- Streaming / event buses --------------------------------------------
  {
    name: "Apache Kafka",
    tokenPatterns: [/^kafka$/, /^kafka_/, /_kafka$/, /^msk_/],
    commentPatterns: [/\bkafka\b/i, /\bconfluent\b/i],
  },
  {
    name: "AWS Kinesis",
    tokenPatterns: [/^kinesis$/, /^kinesis_/, /^kds_/],
    commentPatterns: [/\bkinesis\b/i],
  },
  {
    name: "Azure Event Hubs",
    tokenPatterns: [/^eventhubs?$/, /^eventhubs?_/],
    commentPatterns: [/\bevent ?hubs?\b/i],
  },
  // -- OLTP databases ------------------------------------------------------
  {
    name: "Microsoft SQL Server",
    tokenPatterns: [/^mssql$/, /^mssql_/, /^sqlserver$/, /^sqlserver_/, /^sql_server_/],
    commentPatterns: [/\bsql server\b/i, /\bmssql\b/i],
  },
  {
    name: "PostgreSQL",
    tokenPatterns: [/^postgres$/, /^postgres_/, /^postgresql$/, /^pg_/],
    commentPatterns: [/\bpostgres(?:ql)?\b/i],
  },
  {
    name: "MySQL",
    tokenPatterns: [/^mysql$/, /^mysql_/, /_mysql$/],
    commentPatterns: [/\bmysql\b/i],
  },
  {
    name: "MongoDB",
    tokenPatterns: [/^mongodb$/, /^mongo_/, /^mongodb_/],
    commentPatterns: [/\bmongodb\b/i, /\bmongo db\b/i],
  },
  // -- Lakeflow / Fivetran / Airbyte ingestion hints -----------------------
  // When the catalog is named after the ingestion tool, the *connector
  // subschema* usually tells us the actual source. We attribute via the
  // schema/table tokens; the catalog token alone is ignored here.
  {
    name: "Fivetran",
    tokenPatterns: [/^fivetran$/],
    commentPatterns: [/\bfivetran\b/i],
  },
  {
    name: "Airbyte",
    tokenPatterns: [/^airbyte$/],
    commentPatterns: [/\bairbyte\b/i],
  },
] as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function lower(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

/** Yield non-noise tokens for a table's FQN. Used to feed `tokenPatterns`. */
function tokensForTable(t: Pick<TableInfo, "catalog" | "schema" | "tableName">): string[] {
  return [t.catalog, t.schema, t.tableName]
    .map(lower)
    .filter((tok) => tok.length > 0 && !TOKEN_NOISE.has(tok));
}

/** True iff this lineage source type marks a true external boundary. */
function isExternalSourceType(sourceType: string | null | undefined): boolean {
  if (!sourceType) return false;
  const up = sourceType.toUpperCase();
  return up === "CONNECTION" || up === "PATH" || up === "FILE";
}

/**
 * Build a reverse-edge index: target FQN (lower-cased) → incoming edges.
 * Empty when `lineageGraph` is null.
 */
function buildReverseIndex(
  lineageGraph: LineageGraph | null,
): Map<string, LineageEdge[]> {
  const index = new Map<string, LineageEdge[]>();
  if (!lineageGraph) return index;
  for (const edge of lineageGraph.edges) {
    if (!edge.targetTableFqn || !edge.sourceTableFqn) continue;
    const key = lower(edge.targetTableFqn);
    const existing = index.get(key);
    if (existing) existing.push(edge);
    else index.set(key, [edge]);
  }
  return index;
}

interface UpstreamRoot {
  fqn: string;
  /** True when the edge into this root is a CONNECTION / PATH external boundary. */
  isExternalBoundary: boolean;
}

/**
 * Walk upstream from a seed FQN via the reverse-edge index. Returns a set
 * of root nodes (deepest reachable, capped by `maxHops`). The seed itself
 * is NOT included in the result — caller adds it separately.
 *
 * Roots include nodes with no further upstream edges AND any node reached
 * through an external-boundary edge (CONNECTION / PATH) — those are the
 * gold signal even if the system still records onward edges.
 */
function walkUpstreamRoots(
  seedFqn: string,
  reverseIndex: Map<string, LineageEdge[]>,
  maxHops: number,
): UpstreamRoot[] {
  if (reverseIndex.size === 0) return [];
  const visited = new Set<string>([lower(seedFqn)]);
  const roots: UpstreamRoot[] = [];

  // BFS queue: { fqn, depth }
  let frontier: { fqn: string; depth: number }[] = [{ fqn: seedFqn, depth: 0 }];
  while (frontier.length > 0) {
    const next: { fqn: string; depth: number }[] = [];
    for (const { fqn, depth } of frontier) {
      if (depth >= maxHops) {
        // Treat as a root — we ran out of budget.
        if (depth > 0) roots.push({ fqn, isExternalBoundary: false });
        continue;
      }
      const incoming = reverseIndex.get(lower(fqn)) ?? [];
      if (incoming.length === 0) {
        // True root in the graph (no further upstream).
        if (depth > 0) roots.push({ fqn, isExternalBoundary: false });
        continue;
      }
      for (const edge of incoming) {
        const upstream = edge.sourceTableFqn;
        if (!upstream) continue;
        if (isExternalSourceType(edge.sourceType)) {
          // External boundary — record + stop walking through it.
          if (!visited.has(lower(upstream))) {
            visited.add(lower(upstream));
            roots.push({ fqn: upstream, isExternalBoundary: true });
          }
          continue;
        }
        if (visited.has(lower(upstream))) continue;
        visited.add(lower(upstream));
        next.push({ fqn: upstream, depth: depth + 1 });
      }
    }
    frontier = next;
  }
  return roots;
}

interface SignalHit {
  systemName: string;
  origin: "lineage" | "naming" | "comment";
}

/**
 * Apply pattern matching to a single table's tokens + comment, optionally
 * boosted by lineage context (if the path here crossed an external
 * boundary, the matcher attributes hits to lineage origin).
 */
function matchTableSignals(
  table: Pick<TableInfo, "catalog" | "schema" | "tableName" | "comment">,
  cameFromLineageBoundary: boolean,
): SignalHit[] {
  const tokens = tokensForTable(table);
  const comment = lower(table.comment ?? "");
  const hits: SignalHit[] = [];

  for (const pattern of SOURCE_PATTERNS) {
    // Token match (per-pattern, short-circuit on first hit per pattern).
    let tokenHit = false;
    for (const re of pattern.tokenPatterns) {
      if (tokens.some((tok) => re.test(tok))) {
        tokenHit = true;
        break;
      }
    }
    let commentHit = false;
    if (comment) {
      for (const re of pattern.commentPatterns) {
        if (re.test(comment)) {
          commentHit = true;
          break;
        }
      }
    }
    if (!tokenHit && !commentHit) continue;

    // Prefer lineage > naming > comment when reporting origin.
    const origin: SignalHit["origin"] = cameFromLineageBoundary
      ? "lineage"
      : tokenHit
        ? "naming"
        : "comment";
    hits.push({ systemName: pattern.name, origin });
  }
  return hits;
}

/** Roll up per-table hits into a single per-use-case origin label. */
function rollupOrigin(origins: ReadonlySet<SignalHit["origin"]>): SourceSystemAttributionResult["origin"] {
  const count = origins.size;
  if (count === 0) return "naming"; // Will be filtered out before write
  if (count === 1) {
    const only = [...origins][0]!;
    return only;
  }
  return "mixed";
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/**
 * Attribute source systems to every use case in the input. Returns one
 * result per input use case (including those whose `tablesInvolved` is
 * empty — they get `sourceSystems: []` and are filtered out by callers).
 */
export function attributeSourceSystems(
  input: SourceSystemAttributionInput,
): SourceSystemAttributionResult[] {
  const maxHops = input.maxUpstreamHops ?? 6;
  const tableByFqn = new Map<string, (typeof input.tables)[number]>();
  for (const t of input.tables) tableByFqn.set(lower(t.fqn), t);
  const reverseIndex = buildReverseIndex(input.lineageGraph);

  const results: SourceSystemAttributionResult[] = [];
  for (const uc of input.useCases) {
    const hitsByName = new Map<string, SignalHit["origin"]>();

    for (const seedFqn of uc.tablesInvolved ?? []) {
      const seedTable = tableByFqn.get(lower(seedFqn));
      // 1) Score the seed table itself (FQN tokens + comment).
      if (seedTable) {
        for (const hit of matchTableSignals(seedTable, false)) {
          // Don't downgrade an existing lineage origin to naming/comment.
          const existing = hitsByName.get(hit.systemName);
          if (!existing || (existing !== "lineage" && hit.origin === "lineage")) {
            hitsByName.set(hit.systemName, hit.origin);
          }
        }
      }
      // 2) Walk upstream and score each root.
      const roots = walkUpstreamRoots(seedFqn, reverseIndex, maxHops);
      for (const root of roots) {
        const rootTable = tableByFqn.get(lower(root.fqn));
        // Even if we don't have a TableInfo for the root (lineage walked
        // beyond the scan scope), we can still tokenize the FQN itself.
        const synthetic: Pick<TableInfo, "catalog" | "schema" | "tableName" | "comment"> = rootTable ?? {
          catalog: root.fqn.split(".")[0] ?? "",
          schema: root.fqn.split(".")[1] ?? "",
          tableName: root.fqn.split(".")[2] ?? "",
          comment: null,
        };
        for (const hit of matchTableSignals(synthetic, root.isExternalBoundary)) {
          const existing = hitsByName.get(hit.systemName);
          // Lineage > naming > comment — never downgrade.
          if (
            !existing ||
            (existing !== "lineage" && hit.origin === "lineage") ||
            (existing === "comment" && hit.origin === "naming")
          ) {
            hitsByName.set(hit.systemName, hit.origin);
          }
        }
      }
    }

    // Stable order: by canonical name ascending.
    const sourceSystems = [...hitsByName.keys()].sort();
    const origins = new Set(hitsByName.values());
    results.push({
      useCaseId: uc.id,
      sourceSystems,
      origin: rollupOrigin(origins),
    });
  }
  return results;
}
