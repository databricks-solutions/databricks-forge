/**
 * Ask Forge engine -- orchestrates the conversational AI assistant.
 *
 * Coordinates intent detection, RAG context building, LLM streaming,
 * and action extraction into a unified pipeline that powers the
 * conversational panel.
 */

import { classifyIntent, type AssistantIntent, type IntentClassification } from "./intent";
import {
  buildAssistantContext,
  buildSourceReferences,
  type AssistantContext,
  type TableEnrichment,
} from "./context-builder";
import { extractTableFqnsFromText, mergeTableReferenceLists } from "./context-builder";
import { buildAssistantMessages, type AssistantPersona } from "./prompts";
import { resolveForIntent, type AskForgeIntent } from "@/lib/skills";
import {
  extractSqlBlocks,
  validateSql,
  isColumnResolutionError,
  buildSqlFixPrompt,
} from "./sql-proposer";
import { validateColumnReferences } from "@/lib/validation/sql-columns";
import { extractDashboardIntent, type DashboardProposal } from "./dashboard-proposer";
import { retrieveContext } from "@/lib/embeddings/retriever";
import { isEmbeddingEnabled } from "@/lib/embeddings/config";
import {
  chatCompletion,
  chatCompletionStream,
  type StreamCallback,
  type TokenUsage,
} from "@/lib/dbx/model-serving";
import { resolveEndpoint, isReviewEnabled, getConfig } from "@/lib/dbx/client";
import { reviewAndFixSql } from "@/lib/ai/sql-reviewer";
import { createAssistantLog } from "@/lib/lakebase/assistant-log";
import { listTrackedGenieSpaces } from "@/lib/lakebase/genie-spaces";
import { insertQualityMetrics } from "@/lib/lakebase/quality-metrics";
import { scoreAssistantResponse } from "@/lib/assistant/evaluation";
import { createScopedLogger } from "@/lib/logger";

