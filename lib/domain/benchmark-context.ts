import { listBenchmarkRecords } from "@/lib/lakebase/benchmarks";
import { isEmbeddingEnabled } from "@/lib/embeddings/config";
import { isBenchmarksEnabled } from "@/lib/benchmarks/config";
import { logger } from "@/lib/logger";

export type BenchmarkStrategy = "rag_distill" | "db_fallback" | "default";

export interface BenchmarkSourceMeta {
  strategy: BenchmarkStrategy;
  recordIds: string[];
  chunkCount: number;
}

export interface BenchmarkContextResult {
  text: string;
  sources: BenchmarkSourceMeta;
}

interface BenchmarkPack {
  kpis: string[];
  benchmarks: string[];
  advisoryThemes: string[];
  platformBestPractices: string[];
}

const DEFAULT_PACK: BenchmarkPack = {
  kpis: [
    "Value realization speed (time-to-impact)",
    "Adoption rate among target business users",
    "Decision quality uplift from analytics",
  ],
  benchmarks: [
    "Prioritize use cases with explicit measurable outcomes and clear owners.",
    "Prefer modular data products that can support multiple downstream decisions.",
  ],
  advisoryThemes: [
    "Tie each recommendation to executive priorities and operating model constraints.",
    "Avoid generic initiatives without quantified value or implementation path.",
  ],
  platformBestPractices: [
    "Favor use cases that produce reusable data products consumable across multiple teams.",
    "Prioritize use cases with near-real-time data freshness requirements where batch-only approaches miss intervention windows.",
  ],
};

