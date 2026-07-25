/**
 * Space Fixer -- maps health check failures to Genie Engine passes,
 * builds MetadataSnapshot for off-platform spaces, and merges improvements.
 *
 * Every LLM-backed strategy receives synthesized business context from the
 * space itself (title, description, existing instructions) so fixes are
 * contextually relevant rather than generic.
 */

import { executeSQL } from "@/lib/dbx/sql";
import { resolveEndpoint } from "@/lib/dbx/client";
import { buildSchemaAllowlist } from "@/lib/genie/schema-allowlist";
import { extractEntityCandidatesFromSchema } from "@/lib/genie/entity-extraction";
import {
  defaultGenieEngineConfig,
  type SpaceJson,
  type JoinSpecInput,
  type BenchmarkInput,
  type ReferenceSqlExample,
} from "@/lib/genie/types";
import { resolveRegistry } from "@/lib/genie/health-checks/registry";
import { chatCompletion } from "@/lib/dbx/model-serving";
import { getGenieSpace, updateGenieSpace } from "@/lib/dbx/genie";
import { logger } from "@/lib/logger";
import { recordSpan } from "@/lib/observability/mlflow-tracing";
import type { MetadataSnapshot, TableInfo, ColumnInfo, BusinessContext } from "@/lib/domain/types";
import type { FixStrategy } from "@/lib/genie/health-checks/types";
import "@/lib/skills/content";
import { resolveForGeniePass, formatContextSections } from "@/lib/skills/resolver";

interface FixRequest {
  checkIds: string[];
  serializedSpace: string;
  /** Optional, used as a span attribute for MLflow tracing. */
  spaceId?: string;
}

interface FixResult {
  updatedSpace: SpaceJson;
  changes: FixChange[];
  strategiesRun: FixStrategy[];
}

interface FixChange {
  section: string;
  description: string;
  added: number;
  modified: number;
}

/**
 * Context extracted from the serialized space JSON to feed into LLM passes.
 */
interface SpaceContext {
  title: string;
  description: string;
  domain: string;
  existingInstructions: string[];
  existingMeasureNames: string[];
  existingFilterNames: string[];
  existingExampleQuestions: string[];
  existingBenchmarkQuestions: string[];
  joinSpecs: JoinSpecInput[];
}

function extractSpaceContext(space: SpaceJson): SpaceContext {
  const title = String(space.display_name ?? space.title ?? "");
  const description = String(space.description ?? "");

  const textInstructions = ((space.instructions?.text_instructions ?? []) as SpaceJson[]).map(
    (i: SpaceJson) =>
      Array.isArray(i.content) ? (i.content as string[]).join(" ") : String(i.content ?? ""),
  );

  const measureNames = ((space.instructions?.sql_snippets?.measures ?? []) as SpaceJson[]).map(
    (m: SpaceJson) => String(m.display_name ?? m.alias ?? ""),
  );

  const filterNames = ((space.instructions?.sql_snippets?.filters ?? []) as SpaceJson[]).map(
    (f: SpaceJson) => String(f.display_name ?? ""),
  );

  const exampleQuestions = ((space.instructions?.example_question_sqls ?? []) as SpaceJson[]).map(
    (e: SpaceJson) =>
      Array.isArray(e.question) ? String(e.question[0] ?? "") : String(e.question ?? ""),
  );

  const benchmarkQuestions = ((space.benchmarks?.questions ?? []) as SpaceJson[]).map(
    (q: SpaceJson) =>
      Array.isArray(q.question) ? String(q.question[0] ?? "") : String(q.question ?? ""),
  );

  const joinSpecs: JoinSpecInput[] = ((space.instructions?.join_specs ?? []) as SpaceJson[]).map(
    (j: SpaceJson) => ({
      leftTable: String(j.left?.identifier ?? ""),
      rightTable: String(j.right?.identifier ?? ""),
      sql: Array.isArray(j.sql) ? (j.sql as string[]).join(" ") : String(j.sql ?? ""),
      relationshipType: "many_to_one",
    }),
  );

  const domain = title.toLowerCase().includes("retail")
    ? "retail"
    : title.toLowerCase().includes("finance") || title.toLowerCase().includes("bank")
      ? "finance"
      : title.toLowerCase().includes("health")
        ? "healthcare"
        : "general";

  return {
    title,
    description,
    domain,
    existingInstructions: textInstructions,
    existingMeasureNames: measureNames,
    existingFilterNames: filterNames,
    existingExampleQuestions: exampleQuestions,
    existingBenchmarkQuestions: benchmarkQuestions,
    joinSpecs,
  };
}

interface SpaceSqlContext {
  referenceSql: ReferenceSqlExample[];
  existingBenchmarks: BenchmarkInput[];
}

/**
 * Harvest validated SQL from an existing space to ground LLM passes.
 * Returns reference SQL examples (from trusted assets, measures, benchmarks)
 * and existing benchmarks in BenchmarkInput format.
 */
