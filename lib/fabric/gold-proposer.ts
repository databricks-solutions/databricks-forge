/**
 * Gold Schema Proposer.
 *
 * Reads PBI dataset metadata and proposes Databricks Gold tables:
 * - Type mapping (PBI → Spark SQL)
 * - Name normalization (PBI → UC identifiers)
 * - Relationship preservation (FK comments)
 * - LLM-assisted CREATE TABLE DDL with partitioning/clustering hints
 * - M expression context surfacing (admin scan only)
 */

import { chatCompletion } from "@/lib/dbx/model-serving";
import { resolveEndpoint } from "@/lib/dbx/client";
import { isReviewEnabled } from "@/lib/dbx/client";
import { DATABRICKS_SQL_RULES } from "@/lib/toolkit/sql-rules";
import { reviewAndFixSql } from "@/lib/ai/sql-reviewer";
import "@/lib/skills/content";
import { resolveForPipelineStep, formatContextSections } from "@/lib/skills/resolver";
import { mapPbiTypeToSpark } from "./type-mapping";
import { normalizeIdentifier, normalizeTableName, type NameMapping } from "./name-normalizer";
import { resolveLabelTag, buildTagDdl, type SensitivityLabelMapping } from "./sensitivity-mapping";
import { logger } from "@/lib/logger";
import type { FabricDataset, FabricTable, FabricRelationship } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoldTableProposal {
  pbiTableName: string;
  ucTableName: string;
  ddl: string;
  columns: Array<{
    pbiName: string;
    ucName: string;
    pbiType: string;
    sparkType: string;
  }>;
  relationships: Array<{
    fromColumn: string;
    toTable: string;
    toColumn: string;
  }>;
  dataSource?: string;
  sensitivityLabel?: string | null;
  tagDdl?: string;
}

