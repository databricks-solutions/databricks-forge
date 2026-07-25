/**
 * Embed skill chunks and industry KPIs into the pgvector store.
 *
 * Static skill content is embedded once (idempotent -- deletes existing
 * skill_chunk embeddings before re-inserting). Industry KPIs are embedded
 * per industry outcome map as industry_kpi entities.
 *
 * Call `embedAllSkills()` from an admin API route or at startup when the
 * embedding layer is enabled.
 */

import { generateEmbeddings } from "@/lib/embeddings/client";
import { insertEmbeddings, deleteByKind } from "@/lib/embeddings/store";
import type { EmbeddingInput } from "@/lib/embeddings/types";
import { getAllSkills } from "./registry";
import { INDUSTRY_OUTCOMES } from "@/lib/domain/industry-outcomes";
import {
  getMasterRepoEnrichment,
  getMasterRepoIndustryIds,
} from "@/lib/domain/industry-outcomes/master-repo-registry";
import { composeIndustryKPI } from "@/lib/embeddings/compose";
import { logger } from "@/lib/logger";

// Ensure static skills are registered before we read the registry
import "./content";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Embed all static skill chunks as `skill_chunk` entities.
 * Idempotent: deletes existing skill_chunk embeddings first.
 */
export async function embedStaticSkills(): Promise<number> {
  const skills = getAllSkills();
  const chunks = skills.flatMap((s) =>
    s.chunks.map((c) => ({
      sourceId: c.id,
      contentText: `${c.title}\n${c.content}`,
      metadataJson: {
        skillId: s.id,
        skillName: s.name,
        category: c.category,
        title: c.title,
      },
    })),
  );

  if (chunks.length === 0) return 0;

  await deleteByKind("skill_chunk");

  const texts = chunks.map((c) => c.contentText);
  const vectors = await generateEmbeddings(texts);

  const inputs: EmbeddingInput[] = chunks.map((c, i) => ({
    kind: "skill_chunk" as const,
    sourceId: c.sourceId,
    contentText: c.contentText,
    metadataJson: c.metadataJson,
    embedding: vectors[i],
  }));

  const count = await insertEmbeddings(inputs);
  logger.info("[embed-skills] Embedded static skill chunks", { count });
  return count;
}

/**
 * Embed industry KPIs from all built-in outcome maps as `industry_kpi` entities.
 * Idempotent: deletes existing industry_kpi embeddings first.
 */
export async function embedIndustryKPIs(): Promise<number> {
  const records: Array<{
    sourceId: string;
    contentText: string;
    metadataJson: Record<string, unknown>;
  }> = [];

  for (const industry of INDUSTRY_OUTCOMES) {
    for (const obj of industry.objectives) {
      for (const pri of obj.priorities) {
        if (pri.kpis.length === 0) continue;
        const text = composeIndustryKPI(industry.name, pri.name, pri.kpis, pri.personas);
        records.push({
          sourceId: `kpi-${industry.id}-${pri.name.toLowerCase().replace(/\s+/g, "-").slice(0, 40)}`,
          contentText: text,
          metadataJson: {
            industryId: industry.id,
            industryName: industry.name,
            priority: pri.name,
            objectiveName: obj.name,
          },
        });
      }
    }
  }

  if (records.length === 0) return 0;

  await deleteByKind("industry_kpi");

  const texts = records.map((r) => r.contentText);
  const vectors = await generateEmbeddings(texts);

  const inputs: EmbeddingInput[] = records.map((r, i) => ({
    kind: "industry_kpi" as const,
    sourceId: r.sourceId,
    contentText: r.contentText,
    metadataJson: r.metadataJson,
    embedding: vectors[i],
  }));

  const count = await insertEmbeddings(inputs);
  logger.info("[embed-skills] Embedded industry KPIs", { count });
  return count;
}

/**
 * Embed Master Repository benchmarks as `industry_benchmark` entities.
 * Idempotent: deletes existing industry_benchmark embeddings first.
 */
