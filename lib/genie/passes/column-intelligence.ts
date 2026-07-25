/**
 * Pass 1: Column Intelligence (LLM + Sample Data)
 *
 * Generates column descriptions, synonyms, and entity-matching candidates
 * using the LLM, grounded to the physical schema and informed by sample data.
 */

import { type ChatMessage } from "@/lib/dbx/model-serving";
import { cachedChatCompletion } from "@/lib/toolkit/llm-cache";
import { logger } from "@/lib/logger";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import type { MetadataSnapshot, SensitivityClassification } from "@/lib/domain/types";
import type {
  ColumnEnrichment,
  EntityMatchingCandidate,
  GenieEngineConfig,
  SampleDataCache,
  ColumnOverride,
} from "../types";
import { buildSchemaContextBlock, type SchemaAllowlist } from "../schema-allowlist";
import { extractEntityCandidates, extractEntityCandidatesFromSchema } from "../entity-extraction";
import { mapWithConcurrency } from "@/lib/toolkit/concurrency";
import {
  resolveForGeniePass,
  formatContextSections,
  buildIndustrySkillSections,
} from "@/lib/skills";

const BATCH_SIZE = 15;
const BATCH_CONCURRENCY = 10;
const TEMPERATURE = 0.2;

export interface ColumnIntelligenceInput {
  tableFqns: string[];
  metadata: MetadataSnapshot;
  allowlist: SchemaAllowlist;
  config: GenieEngineConfig;
  sampleData: SampleDataCache | null;
  piiClassifications?: SensitivityClassification[];
  /** Industry ID for domain-specific entity vocabulary. */
  industryId?: string;
  endpoint: string;
  signal?: AbortSignal;
}

export interface ColumnIntelligenceOutput {
  enrichments: ColumnEnrichment[];
  entityCandidates: EntityMatchingCandidate[];
}

export async function runColumnIntelligence(
  input: ColumnIntelligenceInput,
): Promise<ColumnIntelligenceOutput> {
  const {
    tableFqns,
    metadata,
    config,
    sampleData,
    piiClassifications,
    industryId,
    endpoint,
    signal,
  } = input;

  // Entity extraction from sample data (or schema fallback)
  let entityCandidates: EntityMatchingCandidate[];
  if (config.entityMatchingMode === "off") {
    entityCandidates = [];
  } else if (sampleData && sampleData.size > 0) {
    entityCandidates = extractEntityCandidates({
      tableFqns,
      sampleData,
      piiClassifications,
    });
  } else {
    entityCandidates = extractEntityCandidatesFromSchema(metadata.columns, tableFqns);
  }

  // Apply entity matching overrides
  for (const override of config.entityMatchingOverrides) {
    const key = `${override.tableFqn.toLowerCase()}.${override.columnName.toLowerCase()}`;
    if (!override.enabled) {
      entityCandidates = entityCandidates.filter(
        (c) => `${c.tableFqn.toLowerCase()}.${c.columnName.toLowerCase()}` !== key,
      );
    }
  }

  // If LLM refinement is disabled, return basic enrichments
  if (!config.llmRefinement) {
    const enrichments = buildBasicEnrichments(metadata, tableFqns, config.columnOverrides);
    return { enrichments, entityCandidates };
  }

  // LLM pass for column intelligence -- batches run with bounded concurrency
  const batches: string[][] = [];
  for (let i = 0; i < tableFqns.length; i += BATCH_SIZE) {
    batches.push(tableFqns.slice(i, i + BATCH_SIZE));
  }

  const batchResults = await mapWithConcurrency(
    batches.map((batch) => async () => {
      try {
        return await processColumnBatch(
          batch,
          metadata,
          sampleData,
          entityCandidates,
          endpoint,
          industryId,
          signal,
        );
      } catch (err) {
        logger.warn("Column intelligence batch failed, using basic enrichments", {
          endpoint,
          batch,
          error: err instanceof Error ? err.message : String(err),
        });
        return buildBasicEnrichments(metadata, batch, config.columnOverrides);
      }
    }),
    BATCH_CONCURRENCY,
  );

  const enrichments: ColumnEnrichment[] = batchResults.flat();

  // Apply customer overrides (overrides always win)
  applyColumnOverrides(enrichments, config.columnOverrides);

  return { enrichments, entityCandidates };
}

