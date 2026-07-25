/**
 * Research Engine -- multi-pass, preset-aware company intelligence gathering.
 *
 * Orchestrates source collection, industry classification, and analytical
 * passes. The wizard never auto-generates outcome maps; every customer is
 * mapped to one of the registered industries via `normalizeIndustryId`
 * (with closest-match fallback). The May 2026 consolidation removed the
 * outcome-map-generation and enrichment-only-generation passes -- the
 * registered v2 industries cover the field.
 *
 * Consultant-grade outputs come from parallel fan-outs:
 *   - Phase 1: industry-landscape || key-quotes-extraction || source-summaries
 *   - Phase 2: company-deep-dive (Full) or strategy-and-narrative (Balanced)
 *   - Phase 3: data-strategy-mapping (Full)
 *   - Phase 4: demo-narrative (Full)
 *   - Phase 5: persona-talk-track || evidence-linking
 */

import { createScopedLogger } from "@/lib/logger";
import { databricksLLMClient } from "@/lib/ports/defaults/databricks-llm-client";
import { getIndustryOutcomeAsync } from "@/lib/domain/industry-outcomes-server";
import { getMasterRepoEnrichmentAsync } from "@/lib/domain/industry-outcomes/master-repo-registry";
import { getAllIndustryOutcomes } from "@/lib/domain/industry-outcomes-server";
import { resolveResearchBudget } from "../types";
import { resolveScope } from "../scope";
import type {
  ResearchEngineInput,
  ResearchEngineResult,
  ResearchPhase,
  IndustryLandscapeAnalysis,
  CompanyStrategicProfile,
  DataStrategyMap,
  DemoNarrativeDesign,
  ExecutiveBrief,
  KeyQuote,
  SourceSummary,
  PersonaTalkTrack,
} from "./types";
import type { ResearchSource, DataNarrative } from "../types";

import { runWebsiteScrape, runDeepWebsiteScrape } from "./passes/website-scrape";
import { runIRDiscovery } from "./passes/ir-crawler";
import { embedResearchSources } from "./passes/research-embedder";
import { runDocParsing } from "./passes/doc-parser";
import { runIndustryClassification } from "./passes/industry-classification";
import { runQuickSynthesis } from "./passes/quick-synthesis";
import { runIndustryLandscape } from "./passes/industry-landscape";
import { runStrategyAndNarrative } from "./passes/strategy-and-narrative";
import { runCompanyDeepDive } from "./passes/company-deep-dive";
import { runDataStrategyMapping } from "./passes/data-strategy-mapping";
import { runDemoNarrative } from "./passes/demo-narrative";
import { runKeyQuotesExtraction } from "./passes/key-quotes";
import { runSourceSummaries } from "./passes/source-summaries";
import { runPersonaTalkTrack } from "./passes/persona-talk-track";
import { runEvidenceLinking } from "./passes/evidence-linking";
import { getCachedIndustryLandscape, setCachedIndustryLandscape } from "./industry-cache";
import { recencyWeight } from "./recency";
import { normalizeIndustryId, closestIndustryMatch } from "./industry-match";

export class ResearchCancelledError extends Error {
  constructor() {
    super("Research was cancelled");
    this.name = "ResearchCancelledError";
  }
}

