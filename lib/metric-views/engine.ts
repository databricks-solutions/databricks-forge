/**
 * Metric View Engine v2 -- subdomain-level generation with three-tier
 * classification (reuse / improve / new) and an LLM planning pre-pass.
 *
 * Orchestration flow:
 * 1. Deep discovery of existing UC metric views in scope
 * 2. Map subdomains to tables via use case metadata
 * 3. For each subdomain, run a planning pre-pass where the LLM decides
 *    which metric views to create/reuse/improve and why
 * 4. Generate YAML proposals per subdomain (delegates to the existing
 *    runMetricViewProposals for validation, auto-fix, and repair)
 * 5. Merge all proposals with classification metadata
 *
 * The engine can be called from:
 * - Genie engine (Pass 6) -- receives measures/dimensions/joins from earlier passes
 * - Standalone API -- uses lightweight seed for measures/dimensions
 */

import { type ChatMessage } from "@/lib/dbx/model-serving";
import { cachedChatCompletion } from "@/lib/toolkit/llm-cache";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { mapWithConcurrency } from "@/lib/toolkit/concurrency";
import { logger } from "@/lib/logger";
import { resolveForGeniePass, formatSystemOverlay } from "@/lib/skills";
import type { UseCase, MetadataSnapshot, DataDomain } from "@/lib/domain/types";
import type {
  MetricViewProposal,
  MetricViewClassification,
  ExistingMetricViewDetail,
  EnrichedSqlSnippetMeasure,
  EnrichedSqlSnippetDimension,
  ColumnEnrichment,
  JoinSpecInput,
} from "./types";
import { mapSubdomainsToTables, type SubdomainTableGroup } from "./subdomain-mapper";
import { filterRelevantExistingViews } from "./discovery";
import {
  definitionToLegacyText,
  ensureMetricViewDefinition,
  proposalToDefinition,
  type MetricViewDeploymentTarget,
} from "./legacy-adapter";
import {
  applyMetricViewImproveDiff,
  buildMetricViewImproveDiff,
  MetricViewImproveConflictError,
} from "./improve-diff";
import {
  runMetricViewProposals,
  validateMetricViewDefinitionWithProbes,
  type MetricViewProposalsInput,
} from "@/lib/genie/passes/metric-view-proposals";
import type { SchemaAllowlist } from "@/lib/genie/schema-allowlist";
import { evidenceFailed, evidenceSkipped } from "@/lib/validation/evidence";

const PLANNING_TEMPERATURE = 0.15;

// ---------------------------------------------------------------------------
// Engine input / output
// ---------------------------------------------------------------------------

export interface MetricViewEngineV2Input {
  domain: string;
  deploymentTarget?: MetricViewDeploymentTarget;
  /** Exact source tables in scope, including tables not referenced by a use case. */
  tableFqns?: string[];
  useCases: UseCase[];
  dataDomains?: DataDomain[];
  metadata: MetadataSnapshot;
  allowlist: SchemaAllowlist;
  existingMetricViews: ExistingMetricViewDetail[];
  measures: EnrichedSqlSnippetMeasure[];
  dimensions: EnrichedSqlSnippetDimension[];
  joinSpecs: JoinSpecInput[];
  columnEnrichments: ColumnEnrichment[];
  businessContext?: string;
  industryContext?: string;
  endpoint: string;
  signal?: AbortSignal;
  /** Skip the LLM planning pre-pass and generate directly per subdomain. */
  skipPlanning?: boolean;
}

export interface MetricViewEngineV2Output {
  proposals: MetricViewProposal[];
  subdomainGroups: SubdomainTableGroup[];
  planSummary: string;
}

// ---------------------------------------------------------------------------
// Planning pre-pass
// ---------------------------------------------------------------------------

interface PlannedMetricView {
  name: string;
  subdomain: string;
  classification: MetricViewClassification;
  rationale: string;
  existingFqn?: string;
  focusTables: string[];
  suggestedMeasures: string[];
  suggestedDimensions: string[];
}

