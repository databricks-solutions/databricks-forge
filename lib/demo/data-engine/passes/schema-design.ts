/**
 * Data Engine Pass 1: Schema Design
 *
 * Designs the full relational schema (dimension + fact tables) from
 * matched data assets, narratives, and company nomenclature.
 */

import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { resolveEndpoint } from "@/lib/dbx/client";
import type { LLMClient } from "@/lib/ports/llm-client";
import type { Logger } from "@/lib/ports/logger";
import type { TableDesign, DataNarrative } from "../../types";
import type { ResearchEngineResult } from "../../research-engine/types";
import { GENIE_SCHEMA_BIAS, SCHEMA_DESIGN_PROMPT } from "../prompts";

interface SchemaDesignOutput {
  tables: TableDesign[];
}

export async function runSchemaDesign(
  research: ResearchEngineResult,
  narratives: DataNarrative[],
  targetRowCount: { min: number; max: number },
  opts: {
    llm: LLMClient;
    logger: Logger;
    signal?: AbortSignal;
    genieMode?: boolean;
  },
): Promise<TableDesign[]> {
  const { llm, logger: log, signal, genieMode = false } = opts;

  const dataAssetsContext = JSON.stringify(research.matchedDataAssetIds);

  const prompt = SCHEMA_DESIGN_PROMPT
    .replace("{customer_name}", research.customerName)
    .replace("{industry_name}", research.industryId)
    .replace("{data_assets_context}", dataAssetsContext)
    .replace("{narratives_json}", JSON.stringify(narratives))
    .replace("{nomenclature}", JSON.stringify(research.nomenclature))
    .replace("{division}", research.scope?.division ?? "Full Enterprise")
    .replace("{min_rows}", String(targetRowCount.min))
    .replace("{max_rows}", String(targetRowCount.max))
    .replace("{genie_bias}", genieMode ? GENIE_SCHEMA_BIAS : "");

  const endpoint = resolveEndpoint("generation");

  const response = await llm.chat({
    endpoint,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    maxTokens: 16_000,
    responseFormat: "json_object",
    signal,
  });

  const result = parseLLMJson(response.content, "schema-design") as SchemaDesignOutput;
  const tables = result.tables ?? [];

  tables.sort((a, b) => a.creationOrder - b.creationOrder);

  log.info("Schema design complete", {
    tables: tables.length,
    dimensions: tables.filter((t) => t.tableType === "dimension").length,
    facts: tables.filter((t) => t.tableType === "fact").length,
  });

  return tables;
}