function parseMaturityGuidance(customerMaturity: "nascent" | "developing" | "advanced"): string {
  if (customerMaturity === "nascent") {
    return "Favor low-complexity, fast time-to-value use cases.";
  }
  if (customerMaturity === "advanced") {
    return "Favor scalable, platform-level use cases with reusable assets.";
  }
  return "Balance near-term value with medium-term platform capability.";
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

const DISTILL_SYSTEM_PROMPT = `You are a benchmark analyst. Given a set of industry benchmark records retrieved for a customer engagement, distill them into concise, actionable context.

Output EXACTLY four sections in this order:
**Reference KPI lens:** (bullet list of KPI names)
**Use case best-practice priorities:** (bullet list)
**Advisory benchmark principles:** (bullet list)
**Consulting guidance:** (bullet list)

Keep each bullet to one sentence. Omit sections with no relevant content. Total output must be under 600 words.`;

/**
 * Build benchmark context for LLM prompts using a tiered strategy:
 *
 * 1. RAG + fast distill (preferred): retrieve top-K relevant benchmarks
 *    from the vector store, then distill with the fast model endpoint.
 * 2. DB fallback: query published benchmarks directly and format.
 * 3. Default pack: hardcoded fallback when no records exist.
 */
export async function buildBenchmarkContextPrompt(
  industryId: string | undefined,
  customerMaturity: "nascent" | "developing" | "advanced",
): Promise<BenchmarkContextResult> {
  const maturityLine = `Customer maturity: ${customerMaturity}. ${parseMaturityGuidance(customerMaturity)}`;
  const preamble = [
    "### BENCHMARK CONTEXT",
    "",
    "Benchmark priors are advisory only; customer metadata remains factual source-of-truth.",
    maturityLine,
  ].join("\n");

  const defaultSources: BenchmarkSourceMeta = { strategy: "default", recordIds: [], chunkCount: 0 };

  if (!isBenchmarksEnabled()) {
    return { text: formatDefaultPack(preamble), sources: defaultSources };
  }

  const distilled = await tryRagDistill(industryId, customerMaturity);
  if (distilled) {
    return {
      text: `${preamble}\n\n${distilled.text}`,
      sources: distilled.sources,
    };
  }

  const dbResult = await tryDbFallback(industryId);
  if (dbResult) {
    return {
      text: `${preamble}\n\n${dbResult.text}`,
      sources: dbResult.sources,
    };
  }

  return { text: formatDefaultPack(preamble), sources: defaultSources };
}

async function tryRagDistill(
  industryId: string | undefined,
  customerMaturity: string,
): Promise<{ text: string; sources: BenchmarkSourceMeta } | null> {
  if (!isEmbeddingEnabled()) return null;

  try {
    const { retrieveContext, formatRetrievedContext } = await import("@/lib/embeddings/retriever");
    const query = [
      industryId ?? "cross-industry",
      customerMaturity,
      "benchmark KPIs best practices advisory principles",
    ].join(" ");

    const chunks = await retrieveContext(query, {
      scope: "benchmarks",
      topK: 15,
      minScore: 0.4,
    });

    if (chunks.length === 0) return null;

    const recordIds = [...new Set(chunks.map((c) => c.sourceId))];
    const sources: BenchmarkSourceMeta = {
      strategy: "rag_distill",
      recordIds,
      chunkCount: chunks.length,
    };
    const contextText = formatRetrievedContext(chunks, 6000);

    try {
      const { chatCompletion } = await import("@/lib/dbx/model-serving");
      const { resolveEndpoint } = await import("@/lib/dbx/client");

      const response = await chatCompletion({
        endpoint: resolveEndpoint("classification"),
        messages: [
          { role: "system", content: DISTILL_SYSTEM_PROMPT },
          { role: "user", content: contextText },
        ],
        temperature: 0.1,
        maxTokens: 4096,
      });

      if (response.content.trim()) {
        logger.debug("[benchmark-context] RAG+distill succeeded", {
          industryId,
          chunks: chunks.length,
          tokens: response.usage?.totalTokens,
        });
        return { text: response.content.trim(), sources };
      }
    } catch (distillErr) {
      logger.warn("[benchmark-context] Fast distill failed, falling back", {
        error: distillErr instanceof Error ? distillErr.message : String(distillErr),
      });
    }

    const directText = formatChunksDirectly(chunks);
    return directText ? { text: directText, sources } : null;
  } catch (err) {
    logger.warn("[benchmark-context] RAG retrieval failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function formatChunksDirectly(chunks: Array<{ content: string; kind: string }>): string | null {
  if (chunks.length === 0) return null;
  const lines = chunks.slice(0, 10).map((c) => `- ${c.content.split("\n")[0]}`);
  return lines.join("\n");
}

async function tryDbFallback(
  industryId: string | undefined,
): Promise<{ text: string; sources: BenchmarkSourceMeta } | null> {
  try {
    const records = await listBenchmarkRecords({
      lifecycleStatus: "published",
      industry: industryId,
      includeExpired: true,
      limit: 250,
    });

    if (records.length === 0) return null;

    const recordIds = records.map((r) => r.benchmarkId);
    const sources: BenchmarkSourceMeta = {
      strategy: "db_fallback",
      recordIds,
      chunkCount: records.length,
    };

    const pack: BenchmarkPack = {
      kpis: dedupe(records.filter((r) => r.kind === "kpi").map((r) => r.title)).slice(0, 25),
      benchmarks: dedupe(
        records.filter((r) => r.kind === "benchmark_principle").map((r) => r.summary),
      ).slice(0, 20),
      advisoryThemes: dedupe(
        records.filter((r) => r.kind === "advisory_theme").map((r) => r.summary),
      ).slice(0, 20),
      platformBestPractices: dedupe(
        records.filter((r) => r.kind === "platform_best_practice").map((r) => r.summary),
      ).slice(0, 12),
    };

    const effective = {
      kpis: pack.kpis.length > 0 ? pack.kpis : DEFAULT_PACK.kpis,
      benchmarks: pack.benchmarks.length > 0 ? pack.benchmarks : DEFAULT_PACK.benchmarks,
      advisoryThemes:
        pack.advisoryThemes.length > 0 ? pack.advisoryThemes : DEFAULT_PACK.advisoryThemes,
      platformBestPractices:
        pack.platformBestPractices.length > 0
          ? pack.platformBestPractices
          : DEFAULT_PACK.platformBestPractices,
    };

    const text = [
      "**Reference KPI lens:**",
      ...effective.kpis.map((k) => `- ${k}`),
      "",
      "**Use case best-practice priorities:**",
      ...effective.platformBestPractices.map((p) => `- ${p}`),
      "",
      "**Advisory benchmark principles:**",
      ...effective.benchmarks.map((b) => `- ${b}`),
      "",
      "**Consulting guidance:**",
      ...effective.advisoryThemes.map((t) => `- ${t}`),
    ].join("\n");

    return { text, sources };
  } catch {
    return null;
  }
}

function formatDefaultPack(preamble: string): string {
  return [
    preamble,
    "",
    "**Reference KPI lens:**",
    ...DEFAULT_PACK.kpis.map((k) => `- ${k}`),
    "",
    "**Use case best-practice priorities:**",
    ...DEFAULT_PACK.platformBestPractices.map((p) => `- ${p}`),
    "",
    "**Advisory benchmark principles:**",
    ...DEFAULT_PACK.benchmarks.map((b) => `- ${b}`),
    "",
    "**Consulting guidance:**",
    ...DEFAULT_PACK.advisoryThemes.map((t) => `- ${t}`),
  ].join("\n");
}