function extractSpaceSqlExamples(space: SpaceJson): SpaceSqlContext {
  const referenceSql: ReferenceSqlExample[] = [];
  const existingBenchmarks: BenchmarkInput[] = [];

  const exampleSqls = (space.instructions?.example_question_sqls ?? []) as SpaceJson[];
  for (const e of exampleSqls) {
    const question = Array.isArray(e.question)
      ? String(e.question[0] ?? "")
      : String(e.question ?? "");
    const sql = Array.isArray(e.sql) ? String(e.sql[0] ?? "") : String(e.sql ?? "");
    if (question && sql) {
      referenceSql.push({ name: question, question, sql });
    }
  }

  const measures = (space.instructions?.sql_snippets?.measures ?? []) as SpaceJson[];
  for (const m of measures) {
    const name = String(m.display_name ?? m.alias ?? "");
    const sql = Array.isArray(m.sql) ? String(m.sql[0] ?? "") : String(m.sql ?? "");
    if (name && sql) {
      referenceSql.push({ name, question: `Calculate ${name}`, sql });
    }
  }

  const benchmarkQuestions = (space.benchmarks?.questions ?? []) as SpaceJson[];
  for (const q of benchmarkQuestions) {
    const question = Array.isArray(q.question)
      ? String(q.question[0] ?? "")
      : String(q.question ?? "");
    if (!question) continue;

    const answers = (q.answer ?? []) as SpaceJson[];
    const sqlAnswer = answers.find((a: SpaceJson) => a.format === "sql");
    const sql = sqlAnswer
      ? Array.isArray(sqlAnswer.content)
        ? String(sqlAnswer.content[0] ?? "")
        : String(sqlAnswer.content ?? "")
      : "";

    existingBenchmarks.push({
      question,
      expectedSql: sql,
      alternatePhrasings: [],
    });

    if (sql) {
      referenceSql.push({ name: question, question, sql });
    }
  }

  return { referenceSql, existingBenchmarks };
}

function synthesizeBusinessContext(ctx: SpaceContext): BusinessContext | null {
  if (!ctx.title && !ctx.description) return null;
  return {
    industries: ctx.domain !== "general" ? ctx.domain : "",
    strategicGoals: ctx.description || `Analysis of ${ctx.title}`,
    businessPriorities: "",
    strategicInitiative: "",
    valueChain: "",
    revenueModel: "",
    additionalContext: ctx.existingInstructions.join(" ").slice(0, 500),
  };
}

/**
 * Canonical fix strategy ordering: deletes before adds, instructions first.
 * This prevents conflicting content from poisoning new additions.
 */
const STRATEGY_ORDER: readonly FixStrategy[] = [
  "replace_instructions",
  "delete_bad_joins",
  "join_inference",
  "delete_bad_measures",
  "semantic_expressions",
  "delete_bad_synonyms",
  "column_intelligence",
  "delete_bad_examples",
  "trusted_assets",
  "benchmark_generation",
  "entity_matching",
  "sample_questions",
  "instruction_generation",
] as const;

/**
 * Given a list of failed check IDs, resolve the fix strategies needed
 * and group them to minimize redundant engine pass invocations.
 * Returns strategies in delete-before-add order.
 */
export function resolveFixStrategies(checkIds: string[]): Map<FixStrategy, string[]> {
  const registry = resolveRegistry();
  const unordered = new Map<FixStrategy, string[]>();

  for (const checkId of checkIds) {
    const check = registry.checks.find((c) => c.id === checkId);
    if (!check?.fix_strategy) continue;
    const strategy = check.fix_strategy;
    if (!unordered.has(strategy)) unordered.set(strategy, []);
    unordered.get(strategy)!.push(checkId);
  }

  const ordered = new Map<FixStrategy, string[]>();
  for (const strategy of STRATEGY_ORDER) {
    if (unordered.has(strategy)) {
      ordered.set(strategy, unordered.get(strategy)!);
    }
  }
  for (const [strategy, ids] of unordered) {
    if (!ordered.has(strategy)) ordered.set(strategy, ids);
  }

  return ordered;
}

/**
 * Extract table FQNs from a serialized space's data_sources.tables.
 */
export function extractTableFqns(space: SpaceJson): string[] {
  const tables = space?.data_sources?.tables;
  if (!Array.isArray(tables)) return [];
  return tables
    .map((t: { identifier?: string }) => t.identifier)
    .filter((id): id is string => typeof id === "string" && id.split(".").length === 3);
}

/**
 * Build a MetadataSnapshot for off-platform spaces by querying
 * information_schema for the space's tables.
 */
export async function buildMetadataForSpace(tableFqns: string[]): Promise<MetadataSnapshot> {
  const tables: TableInfo[] = [];
  const columns: ColumnInfo[] = [];

  for (const fqn of tableFqns) {
    const parts = fqn.split(".");
    if (parts.length !== 3) continue;
    const [catalog, schema, tableName] = parts;

    tables.push({
      catalog,
      schema,
      tableName,
      fqn,
      tableType: "TABLE",
      comment: null,
    });

    try {
      const sql = `
        SELECT column_name, data_type, ordinal_position, is_nullable, comment
        FROM ${catalog}.information_schema.columns
        WHERE table_catalog = '${catalog}'
          AND table_schema = '${schema}'
          AND table_name = '${tableName}'
        ORDER BY ordinal_position
      `;
      const result = await executeSQL(sql);
      for (const row of result.rows) {
        columns.push({
          tableFqn: fqn,
          columnName: String(row[0] ?? ""),
          dataType: String(row[1] ?? "STRING"),
          ordinalPosition: Number(row[2] ?? 0),
          isNullable: String(row[3] ?? "YES") === "YES",
          comment: row[4] ?? null,
        });
      }
    } catch (err) {
      logger.warn("Failed to query columns for off-platform space table", {
        fqn,
        error: String(err),
      });
    }
  }

  return {
    cacheKey: `fixer-${Date.now()}`,
    ucPath: tableFqns.length > 0 ? tableFqns[0].split(".").slice(0, 2).join(".") : "",
    tables,
    columns,
    foreignKeys: [],
    metricViews: [],

    tableCount: tables.length,
    columnCount: columns.length,
    cachedAt: new Date().toISOString(),
    lineageDiscoveredFqns: [],
  };
}

/**
 * Run the fix workflow: determine strategies, build metadata if needed,
 * run relevant passes, and merge results into the space.
 *
 * Each LLM-backed strategy receives synthesized business context extracted
 * from the space (title, description, existing instructions) so that
 * generated content is contextually relevant.
 */
