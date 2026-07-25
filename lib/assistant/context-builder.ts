/**
 * Context builder for the Ask Forge assistant.
 *
 * Dual-strategy context pipeline:
 *   Strategy 1: Direct Lakebase queries (business context, scan summary,
 *               deployed assets, per-table deep detail)
 *   Strategy 2: Vector semantic search (RAG retrieval across all embedding kinds)
 *
 * Both strategies are merged and deduplicated before injection into the LLM.
 */

import {
  retrieveContext,
  formatRetrievedContext,
  provenanceLabel,
} from "@/lib/embeddings/retriever";
import type { RetrievedChunk } from "@/lib/embeddings/types";
import type { AssistantIntent } from "./intent";
import type { AssistantPersona } from "./prompts";
import type { ConversationTurn } from "./engine";
import { isEmbeddingEnabled } from "@/lib/embeddings/config";
import { isBenchmarksEnabled } from "@/lib/benchmarks/config";
import { withPrisma } from "@/lib/prisma";
import { createScopedLogger } from "@/lib/logger";
import {
  resolveForIntent,
  formatContextSections,
  buildIndustrySkillSections,
  type AskForgeIntent,
} from "@/lib/skills";
import { listAccessibleIds, type ResourceType } from "@/lib/lakebase/acl";

/**
 * Combined "owned + shared" id list for the calling user. Used by
 * fetchDirectLakebaseContext to scope first-result-wins lookups.
 *
 * Note: this returns ONLY shared ids; the owner case is handled by an
 * `ownerEmail` clause in the Prisma where filter at the call site so we
 * avoid an extra round-trip just to pull the owner's own ids.
 */
async function listAccessibleIdsForOwner(
  type: ResourceType,
  ownerEmail: string,
): Promise<string[]> {
  return listAccessibleIds(ownerEmail, type);
}

const log = createScopedLogger({ origin: "AskForge", module: "assistant/context-builder" });

export interface TableEnrichment {
  tableFqn: string;
  owner: string | null;
  numRows: string | null;
  sizeInBytes: string | null;
  lastModified: string | null;
  createdBy: string | null;
  dataDomain: string | null;
  dataTier: string | null;
  healthScore: number | null;
  issues: string[];
  recommendations: string[];
  lastWriteTimestamp: string | null;
  lastWriteOperation: string | null;
  upstreamTables: string[];
  downstreamTables: string[];
  columns: Array<{ name: string; dataType: string }>;
}

export interface AssistantContext {
  ragContext: string;
  chunks: RetrievedChunk[];
  conversationHistory: string;
  tables: string[];
  tableEnrichments: TableEnrichment[];
  hasDataGaps: boolean;
  retrievalTopScore: number | null;
  retrievalAvgScore: number | null;
  lowConfidenceRetrieval: boolean;
  industryId: string | null;
}

const INTENT_SCOPES: Record<
  AssistantIntent,
  Array<{
    scope:
      | "estate"
      | "usecases"
      | "genie"
      | "insights"
      | "documents"
      | "benchmarks"
      | "fabric"
      | "skills"
      | "strategy"
      | "company-research"
      | undefined;
    topK: number;
    minScore: number;
    useLatestRun?: boolean;
    useLatestScan?: boolean;
    useLatestFabricScan?: boolean;
  }>
