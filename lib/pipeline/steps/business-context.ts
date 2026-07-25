/**
 * Pipeline Step 1: Business Context Generation
 *
 * Calls Model Serving to generate a structured business context from the
 * organisation name and user-supplied configuration.
 */

import { executeAIQuery } from "@/lib/ai/agent";
import { resolveEndpoint } from "@/lib/dbx/client";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { updateRunMessage } from "@/lib/lakebase/runs";
import { buildIndustryContextPrompt } from "@/lib/domain/industry-outcomes-server";
import { buildBenchmarkContextPrompt } from "@/lib/domain/benchmark-context";
import { persistManifest } from "@/lib/pipeline/context-manifest";
import { logger as fallbackLogger } from "@/lib/logger";
import type { BusinessContext, PipelineContext } from "@/lib/domain/types";

const DEFAULT_CONTEXT: BusinessContext = {
  industries: "General",
  strategicGoals: "Improve operational efficiency and drive growth",
  businessPriorities: "Increase Revenue",
  strategicInitiative: "Data-driven decision making",
  valueChain: "Standard business operations",
  revenueModel: "Standard revenue model",
  additionalContext: "",
};

/**
 * Safely convert any value to a human-readable string.
 *
 * The LLM may return strings, arrays, or nested objects for business context
 * fields. `String()` on an object produces "[object Object]", so we need to
 * handle arrays and objects explicitly.
 */
function toReadableString(value: unknown, fallback: string): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  // Array of primitives or objects
  if (Array.isArray(value)) {
    const items = value.map((item) => {
      if (typeof item === "string") return item;
      if (typeof item === "object" && item !== null) {
        // Object with a "name", "goal", "title", "description", or "label" key
        const obj = item as Record<string, unknown>;
        const label = obj.name ?? obj.goal ?? obj.title ?? obj.label ?? obj.description;
        if (typeof label === "string") return label;
        // Fallback: join all values
        return Object.values(obj)
          .filter((v) => typeof v === "string" || typeof v === "number")
          .join(" – ");
      }
      return String(item);
    });
    return items.filter(Boolean).join("; ") || fallback;
  }

  // Plain object -- try common shapes, then join values
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const desc = obj.description ?? obj.summary ?? obj.text ?? obj.name;
    if (typeof desc === "string") return desc;
    // Join all string/number values
    const parts = Object.entries(obj)
      .filter(([, v]) => typeof v === "string" || typeof v === "number")
      .map(([k, v]) => `${k}: ${v}`);
    return parts.join("; ") || fallback;
  }

  return fallback;
}

