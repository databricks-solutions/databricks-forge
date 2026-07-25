/**
 * Pipeline run embedding orchestrator.
 *
 * Called after use cases are persisted (post-scoring/SQL) to embed:
 *   - All use cases (name, statement, solution, businessValue, etc.)
 *   - Business context (strategic goals, value chain, priorities)
 *
 * Also provides Genie recommendation embedding (called after engine completes)
 * and outcome map embedding (called on create/update).
 *
 * Embedding is best-effort — failures are logged but do not fail the run.
 */

import { generateEmbeddings } from "./client";
import { insertEmbeddings, deleteEmbeddingsByKindAndRun, deleteEmbeddingsBySource } from "./store";
import {
  composeUseCase,
  composeBusinessContext,
  composeGenieRecommendation,
  composeGenieQuestion,
  composeOutcomeMap,
  composeBenchmarkContext,
  composeBenchmarkSourceChunk,
  composeFabricDataset,
  composeFabricMeasure,
  composeFabricReport,
  composeFabricArtifact,
} from "./compose";
import type { EmbeddingInput } from "./types";
import { isEmbeddingEnabled } from "./config";
import { createScopedLogger } from "@/lib/logger";

const log = createScopedLogger({
  origin: "EmbeddingPipeline",
  module: "embeddings/embed-pipeline",
});