> = {
  business: [
    { scope: "usecases", topK: 10, minScore: 0.4, useLatestRun: true },
    { scope: "estate", topK: 8, minScore: 0.35, useLatestScan: true },
    { scope: "benchmarks", topK: 6, minScore: 0.35 },
    { scope: "fabric", topK: 8, minScore: 0.35, useLatestFabricScan: true },
    { scope: "company-research", topK: 6, minScore: 0.4 },
    { scope: "skills", topK: 4, minScore: 0.4 },
  ],
  technical: [
    { scope: "estate", topK: 15, minScore: 0.4, useLatestScan: true },
    { scope: "insights", topK: 8, minScore: 0.4, useLatestScan: true },
    { scope: "skills", topK: 6, minScore: 0.4 },
  ],
  dashboard: [
    { scope: "insights", topK: 10, minScore: 0.4, useLatestScan: true },
    { scope: "usecases", topK: 8, minScore: 0.4, useLatestRun: true },
    { scope: "fabric", topK: 8, minScore: 0.35, useLatestFabricScan: true },
    { scope: "skills", topK: 4, minScore: 0.4 },
  ],
  navigation: [
    { scope: "estate", topK: 10, minScore: 0.35, useLatestScan: true },
    { scope: "usecases", topK: 8, minScore: 0.35, useLatestRun: true },
    { scope: "documents", topK: 5, minScore: 0.35 },
    { scope: "fabric", topK: 6, minScore: 0.35, useLatestFabricScan: true },
  ],
  exploration: [
    { scope: "estate", topK: 10, minScore: 0.35, useLatestScan: true },
    { scope: "usecases", topK: 8, minScore: 0.35, useLatestRun: true },
    { scope: "documents", topK: 5, minScore: 0.35 },
    { scope: "fabric", topK: 6, minScore: 0.35, useLatestFabricScan: true },
    { scope: "skills", topK: 4, minScore: 0.4 },
  ],
  strategic: [
    { scope: "company-research", topK: 12, minScore: 0.35 },
    { scope: "usecases", topK: 15, minScore: 0.3, useLatestRun: true },
    { scope: "strategy", topK: 10, minScore: 0.3, useLatestRun: true },
    { scope: "estate", topK: 10, minScore: 0.3, useLatestScan: true },
    { scope: "benchmarks", topK: 8, minScore: 0.3 },
    { scope: "documents", topK: 5, minScore: 0.3 },
    { scope: "skills", topK: 4, minScore: 0.4 },
  ],
};

interface DirectContextResult {
  text: string | null;
  latestRunId: string | null;
  latestScanId: string | null;
  latestFabricScanId: string | null;
  industryId: string | null;
}

interface RetrievalPlan {
  scope:
    | "estate"
    | "usecases"
    | "genie"
    | "insights"
    | "documents"
    | "benchmarks"
    | "fabric"
    | "skills"
    | "strategy"
    | "company-research"
    | undefined;
  topK: number;
  minScore: number;
  useLatestRun?: boolean;
  useLatestScan?: boolean;
  useLatestFabricScan?: boolean;
}

// ---------------------------------------------------------------------------
// Persona modulation -- supplements intent-based retrieval plans
// ---------------------------------------------------------------------------