interface PlanningResult {
  views: PlannedMetricView[];
  summary: string;
}

async function runPlanningPrePass(
  subdomainGroups: SubdomainTableGroup[],
  existingViews: ExistingMetricViewDetail[],
  measures: EnrichedSqlSnippetMeasure[],
  columnEnrichments: ColumnEnrichment[],
  businessContext: string | undefined,
  industryContext: string | undefined,
  endpoint: string,
  signal?: AbortSignal,
): Promise<PlanningResult> {
  const subdomainSummary = subdomainGroups
    .map((g) => {
      const tableList = g.tables.slice(0, 10).join(", ");
      const ucSummary = g.useCases
        .slice(0, 3)
        .map((uc) => uc.name)
        .join("; ");
      return `- **${g.subdomain}** (${g.domain}): ${g.tables.length} tables [${tableList}], use cases: ${ucSummary}`;
    })
    .join("\n");

  const existingSummary =
    existingViews.length > 0
      ? existingViews
          .map((mv) => {
            const dims = mv.dimensions.join(", ") || "unknown";
            const meass = mv.measures.join(", ") || "unknown";
            return `- ${mv.fqn}: dims=[${dims}], measures=[${meass}], source=${mv.sourceTable ?? "unknown"}`;
          })
          .join("\n")
      : "(none found)";

  const availableMeasures = measures
    .slice(0, 20)
    .map((m) => `${m.name}: ${m.sql}`)
    .join("\n");

  const systemMessage =
    `You are a Databricks SQL architect planning Unity Catalog metric views for a data estate.

Your task is to decide WHAT metric views to create, which existing ones to reuse or improve, and provide rationale for each decision.

## Best Practices
- Start with atomic measures, build complex KPIs via composability (MEASURE() referencing other measures)
- Model business-friendly dimensions (CASE, DATE_TRUNC for readable labels)
- Use global filter: to scope KPIs consistently
- One metric view per focused analytical concern (not one mega-view per domain)
- Prioritise metric views that serve the most use cases and stakeholders
- Leverage existing metric views when they already solve the need well

## Classification Rules
- **reuse**: An existing metric view already covers this analytical need well. Reference it as-is.
- **improve**: An existing metric view partially covers this need but could benefit from additional measures, dimensions, or better naming/comments.
- **new**: No existing metric view covers this analytical concern. Create one.

${businessContext ? `## Business Context\n${businessContext}\n` : ""}
${industryContext ? `## Industry Context\n${industryContext}\n` : ""}

## Output Format (JSON)
{
  "summary": "1-2 sentence overview of the metric view plan",
  "views": [
    {
      "name": "metric_view_name",
      "subdomain": "subdomain name",
      "classification": "reuse|improve|new",
      "rationale": "Why this view, and why this classification",
      "existingFqn": "catalog.schema.view (only for reuse/improve)",
      "focusTables": ["catalog.schema.table1"],
      "suggestedMeasures": ["total_revenue", "order_count"],
      "suggestedDimensions": ["order_month", "region"]
    }
  ]
}

RULES:
- Be selective: propose only metric views that deliver clear value for the given use cases
- Do NOT create metric views for subdomains with only 1 table and no meaningful measures
- Do NOT propose more than 3 metric views per subdomain
- For "reuse", just reference the existing view FQN (no YAML generation needed)
- For "improve", reference the existing FQN and describe what to add/change` +
    formatSystemOverlay(resolveForGeniePass("metricViews").systemOverlay);

  const userMessage = `## Subdomains and Tables
${subdomainSummary}

## Existing Metric Views in Unity Catalog
${existingSummary}

## Available Measures (from semantic analysis)
${availableMeasures || "(none)"}

Plan the metric views for this data estate.`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemMessage },
    { role: "user", content: userMessage },
  ];

  try {
    const result = await cachedChatCompletion({
      endpoint,
      messages,
      temperature: PLANNING_TEMPERATURE,
      maxTokens: 6144,
      responseFormat: "json_object",
      signal,
    });

    const parsed = parseLLMJson(result.content ?? "", "metric-views:plan") as Record<
      string,
      unknown
    >;
    const views: PlannedMetricView[] = (Array.isArray(parsed.views) ? parsed.views : []).map(
      (v: Record<string, unknown>) => ({
        name: String(v.name ?? ""),
        subdomain: String(v.subdomain ?? ""),
        classification: validateClassification(String(v.classification ?? "new")),
        rationale: String(v.rationale ?? ""),
        existingFqn: v.existingFqn ? String(v.existingFqn) : undefined,
        focusTables: Array.isArray(v.focusTables) ? v.focusTables.map(String) : [],
        suggestedMeasures: Array.isArray(v.suggestedMeasures)
          ? v.suggestedMeasures.map(String)
          : [],
        suggestedDimensions: Array.isArray(v.suggestedDimensions)
          ? v.suggestedDimensions.map(String)
          : [],
      }),
    );

    const summary = String(parsed.summary ?? "Metric view plan generated.");

    logger.info("Metric view planning pre-pass complete", {
      totalPlanned: views.length,
      reuse: views.filter((v) => v.classification === "reuse").length,
      improve: views.filter((v) => v.classification === "improve").length,
      new: views.filter((v) => v.classification === "new").length,
    });

    return { views, summary };
  } catch (err) {
    logger.warn("Metric view planning pre-pass failed, proceeding with default generation", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { views: [], summary: "Planning failed; using default generation." };
  }
}

function validateClassification(value: string): MetricViewClassification {
  if (value === "reuse" || value === "improve" || value === "new") return value;
  return "new";
}

function mergeNamedAdditions<T extends { name: string }>(existing: T[], additions: T[]): T[] {
  const additionsByName = new Map(additions.map((item) => [item.name.toLowerCase(), item]));
  const merged = existing.map((item) => additionsByName.get(item.name.toLowerCase()) ?? item);
  const existingNames = new Set(existing.map((item) => item.name.toLowerCase()));
  merged.push(...additions.filter((item) => !existingNames.has(item.name.toLowerCase())));
  return merged;
}

async function buildImprovementProposal(
  proposal: MetricViewProposal,
  planned: PlannedMetricView,
  existing: ExistingMetricViewDetail,
  allowlist: SchemaAllowlist,
): Promise<MetricViewProposal> {
  const existingAdapted = ensureMetricViewDefinition({
    ...proposal,
    name: existing.name,
    yaml: existing.yaml ?? "",
    existingFqn: existing.fqn,
  });
  if (!existingAdapted.definition || !proposal.definition) {
    return {
      ...proposal,
      classification: "improve",
      existingFqn: existing.fqn,
      validationStatus: "error",
      validationIssues: ["Typed existing and desired definitions are required for improvement."],
      validatorVersion: undefined,
      validationEvidence: [
        evidenceFailed(
          "metric_view_improve",
          "METRIC_VIEW_IMPROVE_DEFINITION_REQUIRED",
          "Typed existing and desired definitions are required for improvement.",
        ),
      ],
      validatedAt: undefined,
    };
  }

  try {
    const existingDefinition = existingAdapted.definition;
    const desired = {
      ...existingDefinition,
      comment: proposal.definition.comment ?? existingDefinition.comment,
      joins: mergeNamedAdditions(existingDefinition.joins, proposal.definition.joins),
      dimensions: mergeNamedAdditions(
        existingDefinition.dimensions,
        proposal.definition.dimensions,
      ),
      measures: mergeNamedAdditions(existingDefinition.measures, proposal.definition.measures),
    };
    const diff = {
      ...buildMetricViewImproveDiff(existingDefinition, desired),
      existingFqn: existing.fqn,
    };
    const merged = applyMetricViewImproveDiff(existingDefinition, diff);
    const [catalog, schema] = existing.fqn.split(".");
    const legacy = definitionToLegacyText(merged, { catalog, schema });
    const normalizedMerged = proposalToDefinition({ name: existing.name, yaml: legacy.yaml });
    if (!normalizedMerged) {
      throw new MetricViewImproveConflictError(
        "Merged metric view could not be normalized through the canonical parser.",
      );
    }
    const validation = await validateMetricViewDefinitionWithProbes({
      yaml: legacy.yaml,
      ddl: legacy.ddl,
      allowlist,
    });
    return {
      ...proposal,
      name: existing.name,
      description: normalizedMerged.comment ?? proposal.description,
      definition: normalizedMerged,
      yaml: legacy.yaml,
      ddl: legacy.ddl,
      sourceTables:
        normalizedMerged.source.kind === "table"
          ? [normalizedMerged.source.table]
          : proposal.sourceTables,
      hasJoins: normalizedMerged.joins.length > 0,
      classification: "improve",
      rationale: planned.rationale,
      existingFqn: existing.fqn,
      improveDiff: diff,
      improveBaseDefinition: existingDefinition,
      validationStatus: validation.status,
      validationIssues: validation.issues,
      validatorVersion: validation.validatorVersion,
      validationEvidence: validation.evidence,
      validatedAt: validation.validatedAt,
    };
  } catch (error) {
    const message =
      error instanceof MetricViewImproveConflictError
        ? error.message
        : `Metric view improvement failed: ${error instanceof Error ? error.message : String(error)}`;
    return {
      ...proposal,
      classification: "improve",
      existingFqn: existing.fqn,
      improveDiff: undefined,
      validationStatus: "error",
      validationIssues: [message],
      validatorVersion: undefined,
      validationEvidence: [
        evidenceFailed("metric_view_improve", "METRIC_VIEW_IMPROVE_CONFLICT", message),
      ],
      validatedAt: undefined,
    };
  }
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

/**
 * Run the full Metric View Engine v2:
 * 1. Map subdomains to tables
 * 2. Filter existing views relevant to each subdomain
 * 3. Run planning pre-pass
 * 4. For "new" and "improve" plans, generate YAML via the existing engine
 * 5. For "reuse" plans, create pass-through proposals
 */
export async function runMetricViewEngineV2(
  input: MetricViewEngineV2Input,
): Promise<MetricViewEngineV2Output> {
  const {
    domain,
    deploymentTarget,
    useCases,
    dataDomains,
    metadata,
    allowlist,
    existingMetricViews,
    measures,
    dimensions,
    joinSpecs,
    columnEnrichments,
    businessContext,
    industryContext,
    endpoint,
    signal,
  } = input;

  // Step 1: Map subdomains to tables
  const subdomainGroups = mapSubdomainsToTables(useCases, dataDomains);

  if (subdomainGroups.length === 0) {
    logger.info("No subdomain groups found, falling back to domain-level generation");
    const result = await runMetricViewProposals({
      domain,
      ...(deploymentTarget ? { deploymentTarget } : {}),
      tableFqns: useCases.flatMap((uc) => uc.tablesInvolved ?? []),
      metadata,
      allowlist,
      useCases,
      measures,
      dimensions,
      joinSpecs,
      columnEnrichments,
      endpoint,
      signal,
    });
    return {
      proposals: result.proposals.map((p) => ({
        ...p,
        classification: "new" as const,
        rationale: "Generated at domain level (no subdomain data available).",
      })),
      subdomainGroups: [],
      planSummary: "Fallback: domain-level generation (no subdomain data).",
    };
  }

  const allProposals: MetricViewProposal[] = [];
  const skipPlanning = input.skipPlanning ?? false;

  // Step 2: Optionally run planning pre-pass (skipping saves 1 LLM call per domain)
  const plan: PlanningResult = skipPlanning
    ? { views: [], summary: "Planning skipped (skipPlanning=true)." }
    : await runPlanningPrePass(
        subdomainGroups,
        existingMetricViews,
        measures,
        columnEnrichments,
        businessContext,
        industryContext,
        endpoint,
        signal,
      );

  // Step 3: Handle "reuse" plans (no generation needed)
  for (const planned of plan.views.filter((v) => v.classification === "reuse")) {
    const existing = existingMetricViews.find(
      (mv) => mv.fqn.toLowerCase() === planned.existingFqn?.toLowerCase(),
    );
    if (existing) {
      const yaml = existing.yaml ?? "";
      const adapted = ensureMetricViewDefinition({
        name: existing.name,
        description: `Existing metric view recommended for reuse. ${planned.rationale}`,
        yaml,
        ddl: "",
        sourceTables: existing.sourceTable ? [existing.sourceTable] : [],
        hasJoins: existing.joinTargets.length > 0,
        hasFilteredMeasures: false,
        hasWindowMeasures: false,
        hasMaterialization: false,
        validationStatus: "valid",
        validationIssues: [],
        classification: "reuse",
        rationale: planned.rationale,
        existingFqn: planned.existingFqn,
        subdomain: planned.subdomain,
      });
      if (!adapted.definition) {
        const missing = yaml.trim().length === 0;
        const message = missing
          ? "Existing metric view has no readable YAML definition."
          : "Existing metric view YAML could not be parsed into typed IR.";
        allProposals.push({
          ...adapted,
          definition: undefined,
          validationStatus: missing ? "unverified" : "error",
          validationIssues: [message],
          validationEvidence: [
            missing
              ? evidenceSkipped(
                  "metric_view_parse",
                  "METRIC_VIEW_REUSE_DEFINITION_MISSING",
                  message,
                )
              : evidenceFailed("metric_view_parse", "METRIC_VIEW_REUSE_PARSE_FAILED", message),
          ],
          validatorVersion: undefined,
          validatedAt: undefined,
        });
      } else {
        const parts = existing.fqn.split(".");
        if (parts.length !== 3) {
          allProposals.push({
            ...adapted,
            validationStatus: "error",
            validationIssues: ["Existing metric view FQN must contain catalog, schema, and name."],
          });
          continue;
        }
        const legacy = definitionToLegacyText(adapted.definition, {
          catalog: parts[0],
          schema: parts[1],
        });
        const validation = await validateMetricViewDefinitionWithProbes({
          yaml: legacy.yaml,
          ddl: legacy.ddl,
          allowlist,
        });
        allProposals.push({
          ...adapted,
          yaml: legacy.yaml,
          ddl: legacy.ddl,
          validationStatus: validation.status,
          validationIssues: validation.issues,
          validatorVersion: validation.validatorVersion,
          validationEvidence: validation.evidence,
          validatedAt: validation.validatedAt,
        });
      }
    }
  }

  // Step 4: Generate "new" and "improve" proposals per subdomain -- PARALLEL
  const generationPlans = plan.views.filter(
    (v) => v.classification === "new" || v.classification === "improve",
  );

  const plansBySubdomain = new Map<string, PlannedMetricView[]>();
  for (const p of generationPlans) {
    const key = p.subdomain.toLowerCase();
    const group = plansBySubdomain.get(key) ?? [];
    group.push(p);
    plansBySubdomain.set(key, group);
  }

  const SUBDOMAIN_CONCURRENCY = 3;
  const subdomainEntries = [...plansBySubdomain.entries()];

  const subdomainResults = await mapWithConcurrency(
    subdomainEntries.map(([subdomainKey, plans]) => async () => {
      const subGroup = subdomainGroups.find((g) => g.subdomain.toLowerCase() === subdomainKey);
      if (!subGroup) return [];

      const relevantExisting = filterRelevantExistingViews(existingMetricViews, subGroup.tables);
      const existingCtx =
        relevantExisting.length > 0
          ? ` (existing views to consider: ${relevantExisting.map((mv) => mv.name).join(", ")})`
          : "";
      const planGuidanceCtx = plans.map((p) => `${p.name} (${p.classification})`).join(", ");
      const domainLabel = planGuidanceCtx
        ? `${domain} / ${subGroup.subdomain} [plan: ${planGuidanceCtx}]${existingCtx}`
        : `${domain} / ${subGroup.subdomain}${existingCtx}`;

      const genInput: MetricViewProposalsInput = {
        domain: domainLabel,
        ...(deploymentTarget ? { deploymentTarget } : {}),
        tableFqns: subGroup.tables,
        metadata,
        allowlist,
        useCases: subGroup.useCases,
        measures,
        dimensions,
        joinSpecs,
        columnEnrichments: columnEnrichments.filter((e) =>
          subGroup.tables.some((t) => t.toLowerCase() === e.tableFqn.toLowerCase()),
        ),
        endpoint,
        signal,
      };

      const result = await runMetricViewProposals(genInput);
      return Promise.all(
        result.proposals.map(async (proposal) => {
          const matchedPlan = plans.find(
            (p) =>
              p.name.toLowerCase() === proposal.name.toLowerCase() ||
              proposal.name.toLowerCase().includes(p.name.toLowerCase().replace(/\s+/g, "_")),
          );
          if (matchedPlan?.classification === "improve") {
            const existing = existingMetricViews.find(
              (view) => view.fqn.toLowerCase() === matchedPlan.existingFqn?.toLowerCase(),
            );
            if (!existing) {
              return {
                ...proposal,
                classification: "improve" as const,
                rationale: matchedPlan.rationale,
                existingFqn: matchedPlan.existingFqn,
                subdomain: subGroup.subdomain,
                validationStatus: "error" as const,
                validationIssues: ["The planned existing metric view target was not discovered."],
                validationEvidence: [
                  evidenceFailed(
                    "metric_view_improve",
                    "METRIC_VIEW_IMPROVE_TARGET_MISSING",
                    "The planned existing metric view target was not discovered.",
                  ),
                ],
                validatorVersion: undefined,
                validatedAt: undefined,
              };
            }
            return {
              ...(await buildImprovementProposal(proposal, matchedPlan, existing, allowlist)),
              subdomain: subGroup.subdomain,
            };
          }
          return {
            ...proposal,
            classification: (matchedPlan?.classification ?? "new") as MetricViewClassification,
            rationale: matchedPlan?.rationale ?? "Generated for this subdomain.",
            existingFqn: matchedPlan?.existingFqn,
            subdomain: subGroup.subdomain,
          };
        }),
      );
    }),
    SUBDOMAIN_CONCURRENCY,
  );

  for (const proposals of subdomainResults) {
    allProposals.push(...proposals);
  }

  // Step 5: If no plans (skipped or empty), generate per-subdomain in parallel
  if (plan.views.length === 0 && allProposals.length === 0) {
    logger.info("No planned views, falling back to parallel per-subdomain generation");
    const fallbackResults = await mapWithConcurrency(
      subdomainGroups.slice(0, 5).map((subGroup) => async () => {
        const result = await runMetricViewProposals({
          domain: `${domain} / ${subGroup.subdomain}`,
          ...(deploymentTarget ? { deploymentTarget } : {}),
          tableFqns: subGroup.tables,
          metadata,
          allowlist,
          useCases: subGroup.useCases,
          measures,
          dimensions,
          joinSpecs,
          columnEnrichments: columnEnrichments.filter((e) =>
            subGroup.tables.some((t) => t.toLowerCase() === e.tableFqn.toLowerCase()),
          ),
          endpoint,
          signal,
        });
        return result.proposals.map((proposal) => ({
          ...proposal,
          classification: "new" as const,
          rationale: "Generated for subdomain (planning pre-pass unavailable).",
          subdomain: subGroup.subdomain,
        }));
      }),
      SUBDOMAIN_CONCURRENCY,
    );
    for (const proposals of fallbackResults) {
      allProposals.push(...proposals);
    }
  }

  logger.info("Metric View Engine v2 complete", {
    domain,
    subdomains: subdomainGroups.length,
    totalProposals: allProposals.length,
    reuse: allProposals.filter((p) => p.classification === "reuse").length,
    improve: allProposals.filter((p) => p.classification === "improve").length,
    new: allProposals.filter((p) => p.classification === "new").length,
  });

  return {
    proposals: allProposals,
    subdomainGroups,
    planSummary: plan.summary,
  };
}
