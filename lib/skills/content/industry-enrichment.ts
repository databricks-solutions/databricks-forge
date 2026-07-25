/**
 * Industry Enrichment skill -- dynamic, built at runtime from outcome maps.
 *
 * Base extractors (from IndustryOutcome):
 *   - typicalDataEntities per use case (expected tables/columns in this domain)
 *   - typicalSourceSystems per use case (where data originates)
 *   - businessValue per use case (ROI framing)
 *   - KPIs per priority (success metrics)
 *   - Personas per priority (who consumes the analysis)
 *
 * Master Repository extractors (from enrichment data):
 *   - Benchmark context per use case (KPI + % impact + source)
 *   - Model type guidance (use case grouping by ML complexity)
 *   - Strategic alignment taxonomy (imperative + pillar)
 *   - Data asset requirements (MC/VA criticality per use case)
 *   - LOE context (model type x data access patterns)
 *
 * Unlike the static skills, this module builds SkillChunks dynamically
 * based on the detected industry.
 */

import type { SkillChunk, SkillSection } from "../types";
import type { IndustryOutcome } from "@/lib/domain/industry-outcomes";
import { getIndustryOutcome } from "@/lib/domain/industry-outcomes";
import { getMasterRepoEnrichment } from "@/lib/domain/industry-outcomes/master-repo-registry";
import type { MasterRepoEnrichment } from "@/lib/domain/industry-outcomes/master-repo-types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build skill chunks from an industry outcome map and Master Repository data.
 * Returns an empty array if the industry is not found.
 */
export function buildIndustrySkillChunks(industryId: string): SkillChunk[] {
  const outcome = getIndustryOutcome(industryId);
  if (!outcome) return [];

  const enrichment = getMasterRepoEnrichment(industryId);
  const chunks: SkillChunk[] = [];

  // -- Base extractors (from IndustryOutcome) --

  const kpis = extractKPIs(outcome);
  if (kpis) {
    chunks.push({
      id: `industry-kpis-${industryId}`,
      title: `${outcome.name} KPIs`,
      content: kpis,
      category: "kpis",
    });
  }

  const entities = extractDataEntities(outcome);
  if (entities) {
    chunks.push({
      id: `industry-entities-${industryId}`,
      title: `${outcome.name} Data Entities`,
      content: entities,
      category: "vocabulary",
    });
  }

  const personas = extractPersonas(outcome);
  if (personas) {
    chunks.push({
      id: `industry-personas-${industryId}`,
      title: `${outcome.name} Personas`,
      content: personas,
      category: "vocabulary",
    });
  }

  const valueFraming = extractBusinessValue(outcome);
  if (valueFraming) {
    chunks.push({
      id: `industry-value-${industryId}`,
      title: `${outcome.name} Business Value`,
      content: valueFraming,
      category: "kpis",
    });
  }

  // -- Master Repository extractors (from enrichment data) --

  if (enrichment) {
    const benchmarks = extractBenchmarkContext(outcome.name, enrichment);
    if (benchmarks) {
      chunks.push({
        id: `industry-benchmarks-${industryId}`,
        title: `${outcome.name} Benchmark Impacts`,
        content: benchmarks,
        category: "kpis",
      });
    }

    const modelTypes = extractModelTypeGuidance(outcome.name, enrichment);
    if (modelTypes) {
      chunks.push({
        id: `industry-model-types-${industryId}`,
        title: `${outcome.name} Model Type Guidance`,
        content: modelTypes,
        category: "patterns",
      });
    }

    const strategy = extractStrategicAlignment(outcome.name, enrichment);
    if (strategy) {
      chunks.push({
        id: `industry-strategy-${industryId}`,
        title: `${outcome.name} Strategic Alignment`,
        content: strategy,
        category: "vocabulary",
      });
    }

    const assets = extractDataAssetRequirements(outcome.name, enrichment);
    if (assets) {
      chunks.push({
        id: `industry-data-assets-${industryId}`,
        title: `${outcome.name} Data Asset Requirements`,
        content: assets,
        category: "vocabulary",
      });
    }

    const loe = extractLOEContext(outcome.name, enrichment);
    if (loe) {
      chunks.push({
        id: `industry-loe-${industryId}`,
        title: `${outcome.name} LOE Patterns`,
        content: loe,
        category: "patterns",
      });
    }
  }

  return chunks;
}

