/**
 * Estate Ontology pass (Workstream B).
 *
 * Runs AFTER the core intelligence layer. Synthesises canonical business
 * entities (Well, Cargo, Trade, ...) from the physical tables using one LLM
 * call grounded in the already-computed domains and tiers, then derives
 * entity-level relationships deterministically from foreign keys, implicit
 * relationships, and lineage edges, and scores each entity's readiness.
 *
 * This is the layer the C-level Estate Overview renders as
 * domain -> data product -> canonical entity -> table. Best-effort: any
 * failure returns an empty ontology so the scan still completes.
 */

import { chatCompletion } from "@/lib/dbx/model-serving";
import { formatPrompt } from "@/lib/ai/templates";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { computeReadinessScore } from "@/lib/domain/estate-readiness";
import { buildEstateContextBlock } from "@/lib/ai/estate-context";
import type { ScopedLogger } from "@/lib/logger";
import type {
  CanonicalEntity,
  EntityRelationship,
  BusinessGlossaryTerm,
  EstateOntology,
  DataDomain,
  DataProduct,
  ImplicitRelationship,
  ForeignKey,
  LineageGraph,
  TableDetail,
  DataTier,
} from "@/lib/domain/types";

export interface OntologyInput {
  /** Per-table detail (tier, domain, owner, comment) keyed by FQN. */
  details: TableDetail[];
  domains: DataDomain[];
  dataProducts: DataProduct[];
  implicitRelationships: ImplicitRelationship[];
  foreignKeys: ForeignKey[];
  lineageGraph: LineageGraph;
  /** fqn -> governance score (0-100), when available. */
  governanceByFqn?: Map<string, number>;
}

export interface OntologyOptions {
  endpoint: string;
  log: ScopedLogger;
  businessName?: string;
  industryId?: string;
  subVertical?: string;
  /** Used only as transient prompt grounding; not copied onto scan rows. */
  orgContext?: string;
}

const TEMPERATURE = 0.2;
const MAX_TABLES_FOR_PROMPT = 600;

interface LLMEntity {
  name: string;
  domain?: string;
  description?: string;
  tables?: string[];
}

/** Map each table FQN to the canonical entity it was assigned to. */
function buildTableToEntity(entities: CanonicalEntity[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of entities) {
    for (const t of e.tables) m.set(t.toLowerCase(), e.name);
  }
  return m;
}

/**
 * Derive entity-to-entity relationships from the table-level signals. Edges
 * between tables that belong to the SAME entity are dropped (intra-entity).
 */
function deriveRelationships(
  entities: CanonicalEntity[],
  input: OntologyInput,
): EntityRelationship[] {
  const tableToEntity = buildTableToEntity(entities);
  // key: "source||target||via" -> count
  const counts = new Map<string, { source: string; target: string; via: EntityRelationship["via"]; count: number }>();

  const add = (
    sourceFqn: string,
    targetFqn: string,
    via: EntityRelationship["via"],
  ) => {
    const s = tableToEntity.get(sourceFqn.toLowerCase());
    const t = tableToEntity.get(targetFqn.toLowerCase());
    if (!s || !t || s === t) return;
    // Normalise direction for FK/implicit (directional) vs lineage (directional too).
    const key = `${s}||${t}||${via}`;
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { source: s, target: t, via, count: 1 });
  };

  for (const fk of input.foreignKeys) add(fk.tableFqn, fk.referencedTableFqn, "foreign_key");
  for (const r of input.implicitRelationships) add(r.sourceTableFqn, r.targetTableFqn, "inferred");
  for (const e of input.lineageGraph.edges) add(e.sourceTableFqn, e.targetTableFqn, "lineage");

  return Array.from(counts.values()).map((c) => ({
    sourceEntity: c.source,
    targetEntity: c.target,
    via: c.via,
    edgeCount: c.count,
  }));
}

function computeTierMix(
  tables: string[],
  detailByFqn: Map<string, TableDetail>,
): Partial<Record<DataTier, number>> {
  const mix: Partial<Record<DataTier, number>> = {};
  for (const fqn of tables) {
    const tier = (detailByFqn.get(fqn)?.dataTier ?? "unknown") as DataTier;
    mix[tier] = (mix[tier] ?? 0) + 1;
  }
  return mix;
}

/** Render a compact table line for the entity-synthesis prompt. */
function renderTableLine(d: TableDetail): string {
  const tier = d.dataTier ?? "unknown";
  const domain = d.dataDomain ?? "?";
  return `- ${d.fqn} [domain=${domain}, tier=${tier}]`;
}

export async function runEstateOntology(
  input: OntologyInput,
  options: OntologyOptions,
): Promise<EstateOntology> {
  const empty: EstateOntology = { entities: [], relationships: [], glossary: [] };
  const detailByFqn = new Map(input.details.map((d) => [d.fqn, d]));

  if (input.details.length === 0) return empty;

  // Build the prompt (cap tables to keep within budget; large estates still
  // get a representative ontology -- entity grouping generalises).
  const tablesForPrompt = input.details.slice(0, MAX_TABLES_FOR_PROMPT);
  const domainSummary =
    input.domains.length > 0
      ? `Business domains in scope: ${[...new Set(input.domains.map((d) => d.domain))].join(", ")}`
      : "";

  const entities: CanonicalEntity[] = [];
  let glossary: BusinessGlossaryTerm[] = [];

  try {
    const prompt = formatPrompt("ENV_CANONICAL_ENTITIES_PROMPT", {
      table_list: tablesForPrompt.map(renderTableLine).join("\n"),
      domain_summary: domainSummary,
      estate_context: buildEstateContextBlock(options),
    });

    const response = await chatCompletion({
      endpoint: options.endpoint,
      messages: [{ role: "user", content: prompt }],
      temperature: TEMPERATURE,
      maxTokens: 65536,
    });

    const parsed = parseLLMJson(response.content, "estate-ontology:entities") as {
      entities?: LLMEntity[];
      glossary?: BusinessGlossaryTerm[];
    };

    const knownFqns = new Set(input.details.map((d) => d.fqn.toLowerCase()));
    for (const e of parsed.entities ?? []) {
      if (!e.name) continue;
      // Keep only tables the scan actually has (strip hallucinations).
      const tables = (e.tables ?? []).filter((t) => knownFqns.has(t.toLowerCase()));
      if (tables.length === 0) continue;
      const readiness = computeReadinessScore(tables, detailByFqn, input.governanceByFqn);
      entities.push({
        name: e.name,
        domain: e.domain ?? "Uncategorised",
        description: e.description ?? "",
        tables,
        tierMix: computeTierMix(tables, detailByFqn),
        readinessScore: readiness.score,
        readiness: readiness.band,
      });
    }
    glossary = Array.isArray(parsed.glossary) ? parsed.glossary.slice(0, 20) : [];
  } catch (error) {
    options.log.warn("Estate ontology entity synthesis failed (non-fatal)", {
      fn: "runEstateOntology",
      errorCategory: "ontology_synthesis_failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return empty;
  }

  if (entities.length === 0) return empty;

  const relationships = deriveRelationships(entities, input);

  options.log.info("Estate ontology synthesised", {
    entities: entities.length,
    relationships: relationships.length,
    glossaryTerms: glossary.length,
  });

  return { entities, relationships, glossary };
}