function applyPersonaModulation(
  basePlans: RetrievalPlan[],
  persona: AssistantPersona,
): RetrievalPlan[] {
  const existingScopes = new Set(basePlans.map((p) => p.scope));
  const supplemental: RetrievalPlan[] = [];

  if (persona === "tech") {
    if (!existingScopes.has("estate")) {
      supplemental.push({ scope: "estate", topK: 8, minScore: 0.35, useLatestScan: true });
    }
    if (!existingScopes.has("insights")) {
      supplemental.push({ scope: "insights", topK: 6, minScore: 0.35, useLatestScan: true });
    }
  } else if (persona === "business") {
    if (!existingScopes.has("usecases")) {
      supplemental.push({ scope: "usecases", topK: 6, minScore: 0.35, useLatestRun: true });
    }
    if (!existingScopes.has("benchmarks")) {
      supplemental.push({ scope: "benchmarks", topK: 4, minScore: 0.35 });
    }
  } else if (persona === "analyst") {
    if (!existingScopes.has("usecases")) {
      supplemental.push({ scope: "usecases", topK: 6, minScore: 0.35, useLatestRun: true });
    }
    if (!existingScopes.has("insights")) {
      supplemental.push({ scope: "insights", topK: 6, minScore: 0.35, useLatestScan: true });
    }
  } else if (persona === "strategic") {
    if (!existingScopes.has("strategy")) {
      supplemental.push({ scope: "strategy", topK: 10, minScore: 0.3, useLatestRun: true });
    }
  }

  return [...basePlans, ...supplemental];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Build full LLM context using dual-strategy pipeline:
 *   1. Direct Lakebase queries (always available, no embedding dependency)
 *   2. Vector semantic search (when embeddings are enabled)
 *
 * Persona supplements the intent-based retrieval to ensure each audience
 * gets contextually appropriate chunks (e.g. tech always gets estate health).
 */
export async function buildAssistantContext(
  question: string,
  intent: AssistantIntent,
  history: ConversationTurn[] = [],
  persona: AssistantPersona = "business",
  userEmail: string | null = null,
): Promise<AssistantContext> {
  // --- Strategy 1: Direct Lakebase context (always runs) ---
  const directContext = await fetchDirectLakebaseContext(userEmail);

  // --- Strategy 2: Vector semantic search (when embeddings enabled) ---
  let chunks: RetrievedChunk[] = [];
  let ragContext = "";

  if (isEmbeddingEnabled()) {
    const basePlans = INTENT_SCOPES[intent];
    const modulated = applyPersonaModulation(basePlans, persona);
    const plans = isBenchmarksEnabled()
      ? modulated
      : modulated.filter((p) => p.scope !== "benchmarks");
    chunks = await retrieveWithFallback(
      question,
      plans,
      directContext.latestRunId,
      directContext.latestScanId,
      directContext.latestFabricScanId,
      userEmail,
    );

    ragContext = formatRetrievedContext(chunks, 12000);

    log.debug("Built RAG context", {
      chunkCount: chunks.length,
      contextLength: ragContext.length,
      topScore: chunks[0]?.score,
    });
  }

  // --- Merge: prepend direct context, then RAG, then table enrichment ---
  let fullContext = "";

  if (directContext.text) {
    fullContext += directContext.text + "\n\n";
  }

  if (ragContext) {
    fullContext += ragContext;
  }

  // --- Strategy 3: Skill knowledge injection (rule-based) ---
  try {
    const resolved = resolveForIntent(intent as AskForgeIntent);
    if (resolved.contextSections.length > 0) {
      fullContext +=
        "\n\n## Platform Expertise\n\n" + formatContextSections(resolved.contextSections);
    }

    if (directContext.industryId) {
      const industrySections = buildIndustrySkillSections(directContext.industryId);
      if (industrySections.length > 0) {
        fullContext +=
          "\n\n## Industry Domain Knowledge\n\n" + formatContextSections(industrySections);
      }
    }
  } catch (err) {
    log.warn("Skill resolution failed (non-fatal)", {
      error: String(err),
      errorCategory: "non_fatal",
    });
  }

  const tables = mergeTableReferenceLists(
    extractTableReferencesFromChunks(chunks),
    extractTableFqnsFromText(directContext.text ?? ""),
    extractTableFqnsFromText(question),
  );
  if (chunks.length > 0 && tables.length === 0) {
    log.warn("Retrieved chunks but inferred zero table references", {
      chunkCount: chunks.length,
      errorCategory: "context_gap",
    });
  }
  const tableEnrichments = await fetchTableEnrichments(tables);

  // Backfill column data from schema snapshot for tables not covered by ForgeTableDetail
  const tablesWithCols = new Set(
    tableEnrichments.filter((e) => e.columns.length > 0).map((e) => e.tableFqn),
  );
  const missingColFqns = tables.filter((fqn) => !tablesWithCols.has(fqn));
  if (missingColFqns.length > 0) {
    const snapshotCols = await loadSchemaSnapshotColumns(missingColFqns);
    for (const enrichment of tableEnrichments) {
      if (enrichment.columns.length === 0) {
        const snapCols = snapshotCols.get(enrichment.tableFqn);
        if (snapCols) {
          enrichment.columns = snapCols.map((c) => ({ name: c.name, dataType: c.type }));
        }
      }
    }
    // Add enrichments for tables that exist in the snapshot but not in ForgeTableDetail
    const enrichedFqns = new Set(tableEnrichments.map((e) => e.tableFqn));
    for (const fqn of missingColFqns) {
      if (!enrichedFqns.has(fqn) && snapshotCols.has(fqn)) {
        tableEnrichments.push({
          tableFqn: fqn,
          owner: null,
          numRows: null,
          sizeInBytes: null,
          lastModified: null,
          createdBy: null,
          dataDomain: null,
          dataTier: null,
          healthScore: null,
          issues: [],
          recommendations: [],
          lastWriteTimestamp: null,
          lastWriteOperation: null,
          upstreamTables: [],
          downstreamTables: [],
          columns: snapshotCols.get(fqn)!.map((c) => ({ name: c.name, dataType: c.type })),
        });
      }
    }
  }

  if (tableEnrichments.length > 0) {
    fullContext +=
      "\n\n## Estate Metadata for Referenced Tables\n\n" + formatTableEnrichments(tableEnrichments);
  } else if (tables.length > 0) {
    fullContext += "\n\n## Referenced Tables\n\n" + tables.map((t) => `- ${t}`).join("\n");
  }

  const conversationHistory = formatConversationHistory(history);

  const retrievalTopScore = chunks.length > 0 ? chunks[0].score : null;
  const retrievalAvgScore =
    chunks.length > 0 ? chunks.reduce((sum, c) => sum + c.score, 0) / chunks.length : null;
  const lowConfidenceRetrieval = retrievalTopScore !== null && retrievalTopScore < 0.5;

  if (lowConfidenceRetrieval) {
    const hasSkillContent =
      fullContext.includes("## Platform Expertise") ||
      fullContext.includes("## Industry Domain Knowledge");
    const confidenceNote = hasSkillContent
      ? "## Retrieval Confidence\nTop retrieval score is low, but platform expertise is available. Lean on domain knowledge and explicitly call out uncertainty where estate-specific context is thin."
      : "## Retrieval Confidence\nTop retrieval score is low. Answer conservatively and explicitly call out uncertainty where context is thin.";
    fullContext = confidenceNote + "\n\n" + fullContext;
  }

  return {
    ragContext: fullContext,
    chunks,
    conversationHistory,
    tables,
    tableEnrichments,
    hasDataGaps: chunks.length === 0 && !directContext.text,
    retrievalTopScore,
    retrievalAvgScore,
    lowConfidenceRetrieval,
    industryId: directContext.industryId,
  };
}

/**
 * Build numbered source references for citation in the LLM response.
 */
export function buildSourceReferences(chunks: RetrievedChunk[]): Array<{
  index: number;
  label: string;
  kind: string;
  sourceId: string;
  score: number;
  metadata: Record<string, unknown> | null;
}> {
  return chunks.slice(0, 10).map((chunk, i) => ({
    index: i + 1,
    label: provenanceLabel(chunk),
    kind: chunk.kind,
    sourceId: chunk.sourceId,
    score: chunk.score,
    metadata: chunk.metadata,
  }));
}

// ---------------------------------------------------------------------------
// Strategy 1: Direct Lakebase context
// ---------------------------------------------------------------------------

/**
 * Fetch structured context directly from Lakebase, independent of vector search.
 * Provides business grounding, estate overview, and deployed asset awareness.
 *
 * When `userEmail` is provided, queries are filtered to runs/scans visible to
 * that user (owned + shared via ACL). When omitted, falls back to the legacy
 * unscoped behaviour (used by background callers and tests).
 */
async function fetchDirectLakebaseContext(
  userEmail: string | null = null,
): Promise<DirectContextResult> {
  try {
    return await withPrisma(async (prisma) => {
      const sections: string[] = [];
      let latestRunId: string | null = null;
      let latestScanId: string | null = null;
      let industryId: string | null = null;

      // Resolve accessible run/scan ids for the calling user.
      const ownerEmail = userEmail ? userEmail.toLowerCase().trim() : null;
      let runFilter: Record<string, unknown> = { status: "completed" };
      let scanFilter: Record<string, unknown> = {};
      let fabricScanFilter: Record<string, unknown> = { status: "completed" };

      if (ownerEmail) {
        const [sharedRunIds, sharedScanIds, sharedFabricIds] = await Promise.all([
          listAccessibleIdsForOwner("run", ownerEmail),
          listAccessibleIdsForOwner("scan", ownerEmail),
          listAccessibleIdsForOwner("fabric_scan", ownerEmail),
        ]);
        runFilter = {
          status: "completed",
          OR: [{ ownerEmail }, { runId: { in: sharedRunIds } }],
        };
        scanFilter = {
          OR: [{ ownerEmail }, { scanId: { in: sharedScanIds } }],
        };
        fabricScanFilter = {
          status: "completed",
          OR: [{ ownerEmail }, { id: { in: sharedFabricIds } }],
        };
      }

      // 1. Business context from latest completed run
      const latestRun = await prisma.forgeRun.findFirst({
        where: runFilter,
        orderBy: { createdAt: "desc" },
        select: {
          runId: true,
          businessName: true,
          businessContext: true,
          businessPriorities: true,
          strategicGoals: true,
          businessDomains: true,
          generationOptions: true,
          ucMetadata: true,
        },
      });

      if (latestRun) {
        latestRunId = latestRun.runId;
        const parts = ["## Business Context"];
        parts.push(`Organisation: ${latestRun.businessName}`);
        if (latestRun.businessContext)
          parts.push(`Context: ${truncate(latestRun.businessContext, 800)}`);
        if (latestRun.businessPriorities)
          parts.push(`Priorities: ${truncate(latestRun.businessPriorities, 400)}`);
        if (latestRun.strategicGoals)
          parts.push(`Strategic Goals: ${truncate(latestRun.strategicGoals, 400)}`);
        if (latestRun.businessDomains) parts.push(`Business Domains: ${latestRun.businessDomains}`);
        sections.push(parts.join("\n"));

        try {
          const opts = latestRun.generationOptions ? JSON.parse(latestRun.generationOptions) : {};
          industryId = opts?.industry ?? null;
        } catch {
          /* ignore malformed JSON */
        }
      }

      // 2. Industry context and KPIs (from outcome map, when industry is known)
      if (industryId) {
        try {
          const { buildIndustryContextPrompt, buildIndustryKPIsPrompt } =
            await import("@/lib/domain/industry-outcomes-server");
          const [industryContext, industryKpis] = await Promise.all([
            buildIndustryContextPrompt(industryId),
            buildIndustryKPIsPrompt(industryId),
          ]);
          if (industryContext) sections.push(industryContext);
          if (industryKpis) sections.push(industryKpis);
        } catch (err) {
          log.warn("Failed to load industry context", {
            industryId,
            error: String(err),
            errorCategory: "non_fatal",
          });
        }
      }

      // 3. Estate summary from latest scan
      const latestScan = await prisma.forgeEnvironmentScan.findFirst({
        where: scanFilter,
        orderBy: { createdAt: "desc" },
        select: {
          scanId: true,
          tableCount: true,
          domainCount: true,
          piiTablesCount: true,
          avgGovernanceScore: true,
          lineageDiscoveredCount: true,
          dataProductCount: true,
          createdAt: true,
          ucPath: true,
        },
      });

      if (latestScan) {
        latestScanId = latestScan.scanId;
        const parts = ["## Data Estate Summary"];
        parts.push(`Scope: ${latestScan.ucPath}`);
        parts.push(
          `Tables: ${latestScan.tableCount} | Domains: ${latestScan.domainCount} | PII tables: ${latestScan.piiTablesCount}`,
        );
        parts.push(
          `Lineage edges: ${latestScan.lineageDiscoveredCount} | Data products: ${latestScan.dataProductCount}`,
        );
        parts.push(`Avg governance score: ${latestScan.avgGovernanceScore.toFixed(0)}/100`);
        parts.push(`Last scanned: ${latestScan.createdAt.toISOString()}`);
        sections.push(parts.join("\n"));

        // 4. Domain distribution from ForgeTableDetail (grouped by dataDomain)
        try {
          const domainGroups = await prisma.forgeTableDetail.groupBy({
            by: ["dataDomain"],
            where: { scanId: latestScan.scanId, dataDomain: { not: null } },
            _count: { _all: true },
            _avg: { governanceScore: true },
          });
          if (domainGroups.length > 0) {
            const sorted = domainGroups.sort((a, b) => b._count._all - a._count._all);
            const domParts = ["## Domain Distribution"];
            for (const g of sorted) {
              const avgGov =
                g._avg.governanceScore != null
                  ? `, avg governance ${Math.round(g._avg.governanceScore)}/100`
                  : "";
              domParts.push(`- **${g.dataDomain}** -- ${g._count._all} tables${avgGov}`);
            }
            sections.push(domParts.join("\n"));
          }
        } catch (err) {
          log.warn("Failed to fetch domain distribution", {
            error: String(err),
            errorCategory: "non_fatal",
          });
        }
      }

      // 5. Deployed assets (dashboards + Genie spaces from tracking + full workspace cache)
      const [deployedDashboards, deployedSpaces, cachedWorkspaceSpaces] = await Promise.all([
        prisma.forgeDashboard.findMany({
          where: { status: { not: "trashed" } },
          select: { title: true, domain: true, dashboardId: true },
          take: 20,
        }),
        prisma.forgeGenieSpace.findMany({
          where: { status: { not: "trashed" } },
          select: { title: true, domain: true, spaceId: true },
          take: 20,
        }),
        prisma.forgeGenieSpaceCache
          .findMany({
            where: { permissionDenied: false },
            select: { spaceId: true, title: true },
            orderBy: { title: "asc" },
            take: 100,
          })
          .catch(() => [] as { spaceId: string; title: string }[]),
      ]);

      if (
        deployedDashboards.length > 0 ||
        deployedSpaces.length > 0 ||
        cachedWorkspaceSpaces.length > 0
      ) {
        const parts = ["## Already Deployed Assets"];
        if (deployedDashboards.length > 0) {
          parts.push(`Dashboards (${deployedDashboards.length}):`);
          for (const d of deployedDashboards) {
            parts.push(`- ${d.title}${d.domain ? ` [${d.domain}]` : ""}`);
          }
        }

        const trackedIds = new Set(deployedSpaces.map((s) => s.spaceId));
        const allSpaces = [
          ...deployedSpaces.map((s) => ({ title: s.title, domain: s.domain })),
          ...cachedWorkspaceSpaces
            .filter((c) => !trackedIds.has(c.spaceId))
            .map((c) => ({ title: c.title, domain: undefined as string | undefined })),
        ];

        if (allSpaces.length > 0) {
          parts.push(`Genie Spaces (${allSpaces.length}):`);
          for (const s of allSpaces) {
            parts.push(`- ${s.title}${s.domain ? ` [${s.domain}]` : ""}`);
          }
        }
        sections.push(parts.join("\n"));
      }

      // 6. Latest Fabric scan for PBI context retrieval
      let latestFabricScanId: string | null = null;
      try {
        const latestFabricScan = await prisma.forgeFabricScan.findFirst({
          where: fabricScanFilter,
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        if (latestFabricScan) {
          latestFabricScanId = latestFabricScan.id;
        }
      } catch {
        // Fabric tables may not exist yet
      }

      return {
        text: sections.length === 0 ? null : sections.join("\n\n---\n\n"),
        latestRunId,
        latestScanId,
        latestFabricScanId,
        industryId,
      };
    });
  } catch (err) {
    log.warn("Failed to fetch direct Lakebase context", {
      error: String(err),
      errorCategory: "non_fatal",
    });
    return {
      text: null,
      latestRunId: null,
      latestScanId: null,
      latestFabricScanId: null,
      industryId: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Table reference extraction (broadened)
// ---------------------------------------------------------------------------

const THREE_PART_FQN = /\b[a-zA-Z_]\w*\.[a-zA-Z_]\w*\.[a-zA-Z_]\w*\b/g;
const TABLE_LIMIT = 20;

function extractTableReferencesFromChunks(chunks: RetrievedChunk[]): string[] {
  const tables = new Set<string>();

  for (const chunk of chunks) {
    // Direct FQN kinds: sourceId IS the FQN
    if (["table_detail", "column_profile", "table_health"].includes(chunk.kind)) {
      tables.add(chunk.sourceId);
    }

    const m = chunk.metadata ?? {};

    // metadata.tableFqn (table_health, environment_insight, column_profile)
    if (typeof m.tableFqn === "string" && m.tableFqn.includes(".")) {
      tables.add(m.tableFqn);
    }

    // metadata.source / metadata.target (lineage_context)
    if (typeof m.source === "string" && m.source.includes(".")) {
      tables.add(m.source);
    }
    if (typeof m.target === "string" && m.target.includes(".")) {
      tables.add(m.target);
    }

    // metadata.tables (array, used by some genie/use-case chunks)
    if (Array.isArray(m.tables)) {
      for (const t of m.tables) {
        if (typeof t === "string" && t.includes(".")) tables.add(t);
      }
    }
  }

  // Supplement: regex-scan ALL chunk content for three-part FQNs.
  // Genie, use-case, and question chunks often contain table FQNs in their
  // text but not in structured metadata, so we always scan broadly.
  for (const chunk of chunks) {
    for (const match of chunk.content.matchAll(THREE_PART_FQN)) {
      tables.add(match[0]);
    }
  }

  return [...tables];
}

export function extractTableFqnsFromText(text: string): string[] {
  if (!text) return [];
  const tables = new Set<string>();
  for (const match of text.matchAll(THREE_PART_FQN)) {
    tables.add(match[0]);
  }
  return [...tables];
}

function normalizeTableFqn(input: string): string {
  return input.replace(/[`"']/g, "").trim();
}

export function mergeTableReferenceLists(...lists: string[][]): string[] {
  const normalized = new Map<string, string>();
  for (const list of lists) {
    for (const item of list) {
      const value = normalizeTableFqn(item);
      if (!value || value.split(".").length < 3) continue;
      const key = value.toLowerCase();
      if (!normalized.has(key)) {
        normalized.set(key, value);
      }
    }
  }
  return Array.from(normalized.values()).slice(0, TABLE_LIMIT);
}

async function retrieveWithFallback(
  question: string,
  plans: RetrievalPlan[],
  latestRunId: string | null,
  latestScanId: string | null,
  latestFabricScanId: string | null,
  userEmail: string | null,
): Promise<RetrievedChunk[]> {
  const strict = await retrieveForPlans(
    question,
    plans,
    latestRunId,
    latestScanId,
    latestFabricScanId,
    false,
    userEmail,
  );
  if (strict.length > 0) {
    return strict;
  }

  const hasStrictFilters = plans.some(
    (plan) => plan.useLatestRun || plan.useLatestScan || plan.useLatestFabricScan,
  );
  if (!hasStrictFilters) {
    return strict;
  }

  log.info("Strict retrieval returned no chunks, retrying relaxed filters");
  return retrieveForPlans(
    question,
    plans,
    latestRunId,
    latestScanId,
    latestFabricScanId,
    true,
    userEmail,
  );
}

async function retrieveForPlans(
  question: string,
  plans: RetrievalPlan[],
  latestRunId: string | null,
  latestScanId: string | null,
  latestFabricScanId: string | null,
  relaxed: boolean,
  userEmail: string | null,
): Promise<RetrievedChunk[]> {
  const retrievals = await Promise.all(
    plans.map((plan) => {
      let scanId: string | undefined;
      if (!relaxed) {
        if (plan.useLatestFabricScan && latestFabricScanId) {
          scanId = latestFabricScanId;
        } else if (plan.useLatestScan && latestScanId) {
          scanId = latestScanId;
        }
      }
      return retrieveContext(question, {
        scope: plan.scope,
        topK: plan.topK,
        minScore: relaxed ? Math.max(0.25, plan.minScore - 0.1) : plan.minScore,
        enforceSourcePriority: true,
        runId: !relaxed && plan.useLatestRun ? (latestRunId ?? undefined) : undefined,
        scanId,
        userEmail,
      });
    }),
  );

  const deduped = new Map<string, RetrievedChunk>();
  for (let i = 0; i < retrievals.length; i++) {
    const plan = plans[i];
    const list = retrievals[i];
    log.debug("Retrieval scope result", {
      scope: plan.scope ?? "all",
      relaxed,
      resultCount: list.length,
      topScore: list[0]?.score,
    });
    for (const chunk of list) {
      const key = `${chunk.kind}:${chunk.sourceId}`;
      const existing = deduped.get(key);
      if (!existing || chunk.score > existing.score) {
        deduped.set(key, chunk);
      }
    }
  }
  return Array.from(deduped.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, TABLE_LIMIT);
}

// ---------------------------------------------------------------------------
// Table enrichment (per-table deep detail from Lakebase)
// ---------------------------------------------------------------------------

/**
 * Fetch enrichment metadata (health, staleness, owner, lineage, insights,
 * related use cases) for a list of table FQNs directly from Lakebase.
 */
async function fetchTableEnrichments(fqns: string[]): Promise<TableEnrichment[]> {
  if (fqns.length === 0) return [];

  try {
    return await withPrisma(async (prisma) => {
      const [details, histories, lineage] = await Promise.all([
        prisma.forgeTableDetail.findMany({
          where: { tableFqn: { in: fqns } },
          orderBy: { scan: { createdAt: "desc" } },
          distinct: ["tableFqn"],
        }),
        prisma.forgeTableHistorySummary.findMany({
          where: { tableFqn: { in: fqns } },
          orderBy: { scan: { createdAt: "desc" } },
          distinct: ["tableFqn"],
        }),
        prisma.forgeTableLineage.findMany({
          where: {
            OR: [{ sourceTableFqn: { in: fqns } }, { targetTableFqn: { in: fqns } }],
          },
        }),
      ]);

      const historyByFqn = new Map(histories.map((h) => [h.tableFqn, h]));

      const upstreamByFqn = new Map<string, string[]>();
      const downstreamByFqn = new Map<string, string[]>();
      for (const edge of lineage) {
        const ds = downstreamByFqn.get(edge.sourceTableFqn) ?? [];
        ds.push(edge.targetTableFqn);
        downstreamByFqn.set(edge.sourceTableFqn, ds);

        const us = upstreamByFqn.get(edge.targetTableFqn) ?? [];
        us.push(edge.sourceTableFqn);
        upstreamByFqn.set(edge.targetTableFqn, us);
      }

      return details.map((d) => {
        const h = historyByFqn.get(d.tableFqn);
        const issues = parseJsonArray(h?.issuesJson);
        const recommendations = parseJsonArray(h?.recommendationsJson);

        let columns: Array<{ name: string; dataType: string }> = [];
        if (d.columnsJson) {
          try {
            const rawCols = JSON.parse(d.columnsJson);
            if (Array.isArray(rawCols)) {
              columns = rawCols
                .map((c: Record<string, unknown>) => ({
                  name: String(c.name ?? ""),
                  dataType: String(c.type ?? c.dataType ?? "STRING"),
                }))
                .filter((c) => c.name);
            }
          } catch {
            // best-effort column parsing
          }
        }

        return {
          tableFqn: d.tableFqn,
          owner: d.owner,
          numRows: d.numRows ? String(d.numRows) : null,
          sizeInBytes: d.sizeInBytes ? String(d.sizeInBytes) : null,
          lastModified: d.lastModified ? new Date(d.lastModified).toISOString() : null,
          createdBy: d.createdBy,
          dataDomain: d.dataDomain,
          dataTier: d.dataTier,
          healthScore: h?.healthScore ?? null,
          issues,
          recommendations,
          lastWriteTimestamp: h?.lastWriteTimestamp
            ? new Date(h.lastWriteTimestamp).toISOString()
            : null,
          lastWriteOperation: h?.lastWriteOperation ?? null,
          upstreamTables: upstreamByFqn.get(d.tableFqn) ?? [],
          downstreamTables: downstreamByFqn.get(d.tableFqn) ?? [],
          columns,
        };
      });
    });
  } catch (err) {
    log.warn("Failed to fetch table enrichments", {
      error: String(err),
      errorCategory: "non_fatal",
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Schema snapshot fallback (covers pipeline-only runs without estate scan)
// ---------------------------------------------------------------------------

async function loadSchemaSnapshotColumns(
  fqns: string[],
): Promise<Map<string, Array<{ name: string; type: string }>>> {
  if (fqns.length === 0) return new Map();
  try {
    return await withPrisma(async (prisma) => {
      const latestRun = await prisma.forgeRun.findFirst({
        where: { schemaSnapshotJson: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { schemaSnapshotJson: true },
      });
      if (!latestRun?.schemaSnapshotJson) return new Map();

      const snapshot = JSON.parse(latestRun.schemaSnapshotJson) as Record<
        string,
        { columns?: Array<{ name: string; type: string }> }
      >;
      const result = new Map<string, Array<{ name: string; type: string }>>();
      for (const fqn of fqns) {
        const entry = snapshot[fqn];
        if (entry?.columns && entry.columns.length > 0) {
          result.set(fqn, entry.columns);
        }
      }
      return result;
    });
  } catch (err) {
    log.warn("Failed to load schema snapshot", {
      error: String(err),
      errorCategory: "non_fatal",
    });
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatConversationHistory(history: ConversationTurn[]): string {
  if (history.length === 0) return "";

  const recent = history.slice(-10);
  return recent
    .map((turn) => {
      const role = turn.role === "user" ? "User" : "Assistant";
      const content = turn.content.length > 500 ? turn.content.slice(0, 500) + "…" : turn.content;
      return `**${role}:** ${content}`;
    })
    .join("\n\n");
}

function quoteIdent(name: string): string {
  return /^\w+$/.test(name) ? name : `\`${name}\``;
}

function formatTableEnrichments(enrichments: TableEnrichment[]): string {
  return enrichments
    .map((t) => {
      const parts = [`**${t.tableFqn}**`];
      if (t.owner) parts.push(`- Owner: ${t.owner}`);
      if (t.createdBy) parts.push(`- Created by: ${t.createdBy}`);
      if (t.dataDomain)
        parts.push(`- Domain: ${t.dataDomain}${t.dataTier ? ` (${t.dataTier})` : ""}`);
      if (t.numRows) parts.push(`- Rows: ${Number(t.numRows).toLocaleString()}`);
      if (t.sizeInBytes) parts.push(`- Size: ${formatBytes(Number(t.sizeInBytes))}`);
      if (t.healthScore !== null) parts.push(`- Health score: ${t.healthScore}/100`);
      if (t.lastModified) parts.push(`- Last modified: ${t.lastModified}`);
      if (t.lastWriteTimestamp)
        parts.push(
          `- Last write: ${t.lastWriteTimestamp} (${t.lastWriteOperation ?? "unknown op"})`,
        );
      if (t.issues.length > 0) parts.push(`- Issues: ${t.issues.join("; ")}`);
      if (t.upstreamTables.length > 0) parts.push(`- Upstream: ${t.upstreamTables.join(", ")}`);
      if (t.downstreamTables.length > 0)
        parts.push(`- Downstream: ${t.downstreamTables.join(", ")}`);
      if (t.columns.length > 0) {
        parts.push(`- **Columns (USE ONLY THESE -- do NOT invent others):**`);
        for (const col of t.columns) {
          parts.push(`  - ${quoteIdent(col.name)} (${col.dataType})`);
        }
      }
      return parts.join("\n");
    })
    .join("\n\n");
}

function parseJsonArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
}