export async function runBusinessContext(
  ctx: PipelineContext,
  runId?: string,
): Promise<BusinessContext> {
  const log = ctx.logger ?? fallbackLogger;
  const { config } = ctx.run;

  try {
    if (runId)
      await updateRunMessage(runId, `Researching business context for ${config.businessName}...`);
    // Inject industry context from outcome maps when an industry is selected
    const industryContext = config.industry
      ? await buildIndustryContextPrompt(config.industry)
      : "";
    const benchmarkResult = await buildBenchmarkContextPrompt(
      config.industry || undefined,
      config.customerMaturity,
    );

    // Retrieve relevant document context from the knowledge base (RAG)
    let documentContext = "";
    let docSourceIds: string[] = [];
    let docKinds: string[] = [];
    let docChunkCount = 0;
    try {
      const { retrieveContext, formatRetrievedContext } =
        await import("@/lib/embeddings/retriever");
      const chunks = await retrieveContext(
        `Business context for ${config.businessName}: ${config.businessDomains || ""} ${config.businessPriorities?.join(", ") || ""} ${config.strategicGoals || ""} ${config.additionalContext || ""}`,
        { kinds: ["document_chunk", "business_context"], topK: 5, minScore: 0.4 },
      );
      if (chunks.length > 0) {
        documentContext = formatRetrievedContext(chunks, 4000);
        docSourceIds = [...new Set(chunks.map((c) => c.sourceId))];
        docKinds = [...new Set(chunks.map((c) => c.kind))];
        docChunkCount = chunks.length;
        log.debug("RAG context retrieved", { chunks: chunks.length });
      }
    } catch {
      // RAG is best-effort; proceed without it
    }

    // Persist enrichment provenance
    if (runId) {
      const outcomeMapSections: string[] = [];
      if (industryContext) outcomeMapSections.push("context");
      try {
        await persistManifest(runId, {
          benchmarks: benchmarkResult.sources,
          outcomeMap: {
            industryId: config.industry || null,
            sections: outcomeMapSections,
          },
          documents: { sourceIds: docSourceIds, kinds: docKinds, chunkCount: docChunkCount },
          steps: ["business-context"],
        });
      } catch (e) {
        log.warn("persistManifest failed (non-fatal)", {
          fn: "runBusinessContext",
          errorCategory: "db",
          error: e,
        });
      }
    }

    const result = await executeAIQuery({
      promptKey: "BUSINESS_CONTEXT_WORKER_PROMPT",
      variables: {
        industry: config.businessDomains || config.businessName,
        name: config.businessName,
        type_description: "Full business context research",
        type_label: "business organisation",
        industry_context: industryContext,
        customer_profile_context: `Customer maturity: ${config.customerMaturity}\nRisk posture: ${config.riskPosture}\nTransformation horizon: ${config.transformationHorizon}\nUser strategic goals: ${config.strategicGoals || "Not provided"}\nAdditional context: ${config.additionalContext || "None provided"}`,
        benchmark_context: benchmarkResult.text,
        document_context: documentContext,
      },
      modelEndpoint: resolveEndpoint("classification"),
      responseFormat: "json_object",
      runId,
      step: "business-context",
    });

    let parsed: Record<string, unknown>;
    try {
      parsed = parseLLMJson(result.rawResponse, "business-context") as Record<string, unknown>;
    } catch (parseErr) {
      log.warn("Failed to parse business context JSON, using defaults", {
        fn: "runBusinessContext",
        errorCategory: "llm_parse",
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
      });
      return {
        ...DEFAULT_CONTEXT,
        businessPriorities: config.businessPriorities.join(", "),
        strategicGoals: config.strategicGoals || DEFAULT_CONTEXT.strategicGoals,
      };
    }

    const context: BusinessContext = {
      industries: toReadableString(parsed.industries, DEFAULT_CONTEXT.industries),
      strategicGoals: toReadableString(parsed.strategic_goals, DEFAULT_CONTEXT.strategicGoals),
      businessPriorities: toReadableString(
        parsed.business_priorities,
        config.businessPriorities.join(", "),
      ),
      strategicInitiative: toReadableString(
        parsed.strategic_initiative,
        DEFAULT_CONTEXT.strategicInitiative,
      ),
      valueChain: toReadableString(parsed.value_chain, DEFAULT_CONTEXT.valueChain),
      revenueModel: toReadableString(parsed.revenue_model, DEFAULT_CONTEXT.revenueModel),
      additionalContext: toReadableString(parsed.additional_context, ""),
    };

    if (runId) await updateRunMessage(runId, `Business context generated: ${context.industries}`);

    // Merge user overrides
    if (config.strategicGoals) {
      context.strategicGoals = config.strategicGoals;
    }
    if (config.businessDomains) {
      context.industries = config.businessDomains;
    }

    return context;
  } catch (error) {
    log.error("Business context LLM call failed, using defaults", {
      fn: "runBusinessContext",
      errorCategory: "llm_error",
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ...DEFAULT_CONTEXT,
      businessPriorities: config.businessPriorities.join(", "),
      strategicGoals: config.strategicGoals || DEFAULT_CONTEXT.strategicGoals,
    };
  }
}
