/**
 * Dashboard Engine — LLM-powered dashboard recommendation generator.
 *
 * Produces one Databricks AI/BI (Lakeview) dashboard recommendation per
 * domain, using use case SQL, Genie engine outputs, and metadata to
 * design data-driven dashboards with appropriate visualisations.
 */

import type { MetadataSnapshot } from "@/lib/domain/types";
import type {
  GenieEngineRecommendation,
  EnrichedSqlSnippetMeasure,
  EnrichedSqlSnippetDimension,
  EnrichedSqlSnippetFilter,
} from "@/lib/genie/types";
import type {
  DashboardDesign,
  DashboardRecommendation,
  DashboardEngineInput,
  DashboardEngineResult,
  DashboardValidationFailure,
  FieldRole,
  FilterCandidate,
  SerializedLakeviewDashboard,
  DatasetSourceKind,
} from "./types";
import type {
  DashboardDesignV2,
  DatasetDesignV2,
  FilterDesignV2,
  WidgetDesignV2,
} from "./design-ir";
import { requireDashboardDesignV2 } from "./design-ir";
import { adaptLegacyDashboardDesign } from "./legacy-design-adapter";
import { chatCompletion, type ChatMessage } from "@/lib/dbx/model-serving";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { buildDashboardDesignPrompt, DASHBOARD_SYSTEM_MESSAGE } from "./prompts";
import {
  assembleLakeviewDashboard,
  buildDashboardRecommendation,
  isCounterQueryDisaggregated,
} from "./assembler";
import { buildSchemaAllowlist, validateSqlExpression } from "@/lib/genie/schema-allowlist";
import { reviewAndFixSql as defaultReviewAndFixSql } from "@/lib/ai/sql-reviewer";
import { isReviewEnabled as defaultIsReviewEnabled, resolveEndpoint } from "@/lib/dbx/client";
import { mapWithConcurrency } from "@/lib/toolkit/concurrency";
import {
  validateDatasetSql,
  lintMissingGroupBy,
  validateSelectedMetricViewBinding,
} from "./validation";
import { executeAndValidateDataset } from "./dataset-execution";
import type { DatasetResultExpectation, ExpectedColumn } from "./result-contract";
import { validateSerializedDashboard } from "./contract-validator";
import {
  DASHBOARD_VALIDATOR_VERSION,
  evidenceFailed,
  evidencePassed,
  evidenceSkipped,
  type ValidationEvidence,
} from "@/lib/validation/evidence";
import { logger as defaultLogger } from "@/lib/logger";
import type { Logger } from "@/lib/ports/logger";
import type { LLMClient } from "@/lib/ports/llm-client";
import type { SqlExecutor } from "@/lib/ports/sql-executor";
import { databricksSqlExecutor } from "@/lib/ports/defaults/databricks-sql-executor";
import type { DiscoveredDashboard } from "@/lib/discovery/types";
import { classifyWidgetExpression } from "./expressions";
import type { SemanticAssetManifest } from "@/lib/semantic-assets/types";
import { DEFAULT_METRIC_DATASET_LIMIT, renderMetricViewDatasetSql } from "./metric-dataset";
import {
  dashboardVisibleSemanticManifest,
  referencesUnavailableMetricAsset,
  selectDatasetSource,
  summarizeDatasetSourceKind,
} from "./source-policy";
import {
  indexSemanticManifests,
  missingDashboardManifestDomains,
  normalizeDashboardDomain,
  selectDashboardDomainGroups,
  type DashboardDomainGroup,
} from "./domain-groups";
import {
  applyDashboardImproveDiff,
  buildDashboardImproveDiff,
  DashboardImproveConflictError,
  toPersistedDashboardRecommendationType,
} from "./improve-diff";
import { adaptSerializedGenieSnippets } from "./genie-snippet-adapter";
import { safeErrorMetadata } from "@/lib/logging/safe-error-metadata";
import {
  formatSqlExecutorDiagnostic,
  isRepairableSqlExecutorDiagnostic,
} from "./executor-diagnostic";
import { isDashboardValidationDeployable } from "./deployability";

const TEMPERATURE = 0.3;

function buildColumnSchemas(metadata: MetadataSnapshot, tableFqns: string[]): string[] {
  const targetSet = new Set(tableFqns.map((f) => f.toLowerCase()));
  const columnsByTable = new Map<string, string[]>();

  for (const c of metadata.columns) {
    const fqn = c.tableFqn.toLowerCase();
    if (!targetSet.has(fqn)) continue;
    const list = columnsByTable.get(c.tableFqn) ?? [];
    list.push(`${c.columnName} (${c.dataType})`);
    columnsByTable.set(c.tableFqn, list);
  }

  return Array.from(columnsByTable.entries()).map(
    ([table, cols]) => `${table}: ${cols.join(", ")}`,
  );
}

function getGenieOutputsForDomain(
  domain: string,
  genieRecommendations?: GenieEngineRecommendation[],
): {
  measures: EnrichedSqlSnippetMeasure[];
  dimensions: EnrichedSqlSnippetDimension[];
  filters: EnrichedSqlSnippetFilter[];
} | null {
  if (!genieRecommendations) return null;

  const domainKey = normalizeDashboardDomain(domain);
  const rec = genieRecommendations.find(
    (recommendation) => normalizeDashboardDomain(recommendation.domain) === domainKey,
  );
  if (!rec) return null;

  try {
    const space = JSON.parse(rec.serializedSpace);
    const snippets = space?.instructions?.sql_snippets;
    if (!snippets) return null;
    return adaptSerializedGenieSnippets(snippets);
  } catch {
    return null;
  }
}