export async function embedIndustryBenchmarks(): Promise<number> {
  const records: Array<{
    sourceId: string;
    contentText: string;
    metadataJson: Record<string, unknown>;
  }> = [];

  for (const industryId of getMasterRepoIndustryIds()) {
    const enrichment = getMasterRepoEnrichment(industryId);
    if (!enrichment) continue;

    for (const uc of enrichment.useCases) {
      if (!uc.benchmarkImpact || !uc.kpiTarget) continue;
      const text = [
        `Use Case: ${uc.name}`,
        `KPI: ${uc.kpiTarget} (${uc.benchmarkImpact})`,
        `Model Type: ${uc.modelType || "Unknown"}`,
        uc.benchmarkSource ? `Source: ${uc.benchmarkSource}` : null,
        uc.description,
      ]
        .filter(Boolean)
        .join("\n");

      records.push({
        sourceId: `bm-${industryId}-${uc.name.toLowerCase().replace(/\s+/g, "-").slice(0, 50)}`,
        contentText: text,
        metadataJson: {
          industryId,
          useCaseName: uc.name,
          kpiTarget: uc.kpiTarget,
          benchmarkImpact: uc.benchmarkImpact,
          modelType: uc.modelType,
        },
      });
    }
  }

  if (records.length === 0) return 0;

  await deleteByKind("industry_benchmark");

  const texts = records.map((r) => r.contentText);
  const vectors = await generateEmbeddings(texts);

  const inputs: EmbeddingInput[] = records.map((r, i) => ({
    kind: "industry_benchmark" as const,
    sourceId: r.sourceId,
    contentText: r.contentText,
    metadataJson: r.metadataJson,
    embedding: vectors[i],
  }));

  const count = await insertEmbeddings(inputs);
  logger.info("[embed-skills] Embedded industry benchmarks", { count });
  return count;
}

/**
 * Embed Master Repository data assets as `industry_data_asset` entities.
 * Idempotent: deletes existing industry_data_asset embeddings first.
 */
export async function embedIndustryDataAssets(): Promise<number> {
  const records: Array<{
    sourceId: string;
    contentText: string;
    metadataJson: Record<string, unknown>;
  }> = [];

  for (const industryId of getMasterRepoIndustryIds()) {
    const enrichment = getMasterRepoEnrichment(industryId);
    if (!enrichment) continue;

    for (const da of enrichment.dataAssets) {
      const text = [
        `Data Asset: ${da.name} (${da.id})`,
        `Family: ${da.assetFamily}`,
        `System: ${da.systemLocation}`,
        da.description,
        `Databricks connectivity: Lakeflow=${da.lakeflowConnect}, UC Federation=${da.ucFederation}, Lakebridge=${da.lakebridgeMigrate}`,
      ].join("\n");

      records.push({
        sourceId: `da-${industryId}-${da.id.toLowerCase()}`,
        contentText: text,
        metadataJson: {
          industryId,
          assetId: da.id,
          assetFamily: da.assetFamily,
          systemLocation: da.systemLocation,
          lakeflowConnect: da.lakeflowConnect,
          ucFederation: da.ucFederation,
          lakebridgeMigrate: da.lakebridgeMigrate,
        },
      });
    }
  }

  if (records.length === 0) return 0;

  await deleteByKind("industry_data_asset");

  const texts = records.map((r) => r.contentText);
  const vectors = await generateEmbeddings(texts);

  const inputs: EmbeddingInput[] = records.map((r, i) => ({
    kind: "industry_data_asset" as const,
    sourceId: r.sourceId,
    contentText: r.contentText,
    metadataJson: r.metadataJson,
    embedding: vectors[i],
  }));

  const count = await insertEmbeddings(inputs);
  logger.info("[embed-skills] Embedded industry data assets", { count });
  return count;
}

/**
 * Embed all skills, industry KPIs, benchmarks, and data assets.
 */
export async function embedAllSkills(): Promise<{
  skillChunks: number;
  industryKpis: number;
  industryBenchmarks: number;
  industryDataAssets: number;
}> {
  const [skillChunks, industryKpis, industryBenchmarks, industryDataAssets] = await Promise.all([
    embedStaticSkills(),
    embedIndustryKPIs(),
    embedIndustryBenchmarks(),
    embedIndustryDataAssets(),
  ]);
  return { skillChunks, industryKpis, industryBenchmarks, industryDataAssets };
}