const log = createScopedLogger({ origin: "AskForge", module: "assistant/engine" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ActionCard {
  type:
    | "run_sql"
    | "deploy_notebook"
    | "deploy_dashboard"
    | "create_genie_space"
    | "view_tables"
    | "view_erd"
    | "start_discovery"
    | "export_report"
    | "view_run"
    | "ask_genie"
    | "view_portfolio"
    | "generate_business_case"
    | "view_stakeholders"
    | "view_roadmap"
    | "draft_executive_memo";
  label: string;
  payload: Record<string, unknown>;
}

export interface SourceCard {
  index: number;
  label: string;
  kind: string;
  sourceId: string;
  score: number;
  metadata: Record<string, unknown> | null;
}

export interface ExistingDashboard {
  sourceId: string;
  title: string;
  score: number;
  metadata: Record<string, unknown> | null;
}

export interface AssistantResponse {
  answer: string;
  intent: IntentClassification;
  sources: SourceCard[];
  actions: ActionCard[];
  tables: string[];
  tableEnrichments: TableEnrichment[];
  sqlBlocks: string[];
  chatMentionedTables: string[];
  dashboardProposal: DashboardProposal | null;
  existingDashboards: ExistingDashboard[];
  tokenUsage: TokenUsage | null;
  durationMs: number;
  logId: string | null;
}

export function inferTablesFromSqlBlocks(sqlBlocks: string[]): string[] {
  return extractTableFqnsFromText(sqlBlocks.join("\n"));
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Run the full assistant pipeline: classify -> context -> stream -> extract.
 *
 * The `onChunk` callback is invoked for each streaming content delta,
 * enabling real-time SSE streaming to the client.
 */
export async function runAssistantEngine(
  question: string,
  history: ConversationTurn[] = [],
  onChunk?: StreamCallback,
  sessionId?: string,
  userId?: string | null,
  persona: AssistantPersona = "business",
  signal?: AbortSignal,
): Promise<AssistantResponse> {
  const start = Date.now();

  const intentResult = await classifyIntent(question);
  log.info("Intent classified", {
    intent: intentResult.intent,
    confidence: intentResult.confidence,
  });

  const context: AssistantContext = await buildAssistantContext(
    question,
    intentResult.intent,
    history,
    persona,
    userId ?? null,
  );

  // Short-circuit when no data exists -- avoid burning LLM tokens on generic answers
  if (context.hasDataGaps) {
    const noDataAnswer = `**No data available yet.**\n\nAsk Forge needs data from your Unity Catalog estate to provide grounded answers. To get started:\n\n1. **Run an Environment Scan** -- go to the Environment page and scan your catalogs\n2. **Run a Discovery Pipeline** -- go to Configure and generate use cases\n3. **Upload documents** to the Knowledge Base for additional context\n\nOnce data is available, I can answer questions about your tables, columns, health, lineage, and more.`;

    if (onChunk) {
      onChunk(noDataAnswer);
    }

    let logId: string | null = null;
    try {
      logId = await createAssistantLog({
        sessionId: sessionId ?? "anonymous",
        question,
        intent: intentResult.intent,
        intentConfidence: intentResult.confidence,
        response: noDataAnswer,
        durationMs: Date.now() - start,
        userId: userId ?? "anonymous",
        persona,
      });
    } catch {
      // best-effort logging
    }

    return {
      answer: noDataAnswer,
      intent: intentResult,
      sources: [],
      actions: [{ type: "start_discovery", label: "Start Discovery", payload: {} }],
      tables: [],
      tableEnrichments: [],
      sqlBlocks: [],
      chatMentionedTables: [],
      dashboardProposal: null,
      existingDashboards: [],
      tokenUsage: null,
      durationMs: Date.now() - start,
      logId,
    };
  }

  const sources = buildSourceReferences(context.chunks);

  let skillsSystemOverlay: string | undefined;
  try {
    const resolved = resolveForIntent(intentResult.intent as AskForgeIntent);
    if (resolved.systemOverlay) skillsSystemOverlay = resolved.systemOverlay;
  } catch {
    // non-fatal: skills overlay is optional
  }

  const { system, user } = buildAssistantMessages(
    context.ragContext,
    context.conversationHistory,
    question,
    persona,
    skillsSystemOverlay,
  );

  const llmResponse = await chatCompletionStream(
    {
      endpoint: resolveEndpoint("reasoning"),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.3,
      maxTokens: 16384,
      signal,
    },
    onChunk,
  );

  let answer = llmResponse.content;
  if (context.lowConfidenceRetrieval) {
    answer = `${answer}\n\n### Confidence Note\nRetrieved context relevance is weak for this question. Validate critical decisions against source metadata before execution.`;
  }
  const sqlBlocks = extractSqlBlocks(answer);

  // --- Parallel post-stream: SQL validation, dashboard lookup, Genie RAG ---

  type SqlFix = { index: number; original: string; fixed: string };

  const validateSqlBlocksParallel = async (): Promise<SqlFix[]> => {
    if (sqlBlocks.length === 0 || !context.tableEnrichments.some((e) => e.columns.length > 0)) {
      return [];
    }
    const knownCols = context.tableEnrichments.flatMap((t) =>
      t.columns.map((c) => ({ tableFqn: t.tableFqn, name: c.name, dataType: c.dataType })),
    );
    const knownColumnNames = new Set(knownCols.map((c) => c.name.toLowerCase()));

    const results = await Promise.allSettled(
      sqlBlocks.map(async (sql, i): Promise<SqlFix | null> => {
        try {
          const staticResult = validateColumnReferences(sql, knownColumnNames, {
            allowAiFunctionFields: true,
          });

          const errorToFix =
            staticResult.unknownColumns.length > 0
              ? `SCHEMA VIOLATION: SQL references columns that do not exist: ${staticResult.unknownColumns.join(", ")}. Use ONLY columns from the provided schema.`
              : await validateSql(sql);

          if (
            errorToFix &&
            (staticResult.unknownColumns.length > 0 || isColumnResolutionError(errorToFix))
          ) {
            log.info("SQL column error, attempting fix", {
              blockIndex: i,
              staticHallucinations: staticResult.unknownColumns.length,
              error: errorToFix.slice(0, 200),
            });

            const fixPrompt = buildSqlFixPrompt(sql, errorToFix, knownCols);
            const fixResponse = await chatCompletion({
              endpoint: resolveEndpoint("reasoning"),
              messages: [
                {
                  role: "system",
                  content: "You are a SQL fixer. Return ONLY corrected SQL in a ```sql block.",
                },
                { role: "user", content: fixPrompt },
              ],
              temperature: 0.1,
              maxTokens: 4096,
            });

            const fixedBlocks = extractSqlBlocks(fixResponse.content);
            if (fixedBlocks.length > 0) {
              const recheck = await validateSql(fixedBlocks[0]);
              if (!recheck) {
                log.info("SQL fix successful", { blockIndex: i });
                return { index: i, original: sql, fixed: fixedBlocks[0] };
              }
              log.warn("SQL fix still fails EXPLAIN", {
                blockIndex: i,
                error: recheck.slice(0, 200),
                errorCategory: "sql_validation",
              });
            }
          }
          return null;
        } catch (err) {
          log.warn("SQL validation/fix failed (non-fatal)", {
            blockIndex: i,
            error: err instanceof Error ? err.message : String(err),
            errorCategory: "non_fatal",
          });
          return null;
        }
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<SqlFix | null> => r.status === "fulfilled")
      .map((r) => r.value)
      .filter((v): v is SqlFix => v !== null);
  };

  const lookupDashboardsAsync = async (): Promise<ExistingDashboard[]> => {
    if (intentResult.intent !== "dashboard") return [];
    try {
      const { withPrisma } = await import("@/lib/prisma");
      const dbDashboards = await withPrisma(async (prisma) =>
        prisma.forgeDashboardRecommendation.findMany({
          select: { id: true, title: true, domain: true, description: true },
          take: 5,
          orderBy: { createdAt: "desc" },
        }),
      );
      return dbDashboards.map((d) => ({
        sourceId: d.id,
        title: d.title,
        score: 1.0,
        metadata: { domain: d.domain, description: d.description },
      }));
    } catch {
      return [];
    }
  };

  const lookupGenieAsync = async (): Promise<{
    spaceTitle: string;
    spaceId: string;
    score: number;
  } | null> => {
    if (!isEmbeddingEnabled()) return null;
    try {
      const genieChunks = await retrieveContext(question, {
        kinds: ["genie_recommendation", "genie_question"],
        topK: 1,
        minScore: 0.7,
        userEmail: userId ?? null,
      });
      if (genieChunks.length > 0) {
        const m = genieChunks[0].metadata ?? {};
        let spaceId = m.spaceId as string | undefined;
        const spaceTitle = (m.spaceTitle as string) ?? (m.title as string) ?? "Genie Space";
        const domain = m.domain as string | undefined;

        // RAG embeddings may not store the deployed spaceId -- resolve via tracked spaces
        if (!spaceId && domain && userId) {
          try {
            const tracked = await listTrackedGenieSpaces({ ownerEmail: userId });
            const match = tracked.find((t) => t.domain === domain && t.status !== "trashed");
            spaceId = match?.spaceId;
          } catch {
            // best-effort lookup
          }
        }

        // Validate spaceId looks like a real Databricks ID (UUID or hex)
        const isValidId = spaceId && /^[0-9a-f-]{32,36}$/i.test(spaceId);
        if (!isValidId) return null;

        return { spaceTitle, spaceId: spaceId!, score: genieChunks[0].score };
      }
    } catch {
      // best-effort Genie routing
    }
    return null;
  };

  const [sqlFixes, existingDashboards, genieSpaceMatch] = await Promise.all([
    validateSqlBlocksParallel(),
    lookupDashboardsAsync(),
    lookupGenieAsync(),
  ]);

  for (const fix of sqlFixes) {
    answer = answer.replace(fix.original, fix.fixed);
    sqlBlocks[fix.index] = fix.fixed;
  }

  // LLM review gate: review + fix SQL blocks, apply fixes and append quality notes
  if (isReviewEnabled("assistant") && sqlBlocks.length > 0) {
    const knownCols = context.tableEnrichments.flatMap((t) =>
      t.columns.map((c) => `${t.tableFqn}: ${c.name} (${c.dataType})`),
    );
    const schemaCtx = knownCols.join("\n");
    const reviews = await Promise.allSettled(
      sqlBlocks.map((sql) =>
        reviewAndFixSql(sql, { schemaContext: schemaCtx, surface: "assistant" }),
      ),
    );
    const warnings: string[] = [];
    for (let i = 0; i < reviews.length; i++) {
      const r = reviews[i];
      if (r.status !== "fulfilled") continue;
      const review = r.value;
      if (review.fixedSql && review.verdict !== "pass") {
        const oldSql = sqlBlocks[i];
        sqlBlocks[i] = review.fixedSql;
        answer = answer.replace(oldSql, review.fixedSql);
        log.info("Review applied SQL fix", {
          blockIndex: i,
          qualityScore: review.qualityScore,
        });
      }
      if (review.verdict !== "pass") {
        const warnMsgs = review.issues
          .filter((issue) => issue.severity !== "info")
          .map((issue) => issue.message);
        if (warnMsgs.length > 0) {
          warnings.push(`SQL block ${i + 1}: ${warnMsgs.join("; ")}`);
        }
      }
    }
    if (warnings.length > 0) {
      answer = `${answer}\n\n> **SQL Quality Notes:** ${warnings.join(" | ")}`;
    }
  }

  const sqlTables = inferTablesFromSqlBlocks(sqlBlocks);
  const questionTables = extractTableFqnsFromText(question);
  const reconciledTables = mergeTableReferenceLists(context.tables, sqlTables);
  const dashboardProposal = extractDashboardIntent(answer);

  const conversationSummary = buildConversationSummary(history, question);
  const actions = buildActions(
    intentResult.intent,
    sqlBlocks,
    dashboardProposal,
    reconciledTables,
    genieSpaceMatch,
    context.tableEnrichments,
    conversationSummary,
    persona,
    sqlTables,
    questionTables,
  );

  const durationMs = Date.now() - start;

  log.info("Response complete", {
    intent: intentResult.intent,
    sourceCount: sources.length,
    tableCount: reconciledTables.length,
    sqlBlockCount: sqlBlocks.length,
    actionCount: actions.length,
    durationMs,
  });
  if (sources.length > 0 && reconciledTables.length === 0) {
    log.warn("Sources present but no referenced tables inferred", {
      sourceCount: sources.length,
      sqlBlockCount: sqlBlocks.length,
      errorCategory: "context_gap",
    });
  }

  createAssistantLog({
    sessionId: sessionId ?? "anonymous",
    question,
    intent: intentResult.intent,
    intentConfidence: intentResult.confidence,
    ragChunkIds: context.chunks.map((c) => c.sourceId),
    response: answer,
    sqlGenerated: sqlBlocks.length > 0 ? sqlBlocks[0] : undefined,
    durationMs,
    promptTokens: llmResponse.usage?.promptTokens,
    completionTokens: llmResponse.usage?.completionTokens,
    totalTokens: llmResponse.usage?.totalTokens,
    userId: userId ?? "anonymous",
    sources,
    referencedTables: reconciledTables,
    actions,
    sqlBlocks,
    persona,
  })
    .then((logId) => {
      const evalResult = scoreAssistantResponse({
        question,
        answer,
        sourceCount: sources.length,
        retrievalTopScore: context.retrievalTopScore,
        sqlBlocks,
        persona,
      });
      return insertQualityMetrics([
        {
          metricType: "assistant",
          metricName: "assistant_overall_score",
          metricValue: evalResult.overallScore / 100,
          floorValue: Number(process.env.FORGE_MIN_ASSISTANT_QUALITY ?? "0.7"),
          passed:
            evalResult.overallScore / 100 >=
            Number(process.env.FORGE_MIN_ASSISTANT_QUALITY ?? "0.7"),
          assistantLogId: logId,
        },
        {
          metricType: "assistant",
          metricName: "assistant_grounding_score",
          metricValue: evalResult.groundingScore / 100,
          assistantLogId: logId,
        },
        {
          metricType: "assistant",
          metricName: "assistant_citation_score",
          metricValue: evalResult.citationScore / 100,
          assistantLogId: logId,
        },
      ]);
    })
    .catch((err) =>
      log.warn("Failed to log interaction", { error: String(err), errorCategory: "non_fatal" }),
    );

  const chatMentionedTables = [...new Set([...sqlTables, ...questionTables])];

  return {
    answer,
    intent: intentResult,
    sources,
    actions,
    tables: reconciledTables,
    tableEnrichments: context.tableEnrichments,
    sqlBlocks,
    chatMentionedTables,
    dashboardProposal,
    existingDashboards,
    tokenUsage: llmResponse.usage,
    durationMs,
    logId: null,
  };
}

/**
 * Build a concise conversation summary from history + current question.
 * Captures the user's questions (most recent 5) to give the Genie engine
 * richer context for title and instruction generation.
 */
function buildConversationSummary(history: ConversationTurn[], question: string): string {
  const userQuestions = history
    .filter((t) => t.role === "user")
    .map((t) => t.content.trim())
    .slice(-4);
  userQuestions.push(question);
  if (userQuestions.length === 1) return question;
  return userQuestions.join(" → ");
}

function isSubstantiveSql(sql: string): boolean {
  const upper = sql.toUpperCase();
  return (
    sql.length > 100 ||
    upper.includes("JOIN") ||
    upper.includes("GROUP BY") ||
    upper.includes("WINDOW") ||
    upper.includes("WITH ")
  );
}

const GENIE_TABLE_CAP = 6;

function buildGenieAction(
  tables: string[],
  sqlTables: string[],
  questionTables: string[],
  enrichmentMap: Map<string, TableEnrichment>,
  sqlBlocks: string[],
  conversationSummary: string,
  intent: AssistantIntent,
): ActionCard | null {
  if (tables.length < 2) return null;

  const seen = new Set<string>();
  const scoped: string[] = [];
  const add = (fqn: string) => {
    const key = fqn.toLowerCase();
    if (!seen.has(key) && scoped.length < GENIE_TABLE_CAP) {
      seen.add(key);
      scoped.push(fqn);
    }
  };
  for (const t of questionTables) add(t);
  for (const t of sqlTables) add(t);
  for (const t of tables) add(t);

  if (scoped.length < 2) return null;

  const schemas = scoped.map((t) => t.split(".")[1]).filter(Boolean);
  const schemaCounts = new Map<string, number>();
  for (const s of schemas) schemaCounts.set(s, (schemaCounts.get(s) || 0) + 1);
  let domainHint = "";
  let bestCount = 0;
  for (const [schema, count] of schemaCounts) {
    if (count > bestCount) {
      bestCount = count;
      domainHint = schema;
    }
  }

  return {
    type: "create_genie_space",
    label: "Create Genie Space",
    payload: {
      tables: scoped,
      domainHint: domainHint || undefined,
      tableEnrichments: scoped.map((t) => enrichmentMap.get(t)).filter(Boolean),
      sqlBlocks: sqlBlocks.slice(0, 3),
      conversationSummary: conversationSummary || undefined,
      intent,
    },
  };
}

function buildActions(
  intent: AssistantIntent,
  sqlBlocks: string[],
  dashboardProposal: DashboardProposal | null,
  tables: string[],
  genieMatch: { spaceTitle: string; spaceId: string; score: number } | null = null,
  tableEnrichments: TableEnrichment[] = [],
  conversationSummary: string = "",
  persona: AssistantPersona = "business",
  sqlTables: string[] = [],
  questionTables: string[] = [],
): ActionCard[] {
  const actions: ActionCard[] = [];

  if (sqlBlocks.length > 0 && persona !== "business") {
    actions.push({
      type: "run_sql",
      label: "Run this SQL",
      payload: { sql: sqlBlocks[0] },
    });
    if (isSubstantiveSql(sqlBlocks[0])) {
      actions.push({
        type: "deploy_notebook",
        label: "Deploy as Notebook",
        payload: { sql: sqlBlocks[0] },
      });
    }
  }

  const enrichmentMap = new Map(tableEnrichments.map((e) => [e.tableFqn, e]));

  const genieAction = buildGenieAction(
    tables,
    sqlTables,
    questionTables,
    enrichmentMap,
    sqlBlocks,
    conversationSummary,
    intent,
  );

  if (dashboardProposal && (dashboardProposal.tables.length > 0 || tables.length > 0)) {
    const dashTables = dashboardProposal.tables.length > 0 ? dashboardProposal.tables : tables;
    const dSchemas = dashTables.map((t) => t.split(".")[1]).filter(Boolean);
    const dSchemaCounts = new Map<string, number>();
    for (const s of dSchemas) dSchemaCounts.set(s, (dSchemaCounts.get(s) || 0) + 1);
    let dashDomainHint = "";
    let dashBestCount = 0;
    for (const [schema, count] of dSchemaCounts) {
      if (count > dashBestCount) {
        dashBestCount = count;
        dashDomainHint = schema;
      }
    }

    actions.push({
      type: "deploy_dashboard",
      label: "Deploy as Dashboard",
      payload: {
        proposal: dashboardProposal,
        sqlBlocks: sqlBlocks.slice(0, 3),
        conversationSummary: conversationSummary || undefined,
        domainHint: dashDomainHint || undefined,
        tableEnrichments: dashTables.map((t) => enrichmentMap.get(t)).filter(Boolean),
      },
    });
  }

  if (genieAction) {
    actions.push(genieAction);
  } else if (tables.length > 0) {
    if (persona !== "business") {
      actions.push({
        type: "view_tables",
        label: `View ${tables.length} Referenced Table${tables.length > 1 ? "s" : ""}`,
        payload: { tables },
      });
    }
    if (tables.length >= 2 && persona !== "business") {
      actions.push({
        type: "view_erd",
        label: "View ERD",
        payload: { tables },
      });
    }
  }

  if (genieMatch) {
    const host = getConfig().host;
    actions.unshift({
      type: "ask_genie",
      label: `Ask Genie: ${genieMatch.spaceTitle}`,
      payload: {
        genieSpaceId: genieMatch.spaceId,
        genieSpaceTitle: genieMatch.spaceTitle,
        url: host ? `${host}/genie/rooms/${genieMatch.spaceId}` : "",
      },
    });
  }

  // Persona-specific reordering: promote dashboard actions for analyst,
  // ensure deploy actions are prominent for business
  if (persona === "analyst" || intent === "dashboard") {
    const dashIdx = actions.findIndex((a) => a.type === "deploy_dashboard");
    if (dashIdx > 0) {
      const [dashAction] = actions.splice(dashIdx, 1);
      actions.unshift(dashAction);
    }
  }

  if (intent === "strategic") {
    actions.push({
      type: "view_portfolio",
      label: "View Portfolio",
      payload: {},
    });
    actions.push({
      type: "view_roadmap",
      label: "View Roadmap",
      payload: {},
    });
    actions.push({
      type: "view_stakeholders",
      label: "View Stakeholders",
      payload: {},
    });
  }

  return actions;
}
