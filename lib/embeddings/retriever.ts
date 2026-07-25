/**
 * RAG retrieval module.
 *
 * Provides a simple interface for retrieving relevant context from
 * the embedding store. Used by pipeline steps to inject grounding
 * context from uploaded documents and past intelligence into LLM prompts.
 */

import { generateEmbedding } from "./client";
import { searchByVector, type UserScope } from "./store";
import type { EmbeddingKind, RetrievedChunk, SearchResult } from "./types";
import { SEARCH_SCOPES } from "./types";
import { isEmbeddingEnabled } from "./config";
import { logger } from "@/lib/logger";
import {
  GLOBAL_KINDS,
  KIND_SCOPE,
  SOURCE_PARENT,
  SOURCE_SCOPED_KINDS,
} from "./kind-scope";
import { listAccessibleIds, type ResourceType } from "@/lib/lakebase/acl";
import { withPrisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RetrieveOptions {
  /** Restrict to specific embedding kinds. */
  kinds?: EmbeddingKind[];
  /** Use a named scope (maps to a set of kinds). */
  scope?: keyof typeof SEARCH_SCOPES;
  /** Maximum results to return. */
  topK?: number;
  /** Minimum similarity score (0-1). */
  minScore?: number;
  /** Filter by run. */
  runId?: string;
  /** Filter by scan. */
  scanId?: string;
  /** JSONB metadata filter. */
  metadataFilter?: Record<string, unknown>;
  /** Prioritize source types and freshness in final ranking. */
  enforceSourcePriority?: boolean;
  /**
   * The acting user's email. When set, results are limited to embeddings
   * whose parent (run / scan / source-id) is owned by or shared with this
   * user, plus globally readable catalog kinds. Background jobs should
   * thread the run owner's email through to keep RAG retrieval consistent
   * with sharing rules.
   *
   * Omit only for legitimately user-agnostic callers (system maintenance,
   * tests, admin tools).
   */
  userEmail?: string | null;
}

/**
 * Build a `UserScope` for the given user by querying ACL and ownership rows
 * for the specific kinds the caller is asking about. Catalog (`global`)
 * kinds bypass this.
 */
async function buildUserScope(
  userEmail: string,
  kinds: readonly EmbeddingKind[] | undefined,
): Promise<UserScope> {
  const wantedKinds = kinds && kinds.length > 0 ? kinds : (Object.keys(KIND_SCOPE) as EmbeddingKind[]);

  const needsRunIds = wantedKinds.some((k) => KIND_SCOPE[k] === "run");
  const needsScanIds = wantedKinds.some((k) => KIND_SCOPE[k] === "scan");
  const sourceKindsWanted = wantedKinds.filter((k) => KIND_SCOPE[k] === "source");
  const globalKinds = wantedKinds.filter((k) => KIND_SCOPE[k] === "global");

  const accessibleRunIds = needsRunIds ? await accessibleIds("run", userEmail) : [];
  const accessibleScanIds = needsScanIds
    ? [
        ...(await accessibleIds("scan", userEmail)),
        ...(await accessibleIds("fabric_scan", userEmail)),
      ]
    : [];

  const accessibleSourceIds: Array<{ sourceId: string; kind: EmbeddingKind }> = [];
  for (const kind of sourceKindsWanted) {
    const parent = SOURCE_PARENT[kind];
    if (!parent) continue;
    const resourceType: ResourceType = parent === "document" ? "document" : "demo_session";
    const ids = await accessibleIds(resourceType, userEmail);
    for (const id of ids) accessibleSourceIds.push({ sourceId: id, kind });
  }

  return {
    accessibleRunIds,
    accessibleScanIds,
    accessibleSourceIds,
    globalKinds,
  };
}

/**
 * Resolve all resource ids of `type` accessible to `userEmail` -- both
 * owned and shared via ACL. Implemented as separate Prisma queries because
 * each owning model lives in its own table.
 */
async function accessibleIds(type: ResourceType, userEmail: string): Promise<string[]> {
  const email = userEmail.trim().toLowerCase();
  const sharedIds = await listAccessibleIds(email, type);
  const ownedIds = await listOwnedIds(type, email);
  return Array.from(new Set([...ownedIds, ...sharedIds]));
}

async function listOwnedIds(type: ResourceType, email: string): Promise<string[]> {
  return withPrisma(async (prisma) => {
    switch (type) {
      case "run": {
        const rows = await prisma.forgeRun.findMany({
          where: { ownerEmail: email },
          select: { runId: true },
        });
        return rows.map((r) => r.runId);
      }
      case "scan": {
        const rows = await prisma.forgeEnvironmentScan.findMany({
          where: { ownerEmail: email },
          select: { scanId: true },
        });
        return rows.map((r) => r.scanId);
      }
      case "fabric_scan": {
        const rows = await prisma.forgeFabricScan.findMany({
          where: { ownerEmail: email },
          select: { id: true },
        });
        return rows.map((r) => r.id);
      }
      case "document": {
        const rows = await prisma.forgeDocument.findMany({
          where: { ownerEmail: email },
          select: { id: true },
        });
        return rows.map((r) => r.id);
      }
      case "demo_session": {
        const rows = await prisma.forgeDemoSession.findMany({
          where: { ownerEmail: email },
          select: { id: true },
        });
        return rows.map((r) => r.id);
      }
      default:
        return [];
    }
  });
}

/**
 * Retrieve relevant chunks for a given natural-language query.
 * Embeds the query, searches the vector store, and returns
 * ranked results with content and metadata.
 */
export async function retrieveContext(
  query: string,
  opts: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  if (!isEmbeddingEnabled()) return [];

  const queryVector = await generateEmbedding(query);

  const kinds = opts.kinds ?? (opts.scope ? SEARCH_SCOPES[opts.scope] : undefined);

  // Build user-scope when an email is provided. When omitted (legacy /
  // background callers), legacy behaviour is preserved: visibility is
  // determined only by run/scan/metadata filters.
  let userScope: UserScope | undefined = undefined;
  if (opts.userEmail) {
    userScope = await buildUserScope(opts.userEmail, kinds);
  }

  const results: SearchResult[] = await searchByVector(queryVector, {
    kinds: kinds as EmbeddingKind[] | undefined,
    runId: opts.runId,
    scanId: opts.scanId,
    metadataFilter: opts.metadataFilter,
    topK: opts.topK ?? 10,
    minScore: opts.minScore ?? 0.4,
    userScope,
  });

  logger.debug("[retriever] Retrieved chunks", {
    query: query.slice(0, 80),
    resultCount: results.length,
    topScore: results[0]?.score,
  });

  const ranked = opts.enforceSourcePriority === false ? results : rerankByProvenance(results);
  return ranked.map((r) => ({
    content: r.contentText,
    kind: r.kind,
    sourceId: r.sourceId,
    score: r.score,
    metadata: r.metadataJson,
  }));
}

type SourcePriority =
  | "CustomerFact"
  | "PlatformBestPractice"
  | "IndustryBenchmark"
  | "AdvisoryGuidance";

const PRIORITY_WEIGHT: Record<SourcePriority, number> = {
  CustomerFact: 1.0,
  PlatformBestPractice: 0.85,
  IndustryBenchmark: 0.7,
  AdvisoryGuidance: 0.55,
};

function inferSourcePriority(result: SearchResult): SourcePriority {
  const label = (result.metadataJson?.sourcePriority as string | undefined) ?? "";
  if (
    label === "CustomerFact" ||
    label === "PlatformBestPractice" ||
    label === "IndustryBenchmark" ||
    label === "AdvisoryGuidance"
  ) {
    return label;
  }
  switch (result.kind) {
    case "table_detail":
    case "column_profile":
    case "table_health":
    case "lineage_context":
      return "CustomerFact";
    // Public company research is factual about the customer -- rank it
    // alongside estate metadata so the retriever's priority weights don't
    // down-weight it relative to platform skills.
    case "company_research":
      return "CustomerFact";
    case "benchmark_context":
      return "IndustryBenchmark";
    case "outcome_map":
    case "industry_kpi":
      return "AdvisoryGuidance";
    case "skill_chunk":
      return "PlatformBestPractice";
    default:
      return "PlatformBestPractice";
  }
}

// Local recency curve, mirrors lib/demo/research-engine/recency.ts but
// without the cross-module dependency. Two layers:
//   1. Full weight within RECENT_YEARS_MS
//   2. Soft decay to HARD_FLOOR_WEIGHT by HARD_FLOOR_YEARS_MS
const ONE_YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
const RECENT_YEARS_MS = 2 * ONE_YEAR_MS;
const HARD_FLOOR_YEARS_MS = 5 * ONE_YEAR_MS;
const HARD_FLOOR_WEIGHT = 0.25;
const UNKNOWN_DATE_WEIGHT = 0.8;

function dateAgeMultiplier(publishedAt: number, now: number = Date.now()): number {
  const ageMs = Math.max(0, now - publishedAt);
  if (ageMs <= RECENT_YEARS_MS) return 1.0;
  if (ageMs >= HARD_FLOOR_YEARS_MS) return HARD_FLOOR_WEIGHT;
  const t = (ageMs - RECENT_YEARS_MS) / (HARD_FLOOR_YEARS_MS - RECENT_YEARS_MS);
  return 1.0 - t * (1.0 - 0.55);
}

function freshnessMultiplier(result: SearchResult): number {
  const md = result.metadataJson ?? {};

  // Explicit validUntil takes precedence (curated content with expiry).
  const validUntil = typeof md.validUntil === "string" ? Date.parse(md.validUntil) : NaN;
  if (Number.isFinite(validUntil)) {
    return validUntil >= Date.now() ? 1 : 0.85;
  }

  // Company research (and any other chunk that carries publishedAt) gets
  // graded decay by age so that a 2016 10-K loses out to a 2024 report even
  // when pure cosine similarity is close.
  const publishedAt = typeof md.publishedAt === "string" ? Date.parse(md.publishedAt) : NaN;
  if (Number.isFinite(publishedAt)) {
    return dateAgeMultiplier(publishedAt);
  }

  const publishedYear =
    typeof md.publishedYear === "number" && Number.isFinite(md.publishedYear)
      ? (md.publishedYear as number)
      : undefined;
  if (publishedYear) {
    const ts = Date.UTC(Math.trunc(publishedYear), 0, 1);
    return dateAgeMultiplier(ts);
  }

  // For company_research chunks with no date at all, apply the same
  // neutral-lean default used by the demo engine so older dated content
  // can still beat an undated chunk.
  if (result.kind === "company_research") return UNKNOWN_DATE_WEIGHT;

  return 1;
}

function rerankByProvenance(results: SearchResult[]): SearchResult[] {
  return [...results].sort((a, b) => {
    const aScore = a.score * PRIORITY_WEIGHT[inferSourcePriority(a)] * freshnessMultiplier(a);
    const bScore = b.score * PRIORITY_WEIGHT[inferSourcePriority(b)] * freshnessMultiplier(b);
    return bScore - aScore;
  });
}

export function rerankByProvenanceForTest(results: SearchResult[]): SearchResult[] {
  return rerankByProvenance(results);
}

// ---------------------------------------------------------------------------
// Provenance labels
// ---------------------------------------------------------------------------

const RAG_PREAMBLE = `The following context is retrieved from multiple sources. Each entry is labelled:
- [PLATFORM DATA] = verified metadata from the customer's Databricks estate
- [PLATFORM INSIGHT] = AI-generated analysis of estate data
- [GENERATED INTELLIGENCE] = previously generated use cases or business context
- [UPLOADED DOCUMENT: filename] = customer-provided document (may describe aspirational goals, not current state)
- [INDUSTRY TEMPLATE] = industry outcome map template
- [INDUSTRY BENCHMARK] = public benchmark prior (advisory only)
- [PLATFORM SKILL] = Databricks best practices and domain expertise
- [INDUSTRY KPI] = industry-specific KPIs and success metrics

Prioritise PLATFORM DATA for factual claims. Use UPLOADED DOCUMENT for strategic direction only.`;

export function provenanceLabel(chunk: RetrievedChunk): string {
  switch (chunk.kind) {
    case "table_detail":
    case "column_profile":
    case "table_health":
    case "lineage_context":
      return "[PLATFORM DATA]";
    case "environment_insight":
    case "data_product":
      return "[PLATFORM INSIGHT]";
    case "use_case":
    case "business_context":
    case "genie_recommendation":
    case "genie_question":
      return "[GENERATED INTELLIGENCE]";
    case "document_chunk":
      return `[UPLOADED DOCUMENT: ${(chunk.metadata?.filename as string) || "unknown"}]`;
    case "outcome_map":
      return "[INDUSTRY TEMPLATE]";
    case "benchmark_context":
      return "[INDUSTRY BENCHMARK]";
    case "skill_chunk":
      return "[PLATFORM SKILL]";
    case "industry_kpi":
      return "[INDUSTRY KPI]";
    default:
      return `[${chunk.kind}]`;
  }
}

/**
 * Format retrieved chunks into a string suitable for injection into
 * an LLM system prompt. Includes provenance labels and a preamble.
 */
export function formatRetrievedContext(chunks: RetrievedChunk[], maxChars: number = 8000): string {
  if (chunks.length === 0) return "";

  const parts: string[] = [RAG_PREAMBLE];
  let totalChars = RAG_PREAMBLE.length;

  for (const chunk of chunks) {
    const entry = `${provenanceLabel(chunk)} ${chunk.content}`;
    if (totalChars + entry.length > maxChars) break;
    parts.push(entry);
    totalChars += entry.length;
  }

  return parts.join("\n\n---\n\n");
}