export async function runResearchEngine(
  input: ResearchEngineInput,
): Promise<ResearchEngineResult> {
  const startTime = Date.now();
  const preset = input.preset ?? "balanced";
  const budget = resolveResearchBudget(preset);
  const llm = input.deps?.llm ?? databricksLLMClient;
  const log = input.deps?.logger ?? createScopedLogger({ origin: "ResearchEngine", module: "demo/research-engine" });
  const signal = input.signal;
  const passTimings: Record<string, number> = {};

  const progress = (phase: ResearchPhase, percent: number, detail?: string) => {
    input.onProgress?.(phase, percent, detail);
  };

  const modelTier = budget.modelTier;

  log.info("Starting research engine", {
    customer: input.customerName,
    industryId: input.industryId,
    preset,
    modelTier,
    scope: input.scope,
  });

  const allSources: ResearchSource[] = [];

  // =======================================================================
  // Phase 0: Source Collection
  // =======================================================================
  progress("source-collection", 5, "Gathering sources...");

  const sourceOpts = {
    fetchFn: input.deps?.fetchFn,
    parsePdf: input.deps?.parsePdf,
    logger: log,
    signal,
    onSourceReady: (s: ResearchSource) => {
      allSources.push(s);
      input.onSourceReady?.(s);
    },
  };

  const sourceTexts: string[] = [];
  let t0 = Date.now();

  const sourceTasks: Array<Promise<{ text: string; sources: ResearchSource[] }>> = [];
  if (budget.sources.includes("strategic-crawl")) {
    progress("source-collection", 5, "Deep scanning website (sitemap + strategic pages)...");
    sourceTasks.push(runDeepWebsiteScrape(input.websiteUrl, input.scope, {
      ...sourceOpts,
      llm,
      onProgress: (detail) => progress("source-collection", 8, detail),
    }));
  } else if (budget.sources.includes("website")) {
    sourceTasks.push(runWebsiteScrape(input.websiteUrl, input.scope, sourceOpts));
  }
  if (budget.sources.includes("ir-discovery") || budget.sources.includes("sec-edgar")) {
    progress("source-collection", 9, "Scanning investor relations + filings...");
    sourceTasks.push(runIRDiscovery(input.websiteUrl, input.scope, sourceOpts));
  }

  const sourceResults = await Promise.allSettled(sourceTasks);
  for (const result of sourceResults) {
    if (result.status === "fulfilled") {
      if (result.value.text) sourceTexts.push(result.value.text);
    }
  }

  let docResult: { text: string; sources: ResearchSource[] } | null = null;
  if (budget.sources.includes("user-docs")) {
    docResult = runDocParsing(input.uploadedDocuments, input.pastedContext, {
      logger: log,
      onSourceReady: sourceOpts.onSourceReady,
    });
    if (docResult.text) sourceTexts.push(docResult.text);
    allSources.push(...docResult.sources);
  }

  let combinedSourceText = sourceTexts.join("\n\n---\n\n");
  passTimings["source-collection"] = Date.now() - t0;

  // Build per-source array used by key-quotes + source-summaries + embedding.
  const perSourceData: Array<{ source: ResearchSource; text: string }> = [];
  for (const result of sourceResults) {
    if (result.status === "fulfilled" && result.value.text) {
      const firstReady = result.value.sources.find((s) => s.status === "ready");
      if (firstReady) {
        perSourceData.push({ source: firstReady, text: result.value.text });
      }
    }
  }
  if (docResult?.text) {
    const firstDoc = docResult.sources.find((s) => s.status === "ready");
    if (firstDoc) perSourceData.push({ source: firstDoc, text: docResult.text });
  }

  // Rank sources by recency * volume before they feed LLM passes. When
  // downstream prompts truncate on token budget, the oldest/lowest-value
  // material drops off first instead of the tail of the original array.
  // This is the single highest-leverage change: a 2016 annual report can
  // no longer dominate the deep-dive prompt when a 2024 report is also
  // available.
  perSourceData.sort((a, b) => {
    const aVol = Math.min(a.text.length / 1e6, 1);
    const bVol = Math.min(b.text.length / 1e6, 1);
    const aScore = recencyWeight(a.source) * (0.2 + aVol);
    const bScore = recencyWeight(b.source) * (0.2 + bVol);
    return bScore - aScore;
  });

  // Rebuild combinedSourceText in recency-ranked order with a small header
  // per source carrying the publication date. Passes like company-deep-dive
  // and strategy-and-narrative slice the first N chars of source_text, so
  // putting recent material first is what makes the bias bite on the LLM's
  // truncated view.
  combinedSourceText = perSourceData
    .map(({ source, text }, idx) => {
      const title = (source.title || `Source ${idx + 1}`).slice(0, 140);
      const published =
        (source.publishedAt && source.publishedAt.slice(0, 10)) ||
        (typeof source.publishedYear === "number" ? String(source.publishedYear) : "unknown date");
      const conf =
        source.dateConfidence && source.dateConfidence !== "unknown"
          ? ` (${source.dateConfidence} confidence)`
          : "";
      return `[${title} -- Published: ${published}${conf}]\n${text}`;
    })
    .join("\n\n---\n\n");

  checkCancelled(signal);
  progress("source-collection", 15, `${allSources.filter((s) => s.status === "ready").length} sources gathered`);

  // =======================================================================
  // Phase 0.5 + 3.25 + 3.5: Embedding, Classification, Outcome Map
  // =======================================================================

  const embeddingTask = allSources.some((s) => s.status === "ready")
    ? (async () => {
        const tEmbed = Date.now();
        progress("embedding", 12, `Embedding ${allSources.filter((s) => s.status === "ready").length} sources for Ask Forge...`);

        const embedSources: Array<{
          type: string;
          title: string;
          text: string;
          url?: string;
          publishedAt?: string;
          publishedYear?: number;
          dateConfidence?: "high" | "medium" | "low" | "unknown";
        }> = perSourceData.map(({ source, text }) => ({
          type: source.type,
          title: source.title,
          text,
          url: source.url,
          publishedAt: source.publishedAt,
          publishedYear: source.publishedYear,
          dateConfidence: source.dateConfidence,
        }));

        const embeddedCount = await embedResearchSources(
          {
            sessionId: input.sessionId ?? input.customerName,
            customerName: input.customerName,
            industryId: input.industryId ?? "",
            sources: embedSources.filter((s) => s.text.length > 0),
          },
          log,
        );

        progress("embedding", 14, `Embedded ${embeddedCount} chunks for Ask Forge`);
        passTimings["embedding"] = Date.now() - tEmbed;
      })()
    : Promise.resolve();

  const classificationAndOutcomeTask = (async () => {
    let industryIdInner = input.industryId ?? "";
    let industryNameInner = "";

    const allOutcomes = await getAllIndustryOutcomes();
    const allOutcomeSummaries = allOutcomes.map((o) => ({ id: o.id, name: o.name }));

    if (industryIdInner) {
      const normalized = normalizeIndustryId(industryIdInner, allOutcomeSummaries);
      if (normalized && normalized !== industryIdInner) {
        log.info("Normalized industry ID", { original: industryIdInner, normalized });
        industryIdInner = normalized;
      }
    }

    if (!industryIdInner) {
      progress("industry-classification", 17, `Classifying industry from ${allSources.filter((s) => s.status === "ready").length} sources...`);
      t0 = Date.now();

      const classification = await runIndustryClassification(combinedSourceText, allOutcomeSummaries, {
        llm,
        logger: log,
        signal,
        modelTier,
      });

      industryIdInner = classification.industryId;
      industryNameInner = classification.industryName;

      const normalized = normalizeIndustryId(industryIdInner, allOutcomeSummaries);
      if (normalized) {
        industryIdInner = normalized;
        const match = allOutcomeSummaries.find((o) => o.id === normalized);
        if (match) industryNameInner = match.name;
      } else {
        // Closest-match fallback. Compares the classifier's raw id AND name
        // against every registered industry's id AND name (normalised
        // Levenshtein), so a degenerate LLM output ("rmg" / "betting") still
        // routes to the most similar registered industry rather than to
        // whichever happens to be alphabetically first. Only the truly
        // empty case (LLM returned nothing) falls through to picking the
        // first registered entry as a last-ditch default.
        const closest = closestIndustryMatch(
          classification.industryId,
          classification.industryName,
          allOutcomeSummaries,
        );
        const fallback = closest ?? allOutcomeSummaries[0];
        log.warn("Industry classification produced no canonical match; using closest-match fallback", {
          rawId: classification.industryId,
          rawName: classification.industryName,
          fallback: fallback?.id,
          fallbackName: fallback?.name,
          mode: closest ? "closest-match" : "first-registered",
        });
        if (fallback) {
          industryIdInner = fallback.id;
          industryNameInner = fallback.name;
        }
      }

      progress("industry-classification", 19, `Classified as ${industryNameInner} (${Math.round(classification.confidence * 100)}% confidence)`);
      passTimings["industry-classification"] = Date.now() - t0;
    }

    if (!industryNameInner) {
      const outcome = await getIndustryOutcomeAsync(industryIdInner);
      industryNameInner = outcome?.name ?? industryIdInner;
    }

    checkCancelled(signal);

    // Sanity-check the registry has both the outcome map and the master
    // repo enrichment for the resolved industry. We never auto-generate;
    // missing data is a registry/config gap and surfaces as a warning so
    // it can be fixed centrally instead of papered over per-customer.
    const existingOutcome = await getIndustryOutcomeAsync(industryIdInner);
    const existingEnrichment = await getMasterRepoEnrichmentAsync(industryIdInner);
    if (!existingOutcome) {
      log.warn("Resolved industry has no registered outcome map", { industryId: industryIdInner });
    }
    if (!existingEnrichment) {
      log.warn("Resolved industry has no master-repo enrichment", { industryId: industryIdInner });
    }

    return { industryId: industryIdInner, industryName: industryNameInner };
  })();

  const [, classResult] = await Promise.all([embeddingTask, classificationAndOutcomeTask]);
  const { industryId, industryName } = classResult;

  checkCancelled(signal);

  const outcomeMap = await getIndustryOutcomeAsync(industryId);
  const enrichment = await getMasterRepoEnrichmentAsync(industryId);

  const outcomeMapContext = outcomeMap
    ? JSON.stringify({
        objectives: outcomeMap.objectives,
        subVerticals: outcomeMap.subVerticals,
        suggestedDomains: outcomeMap.suggestedDomains,
      })
    : "No outcome map available.";

  const dataAssetsContext = enrichment
    ? JSON.stringify(enrichment.dataAssets)
    : "No data assets available.";

  const benchmarkContext = enrichment
    ? JSON.stringify(
        enrichment.useCases.map((uc) => ({
          name: uc.name,
          benchmarkImpact: uc.benchmarkImpact,
          benchmarkSource: uc.benchmarkSource,
          kpiTarget: uc.kpiTarget,
        })),
      )
    : "No benchmarks available.";

  // =======================================================================
  // Analytical Pipeline (varies by preset)
  // =======================================================================
  const resolvedScope = resolveScope(input.scope);
  const hasReadySources = perSourceData.some(({ text }) => text.length > 100);

  let industryLandscape: IndustryLandscapeAnalysis | null = null;
  let companyProfile: CompanyStrategicProfile | null = null;
  let dataStrategy: DataStrategyMap | null = null;
  let demoNarrative: DemoNarrativeDesign | null = null;
  let matchedDataAssetIds: string[] = [];
  let nomenclature: Record<string, string> = {};
  let dataNarratives: DataNarrative[] = [];
  let executiveBrief: ExecutiveBrief | null = null;
  let personaTalkTracks: PersonaTalkTrack[] | null = null;
  let keyQuotes: KeyQuote[] = [];
  let sourceSummaries: SourceSummary[] = [];

  if (preset === "quick") {
    // ----- QUICK: single synthesis call; evidence-linking is RAG-only. -----
    progress("quick-synthesis", 30, `Running quick synthesis for ${input.customerName}...`);
    t0 = Date.now();

    const quickResult = await runQuickSynthesis(
      input.customerName,
      industryId,
      industryName,
      outcomeMapContext,
      combinedSourceText,
      input.scope,
      { llm, logger: log, signal, modelTier },
    );

    companyProfile = quickResult.companyProfile ?? null;
    matchedDataAssetIds = quickResult.matchedDataAssetIds ?? [];
    nomenclature = quickResult.nomenclature ?? {};
    dataNarratives = quickResult.dataNarratives ?? [];
    passTimings["quick-synthesis"] = Date.now() - t0;

    // Best-effort evidence linking (RAG only -- no LLM call).
    if (hasReadySources && companyProfile) {
      progress("evidence-linking", 92, "Linking evidence to sources...");
      t0 = Date.now();
      try {
        const linked = await runEvidenceLinking(
          {
            customerName: input.customerName,
            industryId,
            sessionId: input.sessionId,
            executiveBrief: null,
            companyProfile,
            demoNarrative: null,
            personaTalkTracks: null,
          },
          log,
        );
        companyProfile = linked.companyProfile ?? companyProfile;
        progress(
          "evidence-linking",
          96,
          `Linked ${linked.stats.attached}/${linked.stats.attempted} evidence items`,
        );
      } catch (err) {
        log.warn("evidence-linking failed on quick preset", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      passTimings["evidence-linking"] = Date.now() - t0;
    }
  } else if (preset === "balanced") {
    // ----- BALANCED: Phase-1 fan-out + combined strategy-narrative + Phase-5 fan-out -----
    const cached = getCachedIndustryLandscape(industryId, input.scope?.subVertical);

    progress("industry-landscape", 25, `Analysing ${industryName} market forces and benchmarks...`);
    if (hasReadySources) {
      progress("key-quotes-extraction", 25, `Extracting key quotes from ${perSourceData.length} sources...`);
      progress("source-summaries", 25, `Summarising ${perSourceData.length} sources...`);
    }
    t0 = Date.now();

    const landscapePromise: Promise<IndustryLandscapeAnalysis> = cached
      ? Promise.resolve(cached)
      : runIndustryLandscape(industryName, outcomeMapContext, benchmarkContext, combinedSourceText, {
          llm, logger: log, signal, maxTokens: budget.maxTokensPerPass, modelTier,
        });

    const keyQuotesPromise: Promise<KeyQuote[]> = hasReadySources
      ? runKeyQuotesExtraction(input.customerName, perSourceData, { llm, logger: log, signal })
      : Promise.resolve([]);

    const sourceSummariesPromise: Promise<SourceSummary[]> = hasReadySources
      ? runSourceSummaries(input.customerName, perSourceData, { llm, logger: log, signal })
      : Promise.resolve([]);

    const [landscapeResult, keyQuotesResult, summariesResult] = await Promise.all([
      landscapePromise,
      keyQuotesPromise,
      sourceSummariesPromise,
    ]);

    industryLandscape = landscapeResult;
    keyQuotes = keyQuotesResult;
    sourceSummaries = summariesResult;

    if (!cached && industryLandscape) {
      setCachedIndustryLandscape(industryId, input.scope?.subVertical, industryLandscape);
    }

    passTimings["industry-landscape"] = cached ? 0 : Date.now() - t0;
    progress("industry-landscape", 40, cached
      ? `Loaded ${industryLandscape.marketForces?.length ?? 0} market forces from cache`
      : `Identified ${industryLandscape.marketForces?.length ?? 0} market forces, ${industryLandscape.keyBenchmarks?.length ?? 0} benchmarks`);
    if (hasReadySources) {
      progress("key-quotes-extraction", 40, `Extracted ${keyQuotes.length} quotes`);
      progress("source-summaries", 40, `Summarised ${sourceSummaries.length} sources`);
    }

    checkCancelled(signal);
    progress("strategy-and-narrative", 45, `Building strategy & demo narrative for ${input.customerName}...`);
    t0 = Date.now();

    const combined = await runStrategyAndNarrative(
      input.customerName,
      industryName,
      industryLandscape,
      dataAssetsContext,
      combinedSourceText,
      input.scope,
      { llm, logger: log, signal, maxTokens: budget.maxTokensPerPass, modelTier, keyQuotes },
    );

    companyProfile = combined.companyProfile;
    dataStrategy = combined.dataStrategy;
    demoNarrative = combined.demoNarrative;
    executiveBrief = combined.executiveBrief;
    matchedDataAssetIds = dataStrategy?.matchedDataAssetIds ?? [];
    nomenclature = dataStrategy?.nomenclature ?? {};
    dataNarratives = demoNarrative?.dataNarratives ?? [];
    passTimings["strategy-and-narrative"] = Date.now() - t0;
    progress("strategy-and-narrative", 85, `Matched ${matchedDataAssetIds.length} assets, ${demoNarrative?.killerMoments?.length ?? 0} killer moments`);

    // --- Phase-5 fan-out: persona-talk-track || evidence-linking ---
    checkCancelled(signal);
    progress("persona-talk-track", 90, "Building persona talk tracks...");
    progress("evidence-linking", 90, "Linking evidence to source quotes...");
    t0 = Date.now();

    const talkTrackPromise = runPersonaTalkTrack(input.customerName, industryName, {
      llm, logger: log, signal, modelTier: "generation",
      executiveBrief,
      companyProfile,
      industryLandscape,
      killerMoments: demoNarrative?.killerMoments ?? [],
      keyQuotes,
    });

    const linkingPromise = hasReadySources
      ? runEvidenceLinking(
          {
            customerName: input.customerName,
            industryId,
            sessionId: input.sessionId,
            executiveBrief,
            companyProfile,
            demoNarrative,
            personaTalkTracks: null,
          },
          log,
        )
      : Promise.resolve(null);

    const [talkResult, linkResult] = await Promise.all([talkTrackPromise, linkingPromise]);
    personaTalkTracks = talkResult;
    if (linkResult) {
      executiveBrief = linkResult.executiveBrief ?? executiveBrief;
      companyProfile = linkResult.companyProfile ?? companyProfile;
      demoNarrative = linkResult.demoNarrative ?? demoNarrative;
    }

    // Second, link evidence inside the newly produced persona talk tracks.
    if (hasReadySources && personaTalkTracks && personaTalkTracks.length > 0) {
      try {
        const linked2 = await runEvidenceLinking(
          {
            customerName: input.customerName,
            industryId,
            sessionId: input.sessionId,
            executiveBrief: null,
            companyProfile: null,
            demoNarrative: null,
            personaTalkTracks,
          },
          log,
        );
        personaTalkTracks = linked2.personaTalkTracks ?? personaTalkTracks;
      } catch (err) {
        log.warn("evidence-linking (persona tracks) failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    passTimings["persona-talk-track"] = Date.now() - t0;
    progress("persona-talk-track", 96, `Produced ${personaTalkTracks?.length ?? 0} persona talk tracks`);
    if (hasReadySources) {
      progress("evidence-linking", 96, `Linked evidence: ${linkResult?.stats.attached ?? 0}/${linkResult?.stats.attempted ?? 0}`);
    }

  } else {
    // ----- FULL: Phase-1 fan-out + deep-dive + data-strategy + demo-narrative + Phase-5 fan-out -----
    const cached = getCachedIndustryLandscape(industryId, input.scope?.subVertical);

    progress("industry-landscape", 25, `Analysing ${industryName} market forces and benchmarks...`);
    if (hasReadySources) {
      progress("key-quotes-extraction", 25, `Extracting key quotes from ${perSourceData.length} sources...`);
      progress("source-summaries", 25, `Summarising ${perSourceData.length} sources...`);
    }
    t0 = Date.now();

    const landscapePromise: Promise<IndustryLandscapeAnalysis> = cached
      ? Promise.resolve(cached)
      : runIndustryLandscape(industryName, outcomeMapContext, benchmarkContext, combinedSourceText, {
          llm, logger: log, signal, maxTokens: budget.maxTokensPerPass, modelTier,
        });

    const keyQuotesPromise: Promise<KeyQuote[]> = hasReadySources
      ? runKeyQuotesExtraction(input.customerName, perSourceData, { llm, logger: log, signal })
      : Promise.resolve([]);

    const sourceSummariesPromise: Promise<SourceSummary[]> = hasReadySources
      ? runSourceSummaries(input.customerName, perSourceData, { llm, logger: log, signal })
      : Promise.resolve([]);

    const [landscapeResult, keyQuotesResult, summariesResult] = await Promise.all([
      landscapePromise,
      keyQuotesPromise,
      sourceSummariesPromise,
    ]);

    industryLandscape = landscapeResult;
    keyQuotes = keyQuotesResult;
    sourceSummaries = summariesResult;

    if (!cached && industryLandscape) {
      setCachedIndustryLandscape(industryId, input.scope?.subVertical, industryLandscape);
    }

    passTimings["industry-landscape"] = cached ? 0 : Date.now() - t0;
    progress("industry-landscape", 40, cached
      ? `Loaded ${industryLandscape.marketForces?.length ?? 0} market forces from cache`
      : `Identified ${industryLandscape.marketForces?.length ?? 0} market forces, ${industryLandscape.keyBenchmarks?.length ?? 0} benchmarks`);
    if (hasReadySources) {
      progress("key-quotes-extraction", 40, `Extracted ${keyQuotes.length} quotes`);
      progress("source-summaries", 40, `Summarised ${sourceSummaries.length} sources`);
    }

    checkCancelled(signal);
    progress("company-deep-dive", 45, `Deep-diving ${input.customerName} strategic profile + exec brief...`);
    t0 = Date.now();

    const deepDive = await runCompanyDeepDive(
      input.customerName,
      industryName,
      industryLandscape,
      combinedSourceText,
      input.scope,
      { llm, logger: log, signal, maxTokens: budget.maxTokensPerPass, modelTier, keyQuotes },
    );
    companyProfile = deepDive.profile;
    executiveBrief = deepDive.executiveBrief;
    passTimings["company-deep-dive"] = Date.now() - t0;
    progress("company-deep-dive", 58, `Found ${companyProfile.statedPriorities?.length ?? 0} stated priorities, exec brief ready`);

    checkCancelled(signal);
    progress("data-strategy-mapping", 62, `Mapping ${input.customerName} priorities to data assets...`);
    t0 = Date.now();

    dataStrategy = await runDataStrategyMapping(
      input.customerName,
      industryLandscape,
      companyProfile,
      dataAssetsContext,
      input.scope,
      { llm, logger: log, signal, maxTokens: budget.maxTokensPerPass, modelTier },
    );
    passTimings["data-strategy-mapping"] = Date.now() - t0;
    progress("data-strategy-mapping", 75, `Mapped ${dataStrategy.matchedDataAssetIds?.length ?? 0} assets, maturity: ${dataStrategy.dataMaturityAssessment ?? "unknown"}`);

    checkCancelled(signal);
    progress("demo-narrative", 78, `Designing consultant-grade killer moments for ${input.customerName}...`);
    t0 = Date.now();

    demoNarrative = await runDemoNarrative(
      input.customerName,
      industryName,
      industryLandscape,
      companyProfile,
      dataStrategy,
      input.scope,
      { llm, logger: log, signal, maxTokens: budget.maxTokensPerPass, modelTier, keyQuotes },
    );
    passTimings["demo-narrative"] = Date.now() - t0;
    progress("demo-narrative", 88, `Designed ${demoNarrative.killerMoments?.length ?? 0} killer moments, ${demoNarrative.demoFlow?.length ?? 0}-step demo flow`);

    matchedDataAssetIds = dataStrategy?.matchedDataAssetIds ?? [];
    nomenclature = dataStrategy?.nomenclature ?? {};
    dataNarratives = demoNarrative?.dataNarratives ?? [];

    // --- Phase-5 fan-out: persona-talk-track || evidence-linking ---
    checkCancelled(signal);
    progress("persona-talk-track", 92, "Building persona talk tracks...");
    progress("evidence-linking", 92, "Linking evidence to source quotes...");
    t0 = Date.now();

    const talkTrackPromise = runPersonaTalkTrack(input.customerName, industryName, {
      llm, logger: log, signal, modelTier: "generation",
      executiveBrief,
      companyProfile,
      industryLandscape,
      killerMoments: demoNarrative?.killerMoments ?? [],
      keyQuotes,
    });

    const linkingPromise = hasReadySources
      ? runEvidenceLinking(
          {
            customerName: input.customerName,
            industryId,
            sessionId: input.sessionId,
            executiveBrief,
            companyProfile,
            demoNarrative,
            personaTalkTracks: null,
          },
          log,
        )
      : Promise.resolve(null);

    const [talkResult, linkResult] = await Promise.all([talkTrackPromise, linkingPromise]);
    personaTalkTracks = talkResult;
    if (linkResult) {
      executiveBrief = linkResult.executiveBrief ?? executiveBrief;
      companyProfile = linkResult.companyProfile ?? companyProfile;
      demoNarrative = linkResult.demoNarrative ?? demoNarrative;
    }

    // Second pass on persona tracks.
    if (hasReadySources && personaTalkTracks && personaTalkTracks.length > 0) {
      try {
        const linked2 = await runEvidenceLinking(
          {
            customerName: input.customerName,
            industryId,
            sessionId: input.sessionId,
            executiveBrief: null,
            companyProfile: null,
            demoNarrative: null,
            personaTalkTracks,
          },
          log,
        );
        personaTalkTracks = linked2.personaTalkTracks ?? personaTalkTracks;
      } catch (err) {
        log.warn("evidence-linking (persona tracks) failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    passTimings["persona-talk-track"] = Date.now() - t0;
    progress("persona-talk-track", 97, `Produced ${personaTalkTracks?.length ?? 0} persona talk tracks`);
    if (hasReadySources) {
      progress("evidence-linking", 97, `Linked evidence: ${linkResult?.stats.attached ?? 0}/${linkResult?.stats.attempted ?? 0}`);
    }
  }

  // =======================================================================
  // Build Result
  // =======================================================================
  progress("complete", 100, "Research complete");

  const confidence = allSources.filter((s) => s.status === "ready").length / Math.max(allSources.length, 1);

  const result: ResearchEngineResult = {
    customerName: input.customerName,
    industryId,
    scope: {
      ...resolvedScope,
      suggestedDivisions: companyProfile?.suggestedDivisions,
    },
    industryLandscape,
    companyProfile,
    dataStrategy,
    demoNarrative,
    matchedDataAssetIds,
    nomenclature,
    dataNarratives,
    executiveBrief,
    personaTalkTracks,
    sourceSummaries,
    keyQuotes,
    sources: allSources,
    confidence,
    passTimings,
  };

  const totalMs = Date.now() - startTime;
  log.info("Research engine complete", {
    preset,
    totalMs,
    assets: matchedDataAssetIds.length,
    sources: allSources.length,
    passTimings,
    keyQuotes: keyQuotes.length,
    sourceSummaries: sourceSummaries.length,
    personaTalkTracks: personaTalkTracks?.length ?? 0,
  });

  return result;
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ResearchCancelledError();
}