export async function runFixes(request: FixRequest): Promise<FixResult> {
  const space = JSON.parse(request.serializedSpace) as SpaceJson;
  const strategies = resolveFixStrategies(request.checkIds);
  const changes: FixChange[] = [];
  const strategiesRun: FixStrategy[] = [];
  const spaceIdForTrace = request.spaceId ?? "unknown";

  if (strategies.size === 0) {
    return { updatedSpace: space, changes, strategiesRun };
  }

  const tableFqns = extractTableFqns(space);
  const metadata = await buildMetadataForSpace(tableFqns);
  const allowlist = buildSchemaAllowlist(metadata);
  const config = defaultGenieEngineConfig();
  const endpoint = resolveEndpoint("generation");
  const fastEndpoint = resolveEndpoint("classification");
  const spaceCtx = extractSpaceContext(space);
  const businessContext = synthesizeBusinessContext(spaceCtx);
  const spaceSql = extractSpaceSqlExamples(space);

  const SQL_STRATEGIES: Set<FixStrategy> = new Set([
    "benchmark_generation",
    "trusted_assets",
    "semantic_expressions",
  ]);

  const tablesWithoutColumns = tableFqns.filter(
    (fqn) => !metadata.columns.some((c) => c.tableFqn.toLowerCase() === fqn.toLowerCase()),
  );
  if (tablesWithoutColumns.length > 0) {
    logger.warn("Tables with no columns in metadata -- SQL generation may be unreliable", {
      tablesWithoutColumns,
      totalTables: tableFqns.length,
    });
  }
  if (metadata.columns.length === 0 && tableFqns.length > 0) {
    logger.error("No columns retrieved for any table -- skipping SQL-generating strategies", {
      tables: tableFqns,
    });
    const skippedSqlStrategies = [...strategies.keys()].filter((s) => SQL_STRATEGIES.has(s));
    if (skippedSqlStrategies.length > 0) {
      changes.push({
        section: "metadata",
        description: `Skipped ${skippedSqlStrategies.join(", ")}: no column metadata available for ${tableFqns.length} table${tableFqns.length !== 1 ? "s" : ""}`,
        added: 0,
        modified: 0,
      });
      for (const s of skippedSqlStrategies) {
        strategies.delete(s);
        strategiesRun.push(s);
      }
    }
  }

  const entityCandidates = extractEntityCandidatesFromSchema(
    metadata.columns.map((c) => ({
      tableFqn: c.tableFqn,
      columnName: c.columnName,
      dataType: c.dataType,
    })),
    tableFqns,
  );
  const entityCandidateColumns = new Set(
    entityCandidates.map((c) => `${c.tableFqn.toLowerCase()}.${c.columnName.toLowerCase()}`),
  );

  // Column names in schema (lowercase) for quick validation
  const schemaColumnNames = new Set(metadata.columns.map((c) => c.columnName.toLowerCase()));

  for (const [strategy] of strategies) {
    const spanStart = Date.now();
    try {
      switch (strategy) {
        // ---------------------------------------------------------------
        // DELETE strategies (run before corresponding ADD strategies)
        // ---------------------------------------------------------------

        case "delete_bad_synonyms": {
          const tables = (space.data_sources?.tables ?? []) as SpaceJson[];
          let removed = 0;
          for (const table of tables) {
            const colConfigs = (table.column_configs ?? []) as SpaceJson[];
            for (const col of colConfigs) {
              const synonyms = col.synonyms as string[] | undefined;
              if (!synonyms || synonyms.length === 0) continue;
              const colName = String(col.column_name ?? col.name ?? "").toLowerCase();
              // Remove synonyms that duplicate the column name or are empty
              const filtered = synonyms.filter((s) => {
                const sl = s.trim().toLowerCase();
                if (!sl || sl === colName) return false;
                // Remove synonyms that exactly match another column name (ambiguous)
                if (schemaColumnNames.has(sl) && sl !== colName) return false;
                return true;
              });
              const delta = synonyms.length - filtered.length;
              if (delta > 0) {
                col.synonyms = filtered.length > 0 ? filtered : undefined;
                removed += delta;
              }
            }
          }
          if (removed > 0) {
            changes.push({
              section: "data_sources.tables.column_configs.synonyms",
              description: `Removed ${removed} ambiguous or duplicate synonym${removed !== 1 ? "s" : ""}`,
              added: 0,
              modified: removed,
            });
          }
          strategiesRun.push(strategy);
          break;
        }

        case "delete_bad_measures": {
          const snippets = space.instructions?.sql_snippets;
          if (!snippets) {
            strategiesRun.push(strategy);
            break;
          }
          const measures = (snippets.measures ?? []) as SpaceJson[];
          const before = measures.length;
          // Remove measures with empty SQL or duplicate names
          const seen = new Set<string>();
          const filtered = measures.filter((m: SpaceJson) => {
            const sql = Array.isArray(m.sql) ? (m.sql as string[]).join("") : String(m.sql ?? "");
            if (!sql.trim()) return false;
            const name = String(m.display_name ?? m.alias ?? "").toLowerCase();
            if (seen.has(name)) return false;
            seen.add(name);
            return true;
          });
          const removed = before - filtered.length;
          if (removed > 0) {
            snippets.measures = filtered;
            changes.push({
              section: "instructions.sql_snippets.measures",
              description: `Removed ${removed} empty or duplicate measure${removed !== 1 ? "s" : ""}`,
              added: 0,
              modified: removed,
            });
          }
          // Same for filters
          const filters = (snippets.filters ?? []) as SpaceJson[];
          const beforeF = filters.length;
          const seenF = new Set<string>();
          const filteredF = filters.filter((f: SpaceJson) => {
            const sql = Array.isArray(f.sql) ? (f.sql as string[]).join("") : String(f.sql ?? "");
            if (!sql.trim()) return false;
            const name = String(f.display_name ?? "").toLowerCase();
            if (seenF.has(name)) return false;
            seenF.add(name);
            return true;
          });
          const removedF = beforeF - filteredF.length;
          if (removedF > 0) {
            snippets.filters = filteredF;
            changes.push({
              section: "instructions.sql_snippets.filters",
              description: `Removed ${removedF} empty or duplicate filter${removedF !== 1 ? "s" : ""}`,
              added: 0,
              modified: removedF,
            });
          }
          strategiesRun.push(strategy);
          break;
        }

        case "delete_bad_joins": {
          const joinSpecs = (space.instructions?.join_specs ?? []) as SpaceJson[];
          const before = joinSpecs.length;
          const tableSet = new Set(tableFqns.map((f) => f.toLowerCase()));
          // Remove joins referencing tables not in the space or self-joins
          const filtered = joinSpecs.filter((j: SpaceJson) => {
            const left = String(j.left?.identifier ?? "").toLowerCase();
            const right = String(j.right?.identifier ?? "").toLowerCase();
            if (!left || !right) return false;
            if (left === right) return false;
            if (!tableSet.has(left) || !tableSet.has(right)) return false;
            return true;
          });
          // Deduplicate by left|right pair
          const seen = new Set<string>();
          const deduped = filtered.filter((j: SpaceJson) => {
            const key = [
              String(j.left?.identifier ?? "").toLowerCase(),
              String(j.right?.identifier ?? "").toLowerCase(),
            ]
              .sort()
              .join("|");
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          const removed = before - deduped.length;
          if (removed > 0) {
            space.instructions = space.instructions ?? {};
            space.instructions.join_specs = deduped;
            changes.push({
              section: "instructions.join_specs",
              description: `Removed ${removed} invalid, self-referencing, or duplicate join${removed !== 1 ? "s" : ""}`,
              added: 0,
              modified: removed,
            });
          }
          strategiesRun.push(strategy);
          break;
        }

        case "delete_bad_examples": {
          const examples = (space.instructions?.example_question_sqls ?? []) as SpaceJson[];
          const before = examples.length;
          // Remove examples with empty SQL or empty questions
          const seen = new Set<string>();
          const filtered = examples.filter((e: SpaceJson) => {
            const question = Array.isArray(e.question)
              ? String(e.question[0] ?? "")
              : String(e.question ?? "");
            const sql = Array.isArray(e.sql) ? String(e.sql[0] ?? "") : String(e.sql ?? "");
            if (!question.trim() || !sql.trim()) return false;
            const key = question.trim().toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          const removed = before - filtered.length;
          if (removed > 0) {
            space.instructions = space.instructions ?? {};
            space.instructions.example_question_sqls = filtered;
            changes.push({
              section: "instructions.example_question_sqls",
              description: `Removed ${removed} empty or duplicate example SQL${removed !== 1 ? "s" : ""}`,
              added: 0,
              modified: removed,
            });
          }
          strategiesRun.push(strategy);
          break;
        }

        case "replace_instructions": {
          const textInstructions = (space.instructions?.text_instructions ?? []) as SpaceJson[];
          if (textInstructions.length <= 1) {
            strategiesRun.push(strategy);
            break;
          }
          // Consolidate multiple instruction blocks into a single block.
          // GSL-aware: if any block looks like a GSL document, merge by
          // section so we never erase another block's PURPOSE / DISAMBIGUATION
          // / DATA QUALITY NOTES / CONSTRAINTS.
          const allContent: string[] = [];
          for (const inst of textInstructions) {
            const content = Array.isArray(inst.content)
              ? (inst.content as string[]).filter(Boolean).join("\n")
              : String(inst.content ?? "");
            if (content.trim()) allContent.push(content.trim());
          }

          let consolidated: string | null = null;
          if (allContent.length > 1) {
            const { parseGsl, renderGsl, GSL_SECTIONS } = await import(
              "@/lib/genie/gsl-schema"
            );
            const looksLikeGsl = allContent.some((c) =>
              GSL_SECTIONS.some((sec) => c.toLowerCase().includes(sec.toLowerCase())),
            );
            if (looksLikeGsl) {
              const merged = parseGsl(allContent[0]);
              for (let i = 1; i < allContent.length; i++) {
                const next = parseGsl(allContent[i]);
                for (const sec of GSL_SECTIONS) {
                  const existing = (merged.sections[sec] ?? "").trim();
                  const incoming = (next.sections[sec] ?? "").trim();
                  if (incoming && !existing) {
                    merged.sections[sec] = incoming;
                  } else if (incoming && existing && !existing.includes(incoming)) {
                    merged.sections[sec] = `${existing}\n\n${incoming}`.trim();
                  }
                }
              }
              consolidated = renderGsl(merged) || allContent.join("\n\n");
            } else {
              consolidated = allContent.join("\n\n");
            }
          }

          if (consolidated) {
            space.instructions = space.instructions ?? {};
            space.instructions.text_instructions = [
              {
                id: crypto.randomUUID().replace(/-/g, ""),
                content: [consolidated],
              },
            ];
            changes.push({
              section: "instructions.text_instructions",
              description: `Consolidated ${textInstructions.length} instruction blocks into 1`,
              added: 0,
              modified: textInstructions.length,
            });
          }
          strategiesRun.push(strategy);
          break;
        }

        // ---------------------------------------------------------------
        // ADD strategies (existing)
        // ---------------------------------------------------------------

        case "column_intelligence": {
          const { runColumnIntelligence } = await import("@/lib/genie/passes/column-intelligence");
          const output = await runColumnIntelligence({
            tableFqns,
            metadata,
            allowlist,
            config,
            sampleData: null,
            endpoint: fastEndpoint,
          });

          let descriptionsAdded = 0;
          let synonymsAdded = 0;
          let tableDescriptionsAdded = 0;
          let formatAssistanceEnabled = 0;
          let entityMatchingEnabled = 0;
          const tables = (space.data_sources?.tables ?? []) as SpaceJson[];

          // --- Table-level descriptions ---
          for (const table of tables) {
            const fqn = String(table.identifier ?? "").toLowerCase();
            if (!fqn) continue;
            const hasDesc =
              table.description &&
              (typeof table.description === "string"
                ? table.description.trim().length > 0
                : Array.isArray(table.description) &&
                  table.description.length > 0 &&
                  (table.description as string[]).some((d) => d && String(d).trim().length > 0));
            if (hasDesc) continue;
            const tableColumns = metadata.columns.filter((c) => c.tableFqn.toLowerCase() === fqn);
            if (tableColumns.length === 0) continue;
            const tableName = fqn.split(".").pop() ?? "";
            const colNames = tableColumns.slice(0, 20).map((c) => c.columnName);
            const desc = inferTableDescription(tableName, colNames);
            if (desc) {
              table.description = [desc];
              tableDescriptionsAdded++;
            }
          }

          // --- Column-level enrichments ---
          for (const enrichment of output.enrichments) {
            const hasDesc = enrichment.description && enrichment.description.trim().length > 0;
            const hasSynonyms = enrichment.synonyms && enrichment.synonyms.length > 0;
            if (!hasDesc && !hasSynonyms) continue;

            const table = tables.find(
              (t: SpaceJson) =>
                (t.identifier as string)?.toLowerCase() === enrichment.tableFqn?.toLowerCase(),
            );
            if (!table) continue;

            const colConfigs = (table.column_configs ?? []) as SpaceJson[];
            const col = colConfigs.find(
              (c: SpaceJson) =>
                ((c.column_name as string) ?? (c.name as string))?.toLowerCase() ===
                enrichment.columnName?.toLowerCase(),
            );

            if (!col) {
              const newCol: Record<string, unknown> = {
                column_name: enrichment.columnName,
                enable_format_assistance: true,
              };
              if (hasDesc) {
                newCol.description = [enrichment.description];
                descriptionsAdded++;
              }
              if (hasSynonyms) {
                newCol.synonyms = enrichment.synonyms;
                synonymsAdded++;
              }
              if (enrichment.entityMatchingCandidate) {
                newCol.enable_entity_matching = true;
              }
              colConfigs.push(newCol as SpaceJson);
              if (!table.column_configs) table.column_configs = colConfigs;
              continue;
            }

            const colDescEmpty =
              !col.description ||
              (Array.isArray(col.description) && col.description.length === 0) ||
              (Array.isArray(col.description) &&
                (col.description as string[]).every((d) => !d || String(d).trim() === ""));
            if (colDescEmpty && hasDesc) {
              col.description = [enrichment.description!];
              descriptionsAdded++;
            }
            const colSynEmpty =
              !col.synonyms || (Array.isArray(col.synonyms) && col.synonyms.length === 0);
            if (colSynEmpty && hasSynonyms) {
              col.synonyms = enrichment.synonyms;
              synonymsAdded++;
            }

            if (!col.enable_format_assistance) {
              col.enable_format_assistance = true;
              formatAssistanceEnabled++;
            }
            if (enrichment.entityMatchingCandidate && !col.enable_entity_matching) {
              col.enable_entity_matching = true;
              entityMatchingEnabled++;
            }
          }

          const totalAdded = descriptionsAdded + synonymsAdded + tableDescriptionsAdded;
          const totalFlags = formatAssistanceEnabled + entityMatchingEnabled;
          if (totalAdded > 0 || totalFlags > 0) {
            const parts: string[] = [];
            if (descriptionsAdded > 0) parts.push(`${descriptionsAdded} descriptions`);
            if (synonymsAdded > 0) parts.push(`${synonymsAdded} synonyms`);
            if (tableDescriptionsAdded > 0)
              parts.push(`${tableDescriptionsAdded} table descriptions`);
            if (formatAssistanceEnabled > 0)
              parts.push(`format assistance on ${formatAssistanceEnabled} columns`);
            if (entityMatchingEnabled > 0)
              parts.push(`entity matching on ${entityMatchingEnabled} columns`);
            changes.push({
              section: "data_sources.tables.column_configs",
              description: `Column intelligence: added ${parts.join(", ")}`,
              added: totalAdded,
              modified: totalFlags,
            });
          }
          strategiesRun.push(strategy);
          break;
        }

        case "semantic_expressions": {
          const { runSemanticExpressions } =
            await import("@/lib/genie/passes/semantic-expressions");
          const output = await runSemanticExpressions({
            tableFqns,
            metadata,
            allowlist,
            useCases: [],
            businessContext,
            config,
            endpoint,
          });

          const snippets = space.instructions?.sql_snippets ?? {};
          const existingMeasureIds = new Set(
            (snippets.measures ?? []).map((m: SpaceJson) =>
              String(m.alias ?? m.display_name ?? "").toLowerCase(),
            ),
          );
          const newMeasures = output.measures.filter(
            (m) => !existingMeasureIds.has(m.name.toLowerCase()),
          );
          if (newMeasures.length > 0) {
            snippets.measures = [
              ...(snippets.measures ?? []),
              ...newMeasures.map((m) => ({
                id: crypto.randomUUID().replace(/-/g, ""),
                alias: m.name,
                sql: [m.sql],
                display_name: m.name,
                synonyms: m.synonyms ?? [],
              })),
            ];
          }

          const existingFilterIds = new Set(
            (snippets.filters ?? []).map((f: SpaceJson) =>
              String(f.display_name ?? "").toLowerCase(),
            ),
          );
          const newFilters = output.filters.filter(
            (f) => !existingFilterIds.has(f.name.toLowerCase()),
          );
          if (newFilters.length > 0) {
            snippets.filters = [
              ...(snippets.filters ?? []),
              ...newFilters.map((f) => ({
                id: crypto.randomUUID().replace(/-/g, ""),
                sql: [f.sql],
                display_name: f.name,
                synonyms: f.synonyms ?? [],
              })),
            ];
          }

          const totalAdded = newMeasures.length + newFilters.length;
          if (totalAdded > 0) {
            space.instructions = space.instructions ?? {};
            space.instructions.sql_snippets = snippets;
            changes.push({
              section: "instructions.sql_snippets",
              description: `Semantic expressions: added ${newMeasures.length} measures and ${newFilters.length} filters`,
              added: totalAdded,
              modified: 0,
            });
          }
          strategiesRun.push(strategy);
          break;
        }

        case "join_inference": {
          const { runJoinInference } = await import("@/lib/genie/passes/join-inference");
          const existingJoins = (space.instructions?.join_specs ?? []) as SpaceJson[];
          const existingJoinKeys = new Set(
            existingJoins.map(
              (j: SpaceJson) =>
                `${(j.left?.identifier ?? "").toLowerCase()}|${(j.right?.identifier ?? "").toLowerCase()}`,
            ),
          );

          const output = await runJoinInference({
            tableFqns,
            metadata,
            allowlist,
            existingJoinKeys,
            endpoint: fastEndpoint,
          });

          const newJoins = output.joins.map((j) => ({
            id: crypto.randomUUID().replace(/-/g, ""),
            left: { identifier: j.leftTable, alias: j.leftTable.split(".").pop() },
            right: { identifier: j.rightTable, alias: j.rightTable.split(".").pop() },
            sql: [j.sql],
          }));

          if (newJoins.length > 0) {
            space.instructions = space.instructions ?? {};
            space.instructions.join_specs = [...existingJoins, ...newJoins];
            changes.push({
              section: "instructions.join_specs",
              description: `Join inference: added ${newJoins.length} join specification${newJoins.length !== 1 ? "s" : ""}`,
              added: newJoins.length,
              modified: 0,
            });
          }
          strategiesRun.push(strategy);
          break;
        }

        case "trusted_assets": {
          const { runTrustedAssetAuthoring } = await import("@/lib/genie/passes/trusted-assets");
          const output = await runTrustedAssetAuthoring({
            tableFqns,
            metadata,
            allowlist,
            useCases: [],
            entityCandidates,
            joinSpecs: spaceCtx.joinSpecs,
            endpoint,
            referenceSql: spaceSql.referenceSql,
          });

          const existingQuestions = new Set(
            spaceCtx.existingExampleQuestions.map((q) => q.toLowerCase()),
          );
          const newQueries = output.queries.filter(
            (q) => !existingQuestions.has(q.question.toLowerCase()),
          );

          if (newQueries.length > 0) {
            space.instructions = space.instructions ?? {};
            space.instructions.example_question_sqls = [
              ...(space.instructions.example_question_sqls ?? []),
              ...newQueries.map((q) => ({
                id: crypto.randomUUID().replace(/-/g, ""),
                question: [q.question],
                sql: [q.sql],
              })),
            ];
            changes.push({
              section: "instructions.example_question_sqls",
              description: `Trusted assets: added ${newQueries.length} example question-SQL pair${newQueries.length !== 1 ? "s" : ""}`,
              added: newQueries.length,
              modified: 0,
            });
          }
          strategiesRun.push(strategy);
          break;
        }

        case "instruction_generation": {
          const { runInstructionGeneration } =
            await import("@/lib/genie/passes/instruction-generation");
          const output = await runInstructionGeneration({
            domain: spaceCtx.domain,
            subdomains: [],
            businessName: spaceCtx.title,
            businessContext,
            config,
            entityCandidates,
            joinSpecs: spaceCtx.joinSpecs,
            endpoint: fastEndpoint,
            metadata,
            tableFqns,
          });

          if (output.instructions.length > 0) {
            // GSL-aware merge: if there is exactly one existing text
            // instruction block and it follows the canonical 5-section
            // schema, we patch sections in place rather than appending a
            // sibling block (which would steamroll the existing PURPOSE /
            // DISAMBIGUATION / etc.).
            const { parseGsl, renderGsl, GSL_SECTIONS } = await import(
              "@/lib/genie/gsl-schema"
            );
            space.instructions = space.instructions ?? {};
            const existingBlocks = (space.instructions.text_instructions ?? []) as SpaceJson[];
            const onlyExisting = existingBlocks.length === 1 ? existingBlocks[0] : null;
            const onlyExistingContent = onlyExisting
              ? Array.isArray(onlyExisting.content)
                ? (onlyExisting.content as string[]).join("\n")
                : String(onlyExisting.content ?? "")
              : "";
            const isGsl =
              onlyExistingContent.length > 0 &&
              GSL_SECTIONS.every((sec) =>
                onlyExistingContent.toLowerCase().includes(sec.toLowerCase()),
              );

            if (isGsl && onlyExisting) {
              const parsed = parseGsl(onlyExistingContent);
              const incoming = output.instructions.join("\n\n");
              const sectionToPatch =
                "## Instructions you must follow when providing summaries" as const;
              const existingBody = (parsed.sections[sectionToPatch] ?? "").trim();
              parsed.sections[sectionToPatch] = existingBody
                ? `${existingBody}\n\n${incoming}`
                : incoming;
              onlyExisting.content = [renderGsl(parsed)];
              changes.push({
                section: "instructions.text_instructions",
                description: `Instruction generation: merged ${output.instructions.length} update${output.instructions.length !== 1 ? "s" : ""} into existing GSL block`,
                added: 0,
                modified: 1,
              });
            } else {
              space.instructions.text_instructions = [
                ...existingBlocks,
                ...output.instructions.map((text) => ({
                  id: crypto.randomUUID().replace(/-/g, ""),
                  content: [text],
                })),
              ];
              changes.push({
                section: "instructions.text_instructions",
                description: `Instruction generation: added ${output.instructions.length} text instruction${output.instructions.length !== 1 ? "s" : ""}`,
                added: output.instructions.length,
                modified: 0,
              });
            }
          }
          strategiesRun.push(strategy);
          break;
        }

        case "benchmark_generation": {
          const { runBenchmarkGeneration } =
            await import("@/lib/genie/passes/benchmark-generation");
          const FIX_TARGET_BENCHMARKS = 8;
          const benchmarksPerBatch = FIX_TARGET_BENCHMARKS;
          const output = await runBenchmarkGeneration({
            tableFqns,
            metadata,
            allowlist,
            useCases: [],
            entityCandidates,
            customerBenchmarks: spaceSql.existingBenchmarks,
            joinSpecs: spaceCtx.joinSpecs,
            referenceSql: spaceSql.referenceSql,
            endpoint,
            benchmarksPerBatch,
          });

          if (output.benchmarks.length > 0) {
            space.benchmarks = space.benchmarks ?? { questions: [] };
            const existing = new Set(
              spaceCtx.existingBenchmarkQuestions.map((q) => q.toLowerCase()),
            );
            const newBenchmarks = output.benchmarks.filter(
              (b) => !existing.has(b.question.toLowerCase()),
            );
            if (newBenchmarks.length > 0) {
              space.benchmarks.questions = [
                ...(space.benchmarks.questions ?? []),
                ...newBenchmarks.map((b) => ({
                  id: crypto.randomUUID().replace(/-/g, ""),
                  question: [b.question],
                  ...(b.expectedSql
                    ? { answer: [{ format: "sql", content: [b.expectedSql] }] }
                    : {}),
                })),
              ];
              const diag = output.diagnostics;
              const diagNote = diag?.fallbackUsed ? " (question-only fallback)" : "";
              changes.push({
                section: "benchmarks.questions",
                description: `Benchmark generation: added ${newBenchmarks.length} benchmark question${newBenchmarks.length !== 1 ? "s" : ""}${diagNote}`,
                added: newBenchmarks.length,
                modified: 0,
              });
            }
          }
          strategiesRun.push(strategy);
          break;
        }

        case "entity_matching": {
          const tables = (space.data_sources?.tables ?? []) as SpaceJson[];
          let enabled = 0;
          for (const table of tables) {
            const tableFqn = String(table.identifier ?? "").toLowerCase();
            const colConfigs = (table.column_configs ?? []) as SpaceJson[];
            for (const col of colConfigs) {
              const colName = String(col.column_name ?? col.name ?? "").toLowerCase();
              const key = `${tableFqn}.${colName}`;
              if (entityCandidateColumns.has(key) && !col.enable_entity_matching) {
                col.enable_entity_matching = true;
                enabled++;
              }
            }
          }

          if (enabled > 0) {
            changes.push({
              section: "data_sources.tables.column_configs",
              description: `Entity matching: enabled on ${enabled} candidate column${enabled !== 1 ? "s" : ""}`,
              added: enabled,
              modified: 0,
            });
          }
          strategiesRun.push(strategy);
          break;
        }

        case "sample_questions": {
          const existing = (space.config?.sample_questions ?? []) as SpaceJson[];
          const existingTexts = new Set(
            existing.map((q: SpaceJson) =>
              (Array.isArray(q.question)
                ? String(q.question[0] ?? "")
                : String(q.question ?? "")
              ).toLowerCase(),
            ),
          );
          const generated = await generateSmartSampleQuestions(spaceCtx, tableFqns, fastEndpoint);
          const newQuestions = generated.filter((q) => !existingTexts.has(q.toLowerCase()));

          if (newQuestions.length > 0) {
            space.config = space.config ?? {};
            space.config.sample_questions = [
              ...existing,
              ...newQuestions.map((q: string) => ({
                id: crypto.randomUUID().replace(/-/g, ""),
                question: [q],
              })),
            ];
            changes.push({
              section: "config.sample_questions",
              description: `Sample questions: generated ${newQuestions.length} contextual sample question${newQuestions.length !== 1 ? "s" : ""}`,
              added: newQuestions.length,
              modified: 0,
            });
          }
          strategiesRun.push(strategy);
          break;
        }

        default:
          logger.warn("Unknown fix strategy", { strategy });
      }
      void recordSpan({
        name: `space-fixer.strategy:${strategy}`,
        spanType: "TOOL",
        inputs: { strategy, spaceId: spaceIdForTrace },
        outputs: {
          success: strategiesRun.includes(strategy),
          changes: changes.filter((c) => c.section === strategy).length,
        },
        attributes: { strategy, spaceId: spaceIdForTrace },
        startMs: spanStart,
        endMs: Date.now(),
      });
    } catch (err) {
      logger.error("Fix strategy execution failed", { strategy, error: String(err) });
      changes.push({
        section: strategy,
        description: `Failed: ${err instanceof Error ? err.message : String(err)}`,
        added: 0,
        modified: 0,
      });
      void recordSpan({
        name: `space-fixer.strategy:${strategy}`,
        spanType: "TOOL",
        inputs: { strategy, spaceId: spaceIdForTrace },
        attributes: { strategy, spaceId: spaceIdForTrace },
        startMs: spanStart,
        endMs: Date.now(),
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { updatedSpace: space, changes, strategiesRun };
}

/**
 * Infer a brief table description from the table name and column names.
 * Deterministic heuristic -- no LLM call.
 */
function inferTableDescription(tableName: string, columnNames: string[]): string | null {
  const readable = tableName.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const colSummary = columnNames.slice(0, 8).join(", ");
  if (!colSummary) return null;
  return `${readable} table containing ${colSummary}`;
}

/**
 * Generate user-friendly sample questions using the fast LLM endpoint,
 * informed by the space's title, tables, and existing example SQLs.
 */
async function generateSmartSampleQuestions(
  ctx: SpaceContext,
  tableFqns: string[],
  endpoint: string,
): Promise<string[]> {
  const tableNames = tableFqns.map((f) => f.split(".").pop() ?? f).join(", ");
  const existingExamples = ctx.existingExampleQuestions.slice(0, 5).join("\n- ");

  const sqSkills = resolveForGeniePass("exampleQueries", { contextBudget: 1000 });
  const sqSkillBlock = formatContextSections(sqSkills.contextSections);

  const prompt = `Generate 3 short, user-friendly sample questions for a data exploration space.
Space: "${ctx.title || "Data Space"}"${ctx.description ? ` -- ${ctx.description}` : ""}
Tables: ${tableNames || "various tables"}
${existingExamples ? `Existing example questions (generate DIFFERENT ones):\n- ${existingExamples}` : ""}
${sqSkillBlock ? `\n### Question Style Guidelines\n${sqSkillBlock}\n` : ""}
Return ONLY a JSON array of 3 question strings. Keep them simple and conversational.`;

  try {
    const result = await chatCompletion({
      endpoint,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      maxTokens: 300,
      responseFormat: "json_object",
    });
    const parsed = JSON.parse(result.content ?? "[]");
    const questions = Array.isArray(parsed) ? parsed : (parsed.questions ?? []);
    return questions
      .filter((q: unknown): q is string => typeof q === "string" && q.trim().length > 5)
      .slice(0, 3);
  } catch (err) {
    logger.warn("Smart sample question generation failed, skipping", { error: String(err) });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Retry-on-stale apply helper
// ---------------------------------------------------------------------------

const APPLY_FIXES_MAX_ATTEMPTS = 3;
const APPLY_FIXES_BACKOFF_MS = [2_000, 4_000];

/**
 * Re-fetch the space, run fix strategies against the current revision, and
 * write the result back via `updateGenieSpace`. Retries up to three times
 * with 2s/4s backoff if the API returns a status that suggests we wrote
 * against a stale revision (409/412/RESOURCE_CONFLICT).
 *
 * Mirrors upstream `_apply_config_sync` from the workbench Fix Agent.
 *
 * Use this from any flow that wants the strongest "patch and persist"
 * guarantee. Existing callers that just want the patched JSON (without
 * persisting) should keep using `runFixes` directly.
 */
export async function applyFixesWithRetry(opts: {
  spaceId: string;
  checkIds: string[];
  oboToken?: string;
  /**
   * When true (default), enforce the per-iteration blast-radius gate from
   * `lib/genie/blast-radius.ts`. Set to false for one-off ad-hoc fix flows
   * that intentionally rewrite many tables (e.g. full regenerate).
   */
  enforceBlastRadius?: boolean;
}): Promise<{
  attempts: number;
  fixResult: FixResult;
  /** Populated when the blast-radius gate dropped the fix. */
  blastRadiusDropped?: { tablesTouched: number; max: number };
}> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= APPLY_FIXES_MAX_ATTEMPTS; attempt++) {
    try {
      const fresh = await getGenieSpace(opts.spaceId);
      const serializedSpace = fresh.serialized_space ?? "{}";

      const fixResult = await runFixes({
        checkIds: opts.checkIds,
        serializedSpace,
        spaceId: opts.spaceId,
      });

      if (opts.enforceBlastRadius !== false) {
        const before = JSON.parse(serializedSpace) as SpaceJson;
        const { evaluateBlastRadius } = await import("@/lib/genie/blast-radius");
        const report = evaluateBlastRadius({ before, after: fixResult.updatedSpace });
        if (report.exceeded) {
          logger.warn("[applyFixesWithRetry] blast-radius exceeded, skipping persist", {
            spaceId: opts.spaceId,
            tablesTouched: report.tablesTouched.length,
            max: report.max,
          });
          return {
            attempts: attempt,
            fixResult,
            blastRadiusDropped: {
              tablesTouched: report.tablesTouched.length,
              max: report.max,
            },
          };
        }
      }

      const updatedSerialized = JSON.stringify(fixResult.updatedSpace);
      await updateGenieSpace(opts.spaceId, {
        serializedSpace: updatedSerialized,
        oboToken: opts.oboToken,
      });

      if (attempt > 1) {
        logger.warn("applyFixesWithRetry succeeded after retry", {
          spaceId: opts.spaceId,
          attempt,
        });
      }
      return { attempts: attempt, fixResult };
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isStale =
        msg.includes("CONFLICT") ||
        msg.includes("PRECONDITION_FAILED") ||
        msg.includes("(409)") ||
        msg.includes("(412)") ||
        msg.includes("RESOURCE_CONFLICT");
      if (!isStale || attempt === APPLY_FIXES_MAX_ATTEMPTS) break;

      const backoff = APPLY_FIXES_BACKOFF_MS[attempt - 1] ?? APPLY_FIXES_BACKOFF_MS.at(-1)!;
      logger.warn("applyFixesWithRetry stale conflict, retrying", {
        spaceId: opts.spaceId,
        attempt,
        backoffMs: backoff,
      });
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  throw new Error(
    `applyFixesWithRetry failed after ${APPLY_FIXES_MAX_ATTEMPTS} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}