async function processColumnBatch(
  tableFqns: string[],
  metadata: MetadataSnapshot,
  sampleData: SampleDataCache | null,
  entityCandidates: EntityMatchingCandidate[],
  endpoint: string,
  industryId?: string,
  signal?: AbortSignal,
): Promise<ColumnEnrichment[]> {
  const schemaBlock = buildSchemaContextBlock(metadata, tableFqns);

  // Build sample data section for these tables
  let sampleSection = "";
  if (sampleData) {
    const lines: string[] = [];
    for (const fqn of tableFqns) {
      const entry = sampleData.get(fqn);
      if (!entry || entry.rows.length === 0) continue;
      lines.push(`**${fqn}** sample values:`);
      for (let ci = 0; ci < entry.columns.length; ci++) {
        const vals = new Set<string>();
        for (const row of entry.rows) {
          const v = row[ci];
          if (v !== null && v !== undefined) vals.add(String(v));
        }
        if (vals.size > 0) {
          const sample = [...vals].slice(0, 10).join(", ");
          lines.push(`  ${entry.columns[ci]}: [${sample}]`);
        }
      }
      lines.push("");
    }
    if (lines.length > 0) sampleSection = lines.join("\n");
  }

  // Entity candidates for context
  const entitySection = entityCandidates
    .filter((c) => tableFqns.some((f) => f.toLowerCase() === c.tableFqn.toLowerCase()))
    .map(
      (c) => `  ${c.tableFqn}.${c.columnName}: values=[${c.sampleValues.slice(0, 10).join(", ")}]`,
    )
    .join("\n");

  const systemMessage = `You are a data catalog expert. Analyze the columns in the provided tables and generate enrichment metadata for a Databricks Genie space.

You MUST only reference table and column names from the SCHEMA CONTEXT below. Do NOT invent or assume any identifiers.

For each column, provide:
- description: A concise business-friendly description (null if the existing comment is already good)
- synonyms: Business terms users might use to refer to this column
- hidden: true if this column is purely technical (audit fields, internal IDs, hash columns) and should be hidden from Genie users
- entityMatchingCandidate: true if this is a bounded-cardinality string column where users might use different terms than the stored values

Return a JSON array of objects with: tableFqn, columnName, description, synonyms, hidden, entityMatchingCandidate`;

  const skillsResolved = resolveForGeniePass("columnIntelligence");
  const skillBlock =
    skillsResolved.contextSections.length > 0
      ? formatContextSections(skillsResolved.contextSections) + "\n"
      : "";
  const industrySections = industryId ? buildIndustrySkillSections(industryId) : [];
  const industryBlock =
    industrySections.length > 0
      ? `### DOMAIN ENTITY VOCABULARY\n${formatContextSections(industrySections)}\n`
      : "";

  const userMessage = `${schemaBlock}

${sampleSection ? `### SAMPLE DATA VALUES\n${sampleSection}` : ""}

${entitySection ? `### ENTITY MATCHING CANDIDATES\n${entitySection}` : ""}

${industryBlock}${skillBlock}Analyze ALL columns in the tables above and return the enrichment JSON array.`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemMessage },
    { role: "user", content: userMessage },
  ];

  const result = await cachedChatCompletion({
    endpoint,
    messages,
    temperature: TEMPERATURE,
    maxTokens: 6144,
    responseFormat: "json_object",
    signal,
  });

  const content = result.content ?? "";
  return parseColumnEnrichments(content, tableFqns);
}

function parseColumnEnrichments(content: string, tableFqns: string[]): ColumnEnrichment[] {
  try {
    const parsed = parseLLMJson(content, "genie:column-intelligence") as Record<string, unknown>;
    const items: unknown[] = Array.isArray(parsed)
      ? (parsed as unknown[])
      : Array.isArray(parsed.columns)
        ? parsed.columns
        : Array.isArray(parsed.enrichments)
          ? parsed.enrichments
          : [];

    const tableSet = new Set(tableFqns.map((f) => f.toLowerCase()));

    return items
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .filter((item) => {
        const fqn = String(item.tableFqn ?? "").toLowerCase();
        return tableSet.has(fqn);
      })
      .map((item) => ({
        tableFqn: String(item.tableFqn ?? ""),
        columnName: String(item.columnName ?? ""),
        description: item.description ? String(item.description) : null,
        synonyms: Array.isArray(item.synonyms) ? item.synonyms.map(String) : [],
        hidden: Boolean(item.hidden),
        entityMatchingCandidate: Boolean(item.entityMatchingCandidate),
      }));
  } catch (err) {
    logger.warn("Failed to parse column enrichments from LLM", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

function buildBasicEnrichments(
  metadata: MetadataSnapshot,
  tableFqns: string[],
  overrides: ColumnOverride[],
): ColumnEnrichment[] {
  const tableSet = new Set(tableFqns.map((f) => f.toLowerCase()));
  const overrideMap = new Map<string, ColumnOverride>();
  for (const o of overrides) {
    overrideMap.set(`${o.tableFqn.toLowerCase()}.${o.columnName.toLowerCase()}`, o);
  }

  return metadata.columns
    .filter((c) => tableSet.has(c.tableFqn.toLowerCase()))
    .map((c) => {
      const key = `${c.tableFqn.toLowerCase()}.${c.columnName.toLowerCase()}`;
      const override = overrideMap.get(key);
      return {
        tableFqn: c.tableFqn,
        columnName: c.columnName,
        description: override?.description ?? c.comment,
        synonyms: override?.synonyms ?? [],
        hidden: override?.hidden ?? false,
        entityMatchingCandidate: false,
      };
    });
}

function applyColumnOverrides(enrichments: ColumnEnrichment[], overrides: ColumnOverride[]): void {
  const overrideMap = new Map<string, ColumnOverride>();
  for (const o of overrides) {
    overrideMap.set(`${o.tableFqn.toLowerCase()}.${o.columnName.toLowerCase()}`, o);
  }

  for (const e of enrichments) {
    const key = `${e.tableFqn.toLowerCase()}.${e.columnName.toLowerCase()}`;
    const override = overrideMap.get(key);
    if (override) {
      if (override.description !== undefined) e.description = override.description;
      if (override.synonyms) e.synonyms = override.synonyms;
      if (override.hidden !== undefined) e.hidden = override.hidden;
    }
  }
}
