/**
 * Pipeline Step 5: Domain Clustering
 *
 * Assigns each use case to a business domain and subdomain using Model
 * Serving (JSON mode). Optionally merges small domains.
 */

import { executeAIQuery } from "@/lib/ai/agent";
import { buildTokenAwareBatches } from "@/lib/toolkit/token-budget";
import { resolveEndpoint } from "@/lib/dbx/client";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { updateRunMessage } from "@/lib/lakebase/runs";
import { logger as fallbackLogger } from "@/lib/logger";
import {
  DomainAssignmentSchema,
  SubdomainAssignmentSchema,
  validateLLMArray,
} from "@/lib/validation";
import { mapWithConcurrency } from "@/lib/toolkit/concurrency";
import type { PipelineContext, UseCase } from "@/lib/domain/types";

const MIN_CASES_PER_DOMAIN = 3;
const DOMAIN_CONCURRENCY = 5;

export async function runDomainClustering(
  ctx: PipelineContext,
  runId?: string,
): Promise<UseCase[]> {
  const log = ctx.logger ?? fallbackLogger;
  const { run, useCases } = ctx;
  if (!run.businessContext) throw new Error("Business context not available");
  if (useCases.length === 0) return [];

  const bc = run.businessContext;
  const updatedCases = [...useCases];

  // Step 5a: Assign domains
  if (runId)
    await updateRunMessage(runId, `Assigning domains to ${updatedCases.length} use cases...`);
  try {
    await assignDomains(
      log,
      updatedCases,
      run.config.businessName,
      bc,
      resolveEndpoint("classification"),
      runId,
    );
  } catch (error) {
    log.error("Domain assignment failed", {
      fn: "runDomainClustering",
      errorCategory: "llm_error",
      error: error instanceof Error ? error.message : String(error),
    });
    // Fallback: assign all to "General"
    updatedCases.forEach((uc) => {
      uc.domain = "General";
    });
  }

  // Step 5b: Assign subdomains per domain (parallel across domains)
  const domains = [...new Set(updatedCases.map((uc) => uc.domain))];
  const subdomainTasks = domains
    .filter((domain) => updatedCases.filter((uc) => uc.domain === domain).length >= 2)
    .map((domain) => async () => {
      const domainCases = updatedCases.filter((uc) => uc.domain === domain);
      try {
        await assignSubdomains(
          log,
          domainCases,
          domain,
          run.config.businessName,
          bc,
          resolveEndpoint("classification"),
          runId,
        );
      } catch (error) {
        log.warn("Subdomain assignment failed", {
          fn: "runDomainClustering",
          errorCategory: "llm_error",
          domain,
          error: error instanceof Error ? error.message : String(error),
        });
        domainCases.forEach((uc) => {
          uc.subdomain = "General";
        });
      }
    });
  if (runId)
    await updateRunMessage(
      runId,
      `Assigning subdomains across ${subdomainTasks.length} domains...`,
    );
  await mapWithConcurrency(subdomainTasks, DOMAIN_CONCURRENCY);

  // Step 5c: Merge small domains
  const smallDomainCount = Object.entries(
    updatedCases.reduce<Record<string, number>>((acc, uc) => {
      acc[uc.domain] = (acc[uc.domain] ?? 0) + 1;
      return acc;
    }, {}),
  ).filter(([, count]) => count < MIN_CASES_PER_DOMAIN).length;

  if (smallDomainCount > 0 && runId) {
    await updateRunMessage(runId, `Merging ${smallDomainCount} small domains...`);
  }
  try {
    await mergeSmallDomains(log, updatedCases, resolveEndpoint("classification"), runId);
  } catch (error) {
    log.warn("Domain merge failed", {
      fn: "runDomainClustering",
      errorCategory: "llm_error",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const finalDomainCount = [...new Set(updatedCases.map((uc) => uc.domain))].length;
  if (runId) await updateRunMessage(runId, `Organised into ${finalDomainCount} domains`);

  log.info("Domain clustering complete", { domainCount: finalDomainCount });

  return updatedCases;
}

async function assignDomains(
  log: typeof fallbackLogger,
  useCases: UseCase[],
  businessName: string,
  businessContext: { industries: string },
  aiModel: string,
  runId?: string,
): Promise<void> {
  const targetDomainCount = Math.max(3, Math.min(25, Math.round(useCases.length / 10)));

  const renderUseCase = (uc: UseCase) =>
    `${uc.useCaseNo}, "${uc.name}", "${uc.type}", "${uc.statement}"`;

  // Estimate base prompt overhead (everything except use_cases_csv)
  const baseContextTokens = 1500; // template + business context overhead
  const batches = buildTokenAwareBatches(useCases, renderUseCase, baseContextTokens);

  const domainMap = new Map<number, string>();

  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      const useCasesCsv = batch.map(renderUseCase).join("\n");

      const result = await executeAIQuery({
        promptKey: "DOMAIN_FINDER_PROMPT",
        variables: {
          business_name: businessName,
          industries: businessContext.industries,
          business_context: JSON.stringify(businessContext),
          use_cases_csv: useCasesCsv,
          previous_violations: "None",
          output_language: "English",
          target_domain_count: String(targetDomainCount),
        },
        modelEndpoint: aiModel,
        responseFormat: "json_object",
        runId,
        step: "domain-clustering",
        maxTokens: 128000,
      });

      let rawItems: unknown[];
      try {
        rawItems = parseLLMJson(result.rawResponse, "domain-clustering") as unknown[];
      } catch (parseErr) {
        log.warn("Failed to parse domain assignment JSON", {
          fn: "runDomainClustering",
          errorCategory: "llm_parse",
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
        });
        batch.forEach((uc) => {
          uc.domain = "General";
        });
        return [];
      }

      return validateLLMArray(rawItems, DomainAssignmentSchema, "assignDomains");
    }),
  );

  for (const items of batchResults) {
    for (const item of items) {
      if (!isNaN(item.no) && item.domain) {
        domainMap.set(item.no, item.domain.trim());
      }
    }
  }

  for (const uc of useCases) {
    uc.domain = domainMap.get(uc.useCaseNo) ?? "General";
  }
}

