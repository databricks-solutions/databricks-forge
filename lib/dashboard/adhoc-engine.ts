/**
 * Ad-Hoc Dashboard Engine — intent-aware dashboard generator from a table
 * list and Ask Forge conversation context.
 *
 * Mirrors the Genie ad-hoc engine pattern (lib/genie/adhoc-engine.ts):
 * scrapes metadata from information_schema, maps conversation context into
 * the dashboard design prompt, then runs the proven engine pipeline
 * (buildDashboardDesignPrompt → LLM → assembleLakeviewDashboard).
 *
 * The conversation context is what makes the dashboard purpose-built:
 *   - conversationSummary  → businessContext.strategicGoals
 *   - widgetDescriptions   → synthetic use case statements
 *   - domainHint           → domain
 *   - sqlBlocks            → synthetic use case SQL
 */

import type { UseCase, BusinessContext, ColumnInfo, MetadataSnapshot } from "@/lib/domain/types";
import type {
  DashboardDesign,
  DashboardEngineDeps,
  DashboardRecommendation,
  FilterCandidate,
} from "./types";
import type { DashboardDesignV2 } from "./design-ir";
import { requireDashboardDesignV2 } from "./design-ir";
import { adaptLegacyDashboardDesign } from "./legacy-design-adapter";
import { buildDashboardDesignPrompt, DASHBOARD_SYSTEM_MESSAGE } from "./prompts";
import { buildDashboardRecommendation } from "./assembler";
import { validateDashboardDesign } from "./engine";
import { chatCompletion, type ChatMessage } from "@/lib/dbx/model-serving";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { fetchTableInfoBatch, fetchColumnsBatch } from "@/lib/queries/metadata";
import { reviewAndFixSql as defaultReviewAndFixSql } from "@/lib/ai/sql-reviewer";
import { dashboardDeployDependencies, deployDashboardDraftAndVerify } from "./deploy-lifecycle";
import { DEFAULT_DASHBOARD_PARENT_PATH } from "@/lib/dbx/dashboards";
import {
  resolveEndpoint,
  getConfig,
  isReviewEnabled as defaultIsReviewEnabled,
} from "@/lib/dbx/client";
import { createScopedLogger } from "@/lib/logger";
import { databricksSqlExecutor } from "@/lib/ports/defaults/databricks-sql-executor";
import { DASHBOARD_VALIDATOR_VERSION, evidenceFailed } from "@/lib/validation/evidence";
import { DashboardValidationError } from "./errors";
import { isDashboardValidationDeployable } from "./deployability";
export { DashboardValidationError } from "./errors";

const TEMPERATURE = 0.3;

export interface AdHocDashboardInput {
  tables: string[];
  sqlBlocks?: string[];
  conversationSummary?: string;
  widgetDescriptions?: string[];
  domainHint?: string;
  title?: string;
  deploy?: boolean;
  publish?: boolean;
  embedCredentials?: boolean;
  /** Injectable dependencies for portability and testing. */
  deps?: DashboardEngineDeps;
}

export interface AdHocDashboardResult {
  recommendation: DashboardRecommendation;
  dashboardId?: string;
  displayName?: string;
  dashboardUrl?: string;
  publicationStatus?: "draft" | "published" | "publish_failed";
  publishError?: string;
}