function getFilterCandidatesForDomain(
  metadata: MetadataSnapshot,
  tableFqns: string[],
  genieOutputs: {
    filters: EnrichedSqlSnippetFilter[];
    dimensions: EnrichedSqlSnippetDimension[];
  } | null,
): FilterCandidate[] {
  const candidates: FilterCandidate[] = [];
  const seen = new Set<string>();

  // Pull from Genie filters first
  if (genieOutputs?.filters) {
    for (const f of genieOutputs.filters) {
      if (!seen.has(f.name.toLowerCase())) {
        seen.add(f.name.toLowerCase());
        candidates.push({ name: f.name, column: f.sql, tableFqn: "", dataType: "STRING" });
      }
    }
  }

  // Detect date and low-cardinality columns from metadata
  const targetSet = new Set(tableFqns.map((t) => t.toLowerCase()));
  for (const col of metadata.columns) {
    if (!targetSet.has(col.tableFqn.toLowerCase())) continue;
    const key = `${col.tableFqn}.${col.columnName}`.toLowerCase();
    if (seen.has(key)) continue;

    const dt = col.dataType.toUpperCase();
    if (dt.includes("DATE") || dt.includes("TIMESTAMP")) {
      seen.add(key);
      candidates.push({
        name: col.columnName,
        column: col.columnName,
        tableFqn: col.tableFqn,
        dataType: dt,
      });
    }
  }

  return candidates.slice(0, 6);
}

function requestedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string" && id.length > 0);
}

interface MetricDatasetBinding {
  fqn: string;
  measureNames: string[];
  dimensionNames: string[];
  fallbackSql: string;
  limit: number;
}

