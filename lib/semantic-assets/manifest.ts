import type {
  EnrichedSqlSnippetDimension,
  EnrichedSqlSnippetMeasure,
  MetricViewProposal,
} from "@/lib/metric-views/types";
import type { EnrichedSqlSnippetFilter } from "@/lib/genie/types";
import { isMetricViewValidationDeployable } from "@/lib/metric-views/deployability";
import type {
  GovernedDimension,
  GovernedFilter,
  GovernedMeasure,
  SemanticAssetManifest,
  VerifiedMetricViewAsset,
} from "./types";

function idPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function stableId(kind: string, ...parts: string[]): string {
  return [kind, ...parts.map(idPart)].join(":");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function dedupeById<T extends { id: string }>(values: T[]): T[] {
  return [...values]
    .sort((a, b) => a.id.localeCompare(b.id) || JSON.stringify(a).localeCompare(JSON.stringify(b)))
    .filter((value, index, sorted) => index === 0 || value.id !== sorted[index - 1].id);
}

function intendedFqn(proposal: MetricViewProposal): string {
  if (proposal.existingFqn?.trim()) return proposal.existingFqn.replaceAll("`", "").trim();

  const match = proposal.ddl.match(
    /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+((?:`[^`]+`|[A-Za-z0-9_$-]+)(?:\s*\.\s*(?:`[^`]+`|[A-Za-z0-9_$-]+)){0,2})/i,
  );
  if (match) return match[1].replaceAll("`", "").replace(/\s+/g, "");

  return proposal.definition?.name ?? proposal.name;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function canonicalProposalKey(proposal: MetricViewProposal): string {
  return stableJson({
    definition: proposal.definition,
    sourceTables: uniqueSorted(proposal.sourceTables),
    name: proposal.name.trim(),
    description: proposal.description?.trim() ?? "",
    ddl: proposal.ddl.trim(),
    yaml: proposal.yaml.trim(),
  });
}

function canonicalValidProposals(proposals: MetricViewProposal[]): MetricViewProposal[] {
  const sorted = proposals
    .filter(
      (proposal) => proposal.definition !== undefined && isMetricViewValidationDeployable(proposal),
    )
    .sort(
      (a, b) =>
        intendedFqn(a).toLowerCase().localeCompare(intendedFqn(b).toLowerCase()) ||
        canonicalProposalKey(a).localeCompare(canonicalProposalKey(b)),
    );

  return sorted.filter(
    (proposal, index) =>
      index === 0 ||
      intendedFqn(proposal).toLowerCase() !== intendedFqn(sorted[index - 1]).toLowerCase(),
  );
}

function metricViewMeasures(assetId: string, proposal: MetricViewProposal): GovernedMeasure[] {
  return (proposal.definition?.measures ?? []).map((definition) => ({
    id: stableId("measure", assetId, definition.name),
    name: definition.name,
    source: "metric_view",
    metricViewId: assetId,
    definition,
    synonyms: uniqueSorted(definition.synonyms ?? []),
    ...(definition.comment && { description: definition.comment }),
    fallback: false,
  }));
}

function metricViewDimensions(assetId: string, proposal: MetricViewProposal): GovernedDimension[] {
  return (proposal.definition?.dimensions ?? []).map((definition) => ({
    id: stableId("dimension", assetId, definition.name),
    name: definition.name,
    source: "metric_view",
    metricViewId: assetId,
    definition,
    synonyms: uniqueSorted(definition.synonyms ?? []),
    ...(definition.comment && { description: definition.comment }),
    fallback: false,
  }));
}

function metricViewFilter(assetId: string, proposal: MetricViewProposal): GovernedFilter[] {
  const sql = proposal.definition?.filter?.trim();
  if (!sql) return [];
  return [
    {
      id: stableId("filter", assetId, "view_filter"),
      name: `${proposal.definition?.name ?? proposal.name} filter`,
      source: "metric_view",
      metricViewId: assetId,
      sql,
      synonyms: [],
      fallback: false,
    },
  ];
}

function verifiedMetricView(proposal: MetricViewProposal): VerifiedMetricViewAsset | null {
  if (!proposal.definition || !isMetricViewValidationDeployable(proposal)) return null;

  const fqn = intendedFqn(proposal);
  const isVerifiedReuse =
    proposal.classification === "reuse" &&
    typeof proposal.existingFqn === "string" &&
    proposal.existingFqn.trim().length > 0;
  const id = stableId("metric_view", fqn);
  const measures = dedupeById(metricViewMeasures(id, proposal));
  const dimensions = dedupeById(metricViewDimensions(id, proposal));

  return {
    id,
    intendedFqn: fqn,
    ...(isVerifiedReuse ? { deployedFqn: fqn } : {}),
    validationState: "valid",
    measures,
    dimensions,
    representativeQueries: measures.map((measure) => `SELECT MEASURE(${measure.name}) FROM ${fqn}`),
    deploymentState: isVerifiedReuse ? "deployed" : "proposal",
    sourceTables: uniqueSorted([
      ...proposal.sourceTables,
      ...(proposal.definition.source.kind === "table" ? [proposal.definition.source.table] : []),
    ]),
  };
}

export function promoteSemanticAssetManifest(input: {
  manifest: SemanticAssetManifest;
  proposal: Pick<
    MetricViewProposal,
    "name" | "description" | "definition" | "ddl" | "sourceTables" | "existingFqn"
  >;
  proposalId: string;
  deployedFqn: string;
  now?: Date;
}): SemanticAssetManifest {
  if (!input.proposal.definition) {
    throw new Error("Metric view promotion requires a typed merged definition");
  }
  const proposalIntendedFqn = intendedFqn(input.proposal as MetricViewProposal).toLowerCase();
  let candidates = input.manifest.metricViews.filter(
    (asset) =>
      asset.proposalId === input.proposalId ||
      asset.intendedFqn.toLowerCase() === proposalIntendedFqn,
  );
  if (candidates.length === 0) {
    candidates = input.manifest.metricViews.filter(
      (asset) =>
        asset.intendedFqn.split(".").at(-1)?.toLowerCase() === input.proposal.name.toLowerCase(),
    );
  }
  if (candidates.length !== 1) {
    throw new Error(
      `Persisted semantic manifest has ${candidates.length} matching assets for proposal "${input.proposalId}"`,
    );
  }

  const existing = candidates[0];
  const measures = dedupeById(
    metricViewMeasures(existing.id, input.proposal as MetricViewProposal),
  );
  const dimensions = dedupeById(
    metricViewDimensions(existing.id, input.proposal as MetricViewProposal),
  );
  const filters = metricViewFilter(existing.id, input.proposal as MetricViewProposal);
  const promoted: VerifiedMetricViewAsset = {
    ...existing,
    proposalId: input.proposalId,
    deployedFqn: input.deployedFqn,
    deploymentState: "deployed",
    measures,
    dimensions,
    representativeQueries: measures.map(
      (measure) => `SELECT MEASURE(${measure.name}) FROM ${input.deployedFqn}`,
    ),
    sourceTables: uniqueSorted([
      ...input.proposal.sourceTables,
      ...(input.proposal.definition.source.kind === "table"
        ? [input.proposal.definition.source.table]
        : []),
    ]),
  };

  return {
    ...input.manifest,
    metricViews: input.manifest.metricViews.map((asset) =>
      asset.id === existing.id ? promoted : asset,
    ),
    measures: dedupeById([
      ...input.manifest.measures.filter(
        (measure) => measure.source !== "metric_view" || measure.metricViewId !== existing.id,
      ),
      ...measures,
    ]),
    dimensions: dedupeById([
      ...input.manifest.dimensions.filter(
        (dimension) => dimension.source !== "metric_view" || dimension.metricViewId !== existing.id,
      ),
      ...dimensions,
    ]),
    filters: dedupeById([
      ...input.manifest.filters.filter(
        (filter) => filter.source !== "metric_view" || filter.metricViewId !== existing.id,
      ),
      ...filters,
    ]),
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
}

function genieMeasures(domain: string, measures: EnrichedSqlSnippetMeasure[]): GovernedMeasure[] {
  return measures.map((measure) => ({
    id: stableId("measure", "genie", domain, measure.name),
    name: measure.name.trim(),
    source: "genie_expression",
    sql: measure.sql,
    instructions: measure.instructions,
    synonyms: uniqueSorted(measure.synonyms),
    fallback: true,
  }));
}

function genieDimensions(
  domain: string,
  dimensions: EnrichedSqlSnippetDimension[],
): GovernedDimension[] {
  return dimensions.map((dimension) => ({
    id: stableId("dimension", "genie", domain, dimension.name),
    name: dimension.name.trim(),
    source: "genie_expression",
    sql: dimension.sql,
    instructions: dimension.instructions,
    synonyms: uniqueSorted(dimension.synonyms),
    isTimePeriod: dimension.isTimePeriod,
    fallback: true,
  }));
}

function genieFilters(domain: string, filters: EnrichedSqlSnippetFilter[]): GovernedFilter[] {
  return filters.map((filter) => ({
    id: stableId("filter", "genie", domain, filter.name),
    name: filter.name.trim(),
    source: "genie_expression",
    sql: filter.sql,
    instructions: filter.instructions,
    synonyms: uniqueSorted(filter.synonyms),
    isTimePeriod: filter.isTimePeriod,
    fallback: true,
  }));
}

export function buildSemanticAssetManifest(input: {
  domain: string;
  subdomains: string[];
  proposals: MetricViewProposal[];
  genieMeasures: EnrichedSqlSnippetMeasure[];
  genieDimensions: EnrichedSqlSnippetDimension[];
  genieFilters: EnrichedSqlSnippetFilter[];
  now?: Date;
}): SemanticAssetManifest {
  const selectedProposals = canonicalValidProposals(input.proposals);
  const metricViews = selectedProposals
    .map(verifiedMetricView)
    .filter((asset): asset is VerifiedMetricViewAsset => asset !== null);

  return {
    version: "1",
    domain: input.domain,
    subdomains: uniqueSorted(input.subdomains),
    metricViews,
    measures: dedupeById([
      ...metricViews.flatMap((asset) => asset.measures),
      ...genieMeasures(input.domain, input.genieMeasures),
    ]),
    dimensions: dedupeById([
      ...metricViews.flatMap((asset) => asset.dimensions),
      ...genieDimensions(input.domain, input.genieDimensions),
    ]),
    filters: dedupeById([
      ...selectedProposals.flatMap((proposal) =>
        metricViewFilter(stableId("metric_view", intendedFqn(proposal)), proposal),
      ),
      ...genieFilters(input.domain, input.genieFilters),
    ]),
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
}

interface PersistedSnippet {
  alias?: unknown;
  display_name?: unknown;
  sql?: unknown;
  synonyms?: unknown;
  comment?: unknown;
  instruction?: unknown;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function snippets(value: unknown): PersistedSnippet[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is PersistedSnippet =>
          typeof item === "object" && item !== null && !Array.isArray(item),
      )
    : [];
}

function snippetName(item: PersistedSnippet): string | null {
  if (typeof item.display_name === "string" && item.display_name.trim()) {
    return item.display_name.trim();
  }
  if (typeof item.alias === "string" && item.alias.trim()) {
    return item.alias.trim();
  }
  return null;
}

/** Read-only compatibility adapter for recommendations persisted before manifests existed. */
export function buildFallbackSemanticAssetManifest(input: {
  domain: string;
  subdomains: string[];
  serializedSpace: unknown;
}): SemanticAssetManifest | null {
  const space =
    typeof input.serializedSpace === "object" &&
    input.serializedSpace !== null &&
    !Array.isArray(input.serializedSpace)
      ? (input.serializedSpace as Record<string, unknown>)
      : {};
  const instructions =
    typeof space.instructions === "object" &&
    space.instructions !== null &&
    !Array.isArray(space.instructions)
      ? (space.instructions as Record<string, unknown>)
      : {};
  const sqlSnippets =
    typeof instructions.sql_snippets === "object" &&
    instructions.sql_snippets !== null &&
    !Array.isArray(instructions.sql_snippets)
      ? (instructions.sql_snippets as Record<string, unknown>)
      : {};

  const fallbackMeasures: EnrichedSqlSnippetMeasure[] = snippets(sqlSnippets.measures)
    .filter((item) => snippetName(item) !== null && strings(item.sql).length > 0)
    .map((item) => ({
      name: snippetName(item) as string,
      sql: strings(item.sql).join("\n"),
      synonyms: strings(item.synonyms),
      instructions: strings(item.comment).join(" "),
    }));
  const fallbackDimensions: EnrichedSqlSnippetDimension[] = snippets(sqlSnippets.expressions)
    .filter((item) => snippetName(item) !== null && strings(item.sql).length > 0)
    .map((item) => ({
      name: snippetName(item) as string,
      sql: strings(item.sql).join("\n"),
      synonyms: strings(item.synonyms),
      instructions: strings(item.instruction).join(" "),
      isTimePeriod: false,
    }));
  const fallbackFilters: EnrichedSqlSnippetFilter[] = snippets(sqlSnippets.filters)
    .filter((item) => snippetName(item) !== null && strings(item.sql).length > 0)
    .map((item) => ({
      name: snippetName(item) as string,
      sql: strings(item.sql).join("\n"),
      synonyms: strings(item.synonyms),
      instructions: strings(item.comment).join(" "),
      isTimePeriod: false,
    }));

  if (
    fallbackMeasures.length === 0 &&
    fallbackDimensions.length === 0 &&
    fallbackFilters.length === 0
  ) {
    return null;
  }

  return buildSemanticAssetManifest({
    domain: input.domain,
    subdomains: input.subdomains,
    proposals: [],
    genieMeasures: fallbackMeasures,
    genieDimensions: fallbackDimensions,
    genieFilters: fallbackFilters,
    now: new Date(0),
  });
}