function buildColumnSchemas(columns: ColumnInfo[], tableFqns: string[]): string[] {
  const targetSet = new Set(tableFqns.map((f) => f.toLowerCase()));
  const columnsByTable = new Map<string, string[]>();

  for (const c of columns) {
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

/**
 * Build synthetic UseCase objects from conversation context.
 *
 * Widget descriptions become use case statements (telling the LLM what
 * to visualise). SQL blocks become use case SQL (giving the LLM
 * ready-made queries to refine into datasets). When neither is available,
 * a generic use case per table is created.
 */
function synthesiseUseCases(
  tables: string[],
  sqlBlocks: string[],
  widgetDescriptions: string[],
  domainHint: string,
): UseCase[] {
  const useCases: UseCase[] = [];
  const base = {
    id: "",
    runId: "",
    useCaseNo: 0,
    type: "Statistical" as const,
    analyticsTechnique: "Dashboard",
    solution: "",
    businessValue: "",
    beneficiary: "",
    sponsor: "",
    domain: domainHint || "General",
    subdomain: "",
    priorityScore: 0.8,
    feasibilityScore: 0.8,
    impactScore: 0.8,
    overallScore: 0.8,
    userPriorityScore: null,
    userFeasibilityScore: null,
    userImpactScore: null,
    userOverallScore: null,
    scoreRationale: null,
    consultingScorecard: null,
    sqlStatus: null,
    feedback: null,
    feedbackAt: null,
    enrichmentTags: null,
    sourceSystems: null,
    sourceSystemsOrigin: null,
    blastRadius: null,
    referenceUseCaseName: null,
    referenceUseCaseResolvedAt: null,
  };

  if (widgetDescriptions.length > 0) {
    for (let i = 0; i < widgetDescriptions.length; i++) {
      useCases.push({
        ...base,
        useCaseNo: i + 1,
        name: widgetDescriptions[i].slice(0, 80),
        statement: widgetDescriptions[i],
        tablesInvolved: tables,
        sqlCode: sqlBlocks[i] ?? null,
      });
    }
  }

  if (sqlBlocks.length > widgetDescriptions.length) {
    for (let i = widgetDescriptions.length; i < sqlBlocks.length; i++) {
      useCases.push({
        ...base,
        useCaseNo: useCases.length + 1,
        name: `Query ${i + 1}`,
        statement: `Analyse data from ${tables
          .slice(0, 3)
          .map((t) => t.split(".").pop())
          .join(", ")}`,
        tablesInvolved: tables,
        sqlCode: sqlBlocks[i],
      });
    }
  }

  if (useCases.length === 0) {
    for (let i = 0; i < tables.length; i++) {
      const tableName = tables[i].split(".").pop() ?? tables[i];
      useCases.push({
        ...base,
        useCaseNo: i + 1,
        name: `Analyse ${tableName}`,
        statement: `Analyse key metrics and trends from ${tableName}`,
        tablesInvolved: [tables[i]],
        sqlCode: null,
      });
    }
  }

  return useCases;
}

function buildFilterCandidatesFromColumns(
  columns: ColumnInfo[],
  tableFqns: string[],
): FilterCandidate[] {
  const candidates: FilterCandidate[] = [];
  const targetSet = new Set(tableFqns.map((f) => f.toLowerCase()));
  const seen = new Set<string>();

  for (const col of columns) {
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

function buildBusinessContext(conversationSummary?: string): BusinessContext | null {
  if (!conversationSummary) return null;
  return {
    industries: "",
    strategicGoals: conversationSummary,
    businessPriorities: "",
    strategicInitiative: "",
    valueChain: "",
    revenueModel: "",
    additionalContext: "",
  };
}

/**
 * Run the ad-hoc dashboard engine.
 *
 * Scrapes metadata for the given tables, synthesises use cases from
 * conversation context, calls the LLM to design a Lakeview dashboard,
 * and optionally deploys it to the Databricks workspace.
 */
export async function runAdHocDashboardEngine(
  input: AdHocDashboardInput,
): Promise<AdHocDashboardResult> {
  const inputDeps = input.deps;
  const log =
    inputDeps?.logger ??
    createScopedLogger({
      origin: "DashboardEngine",
      module: "dashboard/adhoc-engine",
    });
  const sql = inputDeps?.sql ?? databricksSqlExecutor;
  const reviewFn = inputDeps?.reviewAndFixSql ?? defaultReviewAndFixSql;
  const isReviewEnabledFn = inputDeps?.isReviewEnabled ?? defaultIsReviewEnabled;
  const {
    tables,
    sqlBlocks = [],
    conversationSummary,
    widgetDescriptions = [],
    domainHint = "",
    title,
    deploy = false,
    publish = false,
    embedCredentials = false,
  } = input;

  log.info("Ad-hoc Dashboard Engine starting", {
    tableCount: tables.length,
    sqlBlockCount: sqlBlocks.length,
    widgetCount: widgetDescriptions.length,
    domainHint: domainHint || "(none)",
    deploy,
  });

  const [tableInfos, columns] = await Promise.all([
    fetchTableInfoBatch(tables),
    fetchColumnsBatch(tables),
  ]);

  if (columns.length === 0) {
    throw new Error("Could not retrieve column metadata for the specified tables");
  }

  const columnSchemas = buildColumnSchemas(columns, tables);
  const useCases = synthesiseUseCases(tables, sqlBlocks, widgetDescriptions, domainHint);
  const businessContext = buildBusinessContext(conversationSummary);
  const domain = domainHint || tableInfos[0]?.schema || "General";
  const businessName = title || "Ask Forge";
  const filterCandidates = buildFilterCandidatesFromColumns(columns, tables);

  const prompt = buildDashboardDesignPrompt({
    businessName,
    businessContext,
    domain,
    subdomains: [],
    useCases,
    tables,
    columnSchemas,
    filterCandidates,
  });

  const messages: ChatMessage[] = [
    { role: "system", content: DASHBOARD_SYSTEM_MESSAGE },
    { role: "user", content: prompt },
  ];

  log.info("Ad-hoc Dashboard Engine: calling LLM", {
    useCaseCount: useCases.length,
    columnSchemaCount: columnSchemas.length,
  });

  const endpoint = resolveEndpoint("generation");
  const resultContent = inputDeps?.llm
    ? (
        await inputDeps.llm.chat({
          endpoint,
          messages,
          temperature: TEMPERATURE,
          responseFormat: "json_object",
        })
      ).content
    : (
        await chatCompletion({
          endpoint,
          messages,
          temperature: TEMPERATURE,
          responseFormat: "json_object",
        })
      ).content;

  const parsed = parseLLMJson(resultContent, "adhoc-dashboard") as
    | DashboardDesign
    | DashboardDesignV2;
  const parsedDesign =
    parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, "version")
      ? requireDashboardDesignV2(parsed)
      : adaptLegacyDashboardDesign(parsed as DashboardDesign);
  const design: DashboardDesignV2 = {
    ...parsedDesign,
    datasets: parsedDesign.datasets.map((dataset) => ({
      ...dataset,
      sourceKind: "table",
      metricViewFqn: undefined,
      metricIds: [],
      dimensionIds: [],
    })),
  };

  // Validate dataset SQL against the actual schema to catch hallucinated columns
  const metadata: Pick<MetadataSnapshot, "tables" | "columns" | "metricViews"> = {
    tables: tableInfos,
    columns,
    metricViews: [],
  };
  const validation = await validateDashboardDesign(
    design,
    metadata as MetadataSnapshot,
    columnSchemas,
    {
      log,
      sql,
      reviewFn,
      isReviewEnabledFn,
      reviewSurface: "adhoc-dashboard",
    },
  );
  if (!validation.valid || !validation.serializedDashboard) {
    log.warn("Ad-hoc Dashboard Engine: recommendation failed validation", {
      validationEvidence: validation.evidence,
    });
    const failedCodes = validation.evidence
      .filter((item) => item.status === "failed")
      .map((item) => item.code);
    throw new DashboardValidationError(
      `Dashboard recommendation validation failed: ${failedCodes.join(", ")}`,
      [{ domain, evidence: validation.evidence }],
    );
  }
  const useCaseIds = useCases.map((uc) => uc.id);

  const recommendation = buildDashboardRecommendation(
    validation.design,
    validation.serializedDashboard,
    domain,
    [],
    businessName,
    useCaseIds,
  );
  recommendation.validationStatus = "valid";
  recommendation.validatorVersion = DASHBOARD_VALIDATOR_VERSION;
  recommendation.validationEvidence = validation.evidence;
  recommendation.validatedAt = new Date().toISOString();
  if (!isDashboardValidationDeployable(recommendation)) {
    const evidence = [
      ...(recommendation.validationEvidence ?? []),
      evidenceFailed(
        "dashboard_provenance",
        "VALIDATION_PROVENANCE_INCOMPLETE",
        `Dashboard recommendation for domain "${domain}" did not contain complete deployable validation provenance.`,
        { artifactRef: `domain:${domain}` },
      ),
    ];
    log.warn("Ad-hoc Dashboard Engine: recommendation has incomplete validation provenance", {
      validationEvidence: evidence,
    });
    throw new DashboardValidationError("Dashboard recommendation is not deployable", [
      { domain, evidence },
    ]);
  }

  log.info("Ad-hoc Dashboard Engine: design complete", {
    datasets: recommendation.datasetCount,
    widgets: recommendation.widgetCount,
  });

  if (!deploy) {
    return { recommendation };
  }
  const config = getConfig();
  const deployResult = await deployDashboardDraftAndVerify(
    {
      mode: "create",
      displayName: recommendation.title,
      serializedDashboard: recommendation.serializedDashboard,
      warehouseId: config.warehouseId,
      parentPath: DEFAULT_DASHBOARD_PARENT_PATH,
      publish,
      embedCredentials,
      auth: { mode: "app" },
    },
    dashboardDeployDependencies,
  );

  const dashboardId = deployResult.dashboardId;
  const dashboardUrl = `${config.host}/sql/dashboardsv3/${dashboardId}`;

  log.info("Ad-hoc Dashboard Engine: deployed", {
    dashboardId,
    dashboardUrl,
    publicationStatus: deployResult.publicationStatus,
  });

  return {
    recommendation,
    dashboardId,
    displayName: deployResult.displayName,
    dashboardUrl,
    publicationStatus: deployResult.publicationStatus,
    publishError: deployResult.publishError,
  };
}
