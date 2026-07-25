/**
 * Pass 2.5: LLM Join Inference (config-gated)
 *
 * When FK-derived and SQL-mined joins are sparse (< 3), uses an LLM to
 * discover implicit table relationships from column naming patterns
 * (e.g. orders.customer_id -> customers.customerID).
 *
 * All inferred joins are validated against the schema allowlist.
 */

import { type ChatMessage } from "@/lib/dbx/model-serving";
import { cachedChatCompletion } from "@/lib/toolkit/llm-cache";
import { logger } from "@/lib/logger";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import type { MetadataSnapshot } from "@/lib/domain/types";
import {
  buildSchemaContextBlock,
  isValidTable,
  validateSqlExpression,
  type SchemaAllowlist,
} from "../schema-allowlist";
import { canonicalKeyGroups } from "../key-synonyms";
import { reviewBatch, type BatchReviewItem } from "@/lib/ai/sql-reviewer";
import { isReviewEnabled } from "@/lib/dbx/client";
import {
  isSqlRepairEnabled,
  validateAndRepairBatch,
  type ValidateAndRepairItem,
} from "@/lib/genie/sql-validator";
import "@/lib/skills/content";
import { resolveForGeniePass, formatContextSections } from "@/lib/skills/resolver";

const TEMPERATURE = 0.1;

export interface JoinInferenceInput {
  tableFqns: string[];
  metadata: MetadataSnapshot;
  allowlist: SchemaAllowlist;
  existingJoinKeys: Set<string>;
  endpoint: string;
  signal?: AbortSignal;
}

export interface JoinInferenceOutput {
  joins: Array<{
    leftTable: string;
    rightTable: string;
    sql: string;
    relationshipType: "many_to_one";
  }>;
}

export async function runJoinInference(input: JoinInferenceInput): Promise<JoinInferenceOutput> {
  const { tableFqns, metadata, allowlist, existingJoinKeys, endpoint, signal } = input;

  if (tableFqns.length < 2) {
    return { joins: [] };
  }

  const schemaBlock = buildSchemaContextBlock(metadata, tableFqns);

  const existingList = [...existingJoinKeys].map((k) => k.replace("|", " <-> ")).join("\n");

  const systemMessage = `You are a data modeling expert identifying table relationships for a Databricks Genie space.

Given the schema context, identify JOIN relationships between tables based on:
1. Column naming conventions (e.g. customer_id in one table matching customerID in another)
2. Primary key / foreign key patterns (e.g. table.id being referenced as table_id elsewhere)
3. Common data modeling patterns (fact-dimension relationships)

Rules:
- ONLY reference tables and columns from the SCHEMA CONTEXT below.
- Do NOT duplicate any already-known relationships listed below.
- For each join, provide the exact column-level join condition.
- Return at most 10 joins.

Return JSON: { "joins": [{ "leftTable": "catalog.schema.table1", "rightTable": "catalog.schema.table2", "joinCondition": "table1.col = table2.col" }] }`;

  const synonymHints = Object.entries(canonicalKeyGroups())
    .map(([canonical, variants]) => `- ${canonical}: ${variants.join(", ")}`)
    .join("\n");

  const joinSkills = resolveForGeniePass("joinInference");
  const joinSkillContext = formatContextSections(joinSkills.contextSections);

  const userMessage = `${schemaBlock}

${existingList ? `### ALREADY KNOWN RELATIONSHIPS (do not duplicate)\n${existingList}\n` : ""}

Identify additional table join relationships from column naming patterns.
${joinSkillContext ? `\n### Data Modeling Patterns\n${joinSkillContext}\n` : ""}
### KEY SYNONYM HINTS
${synonymHints}`;

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
  const parsed = parseLLMJson(content, "genie:join-inference") as Record<string, unknown>;
  const items = Array.isArray(parsed.joins) ? parsed.joins : [];

  const joins = (items as Record<string, unknown>[])
    .map((j) => ({
      leftTable: String(j.leftTable ?? j.left_table ?? ""),
      rightTable: String(j.rightTable ?? j.right_table ?? ""),
      sql: String(j.joinCondition ?? j.join_condition ?? j.sql ?? ""),
    }))
    .filter((j) => {
      if (!j.leftTable || !j.rightTable || !j.sql) return false;
      if (!isValidTable(allowlist, j.leftTable) || !isValidTable(allowlist, j.rightTable))
        return false;
      if (!validateSqlExpression(allowlist, j.sql, `join:${j.leftTable}->${j.rightTable}`, true))
        return false;

      const pairKey = `${j.leftTable.toLowerCase()}|${j.rightTable.toLowerCase()}`;
      const reverseKey = `${j.rightTable.toLowerCase()}|${j.leftTable.toLowerCase()}`;
      if (existingJoinKeys.has(pairKey) || existingJoinKeys.has(reverseKey)) return false;

      return true;
    })
    .map((j) => ({
      ...j,
      relationshipType: "many_to_one" as const,
    }));

  if (isReviewEnabled("genie-join-inference") && joins.length > 0) {
    const batchItems: BatchReviewItem[] = joins.map((j, i) => ({
      id: `join-${i}`,
      sql: j.sql,
      context: `Join condition: ${j.leftTable} -> ${j.rightTable}`,
    }));
    const batchResults = await reviewBatch(batchItems, "genie-join-inference", schemaBlock);
    const failedIds = new Set(
      batchResults.filter((r) => r.result.verdict === "fail").map((r) => r.id),
    );
    if (failedIds.size > 0) {
      const before = joins.length;
      const filtered = joins.filter((_, i) => !failedIds.has(`join-${i}`));
      logger.info("Join inference: review filtered joins", {
        before,
        after: filtered.length,
        removed: before - filtered.length,
      });
      return { joins: filtered };
    }
  }

  // Phase 2 SQL validator gate: build a synthetic INNER JOIN SELECT for each
  // candidate join and EXPLAIN it on the warehouse. Drops any join whose ON
  // clause can't be EXPLAIN'd or repaired.
  let validatedJoins = joins;
  if (isSqlRepairEnabled() && validatedJoins.length > 0) {
    const items: ValidateAndRepairItem[] = validatedJoins.map((j) => ({
      sql: j.sql,
      kind: "join",
      leftTable: j.leftTable,
      rightTable: j.rightTable,
      schemaContext: schemaBlock,
      surface: "genie-join-inference",
    }));
    const validated = await validateAndRepairBatch(items);
    validatedJoins = validatedJoins
      .map((j, i) => {
        const r = validated[i];
        if (r.status === "dropped") {
          logger.warn("Join dropped by validator", {
            left: j.leftTable,
            right: j.rightTable,
            reason: r.reason,
          });
          return null;
        }
        return r.finalSql && r.finalSql !== j.sql ? { ...j, sql: r.finalSql } : j;
      })
      .filter((j): j is (typeof validatedJoins)[number] => j !== null);
  }

  if (validatedJoins.length > 0) {
    logger.info("LLM join inference discovered relationships", {
      count: validatedJoins.length,
      pairs: validatedJoins.map((j) => `${j.leftTable} -> ${j.rightTable}`),
    });
  }

  return { joins: validatedJoins };
}