function resolveDatasetSources(
  design: DashboardDesignV2,
  manifest: SemanticAssetManifest | undefined,
): {
  design: DashboardDesignV2;
  datasetSourceKind: DatasetSourceKind;
  metricBindings: Map<string, MetricDatasetBinding>;
  evidence: ValidationEvidence[];
} {
  const decisions: Array<"metric_view" | "semantic_expression" | "table"> = [];
  const metricBindings = new Map<string, MetricDatasetBinding>();
  const evidence: ValidationEvidence[] = [];
  const datasets = design.datasets.map((dataset) => {
    const measureIds = requestedIds(dataset.metricIds);
    const dimensionIds = requestedIds(dataset.dimensionIds);
    if (!manifest) {
      decisions.push("table");
      return { ...dataset, sourceKind: "table" as const, metricIds: measureIds, dimensionIds };
    }
    const decision = selectDatasetSource({
      purpose: dataset.purpose,
      measureIds,
      dimensionIds,
      manifest,
    });
    decisions.push(decision.kind);
    if (decision.kind !== "metric_view") {
      if (referencesUnavailableMetricAsset(dataset.sql, manifest)) {
        evidence.push(
          evidenceFailed(
            "dataset_source",
            "PROPOSED_METRIC_SQL_REJECTED",
            `Dataset "${dataset.name}" used metric-view SQL without a demonstrably deployed semantic asset.`,
            { artifactRef: `dataset:${dataset.name}` },
          ),
        );
      }
      return {
        ...dataset,
        sourceKind: decision.kind,
        metricIds: measureIds,
        dimensionIds,
        metricViewFqn: undefined,
      };
    }

    try {
      const sql = renderMetricViewDatasetSql({
        asset: decision.asset,
        measures: measureIds,
        dimensions: dimensionIds,
      });
      const measuresById = new Map(
        decision.asset.measures.map((measure) => [measure.id, measure.name]),
      );
      const dimensionsById = new Map(
        decision.asset.dimensions.map((dimension) => [dimension.id, dimension.name]),
      );
      metricBindings.set(dataset.name, {
        fqn: decision.asset.deployedFqn ?? decision.asset.intendedFqn,
        measureNames: measureIds.map((id) => measuresById.get(id)!),
        dimensionNames: dimensionIds.map((id) => dimensionsById.get(id)!),
        fallbackSql: dataset.sql,
        limit: DEFAULT_METRIC_DATASET_LIMIT,
      });
      return {
        ...dataset,
        sql,
        sourceKind: "metric_view" as const,
        metricViewFqn: decision.asset.deployedFqn ?? decision.asset.intendedFqn,
        metricIds: measureIds,
        dimensionIds,
      };
    } catch (error) {
      decisions[decisions.length - 1] = "table";
      evidence.push(
        evidenceSkipped(
          "dataset_source",
          "METRIC_SOURCE_RENDER_FALLBACK",
          `Dataset "${dataset.name}" retained table SQL because governed rendering failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { artifactRef: `dataset:${dataset.name}` },
        ),
      );
      return {
        ...dataset,
        sourceKind: "table" as const,
        metricViewFqn: undefined,
        metricIds: measureIds,
        dimensionIds,
      };
    }
  });

  return {
    design: { ...design, datasets },
    datasetSourceKind: summarizeDatasetSourceKind(decisions),
    metricBindings,
    evidence,
  };
}

interface DashboardValidationDeps {
  log: Logger;
  sql: SqlExecutor;
  reviewFn: typeof defaultReviewAndFixSql;
  isReviewEnabledFn: (surface?: string) => boolean;
  reviewSurface: "dashboard" | "adhoc-dashboard";
  metricBindings?: Map<string, MetricDatasetBinding>;
  sourceResolutionEvidence?: ValidationEvidence[];
}

export interface DashboardDesignValidationResult {
  valid: boolean;
  design: DashboardDesignV2;
  serializedDashboard?: SerializedLakeviewDashboard;
  evidence: ValidationEvidence[];
  datasetSourceKind?: DatasetSourceKind;
}

function compatibleTypesForField(
  field: { role: FieldRole },
  purpose: DatasetDesignV2["purpose"],
): string[] {
  if (field.role === "value" || field.role === "y") return ["numeric"];
  if (field.role === "x" && purpose === "trend") return ["temporal"];
  if (field.role === "x" || field.role === "color") {
    return ["categorical"];
  }
  return ["numeric", "temporal", "categorical", "binary", "array", "map", "struct", "variant"];
}

function buildDatasetExpectation(
  dataset: DatasetDesignV2,
  widgets: WidgetDesignV2[],
  filters: FilterDesignV2[],
): { expectation?: DatasetResultExpectation; evidence: ValidationEvidence[] } {
  const expectedByName = new Map<string, ExpectedColumn>(
    dataset.expectedFields.map((field) => [
      field.name.trim().toLowerCase(),
      {
        name: field.name,
        role: field.roles[0] ?? "column",
        compatibleTypes: field.compatibleTypes,
      },
    ]),
  );
  const evidence: ValidationEvidence[] = [];
  for (const widget of widgets) {
    if (widget.datasetName !== dataset.name) continue;
    for (const field of widget.fields) {
      const parsed = classifyWidgetExpression(field.expression);
      if (!parsed) {
        evidence.push(
          evidenceFailed(
            "dataset_result",
            "WIDGET_EXPRESSION_UNSUPPORTED",
            `Widget "${widget.title}" field "${field.name}" uses unsupported expression "${field.expression}".`,
            { artifactRef: `widget:${widget.title}` },
          ),
        );
        continue;
      }
      if (parsed.sourceIdentifier === null) continue;
      const key = parsed.sourceIdentifier.trim().toLowerCase();
      if (!key || expectedByName.has(key)) continue;
      expectedByName.set(key, {
        name: parsed.sourceIdentifier,
        role: field.role,
        compatibleTypes: compatibleTypesForField(field, dataset.purpose),
      });
    }
  }
  for (const filter of filters) {
    for (const binding of filter.bindings) {
      if (binding.datasetName !== dataset.name) continue;
      const parsed = classifyWidgetExpression(binding.expression);
      if (!parsed) {
        evidence.push(
          evidenceFailed(
            "dataset_result",
            "WIDGET_EXPRESSION_UNSUPPORTED",
            `Filter "${filter.title}" field "${binding.fieldName}" uses unsupported expression "${binding.expression}".`,
            { artifactRef: `filter:${filter.title}` },
          ),
        );
        continue;
      }
      if (parsed.sourceIdentifier === null) continue;
      const key = parsed.sourceIdentifier.trim().toLowerCase();
      if (!key || expectedByName.has(key)) continue;
      expectedByName.set(key, {
        name: parsed.sourceIdentifier,
        role: "filter",
        compatibleTypes:
          filter.type === "filter-date-range-picker" ? ["temporal"] : ["categorical"],
      });
    }
  }
  if (evidence.length > 0) return { evidence };
  return {
    evidence,
    expectation: {
      datasetName: dataset.name,
      purpose: dataset.purpose,
      expectedColumns: [...expectedByName.values()],
      ...(dataset.purpose === "kpi" && isCounterQueryDisaggregated(dataset.name, filters)
        ? { requireSingleRow: true }
        : { maxRowCount: 1000 }),
    },
  };
}

async function validateRequiredDataset(
  dataset: DatasetDesignV2,
  design: DashboardDesignV2,
  allowlist: ReturnType<typeof buildSchemaAllowlist>,
  schemaContext: string,
  deps: DashboardValidationDeps,
  metricBindingOverride?: MetricDatasetBinding | null,
  executionRepairAttempted = false,
): Promise<{
  dataset: DatasetDesignV2;
  ok: boolean;
  evidence: ValidationEvidence[];
  sourceKind: "metric_view" | "table";
}> {
  const evidence: ValidationEvidence[] = [];
  let validatedDataset = { ...dataset };
  const artifactRef = `dataset:${dataset.name}`;
  const metricBinding =
    metricBindingOverride === undefined
      ? (deps.metricBindings?.get(dataset.name) ?? null)
      : metricBindingOverride;
  const sourceKind = metricBinding ? "metric_view" : "table";

  const fallBackToTable = async (
    code: string,
    reason: string,
  ): Promise<{
    dataset: DatasetDesignV2;
    ok: boolean;
    evidence: ValidationEvidence[];
    sourceKind: "table";
  }> => {
    const fallbackEvidence = evidenceSkipped(
      "dataset_source",
      code,
      `Dataset "${dataset.name}" retained table SQL: ${reason}`,
      { artifactRef },
    );
    const fallback = await validateRequiredDataset(
      {
        ...dataset,
        sql: metricBinding?.fallbackSql ?? dataset.sql,
        sourceKind: "table",
        metricViewFqn: undefined,
      },
      design,
      allowlist,
      schemaContext,
      deps,
      null,
    );
    return {
      ...fallback,
      sourceKind: "table",
      evidence: [...evidence, fallbackEvidence, ...fallback.evidence],
    };
  };

  if (
    !validateSqlExpression(allowlist, dataset.sql, `${deps.reviewSurface}:${dataset.name}`, true)
  ) {
    evidence.push(
      evidenceFailed(
        "dataset_static",
        "SCHEMA_ALLOWLIST_FAILED",
        `Dataset "${dataset.name}" failed schema allowlist validation.`,
        { artifactRef },
      ),
    );
    return { dataset: validatedDataset, ok: false, evidence, sourceKind };
  }
  evidence.push(
    evidencePassed(
      "dataset_static",
      "SCHEMA_ALLOWLIST_VALID",
      `Dataset "${dataset.name}" passed schema allowlist validation.`,
      { artifactRef },
    ),
  );

  if (deps.isReviewEnabledFn(deps.reviewSurface)) {
    try {
      const review = await deps.reviewFn(validatedDataset.sql, {
        schemaContext,
        surface: deps.reviewSurface,
      });
      if (review.verdict === "fail" && !review.fixedSql) {
        evidence.push(
          evidenceFailed(
            "dataset_review",
            "LLM_REVIEW_FAILED",
            `Dataset "${dataset.name}" was rejected by SQL review.`,
            { artifactRef },
          ),
        );
        return { dataset: validatedDataset, ok: false, evidence, sourceKind };
      }
      if (review.fixedSql) {
        if (metricBinding) {
          const bindingValidation = validateSelectedMetricViewBinding(
            review.fixedSql,
            metricBinding,
          );
          if (!bindingValidation.valid) {
            return fallBackToTable(
              "METRIC_SOURCE_REVIEW_DRIFT_FALLBACK",
              `SQL review drifted from its governed binding: ${bindingValidation.issues.join("; ")}`,
            );
          }
        }
        if (
          !validateSqlExpression(
            allowlist,
            review.fixedSql,
            `${deps.reviewSurface}_fix:${dataset.name}`,
            true,
          )
        ) {
          evidence.push(
            evidenceFailed(
              "dataset_review",
              "LLM_REVIEW_FIX_INVALID",
              `Dataset "${dataset.name}" review fix failed schema allowlist validation.`,
              { artifactRef },
            ),
          );
          return { dataset: validatedDataset, ok: false, evidence, sourceKind };
        }
        validatedDataset = { ...validatedDataset, sql: review.fixedSql };
      }
      evidence.push(
        evidencePassed(
          "dataset_review",
          "LLM_REVIEW_PASSED",
          `Dataset "${dataset.name}" passed SQL review.`,
          { artifactRef },
        ),
      );
    } catch (error) {
      evidence.push(
        evidenceFailed(
          "dataset_review",
          "LLM_REVIEW_ERROR",
          `Dataset "${dataset.name}" SQL review failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { artifactRef },
        ),
      );
      return { dataset: validatedDataset, ok: false, evidence, sourceKind };
    }
  } else {
    evidence.push(
      evidenceSkipped(
        "dataset_review",
        "LLM_REVIEW_DISABLED",
        `Dataset "${dataset.name}" SQL review is disabled by configuration.`,
        { artifactRef },
      ),
    );
  }

  if (metricBinding) {
    const metricViewValidation = validateSelectedMetricViewBinding(
      validatedDataset.sql,
      metricBinding,
    );
    if (!metricViewValidation.valid) {
      return fallBackToTable(
        "METRIC_SOURCE_BINDING_FALLBACK",
        `governed SQL no longer matched its selected binding: ${metricViewValidation.issues.join(
          "; ",
        )}`,
      );
    }
    evidence.push(
      evidencePassed(
        "dataset_static",
        "METRIC_VIEW_SQL_VALID",
        `Dataset "${dataset.name}" passed metric-view SQL validation.`,
        { artifactRef },
      ),
    );
  }

  const lint = lintMissingGroupBy(validatedDataset.sql);
  if (lint) {
    evidence.push(
      evidenceSkipped(
        "dataset_static",
        "MISSING_GROUP_BY_LINT_ADVISORY",
        `${lint} Static analysis could not prove invalidity; mandatory EXPLAIN and bounded execution will decide.`,
        { artifactRef },
      ),
    );
  } else {
    evidence.push(
      evidencePassed(
        "dataset_static",
        "STATIC_LINT_PASSED",
        `Dataset "${dataset.name}" passed static SQL lint.`,
        { artifactRef },
      ),
    );
  }

  const resultExpectation = buildDatasetExpectation(
    dataset,
    design.pages.flatMap((page) => page.widgets),
    [...design.globalFilters, ...design.pages.flatMap((page) => page.filters)],
  );
  if (!resultExpectation.expectation) {
    evidence.push(...resultExpectation.evidence);
    return { dataset: validatedDataset, ok: false, evidence, sourceKind };
  }

  const explainError = await validateDatasetSql(validatedDataset.sql, dataset.name, deps.sql);
  if (explainError) {
    evidence.push(
      evidenceFailed(
        "dataset_explain",
        "EXPLAIN_FAILED",
        `Dataset "${dataset.name}" failed EXPLAIN: ${formatSqlExecutorDiagnostic(explainError)}`,
        { artifactRef },
      ),
    );
    return { dataset: validatedDataset, ok: false, evidence, sourceKind };
  }
  evidence.push(
    evidencePassed(
      "dataset_explain",
      "EXPLAIN_PASSED",
      `Dataset "${dataset.name}" passed EXPLAIN validation.`,
      { artifactRef },
    ),
  );

  const execution = await executeAndValidateDataset({
    sql: validatedDataset.sql,
    datasetName: dataset.name,
    purpose: dataset.purpose,
    expectation: resultExpectation.expectation,
    sqlExecutor: deps.sql,
  });
  evidence.push(...execution.evidence.map((item) => ({ ...item, artifactRef })));
  if (lint && execution.ok) {
    evidence.push(
      evidencePassed(
        "dataset_static",
        "STATIC_LINT_PASSED",
        `Dataset "${dataset.name}" passed mandatory EXPLAIN and bounded execution after advisory static analysis.`,
        { artifactRef },
      ),
    );
  }
  if (
    !execution.ok &&
    !executionRepairAttempted &&
    isRepairableSqlExecutorDiagnostic(execution.repairDiagnostic)
  ) {
    try {
      const repair = await deps.reviewFn(validatedDataset.sql, {
        schemaContext,
        surface: deps.reviewSurface,
        requestFix: true,
        runtimeError: formatSqlExecutorDiagnostic(execution.repairDiagnostic),
      });
      if (!repair.fixedSql || repair.fixedSql.trim() === validatedDataset.sql.trim()) {
        evidence.push(
          evidenceFailed(
            "dataset_repair",
            "EXECUTION_REPAIR_FAILED",
            `Dataset "${dataset.name}" execution repair produced no distinct corrected SQL.`,
            { artifactRef },
          ),
        );
        return { dataset: validatedDataset, ok: false, evidence, sourceKind };
      }

      const repaired = await validateRequiredDataset(
        { ...validatedDataset, sql: repair.fixedSql },
        design,
        allowlist,
        schemaContext,
        deps,
        metricBindingOverride,
        true,
      );
      if (!repaired.ok) {
        return {
          ...repaired,
          evidence: [
            ...evidence,
            ...repaired.evidence,
            evidenceFailed(
              "dataset_repair",
              "EXECUTION_REPAIR_FAILED",
              `Dataset "${dataset.name}" failed validation after one execution repair attempt.`,
              { artifactRef },
            ),
          ],
        };
      }

      return {
        ...repaired,
        evidence: [
          ...evidence.map((item) =>
            item.stage === "dataset_execution" &&
            item.code === "SQL_EXECUTION_FAILED" &&
            item.status === "failed"
              ? evidenceSkipped(
                  "dataset_repair",
                  "EXECUTION_REPAIR_TRIGGERED",
                  `Dataset "${dataset.name}" had a repairable execution diagnostic; one bounded repair was attempted.`,
                  { artifactRef },
                )
              : item,
          ),
          ...repaired.evidence,
          evidencePassed(
            "dataset_repair",
            "EXECUTION_REPAIR_SUCCEEDED",
            `Dataset "${dataset.name}" passed all validation gates after one execution repair.`,
            { artifactRef },
          ),
        ],
      };
    } catch {
      evidence.push(
        evidenceFailed(
          "dataset_repair",
          "EXECUTION_REPAIR_FAILED",
          `Dataset "${dataset.name}" execution repair could not be completed.`,
          { artifactRef },
        ),
      );
    }
  }
  return { dataset: validatedDataset, ok: execution.ok, evidence, sourceKind };
}

export async function validateDashboardDesign(
  design: DashboardDesignV2,
  metadata: MetadataSnapshot,
  columnSchemas: string[],
  deps: DashboardValidationDeps,
): Promise<DashboardDesignValidationResult> {
  const evidence: ValidationEvidence[] = [...(deps.sourceResolutionEvidence ?? [])];
  if (evidence.some((item) => item.status === "failed")) {
    return { valid: false, design, evidence };
  }
  if (!design.datasets?.length || !Array.isArray(design.pages)) {
    evidence.push(
      evidenceFailed(
        "dashboard_design",
        "EMPTY_DESIGN",
        "Dashboard design must contain required datasets and pages.",
      ),
    );
    return { valid: false, design, evidence };
  }

  const allowlist = buildSchemaAllowlist(metadata);
  const datasetResults = await mapWithConcurrency(
    design.datasets.map(
      (dataset) => () =>
        validateRequiredDataset(dataset, design, allowlist, columnSchemas.join("\n"), deps),
    ),
    3,
  );
  for (const result of datasetResults) evidence.push(...result.evidence);
  const datasetSourceKind = summarizeDatasetSourceKind(
    datasetResults.map((result) => result.sourceKind),
  );
  if (datasetResults.some((result) => !result.ok)) {
    return { valid: false, design, evidence, datasetSourceKind };
  }

  const validatedDesign: DashboardDesignV2 = {
    ...design,
    datasets: datasetResults.map((result) => result.dataset),
    pages: design.pages.map((page) => ({
      ...page,
      widgets: [...page.widgets],
      filters: [...page.filters],
    })),
    globalFilters: [...design.globalFilters],
  };
  const datasetNames = new Set(validatedDesign.datasets.map((dataset) => dataset.name));
  const widgets = validatedDesign.pages.flatMap((page) => page.widgets);
  const filters = [
    ...validatedDesign.globalFilters,
    ...validatedDesign.pages.flatMap((page) => page.filters),
  ];
  const missingReferences = widgets.filter((widget) => !datasetNames.has(widget.datasetName));
  if (missingReferences.length > 0) {
    for (const widget of missingReferences) {
      evidence.push(
        evidenceFailed(
          "dashboard_design",
          "WIDGET_DATASET_MISSING",
          `Widget "${widget.title}" references missing dataset "${widget.datasetName}".`,
          { artifactRef: `widget:${widget.title}` },
        ),
      );
    }
    return { valid: false, design: validatedDesign, evidence, datasetSourceKind };
  }
  for (const filter of filters) {
    for (const binding of filter.bindings) {
      if (datasetNames.has(binding.datasetName)) continue;
      evidence.push(
        evidenceFailed(
          "dashboard_design",
          "FILTER_DATASET_MISSING",
          `Filter "${filter.title}" references missing dataset "${binding.datasetName}".`,
          { artifactRef: `filter:${filter.title}` },
        ),
      );
    }
  }
  if (evidence.some((item) => item.code === "FILTER_DATASET_MISSING")) {
    return { valid: false, design: validatedDesign, evidence, datasetSourceKind };
  }
  evidence.push(
    evidencePassed(
      "dashboard_design",
      "WIDGET_DATASET_REFERENCES_VALID",
      "Every dashboard widget references a required dataset.",
    ),
  );

  let serializedDashboard: SerializedLakeviewDashboard;
  try {
    serializedDashboard = assembleLakeviewDashboard(validatedDesign);
  } catch (error) {
    evidence.push(
      evidenceFailed(
        "dashboard_assembly",
        "ASSEMBLY_FAILED",
        `Dashboard assembly failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return { valid: false, design: validatedDesign, evidence, datasetSourceKind };
  }

  const contract = validateSerializedDashboard(serializedDashboard);
  evidence.push(...contract.evidence);
  evidence.push(
    ...contract.errors.map((error) =>
      evidenceFailed("dashboard_contract", error.code, error.message, {
        artifactRef: error.path,
      }),
    ),
  );
  return {
    valid: contract.valid,
    design: validatedDesign,
    serializedDashboard,
    evidence,
    datasetSourceKind,
  };
}

type DomainProcessResult =
  | { recommendation: DashboardRecommendation; failure?: never }
  | { recommendation?: never; failure: DashboardValidationFailure };

function mergeDashboardAdditions(
  existing: DashboardDesignV2,
  generated: DashboardDesignV2,
): DashboardDesignV2 {
  const mergeNamed = <T>(current: T[], additions: T[], name: (item: T) => string): T[] => {
    const byName = new Map(additions.map((item) => [name(item).toLowerCase(), item]));
    return [
      ...current.map((item) => byName.get(name(item).toLowerCase()) ?? item),
      ...additions.filter(
        (item) => !current.some((entry) => name(entry).toLowerCase() === name(item).toLowerCase()),
      ),
    ];
  };
  const unmatchedWidgets = generated.pages
    .filter(
      (page) =>
        !existing.pages.some((entry) => entry.name.toLowerCase() === page.name.toLowerCase()),
    )
    .flatMap((page) => page.widgets);
  return {
    ...existing,
    datasets: mergeNamed(existing.datasets, generated.datasets, (dataset) => dataset.name),
    pages: existing.pages.map((page, index) => {
      const generatedPage = generated.pages.find(
        (entry) => entry.name.toLowerCase() === page.name.toLowerCase(),
      );
      const additions = [
        ...(generatedPage?.widgets ?? []),
        ...(index === 0 ? unmatchedWidgets : []),
      ];
      return {
        ...page,
        widgets: mergeNamed(page.widgets, additions, (widget) => widget.title),
        filters: [...page.filters],
      };
    }),
    globalFilters: mergeNamed(
      existing.globalFilters,
      [...generated.globalFilters, ...generated.pages.flatMap((page) => page.filters)],
      (filter) => filter.title,
    ),
  };
}

async function processDomain(
  group: DashboardDomainGroup,
  metadata: MetadataSnapshot,
  endpoint: string,
  businessName: string,
  businessContext: import("@/lib/domain/types").BusinessContext | null,
  genieRecommendations: GenieEngineRecommendation[] | undefined,
  semanticManifest: SemanticAssetManifest | undefined,
  existingDashboard: DiscoveredDashboard | undefined,
  _runId: string | undefined,
  deps: {
    llm?: LLMClient;
    log: Logger;
    sql: SqlExecutor;
    reviewFn: typeof defaultReviewAndFixSql;
    isReviewEnabledFn: (surface?: string) => boolean;
  },
): Promise<DomainProcessResult> {
  const { log, reviewFn, isReviewEnabledFn } = deps;
  const columnSchemas = buildColumnSchemas(metadata, group.tables);
  const genieOutputs = getGenieOutputsForDomain(group.domain, genieRecommendations);
  const filterCandidates = getFilterCandidatesForDomain(metadata, group.tables, genieOutputs);
  const promptManifest = semanticManifest
    ? dashboardVisibleSemanticManifest(semanticManifest)
    : undefined;

  const prompt = buildDashboardDesignPrompt({
    businessName,
    businessContext,
    domain: group.domain,
    subdomains: group.subdomains,
    useCases: group.useCases,
    tables: group.tables,
    columnSchemas,
    measures: genieOutputs?.measures,
    dimensions: genieOutputs?.dimensions,
    filters: genieOutputs?.filters,
    filterCandidates,
    semanticManifest: promptManifest,
  });

  const messages: ChatMessage[] = [
    { role: "system", content: DASHBOARD_SYSTEM_MESSAGE },
    { role: "user", content: prompt },
  ];

  log.info("Dashboard Engine: calling LLM for domain", {
    domain: group.domain,
    useCaseCount: group.useCases.length,
    tableCount: group.tables.length,
  });

  let resultContent: string;
  if (deps.llm) {
    const resp = await deps.llm.chat({
      endpoint,
      messages,
      temperature: TEMPERATURE,
      responseFormat: "json_object",
    });
    resultContent = resp.content;
  } else {
    const result = await chatCompletion({
      endpoint,
      messages,
      temperature: TEMPERATURE,
      responseFormat: "json_object",
    });
    resultContent = result.content;
  }

  const parsed = parseLLMJson(resultContent, "dashboard:engine") as
    | DashboardDesign
    | DashboardDesignV2;
  const design =
    parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, "version")
      ? requireDashboardDesignV2(parsed)
      : adaptLegacyDashboardDesign(parsed as DashboardDesign);
  const resolved = resolveDatasetSources(design, semanticManifest);

  let designToValidate = resolved.design;
  let improveDiff: DashboardRecommendation["improveDiff"];
  if (existingDashboard) {
    if (!existingDashboard.dashboardDesign || !existingDashboard.liveSerializedFingerprint) {
      return {
        failure: {
          domain: group.domain,
          evidence: [
            evidenceFailed(
              "dashboard_improve",
              "DASHBOARD_IMPROVE_EXISTING_IR_REQUIRED",
              `Existing dashboard "${existingDashboard.dashboardId}" has no live-verified typed design for an additive improvement.`,
              { artifactRef: `dashboard:${existingDashboard.dashboardId}` },
            ),
          ],
        },
      };
    }
    try {
      const desiredMerged = mergeDashboardAdditions(
        existingDashboard.dashboardDesign,
        resolved.design,
      );
      improveDiff = buildDashboardImproveDiff(
        existingDashboard.dashboardId,
        existingDashboard.dashboardDesign,
        desiredMerged,
        existingDashboard.liveSerializedFingerprint,
      );
      designToValidate = applyDashboardImproveDiff(existingDashboard.dashboardDesign, improveDiff);
    } catch (error) {
      const message =
        error instanceof DashboardImproveConflictError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      return {
        failure: {
          domain: group.domain,
          evidence: [
            evidenceFailed("dashboard_improve", "DASHBOARD_IMPROVE_CONFLICT", message, {
              artifactRef: `dashboard:${existingDashboard.dashboardId}`,
            }),
          ],
        },
      };
    }
  }

  const validation = await validateDashboardDesign(designToValidate, metadata, columnSchemas, {
    log,
    sql: deps.sql,
    reviewFn,
    isReviewEnabledFn,
    reviewSurface: "dashboard",
    metricBindings: resolved.metricBindings,
    sourceResolutionEvidence: resolved.evidence,
  });
  if (!validation.valid || !validation.serializedDashboard) {
    log.warn("Dashboard Engine: recommendation failed validation", {
      domain: group.domain,
      validationEvidence: validation.evidence,
    });
    return {
      failure: {
        domain: group.domain,
        evidence: validation.evidence,
      },
    };
  }

  const useCaseIds = group.useCases.map((uc) => uc.id);
  const recommendation = buildDashboardRecommendation(
    validation.design,
    validation.serializedDashboard,
    group.domain,
    group.subdomains,
    businessName,
    useCaseIds,
  );
  recommendation.validationStatus = "valid";
  recommendation.validatorVersion = DASHBOARD_VALIDATOR_VERSION;
  recommendation.validationEvidence = validation.evidence;
  recommendation.validatedAt = new Date().toISOString();
  recommendation.datasetSourceKind = validation.datasetSourceKind ?? resolved.datasetSourceKind;
  const emptyImproveDiff =
    improveDiff &&
    improveDiff.addDatasets.length === 0 &&
    improveDiff.addWidgets.length === 0 &&
    improveDiff.addFilters.length === 0;
  recommendation.classification = existingDashboard
    ? emptyImproveDiff
      ? "reuse"
      : "improve"
    : "new";
  recommendation.recommendationType = toPersistedDashboardRecommendationType(
    recommendation.classification,
  );
  if (existingDashboard && improveDiff) {
    recommendation.existingAssetId = existingDashboard.dashboardId;
    recommendation.improveDiff = improveDiff;
    recommendation.improveBaseDesign = existingDashboard.dashboardDesign;
    recommendation.changeSummary = emptyImproveDiff
      ? `Reuse "${existingDashboard.displayName}" without mutation.`
      : `Add ${improveDiff.addDatasets.length} datasets, ${improveDiff.addWidgets.length} widgets, and ${improveDiff.addFilters.length} filters to "${existingDashboard.displayName}".`;
  }
  if (!isDashboardValidationDeployable(recommendation)) {
    const evidence = [
      ...(recommendation.validationEvidence ?? []),
      evidenceFailed(
        "dashboard_provenance",
        "VALIDATION_PROVENANCE_INCOMPLETE",
        `Dashboard recommendation for domain "${group.domain}" did not contain complete deployable validation provenance.`,
        { artifactRef: `domain:${group.domain}` },
      ),
    ];
    log.warn("Dashboard Engine: recommendation has incomplete validation provenance", {
      domain: group.domain,
      validationEvidence: evidence,
    });
    return {
      failure: {
        domain: group.domain,
        evidence,
      },
    };
  }
  return { recommendation };
}

/**
 * Run the Dashboard Engine pipeline.
 *
 * Produces one dashboard recommendation per domain with SQL datasets
 * and Lakeview-compatible widget specifications.
 */
export async function runDashboardEngine(
  input: DashboardEngineInput,
): Promise<DashboardEngineResult> {
  const {
    run,
    useCases,
    metadata,
    genieRecommendations,
    semanticManifests,
    existingDashboards = [],
    domainFilter,
    onProgress,
    deps: inputDeps,
  } = input;

  const log: Logger = inputDeps?.logger ?? defaultLogger;
  const llm: LLMClient | undefined = inputDeps?.llm;
  const sql = inputDeps?.sql ?? databricksSqlExecutor;
  const reviewFn = inputDeps?.reviewAndFixSql ?? defaultReviewAndFixSql;
  const isReviewEnabledFn = inputDeps?.isReviewEnabled ?? defaultIsReviewEnabled;
  const wireDeps = { llm, log, sql, reviewFn, isReviewEnabledFn };

  const endpoint = resolveEndpoint("generation");
  const businessName = run.config.businessName;
  const businessContext = run.businessContext;

  log.info("Dashboard Engine starting", {
    runId: run.runId,
    useCaseCount: useCases.length,
    tableCount: metadata.tableCount,
  });

  onProgress?.("Grouping use cases by domain...", 5);

  const domainGroups = selectDashboardDomainGroups(useCases, domainFilter);

  if (domainGroups.length === 0) {
    log.warn("No domain groups for dashboard generation", {
      runId: run.runId,
      domainFilter,
    });
    return { recommendations: [], validationFailures: [] };
  }

  const manifestsByDomain = semanticManifests
    ? indexSemanticManifests(semanticManifests)
    : new Map<string, SemanticAssetManifest>();
  const missingManifestDomains =
    semanticManifests === undefined
      ? []
      : missingDashboardManifestDomains(domainGroups, semanticManifests);
  const validationFailures: DashboardValidationFailure[] = missingManifestDomains.map((domain) => ({
    domain,
    evidence: [
      evidenceFailed(
        "semantic_manifest",
        "SEMANTIC_MANIFEST_MISSING",
        `No persisted semantic manifest is available for dashboard domain "${domain}".`,
        { artifactRef: `domain:${domain}` },
      ),
    ],
  }));
  const processableGroups =
    semanticManifests === undefined
      ? domainGroups
      : domainGroups.filter((group) =>
          manifestsByDomain.has(normalizeDashboardDomain(group.domain)),
        );

  // Build existing-dashboard-to-domain mapping for enhancement detection
  const existingDashboardByDomain = new Map<string, DiscoveredDashboard>();
  if (existingDashboards.length > 0) {
    const verifiedExistingDashboards = existingDashboards.filter(
      (dashboard) => dashboard.dashboardDesign && dashboard.liveSerializedFingerprint,
    );
    for (const group of processableGroups) {
      const domainTableSet = new Set(group.tables.map((t) => t.toLowerCase()));
      let bestMatch: { dashboard: DiscoveredDashboard; overlap: number } | null = null;
      for (const dash of verifiedExistingDashboards) {
        const overlap = dash.tables.filter((t) => domainTableSet.has(t.toLowerCase())).length;
        if (overlap > 0 && (!bestMatch || overlap > bestMatch.overlap)) {
          bestMatch = { dashboard: dash, overlap };
        }
      }
      if (bestMatch && bestMatch.overlap >= 1) {
        existingDashboardByDomain.set(group.domain, bestMatch.dashboard);
      }
    }
    if (existingDashboardByDomain.size > 0) {
      log.info("Existing dashboard mapping", {
        totalExisting: existingDashboards.length,
        verifiedExisting: verifiedExistingDashboards.length,
        domainsWithExisting: existingDashboardByDomain.size,
      });
    }
  }

  log.info("Dashboard Engine: processing domains", {
    domainCount: processableGroups.length,
    domains: processableGroups.map((g) => g.domain),
    missingManifestDomains,
  });

  const recommendations: DashboardRecommendation[] = [];
  const domainResults = await mapWithConcurrency(
    processableGroups.map((group, i) => async () => {
      const pct = Math.round(10 + (i / processableGroups.length) * 85);
      onProgress?.(`Designing dashboard for ${group.domain}...`, pct);
      try {
        const outcome = await processDomain(
          group,
          metadata,
          endpoint,
          businessName,
          businessContext,
          genieRecommendations,
          manifestsByDomain.get(normalizeDashboardDomain(group.domain)),
          existingDashboardByDomain.get(group.domain),
          run.runId,
          wireDeps,
        );
        if (outcome.recommendation) {
          const rec = outcome.recommendation;
          log.info("Dashboard Engine: domain complete", {
            domain: group.domain,
            datasets: rec.datasetCount,
            widgets: rec.widgetCount,
          });
          return outcome;
        }
        return outcome;
      } catch (err) {
        const diagnostic = safeErrorMetadata(err, "Dashboard domain generation failed.");
        log.error("Dashboard Engine: domain failed", {
          domain: group.domain,
          ...diagnostic,
        });
        return {
          failure: {
            domain: group.domain,
            evidence: [
              evidenceFailed(
                "dashboard_engine",
                "DOMAIN_GENERATION_FAILED",
                `Dashboard generation failed for domain "${group.domain}" (${diagnostic.errorName}).`,
              ),
            ],
          },
        } satisfies DomainProcessResult;
      }
    }),
    3,
  );
  for (const outcome of domainResults) {
    if (outcome.recommendation) recommendations.push(outcome.recommendation);
    if (outcome.failure) validationFailures.push(outcome.failure);
  }

  onProgress?.("Dashboard generation complete", 100);

  log.info("Dashboard Engine complete", {
    runId: run.runId,
    recommendationCount: recommendations.length,
    validationFailureCount: validationFailures.length,
    domains: recommendations.map((r) => r.domain),
  });

  return { recommendations, validationFailures };
}