/**
 * Build ready-to-inject context sections from an industry outcome map.
 * Convenience wrapper over buildIndustrySkillChunks for direct prompt injection.
 */
export function buildIndustrySkillSections(industryId: string): SkillSection[] {
  return buildIndustrySkillChunks(industryId).map((c) => ({
    title: c.title,
    content: c.content,
  }));
}

/**
 * Build a compact domain question patterns block for benchmark generation.
 * Returns example question templates grounded in industry KPIs and entities.
 */
export function buildDomainQuestionPatterns(industryId: string): string {
  const outcome = getIndustryOutcome(industryId);
  if (!outcome) return "";

  const patterns: string[] = [`Domain Question Patterns for ${outcome.name}:`];

  for (const obj of outcome.objectives) {
    for (const pri of obj.priorities) {
      if (pri.kpis.length === 0) continue;
      const kpi = pri.kpis[0];
      patterns.push(`- "What is the ${kpi.toLowerCase()} by [dimension] for [time period]?"`);
      if (patterns.length >= 6) break;
    }
    if (patterns.length >= 6) break;
  }

  return patterns.join("\n");
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

function extractKPIs(outcome: IndustryOutcome): string | null {
  const lines: string[] = [`Industry KPIs for ${outcome.name}:`];

  for (const obj of outcome.objectives) {
    for (const pri of obj.priorities) {
      if (pri.kpis.length === 0) continue;
      lines.push(`${pri.name}: ${pri.kpis.join("; ")}`);
    }
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

function extractDataEntities(outcome: IndustryOutcome): string | null {
  const entitySet = new Set<string>();

  for (const obj of outcome.objectives) {
    for (const pri of obj.priorities) {
      for (const uc of pri.useCases) {
        for (const entity of uc.typicalDataEntities ?? []) {
          entitySet.add(entity);
        }
      }
    }
  }

  if (entitySet.size === 0) return null;

  const sorted = Array.from(entitySet).sort();
  return `Typical Data Entities for ${outcome.name}:\n${sorted.join(", ")}`;
}

function extractPersonas(outcome: IndustryOutcome): string | null {
  const personaSet = new Set<string>();

  for (const obj of outcome.objectives) {
    for (const pri of obj.priorities) {
      for (const persona of pri.personas) {
        personaSet.add(persona);
      }
    }
  }

  if (personaSet.size === 0) return null;

  const sorted = Array.from(personaSet).sort();
  return `Key Personas for ${outcome.name}:\n${sorted.join(", ")}`;
}

function extractBusinessValue(outcome: IndustryOutcome): string | null {
  const lines: string[] = [`Business Value Themes for ${outcome.name}:`];
  let count = 0;

  for (const obj of outcome.objectives) {
    for (const pri of obj.priorities) {
      for (const uc of pri.useCases) {
        if (!uc.businessValue) continue;
        lines.push(`- ${uc.name}: ${uc.businessValue}`);
        count++;
        if (count >= 8) break;
      }
      if (count >= 8) break;
    }
    if (count >= 8) break;
  }

  return count > 0 ? lines.join("\n") : null;
}

// ---------------------------------------------------------------------------
// Master Repository extraction helpers
// ---------------------------------------------------------------------------

const BENCHMARK_LIMIT = 15;
const ASSET_LIMIT = 12;
const LOE_LIMIT = 10;

function extractBenchmarkContext(
  industryName: string,
  enrichment: MasterRepoEnrichment,
): string | null {
  const lines: string[] = [`Industry Benchmark Impacts for ${industryName}:`];
  let count = 0;

  for (const uc of enrichment.useCases) {
    if (!uc.benchmarkImpact || !uc.kpiTarget) continue;
    const src = uc.benchmarkSource ? ` (${uc.benchmarkSource})` : "";
    lines.push(`- ${uc.name}: ${uc.kpiTarget} ${uc.benchmarkImpact}${src}`);
    count++;
    if (count >= BENCHMARK_LIMIT) break;
  }

  return count > 0 ? lines.join("\n") : null;
}

function extractModelTypeGuidance(
  industryName: string,
  enrichment: MasterRepoEnrichment,
): string | null {
  const groups = new Map<string, string[]>();

  for (const uc of enrichment.useCases) {
    if (!uc.modelType) continue;
    if (!groups.has(uc.modelType)) groups.set(uc.modelType, []);
    groups.get(uc.modelType)!.push(uc.name);
  }

  if (groups.size === 0) return null;

  const lines: string[] = [`Model Type Guidance for ${industryName}:`];
  for (const [type, names] of groups) {
    const display = names.slice(0, 5).join(", ");
    const more = names.length > 5 ? ` (+${names.length - 5} more)` : "";
    lines.push(`${type}: ${display}${more}`);
  }

  return lines.join("\n");
}

function extractStrategicAlignment(
  industryName: string,
  enrichment: MasterRepoEnrichment,
): string | null {
  const imperatives = new Map<string, Set<string>>();

  for (const uc of enrichment.useCases) {
    if (!uc.strategicImperative) continue;
    if (!imperatives.has(uc.strategicImperative)) {
      imperatives.set(uc.strategicImperative, new Set());
    }
    if (uc.strategicPillar) {
      imperatives.get(uc.strategicImperative)!.add(uc.strategicPillar);
    }
  }

  if (imperatives.size === 0) return null;

  const lines: string[] = [`Strategic Alignment for ${industryName}:`];
  for (const [imp, pillars] of imperatives) {
    const pillarList = Array.from(pillars).slice(0, 4).join("; ");
    lines.push(`${imp}: ${pillarList}`);
  }

  return lines.join("\n");
}

function extractDataAssetRequirements(
  industryName: string,
  enrichment: MasterRepoEnrichment,
): string | null {
  if (enrichment.dataAssets.length === 0) return null;

  const families = new Map<string, string[]>();
  for (const da of enrichment.dataAssets) {
    if (!da.assetFamily) continue;
    if (!families.has(da.assetFamily)) families.set(da.assetFamily, []);
    families.get(da.assetFamily)!.push(`${da.id}: ${da.name}`);
  }

  const lines: string[] = [`Data Asset Catalog for ${industryName}:`];
  let count = 0;
  for (const [family, assets] of families) {
    lines.push(`${family}: ${assets.join("; ")}`);
    count += assets.length;
    if (count >= ASSET_LIMIT) break;
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

function extractLOEContext(industryName: string, enrichment: MasterRepoEnrichment): string | null {
  const patterns = new Map<string, number>();

  for (const uc of enrichment.useCases) {
    if (!uc.modelType) continue;
    const mcCount = uc.dataAssetCriticality
      ? Object.values(uc.dataAssetCriticality).filter((v) => v === "MC").length
      : 0;
    const dataComplexity = mcCount >= 4 ? "high data" : mcCount >= 2 ? "medium data" : "low data";
    const key = `${uc.modelType} + ${dataComplexity}`;
    patterns.set(key, (patterns.get(key) || 0) + 1);
  }

  if (patterns.size === 0) return null;

  const sorted = Array.from(patterns.entries()).sort((a, b) => b[1] - a[1]);
  const lines: string[] = [`LOE Patterns for ${industryName}:`];
  for (const [pattern, count] of sorted.slice(0, LOE_LIMIT)) {
    lines.push(`- ${pattern}: ${count} use cases`);
  }

  return lines.join("\n");
}