function parseTables(val: string[] | string | undefined): string[] {
  if (Array.isArray(val)) return val;
  if (typeof val !== "string" || !val) return [];
  try {
    return JSON.parse(val);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Use case + business context embedding
// ---------------------------------------------------------------------------

interface UseCaseLike {
  id: string;
  name: string;
  type?: string;
  analyticsTechnique?: string;
  statement: string;
  solution: string;
  businessValue: string;
  beneficiary?: string;
  sponsor?: string;
  domain: string;
  subdomain?: string;
  tablesInvolved?: string[] | string;
  overallScore?: number;
}

/**
 * Embed all use cases and business context for a pipeline run.
 * Deletes existing embeddings for the run first.
 */
export async function embedRunResults(
  runId: string,
  useCases: UseCaseLike[],
  businessContext?: string | null,
  businessName?: string,
): Promise<void> {
  if (!isEmbeddingEnabled()) {
    log.debug("Embedding disabled, skipping run embedding");
    return;
  }

  const startTime = Date.now();

  try {
    await deleteEmbeddingsByKindAndRun("use_case", runId);
    await deleteEmbeddingsByKindAndRun("business_context", runId);

    const inputs: EmbeddingInput[] = [];
    const texts: string[] = [];

    for (const uc of useCases) {
      const text = composeUseCase(uc);
      texts.push(text);
      inputs.push({
        kind: "use_case",
        sourceId: uc.id,
        runId,
        contentText: text,
        metadataJson: {
          domain: uc.domain,
          subdomain: uc.subdomain,
          type: uc.type,
          technique: uc.analyticsTechnique,
          tables: parseTables(uc.tablesInvolved),
        },
        embedding: [],
      });
    }

    if (businessContext) {
      try {
        const ctx = JSON.parse(businessContext);
        const text = composeBusinessContext(ctx, businessName);
        texts.push(text);
        inputs.push({
          kind: "business_context",
          sourceId: runId,
          runId,
          contentText: text,
          metadataJson: { businessName },
          embedding: [],
        });
      } catch {
        // businessContext might not be valid JSON
      }
    }

    if (texts.length === 0) return;

    const embeddings = await generateEmbeddings(texts);
    for (let i = 0; i < inputs.length; i++) {
      inputs[i].embedding = embeddings[i];
    }

    await insertEmbeddings(inputs);

    log.info("Run embedding complete", {
      runId,
      useCases: useCases.length,
      totalRecords: inputs.length,
      durationMs: Date.now() - startTime,
    });
  } catch (err) {
    log.warn("Embedding failed (non-fatal)", {
      runId,
      error: err instanceof Error ? err.message : String(err),
      errorCategory: "non_fatal",
    });
  }
}

// ---------------------------------------------------------------------------
// Business value embedding (value estimates, roadmap, stakeholders, synthesis)
// ---------------------------------------------------------------------------

interface ValueEstimateLike {
  id: string;
  useCaseId: string;
  useCaseName?: string;
  valueLow: number;
  valueMid: number;
  valueHigh: number;
  currency?: string;
  valueType?: string;
  confidence?: string;
  rationale?: string | null;
  assumptions?: string[] | null;
  industryBenchmark?: string | null;
}

interface RoadmapPhaseLike {
  useCaseId: string;
  useCaseName?: string;
  phase: string;
  effortEstimate?: string | null;
  dependencies?: string[];
  enablers?: string[];
  rationale?: string | null;
}

interface StakeholderLike {
  id: string;
  role: string;
  department: string;
  useCaseCount: number;
  totalValue: number;
  domains?: string[];
  changeComplexity?: string | null;
  isChampion: boolean;
  isSponsor: boolean;
}

interface SynthesisLike {
  keyFindings?: Array<{ title: string; description: string; severity?: string }>;
  strategicRecommendations?: Array<{ title: string; description: string; priority?: string }>;
  riskCallouts?: Array<{ title: string; description: string; impact?: string }>;
  totalEstimatedValue?: { low: number; mid: number; high: number; currency?: string };
  quickWinCount?: number;
  topDomain?: string | null;
}

/**
 * Embed business value analysis outputs for the Strategic Advisor persona.
 * Deletes existing BV embeddings for the run first, then inserts fresh ones.
 */
export async function embedBusinessValueResults(
  runId: string,
  estimates: ValueEstimateLike[],
  roadmapPhases: RoadmapPhaseLike[],
  stakeholders: StakeholderLike[],
  synthesis: SynthesisLike | null,
): Promise<void> {
  if (!isEmbeddingEnabled()) {
    log.debug("Embedding disabled, skipping BV embedding");
    return;
  }

  const startTime = Date.now();

  try {
    const {
      composeValueEstimate,
      composeRoadmapPhase,
      composeStakeholderProfile,
      composeExecutiveSynthesis,
    } = await import("./compose");

    await deleteEmbeddingsByKindAndRun("value_estimate", runId);
    await deleteEmbeddingsByKindAndRun("roadmap_phase", runId);
    await deleteEmbeddingsByKindAndRun("stakeholder_profile", runId);
    await deleteEmbeddingsByKindAndRun("executive_synthesis", runId);

    const inputs: EmbeddingInput[] = [];
    const texts: string[] = [];

    for (const est of estimates) {
      const text = composeValueEstimate(est);
      texts.push(text);
      inputs.push({
        kind: "value_estimate",
        sourceId: est.id,
        runId,
        contentText: text,
        metadataJson: {
          useCaseId: est.useCaseId,
          valueType: est.valueType ?? null,
          confidence: est.confidence ?? null,
          valueMid: est.valueMid,
        },
        embedding: [],
      });
    }

    for (const rp of roadmapPhases) {
      const text = composeRoadmapPhase(rp);
      texts.push(text);
      inputs.push({
        kind: "roadmap_phase",
        sourceId: `${runId}:${rp.useCaseId}`,
        runId,
        contentText: text,
        metadataJson: {
          useCaseId: rp.useCaseId,
          phase: rp.phase,
          effort: rp.effortEstimate ?? null,
        },
        embedding: [],
      });
    }

    for (const sp of stakeholders) {
      const text = composeStakeholderProfile(sp);
      texts.push(text);
      inputs.push({
        kind: "stakeholder_profile",
        sourceId: sp.id,
        runId,
        contentText: text,
        metadataJson: { role: sp.role, department: sp.department, isChampion: sp.isChampion },
        embedding: [],
      });
    }

    if (synthesis) {
      const text = composeExecutiveSynthesis(synthesis);
      texts.push(text);
      inputs.push({
        kind: "executive_synthesis",
        sourceId: `${runId}:synthesis`,
        runId,
        contentText: text,
        metadataJson: {
          quickWinCount: synthesis.quickWinCount ?? null,
          topDomain: synthesis.topDomain ?? null,
        },
        embedding: [],
      });
    }

    if (texts.length === 0) return;

    const embeddings = await generateEmbeddings(texts);
    for (let i = 0; i < inputs.length; i++) {
      inputs[i].embedding = embeddings[i];
    }

    await insertEmbeddings(inputs);

    log.info("Business value embedding complete", {
      runId,
      estimates: estimates.length,
      roadmapPhases: roadmapPhases.length,
      stakeholders: stakeholders.length,
      hasSynthesis: !!synthesis,
      totalRecords: inputs.length,
      durationMs: Date.now() - startTime,
    });
  } catch (err) {
    log.warn("Business value embedding failed (non-fatal)", {
      runId,
      error: err instanceof Error ? err.message : String(err),
      errorCategory: "non_fatal",
    });
  }
}

// ---------------------------------------------------------------------------
// Genie recommendation embedding
// ---------------------------------------------------------------------------

interface GenieRecLike {
  domain: string;
  title: string;
  description: string;
  tables?: string[];
  metricViews?: string[];
  changeSummary?: string | null;
  recommendationType?: string | null;
  serializedSpace?: string;
}

/**
 * Embed Genie recommendations and their sample questions.
 */
export async function embedGenieRecommendations(
  runId: string,
  recommendations: GenieRecLike[],
): Promise<void> {
  if (!isEmbeddingEnabled()) {
    log.debug("Embedding disabled, skipping genie embedding");
    return;
  }

  const startTime = Date.now();

  try {
    await deleteEmbeddingsByKindAndRun("genie_recommendation", runId);
    await deleteEmbeddingsByKindAndRun("genie_question", runId);

    const inputs: EmbeddingInput[] = [];
    const texts: string[] = [];

    for (const rec of recommendations) {
      // Embed the recommendation itself
      const recText = composeGenieRecommendation(rec);
      texts.push(recText);
      inputs.push({
        kind: "genie_recommendation",
        sourceId: `${runId}:${rec.domain}`,
        runId,
        contentText: recText,
        metadataJson: { domain: rec.domain, title: rec.title, tables: rec.tables ?? [] },
        embedding: [],
      });

      // Extract and embed individual sample questions + trusted queries
      if (rec.serializedSpace) {
        try {
          const space = JSON.parse(rec.serializedSpace);

          // Sample questions
          const sampleQuestions = space.config?.sample_questions ?? [];
          for (const sq of sampleQuestions) {
            const qTexts = Array.isArray(sq.question) ? sq.question : [sq.question];
            for (const qText of qTexts) {
              if (!qText) continue;
              const text = composeGenieQuestion(qText, rec.domain);
              texts.push(text);
              inputs.push({
                kind: "genie_question",
                sourceId: `${runId}:${rec.domain}:q:${sq.id || qText.slice(0, 30)}`,
                runId,
                contentText: text,
                metadataJson: { domain: rec.domain, spaceTitle: rec.title },
                embedding: [],
              });
            }
          }

          // Trusted query questions (example_question_sqls)
          const trustedQueries = space.instructions?.example_question_sqls ?? [];
          for (const tq of trustedQueries) {
            const qTexts = Array.isArray(tq.question) ? tq.question : [tq.question];
            const sqlText = Array.isArray(tq.sql) ? tq.sql.join("\n") : tq.sql;
            for (const qText of qTexts) {
              if (!qText) continue;
              const text = composeGenieQuestion(qText, rec.domain, sqlText);
              texts.push(text);
              inputs.push({
                kind: "genie_question",
                sourceId: `${runId}:${rec.domain}:tq:${tq.id || qText.slice(0, 30)}`,
                runId,
                contentText: text,
                metadataJson: { domain: rec.domain, spaceTitle: rec.title, hasSql: true },
                embedding: [],
              });
            }
          }
        } catch {
          // serializedSpace might not be valid JSON
        }
      }
    }

    if (texts.length === 0) return;

    const embeddings = await generateEmbeddings(texts);
    for (let i = 0; i < inputs.length; i++) {
      inputs[i].embedding = embeddings[i];
    }

    await insertEmbeddings(inputs);

    log.info("Genie embedding complete", {
      runId,
      recommendations: recommendations.length,
      totalRecords: inputs.length,
      durationMs: Date.now() - startTime,
    });
  } catch (err) {
    log.warn("Genie embedding failed (non-fatal)", {
      runId,
      error: err instanceof Error ? err.message : String(err),
      errorCategory: "non_fatal",
    });
  }
}

// ---------------------------------------------------------------------------
// Outcome map embedding
// ---------------------------------------------------------------------------

interface OutcomeMapLike {
  id: string;
  name: string;
  objectives?: Array<{
    name: string;
    whyChange?: string;
    priorities?: Array<{
      name: string;
      useCases?: Array<{ name: string; description?: string }>;
    }>;
  }>;
  suggestedDomains?: string[];
  suggestedPriorities?: string[];
}

/**
 * Embed an outcome map (industry objectives and use cases).
 */
export async function embedOutcomeMap(map: OutcomeMapLike): Promise<void> {
  if (!isEmbeddingEnabled()) return;

  try {
    await deleteEmbeddingsBySource(map.id);

    const text = composeOutcomeMap(map);
    const [embedding] = await generateEmbeddings([text]);

    await insertEmbeddings([
      {
        kind: "outcome_map",
        sourceId: map.id,
        contentText: text,
        metadataJson: { name: map.name },
        embedding,
      },
    ]);

    log.debug("Outcome map embedded", { id: map.id, name: map.name });
  } catch (err) {
    log.warn("Outcome map embedding failed (non-fatal)", {
      id: map.id,
      error: err instanceof Error ? err.message : String(err),
      errorCategory: "non_fatal",
    });
  }
}

// ---------------------------------------------------------------------------
// Benchmark record embedding
// ---------------------------------------------------------------------------

interface BenchmarkLike {
  benchmarkId: string;
  kind: string;
  title: string;
  summary: string;
  sourceUrl: string;
  publisher: string;
  industry?: string | null;
  region?: string | null;
  publishedAt?: string | null;
  ttlDays: number;
  sourceContent?: string | null;
}

/**
 * Embed a benchmark record using real source content when available.
 * Falls back to the hand-written summary if no source content exists.
 * Returns the number of chunks embedded.
 */
export async function embedBenchmarkRecords(records: BenchmarkLike[]): Promise<number> {
  if (!isEmbeddingEnabled() || records.length === 0) return 0;

  const { chunkText } = await import("./chunker");
  let totalChunks = 0;

  try {
    await Promise.all(records.map((r) => deleteEmbeddingsBySource(r.benchmarkId)));

    const allInputs: EmbeddingInput[] = [];
    const allTexts: string[] = [];

    for (const r of records) {
      const content = r.sourceContent || r.summary;
      const chunks = chunkText(content);

      if (chunks.length === 0) continue;

      const useSourceContent = !!r.sourceContent;
      const meta = {
        kind: r.kind,
        industry: r.industry ?? null,
        region: r.region ?? null,
        sourcePriority: "IndustryBenchmark",
        publishedAt: r.publishedAt ?? null,
        ttlDays: r.ttlDays,
        hasSourceContent: useSourceContent,
      };

      for (const chunk of chunks) {
        const text = useSourceContent
          ? composeBenchmarkSourceChunk(
              chunk.text,
              { title: r.title, kind: r.kind, industry: r.industry, publisher: r.publisher },
              chunk.index,
            )
          : composeBenchmarkContext({
              kind: r.kind,
              title: r.title,
              summary: r.summary,
              industry: r.industry ?? null,
              region: r.region ?? null,
              publisher: r.publisher,
              sourceUrl: r.sourceUrl,
            });

        allTexts.push(text);
        allInputs.push({
          kind: "benchmark_context",
          sourceId: r.benchmarkId,
          contentText: text,
          metadataJson: { ...meta, chunkIndex: chunk.index },
          embedding: [],
        });
      }

      totalChunks += chunks.length;
    }

    if (allTexts.length === 0) return 0;

    const vectors = await generateEmbeddings(allTexts);
    for (let i = 0; i < allInputs.length; i++) {
      allInputs[i].embedding = vectors[i];
    }

    await insertEmbeddings(allInputs);

    log.info("Benchmark embedding complete", {
      records: records.length,
      totalChunks,
    });
  } catch (err) {
    log.warn("Benchmark embedding failed (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
      errorCategory: "non_fatal",
    });
  }

  return totalChunks;
}

// ---------------------------------------------------------------------------
// Fabric scan embedding
// ---------------------------------------------------------------------------

export async function embedFabricScan(
  scanId: string,
  data: {
    datasets: Array<{
      datasetId: string;
      name: string;
      workspaceName?: string;
      tables: Array<{
        name: string;
        columns: Array<{ name: string; dataType: string }>;
        measures: Array<{ name: string; expression: string; description?: string }>;
      }>;
      relationships: Array<{
        fromTable: string;
        fromColumn: string;
        toTable: string;
        toColumn: string;
      }>;
      sensitivityLabel?: string | null;
    }>;
    reports: Array<{
      reportId: string;
      name: string;
      reportType?: string | null;
      datasetName?: string;
      workspaceName?: string;
      tiles?: Array<{ title: string }>;
      sensitivityLabel?: string | null;
    }>;
    artifacts: Array<{
      artifactId: string;
      name: string;
      artifactType: string;
      workspaceName?: string;
      metadata?: Record<string, unknown>;
    }>;
  },
): Promise<void> {
  if (!isEmbeddingEnabled()) return;

  try {
    const allTexts: string[] = [];
    const allInputs: EmbeddingInput[] = [];

    for (const ds of data.datasets) {
      allTexts.push(composeFabricDataset(ds));
      allInputs.push({
        kind: "fabric_dataset",
        sourceId: ds.datasetId,
        scanId,
        contentText: allTexts[allTexts.length - 1],
        metadataJson: {
          name: ds.name,
          workspace: ds.workspaceName,
          sensitivity: ds.sensitivityLabel,
        },
        embedding: [],
      });

      for (const table of ds.tables) {
        for (const measure of table.measures) {
          allTexts.push(
            composeFabricMeasure({
              name: measure.name,
              expression: measure.expression,
              tableName: table.name,
              datasetName: ds.name,
              description: measure.description,
            }),
          );
          allInputs.push({
            kind: "fabric_measure",
            sourceId: `${ds.datasetId}:${table.name}:${measure.name}`,
            scanId,
            contentText: allTexts[allTexts.length - 1],
            metadataJson: { dataset: ds.name, table: table.name, measure: measure.name },
            embedding: [],
          });
        }
      }
    }

    for (const r of data.reports) {
      allTexts.push(composeFabricReport(r));
      allInputs.push({
        kind: "fabric_report",
        sourceId: r.reportId,
        scanId,
        contentText: allTexts[allTexts.length - 1],
        metadataJson: { name: r.name, type: r.reportType, workspace: r.workspaceName },
        embedding: [],
      });
    }

    for (const a of data.artifacts) {
      allTexts.push(composeFabricArtifact(a));
      allInputs.push({
        kind: "fabric_artifact",
        sourceId: a.artifactId,
        scanId,
        contentText: allTexts[allTexts.length - 1],
        metadataJson: { name: a.name, type: a.artifactType, workspace: a.workspaceName },
        embedding: [],
      });
    }

    if (allTexts.length === 0) return;

    const BATCH = 16;
    for (let i = 0; i < allTexts.length; i += BATCH) {
      const batch = allTexts.slice(i, i + BATCH);
      const vectors = await generateEmbeddings(batch);
      for (let j = 0; j < vectors.length; j++) {
        allInputs[i + j].embedding = vectors[j];
      }
    }

    await insertEmbeddings(allInputs);

    log.info("Fabric scan embedding complete", {
      scanId,
      datasets: data.datasets.length,
      reports: data.reports.length,
      artifacts: data.artifacts.length,
      totalEmbeddings: allInputs.length,
    });
  } catch (err) {
    log.warn("Fabric scan embedding failed (non-fatal)", {
      scanId,
      error: err instanceof Error ? err.message : String(err),
      errorCategory: "non_fatal",
    });
  }
}