export interface GoldSchemaProposal {
  targetCatalog: string;
  targetSchema: string;
  tables: GoldTableProposal[];
  nameMapping: NameMapping[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function proposeGoldSchema(
  datasets: FabricDataset[],
  targetCatalog: string,
  targetSchema: string,
  options?: {
    useLLM?: boolean;
    sensitivityMappings?: SensitivityLabelMapping[];
    resourcePrefix?: string;
  },
): Promise<GoldSchemaProposal> {
  const allTables: FabricTable[] = [];
  const allRelationships: FabricRelationship[] = [];
  const expressions: Array<{ tableName: string; source: string }> = [];
  const tableSensitivity = new Map<string, string | null>();
  const warnings: string[] = [];

  for (const ds of datasets) {
    for (const t of ds.tables) {
      if (t.isHidden) continue;
      allTables.push(t);
      if (ds.sensitivityLabel) tableSensitivity.set(t.name, ds.sensitivityLabel);
    }
    allRelationships.push(...ds.relationships);
    for (const expr of ds.expressions) {
      if (expr.expression) {
        expressions.push({ tableName: expr.name, source: expr.expression });
      }
    }
  }

  const usedNames = new Set<string>();
  const proposals: GoldTableProposal[] = [];
  const nameMapping: NameMapping[] = [];

  const rp = options?.resourcePrefix ?? "";
  for (const table of allTables) {
    let ucTableName = normalizeTableName(table.name, usedNames);
    if (rp && !ucTableName.startsWith(rp)) ucTableName = `${rp}${ucTableName}`;
    usedNames.add(ucTableName);
    nameMapping.push({ original: table.name, normalized: ucTableName, source: "table" });

    const columns: GoldTableProposal["columns"] = [];
    const usedColNames = new Set<string>();

    for (const col of table.columns) {
      if (col.isHidden) continue;
      let ucColName = normalizeIdentifier(col.name);
      const base = ucColName;
      let suffix = 2;
      while (usedColNames.has(ucColName)) {
        ucColName = `${base}_${suffix}`;
        suffix++;
      }
      usedColNames.add(ucColName);

      columns.push({
        pbiName: col.name,
        ucName: ucColName,
        pbiType: col.dataType,
        sparkType: mapPbiTypeToSpark(col.dataType),
      });

      nameMapping.push({
        original: `${table.name}.${col.name}`,
        normalized: `${ucTableName}.${ucColName}`,
        source: "column",
      });
    }

    const rels = allRelationships
      .filter((r) => r.fromTable === table.name)
      .map((r) => ({
        fromColumn: normalizeIdentifier(r.fromColumn),
        toTable: normalizeIdentifier(r.toTable),
        toColumn: normalizeIdentifier(r.toColumn),
      }));

    const dataSource = expressions.find(
      (e) => e.tableName.toLowerCase() === table.name.toLowerCase(),
    )?.source;

    const label = tableSensitivity.get(table.name) ?? null;
    const fqn = `${targetCatalog}.${targetSchema}.${ucTableName}`;
    const tag = resolveLabelTag(label, options?.sensitivityMappings);

    proposals.push({
      pbiTableName: table.name,
      ucTableName,
      ddl: "",
      columns,
      relationships: rels,
      dataSource,
      sensitivityLabel: label,
      tagDdl: tag ? buildTagDdl(fqn, tag) : undefined,
    });
  }

  if (options?.useLLM !== false) {
    try {
      const enhancedDDL = await generateDDLWithLLM(proposals, targetCatalog, targetSchema);
      for (const proposal of proposals) {
        proposal.ddl =
          enhancedDDL[proposal.ucTableName] ?? buildBasicDDL(proposal, targetCatalog, targetSchema);
      }
    } catch (err) {
      logger.warn("[gold-proposer] LLM DDL generation failed, using basic DDL", {
        error: err instanceof Error ? err.message : String(err),
      });
      warnings.push("LLM-assisted DDL generation failed. Basic DDL was generated instead.");
      for (const proposal of proposals) {
        proposal.ddl = buildBasicDDL(proposal, targetCatalog, targetSchema);
      }
    }
  } else {
    for (const proposal of proposals) {
      proposal.ddl = buildBasicDDL(proposal, targetCatalog, targetSchema);
    }
  }

  if (isReviewEnabled("gold-proposer")) {
    for (const proposal of proposals) {
      if (!proposal.ddl) continue;
      try {
        const review = await reviewAndFixSql(proposal.ddl, {
          surface: "gold-proposer",
        });
        if (review.fixedSql) {
          logger.info("Gold proposer: review applied DDL fix", {
            table: proposal.ucTableName,
            qualityScore: review.qualityScore,
          });
          proposal.ddl = review.fixedSql;
        } else if (review.verdict === "fail") {
          logger.warn("Gold proposer: DDL failed review, falling back to basic DDL", {
            table: proposal.ucTableName,
            issues: review.issues.map((i) => i.message),
          });
          proposal.ddl = buildBasicDDL(proposal, targetCatalog, targetSchema);
        }
      } catch (err) {
        logger.warn("Gold proposer: review failed, keeping original DDL", {
          table: proposal.ucTableName,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return { targetCatalog, targetSchema, tables: proposals, nameMapping, warnings };
}

// ---------------------------------------------------------------------------
// Basic DDL (deterministic fallback)
// ---------------------------------------------------------------------------

function buildBasicDDL(proposal: GoldTableProposal, catalog: string, schema: string): string {
  const fqn = `${catalog}.${schema}.${proposal.ucTableName}`;
  const colDefs = proposal.columns.map((c) => `  ${c.ucName} ${c.sparkType}`);

  const relComments = proposal.relationships.map(
    (r) => `-- FK: ${r.fromColumn} -> ${r.toTable}.${r.toColumn}`,
  );

  const parts = [`CREATE TABLE IF NOT EXISTS ${fqn} (`];
  parts.push(colDefs.join(",\n"));
  parts.push(")");
  parts.push("USING DELTA;");

  if (relComments.length) {
    parts.push("");
    parts.push(...relComments);
  }

  if (proposal.dataSource) {
    parts.push("");
    parts.push(`-- Data source: ${proposal.dataSource.replace(/\n/g, " ").slice(0, 200)}`);
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// LLM-enhanced DDL
// ---------------------------------------------------------------------------

async function generateDDLWithLLM(
  proposals: GoldTableProposal[],
  catalog: string,
  schema: string,
): Promise<Record<string, string>> {
  const tableDescriptions = proposals
    .map((p) => {
      const cols = p.columns
        .map((c) => `  ${c.ucName} ${c.sparkType} -- (was PBI: ${c.pbiName} ${c.pbiType})`)
        .join("\n");
      const rels = p.relationships.length
        ? `\n  Relationships: ${p.relationships.map((r) => `${r.fromColumn} -> ${r.toTable}.${r.toColumn}`).join(", ")}`
        : "";
      const source = p.dataSource ? `\n  Source: ${p.dataSource.slice(0, 200)}` : "";
      return `Table: ${catalog}.${schema}.${p.ucTableName} (was PBI: ${p.pbiTableName})\nColumns:\n${cols}${rels}${source}`;
    })
    .join("\n\n");

  const goldSkills = resolveForPipelineStep("sql-generation", { contextBudget: 2000 });
  const goldSkillBlock = formatContextSections(goldSkills.contextSections);

  const prompt = `You are a Databricks SQL expert. Given the following table proposals migrated from Power BI, generate optimal CREATE TABLE DDL for each table.

${DATABRICKS_SQL_RULES}
${goldSkillBlock ? `\n## Databricks Data Modeling Patterns\n${goldSkillBlock}\n` : ""}
Requirements:
- Use DELTA format
- Add appropriate COMMENT on columns where the PBI name or type change is non-obvious
- Suggest CLUSTER BY for tables with obvious time or ID columns
- Include TBLPROPERTIES for Gold tier metadata
- Preserve FK relationships as comments
- Each DDL must be self-contained (no cross-table dependencies)

Tables:
${tableDescriptions}

Return a JSON object where keys are UC table names and values are complete CREATE TABLE DDL strings. Return ONLY valid JSON.`;

  const response = await chatCompletion({
    endpoint: resolveEndpoint("generation"),
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
    maxTokens: 16384,
    responseFormat: "json_object",
  });

  const content = response.content ?? "{}";
  try {
    return JSON.parse(content) as Record<string, string>;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as Record<string, string>;
    return {};
  }
}