async function assignSubdomains(
  log: typeof fallbackLogger,
  domainCases: UseCase[],
  domainName: string,
  businessName: string,
  businessContext: { industries: string },
  aiModel: string,
  runId?: string,
): Promise<void> {
  const renderUseCase = (uc: UseCase) =>
    `${uc.useCaseNo}, "${uc.name}", "${uc.type}", "${uc.statement}"`;

  const baseContextTokens = 1200;
  const batches = buildTokenAwareBatches(domainCases, renderUseCase, baseContextTokens);

  const subdomainMap = new Map<number, string>();

  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      const useCasesCsv = batch.map(renderUseCase).join("\n");

      const result = await executeAIQuery({
        promptKey: "SUBDOMAIN_DETECTOR_PROMPT",
        variables: {
          domain_name: domainName,
          business_name: businessName,
          industries: businessContext.industries,
          business_context: JSON.stringify(businessContext),
          use_cases_csv: useCasesCsv,
          previous_violations: "None",
          output_language: "English",
        },
        modelEndpoint: aiModel,
        responseFormat: "json_object",
        runId,
        step: "domain-clustering",
        maxTokens: 128000,
      });

      let rawItems: unknown[];
      try {
        rawItems = parseLLMJson(result.rawResponse, "domain-clustering:subdomain") as unknown[];
      } catch (parseErr) {
        log.warn("Failed to parse subdomain assignment JSON", {
          fn: "runDomainClustering",
          errorCategory: "llm_parse",
          domain: domainName,
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
        });
        batch.forEach((uc) => {
          uc.subdomain = "General";
        });
        return [];
      }

      return validateLLMArray(rawItems, SubdomainAssignmentSchema, "assignSubdomains");
    }),
  );

  for (const items of batchResults) {
    for (const item of items) {
      if (!isNaN(item.no) && item.subdomain) {
        subdomainMap.set(item.no, item.subdomain.trim());
      }
    }
  }

  // Post-processing: merge single-item subdomains into nearest sibling
  const subdomainCounts = new Map<string, number>();
  for (const sd of subdomainMap.values()) {
    subdomainCounts.set(sd, (subdomainCounts.get(sd) ?? 0) + 1);
  }

  const singleItemSubdomains = new Set(
    [...subdomainCounts.entries()].filter(([, count]) => count < 2).map(([name]) => name),
  );

  if (singleItemSubdomains.size > 0) {
    const largestSubdomain =
      [...subdomainCounts.entries()]
        .filter(([name]) => !singleItemSubdomains.has(name))
        .sort(([, a], [, b]) => b - a)[0]?.[0] ?? "General";

    for (const [no, sd] of subdomainMap.entries()) {
      if (singleItemSubdomains.has(sd)) {
        subdomainMap.set(no, largestSubdomain);
      }
    }
  }

  for (const uc of domainCases) {
    uc.subdomain = subdomainMap.get(uc.useCaseNo) ?? "General";
  }
}

async function mergeSmallDomains(
  log: typeof fallbackLogger,
  useCases: UseCase[],
  aiModel: string,
  runId?: string,
): Promise<void> {
  const domainCounts: Record<string, number> = {};
  for (const uc of useCases) {
    domainCounts[uc.domain] = (domainCounts[uc.domain] ?? 0) + 1;
  }

  const smallDomains = Object.entries(domainCounts)
    .filter(([, count]) => count < MIN_CASES_PER_DOMAIN)
    .map(([name]) => name);

  if (smallDomains.length === 0) return;

  const domainInfoStr = Object.entries(domainCounts)
    .map(([name, count]) => `${name}: ${count} use cases`)
    .join("\n");

  try {
    const result = await executeAIQuery({
      promptKey: "DOMAINS_MERGER_PROMPT",
      variables: {
        min_cases_per_domain: String(MIN_CASES_PER_DOMAIN),
        domain_info_str: domainInfoStr,
      },
      modelEndpoint: aiModel,
      responseFormat: "json_object",
      runId,
      step: "domain-clustering",
      maxTokens: 128000,
    });

    let mergeMap: Record<string, string>;
    try {
      mergeMap = parseLLMJson(result.rawResponse, "domain-clustering:merge") as Record<
        string,
        string
      >;
    } catch (parseErr) {
      log.warn("Failed to parse domain merge JSON", {
        fn: "runDomainClustering",
        errorCategory: "llm_parse",
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
      });
      return;
    }

    for (const uc of useCases) {
      if (mergeMap[uc.domain]) {
        uc.domain = mergeMap[uc.domain];
      }
    }
  } catch (error) {
    log.warn("Domain merge failed", {
      fn: "runDomainClustering",
      errorCategory: "llm_error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
