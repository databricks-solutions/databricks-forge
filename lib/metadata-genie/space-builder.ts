/**
 * Builds a SerializedSpace for the Meta Data Genie.
 *
 * Combines curated system.information_schema view definitions with
 * industry-tailored content derived from the matched outcome map.
 */

import { randomUUID } from "crypto";
import type { IndustryOutcome } from "@/lib/domain/industry-outcomes";
import type {
  SerializedSpace,
  DataSourceTable,
  JoinSpec,
  TextInstruction,
  ExampleQuestionSql,
  SampleQuestion,
  SqlSnippets,
  SqlSnippetMeasure,
  SqlSnippetFilter,
  SqlSnippetExpression,
  BenchmarkQuestion,
  QuestionComplexity,
} from "@/lib/genie/types";
import type { IndustryDetectionResult, ViewTarget } from "./types";

// ---------------------------------------------------------------------------
// View descriptions (hand-written for the Genie)
// ---------------------------------------------------------------------------

const VIEW_DESCRIPTIONS: Record<string, string> = {
  mdg_catalogs:
    "Lists all Unity Catalog catalogs. Use to discover available data catalogs, their owners, and descriptions. Key columns: catalog_name, catalog_owner, comment.",
  mdg_schemas:
    "Lists all schemas (databases) within catalogs. Use to explore the organisational structure of the data estate. Key columns: catalog_name, schema_name, schema_owner, comment.",
  mdg_tables:
    "Lists all tables and views. The primary entry point for discovering what data exists. Key columns: table_catalog, table_schema, table_name, table_type, table_owner, comment, data_source_format, created, last_altered.",
  mdg_columns:
    "Lists all columns with their data types. Use to find specific data attributes across the estate. Key columns: table_catalog, table_schema, table_name, column_name, data_type, is_nullable, comment.",
  mdg_views:
    "Lists SQL view definitions. Use to understand how derived data is computed. Key columns: table_catalog, table_schema, table_name, view_definition.",
  mdg_volumes:
    "Lists Unity Catalog volumes (file-based storage). Key columns: volume_catalog, volume_schema, volume_name, volume_type, storage_location.",
  mdg_table_tags:
    "Lists tags applied to tables. Use to find tables by classification (e.g. PII, sensitivity). Key columns: catalog_name, schema_name, table_name, tag_name, tag_value.",
  mdg_column_tags:
    "Lists tags applied to columns. Use to find columns by classification. Key columns: catalog_name, schema_name, table_name, column_name, tag_name, tag_value.",
  mdg_table_constraints:
    "Lists primary key and foreign key constraints. Use to understand table relationships. Key columns: table_catalog, table_schema, table_name, constraint_type.",
  mdg_table_privileges:
    "Lists table access privileges. Use to understand who has access to what data. Key columns: table_catalog, table_schema, table_name, grantee, privilege_type.",
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface BuildMetadataGenieSpaceOpts {
  viewTarget: ViewTarget;
  outcomeMap?: IndustryOutcome | null;
  llmDetection: IndustryDetectionResult;
  catalogScope?: string[];
  lineageAccessible?: boolean;
  title?: string;
  questionComplexity?: QuestionComplexity;
}

export function buildMetadataGenieSpace(opts: BuildMetadataGenieSpaceOpts): SerializedSpace {
  const {
    viewTarget,
    outcomeMap,
    llmDetection,
    catalogScope,
    lineageAccessible,
    questionComplexity,
  } = opts;
  const prefix = `${viewTarget.catalog}.${viewTarget.schema}`;
  const hasLineage = lineageAccessible === true;

  const tables = buildDataSourceTables(prefix, hasLineage);
  const joinSpecs = buildJoinSpecs(prefix);
  const sampleQuestions = buildSampleQuestions(
    outcomeMap,
    llmDetection,
    hasLineage,
    questionComplexity,
  );
  const textInstructions = buildTextInstructions(
    outcomeMap,
    llmDetection,
    catalogScope,
    hasLineage,
  );
  const exampleSqls = buildExampleSqls(prefix, outcomeMap, llmDetection, hasLineage);
  const sqlSnippets = buildSqlSnippets(prefix, outcomeMap, hasLineage);
  const benchmarks = buildBenchmarks(prefix);

  return {
    version: 2,
    config: {
      sample_questions: sampleQuestions,
    },
    data_sources: {
      tables,
    },
    instructions: {
      text_instructions: textInstructions,
      example_question_sqls: exampleSqls,
      join_specs: joinSpecs,
      sql_snippets: sqlSnippets,
    },
    benchmarks: { questions: benchmarks },
  };
}

// ---------------------------------------------------------------------------
// Data Sources
// ---------------------------------------------------------------------------

const LINEAGE_DESCRIPTION =
  "Data lineage showing upstream sources and downstream consumers for each table. " +
  "Use to trace data flow and understand dependencies. " +
  "Key columns: source_table_full_name, target_table_full_name, source_type, target_type, entity_type, event_time.";

function buildDataSourceTables(prefix: string, hasLineage: boolean): DataSourceTable[] {
  const allDescriptions = hasLineage
    ? { ...VIEW_DESCRIPTIONS, mdg_lineage: LINEAGE_DESCRIPTION }
    : VIEW_DESCRIPTIONS;
  const viewNames = Object.keys(allDescriptions).sort();
  return viewNames.map((name) => ({
    identifier: `${prefix}.${name}`,
    description: [allDescriptions[name]],
  }));
}

// ---------------------------------------------------------------------------
// Join Specs -- one join_spec per table pair
// ---------------------------------------------------------------------------
// The working Genie Engine produces join_specs with:
//   - explicit `alias` on left/right
//   - backtick-quoted `alias`.`column` format in sql
//   - exactly ONE sql equality per join_spec
//   - a --rt= relationship type comment
// We mirror that format exactly.

type JoinDef = [left: string, right: string, leftCol: string, rightCol: string];

const JOIN_DEFS: JoinDef[] = [
  ["mdg_catalogs", "mdg_schemas", "catalog_name", "catalog_name"],
  ["mdg_schemas", "mdg_tables", "catalog_name", "table_catalog"],
  ["mdg_schemas", "mdg_tables", "schema_name", "table_schema"],
  ["mdg_tables", "mdg_columns", "table_catalog", "table_catalog"],
  ["mdg_tables", "mdg_columns", "table_schema", "table_schema"],
  ["mdg_tables", "mdg_columns", "table_name", "table_name"],
  ["mdg_tables", "mdg_table_tags", "table_catalog", "catalog_name"],
  ["mdg_tables", "mdg_table_tags", "table_schema", "schema_name"],
  ["mdg_tables", "mdg_table_tags", "table_name", "table_name"],
  ["mdg_columns", "mdg_column_tags", "table_catalog", "catalog_name"],
  ["mdg_columns", "mdg_column_tags", "table_schema", "schema_name"],
  ["mdg_columns", "mdg_column_tags", "table_name", "table_name"],
  ["mdg_columns", "mdg_column_tags", "column_name", "column_name"],
  ["mdg_tables", "mdg_table_constraints", "table_catalog", "table_catalog"],
  ["mdg_tables", "mdg_table_constraints", "table_schema", "table_schema"],
  ["mdg_tables", "mdg_table_constraints", "table_name", "table_name"],
  ["mdg_tables", "mdg_table_privileges", "table_catalog", "table_catalog"],
  ["mdg_tables", "mdg_table_privileges", "table_schema", "table_schema"],
  ["mdg_tables", "mdg_table_privileges", "table_name", "table_name"],
  ["mdg_tables", "mdg_views", "table_catalog", "table_catalog"],
  ["mdg_tables", "mdg_views", "table_schema", "table_schema"],
  ["mdg_tables", "mdg_views", "table_name", "table_name"],
  ["mdg_schemas", "mdg_volumes", "catalog_name", "volume_catalog"],
  ["mdg_schemas", "mdg_volumes", "schema_name", "volume_schema"],
];

function buildJoinSpecs(prefix: string): JoinSpec[] {
  return JOIN_DEFS.map(([left, right, leftCol, rightCol]) => {
    const rightAlias = right === left ? `${right}_2` : right;
    return {
      id: randomUUID(),
      left: { identifier: `${prefix}.${left}`, alias: left },
      right: { identifier: `${prefix}.${right}`, alias: rightAlias },
      sql: [
        `\`${left}\`.\`${leftCol}\` = \`${rightAlias}\`.\`${rightCol}\``,
        "--rt=FROM_RELATIONSHIP_TYPE_MANY_TO_ONE--",
      ],
    };
  });
}

// ---------------------------------------------------------------------------
// Sample Questions (BA-focused, derived from outcome map)
// ---------------------------------------------------------------------------

/**
 * Build preview question strings (exported for use by the generate API
 * before a viewTarget is chosen).
 */
export function buildPreviewQuestions(
  outcomeMap: IndustryOutcome | null | undefined,
  llmDetection: IndustryDetectionResult,
  hasLineage?: boolean,
  questionComplexity?: QuestionComplexity,
): string[] {
  const level = questionComplexity ?? "simple";
  const questions: string[] = [];

  if (outcomeMap) {
    const entities = new Set<string>();
    const priorities = new Set<string>();

    for (const obj of outcomeMap.objectives) {
      for (const p of obj.priorities) {
        priorities.add(p.name);
        for (const uc of p.useCases) {
          if (questions.length < 5) {
            const name = uc.name.toLowerCase();
            switch (level) {
              case "simple":
                questions.push(`What data do we have for ${name}?`);
                break;
              case "medium":
                questions.push(`Do we have data to support ${name}?`);
                break;
              case "complex":
                questions.push(`What data quality and coverage gaps exist for ${name}?`);
                break;
            }
          }
          for (const e of uc.typicalDataEntities ?? []) {
            entities.add(e);
          }
        }
      }
    }

    for (const entity of [...entities].slice(0, 4)) {
      const e = entity.toLowerCase();
      switch (level) {
        case "simple":
          questions.push(`Where is our ${e} data?`);
          break;
        case "medium":
          questions.push(`Where is ${e} data stored?`);
          break;
        case "complex":
          questions.push(`Which schemas and tables contain ${e} data, and how current is it?`);
          break;
      }
    }

    for (const priority of [...priorities].slice(0, 3)) {
      const p = priority.toLowerCase();
      switch (level) {
        case "simple":
          questions.push(`What data relates to ${p}?`);
          break;
        case "medium":
          questions.push(`What data supports ${p}?`);
          break;
        case "complex":
          questions.push(`What data assets and lineage paths support ${p}?`);
          break;
      }
    }

    for (const sv of (outcomeMap.subVerticals ?? []).slice(0, 2)) {
      questions.push(
        level === "simple" ? `What ${sv} data do we have?` : `What data is specific to ${sv}?`,
      );
    }
  } else if (llmDetection.domains.length > 0) {
    for (const domain of llmDetection.domains.slice(0, 5)) {
      questions.push(`What ${domain.toLowerCase()} data do we have?`);
    }
  }

  switch (level) {
    case "simple":
      questions.push(
        "What data do we have?",
        "Which tables have no description?",
        "Are any tables duplicated?",
        "What tables were created recently?",
        "Which schemas have the most tables?",
      );
      break;
    case "medium":
      questions.push(
        "What data do we have?",
        "Do we have any tables without descriptions?",
        "What tables might be duplicated across schemas?",
        "What are the most recently created tables?",
        "Which schemas have the most tables?",
      );
      break;
    case "complex":
      questions.push(
        "What data do we have?",
        "What data quality issues exist across the estate?",
        "Which tables have overlapping schemas or redundant structures?",
        "What are the most recently created tables and who owns them?",
        "Which schemas have the most tables and what is their lineage coverage?",
      );
      break;
  }

  if (hasLineage) {
    switch (level) {
      case "simple":
        questions.push("Where does this data come from?", "What depends on this data?");
        break;
      case "medium":
        questions.push(
          "Where does this table get its data from?",
          "What downstream tables depend on our data?",
        );
        break;
      case "complex":
        questions.push(
          "What is the full upstream lineage for this table?",
          "What downstream dependencies and impact paths exist?",
        );
        break;
    }
  }

  return [...new Set(questions)].slice(0, 15);
}

function buildSampleQuestions(
  outcomeMap: IndustryOutcome | null | undefined,
  llmDetection: IndustryDetectionResult,
  hasLineage: boolean,
  questionComplexity?: QuestionComplexity,
): SampleQuestion[] {
  const unique = buildPreviewQuestions(outcomeMap, llmDetection, hasLineage, questionComplexity);
  return unique.map((q) => ({
    id: randomUUID(),
    question: [q],
  }));
}

// ---------------------------------------------------------------------------
// Text Instructions
// ---------------------------------------------------------------------------

function buildTextInstructions(
  outcomeMap: IndustryOutcome | null | undefined,
  llmDetection: IndustryDetectionResult,
  catalogScope?: string[],
  hasLineage?: boolean,
): TextInstruction[] {
  const parts: string[] = [];

  parts.push(
    "You are a metadata exploration assistant helping business analysts discover and understand their data estate. " +
      "Answer questions about what data exists, where it is stored, its structure, and how it is organised.",
  );

  if (outcomeMap) {
    parts.push(
      `This data estate belongs to the ${outcomeMap.name} industry.` +
        (outcomeMap.subVerticals?.length
          ? ` Sub-verticals include: ${outcomeMap.subVerticals.join(", ")}.`
          : ""),
    );
    if (outcomeMap.suggestedDomains.length > 0) {
      parts.push(`Key business domains: ${outcomeMap.suggestedDomains.join(", ")}.`);
    }
  } else if (llmDetection.industries) {
    parts.push(`Detected industries: ${llmDetection.industries}.`);
    if (llmDetection.domains.length > 0) {
      parts.push(`Key business domains: ${llmDetection.domains.join(", ")}.`);
    }
  }

  if (catalogScope && catalogScope.length > 0) {
    parts.push(`This space is scoped to the following catalogs: ${catalogScope.join(", ")}.`);
  }

  parts.push(
    "When searching for business-relevant tables, look at both table names and their comments/descriptions. " +
      "Tables without comments may still contain important data — infer purpose from naming conventions.",
  );

  parts.push(
    "The data_source_format column indicates the storage format (DELTA, PARQUET, CSV, JSON, etc.). DELTA is the default managed format in Databricks.",
  );

  parts.push(
    "table_type can be MANAGED, EXTERNAL, or VIEW. MANAGED tables are fully governed by Unity Catalog. EXTERNAL tables reference data stored outside Unity Catalog.",
  );

  parts.push(
    "Tags from mdg_table_tags and mdg_column_tags provide classifications like PII sensitivity, data quality tier, or domain labels. " +
      "Use them to find sensitive or categorised data.",
  );

  parts.push(
    "When a user asks about a table by business name, search both the table_name and comment columns using LIKE with wildcards. " +
      "If multiple matches are found, present all of them and ask the user to clarify which one they mean.",
  );

  if (hasLineage) {
    parts.push(
      "The mdg_lineage view shows data flow between tables. " +
        "source_table_full_name and target_table_full_name are fully qualified names (catalog.schema.table). " +
        "To join with mdg_tables, use CONCAT(table_catalog, '.', table_schema, '.', table_name) = source_table_full_name or target_table_full_name.",
    );
  }

  return [
    {
      id: randomUUID(),
      content: [parts.join("\n\n")],
    },
  ];
}

// ---------------------------------------------------------------------------
// Example SQL
// ---------------------------------------------------------------------------

function buildExampleSqls(
  prefix: string,
  outcomeMap: IndustryOutcome | null | undefined,
  llmDetection: IndustryDetectionResult,
  hasLineage?: boolean,
): ExampleQuestionSql[] {
  const examples: ExampleQuestionSql[] = [];

  examples.push({
    id: randomUUID(),
    question: ["How many tables do we have in each schema?"],
    sql: [
      `SELECT table_catalog, table_schema, COUNT(*) AS table_count FROM ${prefix}.mdg_tables GROUP BY table_catalog, table_schema ORDER BY table_count DESC`,
    ],
  });

  examples.push({
    id: randomUUID(),
    question: ["Which tables have no description?"],
    sql: [
      `SELECT table_catalog, table_schema, table_name FROM ${prefix}.mdg_tables WHERE comment IS NULL OR TRIM(comment) = '' ORDER BY table_catalog, table_schema, table_name`,
    ],
  });

  examples.push({
    id: randomUUID(),
    question: ["What tables might be duplicated across schemas?"],
    sql: [
      `SELECT table_name, COUNT(DISTINCT CONCAT(table_catalog, '.', table_schema)) AS schema_count, COLLECT_SET(CONCAT(table_catalog, '.', table_schema)) AS schemas FROM ${prefix}.mdg_tables GROUP BY table_name HAVING schema_count > 1 ORDER BY schema_count DESC`,
    ],
  });

  const searchTerm =
    outcomeMap?.suggestedDomains?.[0]?.toLowerCase() ??
    (llmDetection.domains[0]?.toLowerCase() || "customer");

  examples.push({
    id: randomUUID(),
    question: [`What tables contain ${searchTerm} data?`],
    sql: [
      `SELECT table_catalog, table_schema, table_name, comment FROM ${prefix}.mdg_tables WHERE LOWER(table_name) LIKE '%${searchTerm}%' OR LOWER(comment) LIKE '%${searchTerm}%' ORDER BY table_catalog, table_schema, table_name`,
    ],
  });

  examples.push({
    id: randomUUID(),
    question: ["What are the most recently created tables?"],
    sql: [
      `SELECT table_catalog, table_schema, table_name, table_type, created, created_by FROM ${prefix}.mdg_tables ORDER BY created DESC LIMIT 20`,
    ],
  });

  examples.push({
    id: randomUUID(),
    question: ["What tags are applied to our tables?"],
    sql: [
      `SELECT tag_name, tag_value, COUNT(*) AS table_count FROM ${prefix}.mdg_table_tags GROUP BY tag_name, tag_value ORDER BY table_count DESC`,
    ],
  });

  examples.push({
    id: randomUUID(),
    question: ["Who has access to what data?"],
    sql: [
      `SELECT grantee, privilege_type, COUNT(*) AS table_count FROM ${prefix}.mdg_table_privileges GROUP BY grantee, privilege_type ORDER BY table_count DESC`,
    ],
  });

  examples.push({
    id: randomUUID(),
    question: ["What columns have timestamp data types?"],
    sql: [
      `SELECT table_catalog, table_schema, table_name, column_name, data_type FROM ${prefix}.mdg_columns WHERE LOWER(data_type) LIKE '%timestamp%' ORDER BY table_catalog, table_schema, table_name`,
    ],
  });

  examples.push({
    id: randomUUID(),
    question: ["Which tables have primary key or foreign key constraints?"],
    sql: [
      `SELECT constraint_type, COUNT(DISTINCT CONCAT(table_catalog, '.', table_schema, '.', table_name)) AS table_count FROM ${prefix}.mdg_table_constraints GROUP BY constraint_type ORDER BY table_count DESC`,
    ],
  });

  examples.push({
    id: randomUUID(),
    question: ["What data do we have in each catalog?"],
    sql: [
      `SELECT c.catalog_name, c.comment, COUNT(DISTINCT CONCAT(s.catalog_name, '.', s.schema_name)) AS schema_count, COUNT(DISTINCT CONCAT(t.table_catalog, '.', t.table_schema, '.', t.table_name)) AS table_count FROM ${prefix}.mdg_catalogs c LEFT JOIN ${prefix}.mdg_schemas s ON c.catalog_name = s.catalog_name LEFT JOIN ${prefix}.mdg_tables t ON s.catalog_name = t.table_catalog AND s.schema_name = t.table_schema GROUP BY c.catalog_name, c.comment ORDER BY table_count DESC`,
    ],
  });

  if (hasLineage) {
    examples.push({
      id: randomUUID(),
      question: ["What are the upstream data sources for a table?"],
      sql: [
        `SELECT source_table_full_name, source_type, COUNT(*) AS event_count, MAX(event_time) AS last_event FROM ${prefix}.mdg_lineage WHERE target_table_full_name LIKE '%table_name_here%' GROUP BY source_table_full_name, source_type ORDER BY last_event DESC`,
      ],
    });
  }

  return examples;
}

// ---------------------------------------------------------------------------
// SQL Snippets
// ---------------------------------------------------------------------------

function buildSqlSnippets(
  prefix: string,
  outcomeMap: IndustryOutcome | null | undefined,
  hasLineage?: boolean,
): SqlSnippets {
  const measures: SqlSnippetMeasure[] = [
    {
      id: randomUUID(),
      alias: "table_count_per_schema",
      sql: [`COUNT(*) FROM ${prefix}.mdg_tables GROUP BY table_catalog, table_schema`],
      synonyms: ["tables per schema", "schema size"],
    },
    {
      id: randomUUID(),
      alias: "column_count_per_table",
      sql: [`COUNT(*) FROM ${prefix}.mdg_columns GROUP BY table_catalog, table_schema, table_name`],
      synonyms: ["columns per table", "table width"],
    },
    {
      id: randomUUID(),
      alias: "total_tables",
      sql: [`COUNT(DISTINCT CONCAT(table_catalog, '.', table_schema, '.', table_name))`],
      synonyms: ["table count", "number of tables", "how many tables"],
    },
    {
      id: randomUUID(),
      alias: "total_schemas",
      sql: [`COUNT(DISTINCT CONCAT(catalog_name, '.', schema_name))`],
      synonyms: ["schema count", "number of schemas"],
    },
    {
      id: randomUUID(),
      alias: "total_catalogs",
      sql: [`COUNT(DISTINCT catalog_name)`],
      synonyms: ["catalog count", "number of catalogs"],
    },
    {
      id: randomUUID(),
      alias: "undocumented_table_count",
      sql: [`SUM(CASE WHEN comment IS NULL OR TRIM(comment) = '' THEN 1 ELSE 0 END)`],
      synonyms: ["tables without descriptions", "missing descriptions", "undocumented tables"],
    },
    {
      id: randomUUID(),
      alias: "tagged_table_count",
      sql: [`COUNT(DISTINCT CONCAT(catalog_name, '.', schema_name, '.', table_name))`],
      synonyms: ["classified tables", "labelled tables", "tables with tags"],
    },
    {
      id: randomUUID(),
      alias: "distinct_data_types",
      sql: [`COUNT(DISTINCT data_type)`],
      synonyms: ["data type count", "number of data types", "type variety"],
    },
  ];

  const filters: SqlSnippetFilter[] = [
    {
      id: randomUUID(),
      sql: [`comment IS NULL OR TRIM(comment) = ''`],
      display_name: "Tables without descriptions",
      synonyms: ["undocumented tables", "missing descriptions"],
    },
    {
      id: randomUUID(),
      sql: [`data_source_format = 'DELTA'`],
      display_name: "Delta tables",
      synonyms: ["delta format", "managed tables", "delta"],
    },
    {
      id: randomUUID(),
      sql: [`table_type = 'EXTERNAL'`],
      display_name: "External tables",
      synonyms: ["external", "unmanaged", "external tables"],
    },
    {
      id: randomUUID(),
      sql: [`table_type = 'VIEW'`],
      display_name: "Views only",
      synonyms: ["views", "derived tables", "virtual tables"],
    },
    {
      id: randomUUID(),
      sql: [
        `CONCAT(table_catalog, '.', table_schema, '.', table_name) IN (SELECT DISTINCT CONCAT(catalog_name, '.', schema_name, '.', table_name) FROM ${prefix}.mdg_table_tags)`,
      ],
      display_name: "Tables with tags",
      synonyms: ["tagged tables", "classified tables", "labelled tables"],
    },
    {
      id: randomUUID(),
      sql: [`created >= DATE_ADD(CURRENT_DATE(), -30)`],
      display_name: "Recently created (last 30 days)",
      synonyms: ["new tables", "last 30 days", "recently added"],
    },
    {
      id: randomUUID(),
      sql: [`last_altered >= DATE_ADD(CURRENT_DATE(), -30)`],
      display_name: "Recently modified (last 30 days)",
      synonyms: ["recently changed", "recently updated", "recently modified"],
    },
  ];

  if (outcomeMap) {
    for (const domain of outcomeMap.suggestedDomains.slice(0, 3)) {
      filters.push({
        id: randomUUID(),
        sql: [`LOWER(table_name) LIKE '%${domain.toLowerCase().replace(/\s+/g, "_")}%'`],
        display_name: `Tables related to ${domain}`,
        synonyms: [domain.toLowerCase()],
      });
    }
  }

  if (hasLineage) {
    measures.push({
      id: randomUUID(),
      alias: "lineage_edge_count",
      sql: [`COUNT(DISTINCT CONCAT(source_table_full_name, ' -> ', target_table_full_name))`],
      synonyms: ["data flows", "connections", "dependencies", "lineage edges"],
    });

    filters.push({
      id: randomUUID(),
      sql: [
        `CONCAT(table_catalog, '.', table_schema, '.', table_name) NOT IN (SELECT DISTINCT target_table_full_name FROM ${prefix}.mdg_lineage)`,
      ],
      display_name: "Tables with no upstream sources",
      synonyms: ["source tables", "root tables", "ingestion tables", "origin tables"],
    });
  }

  const expressions: SqlSnippetExpression[] = [
    {
      id: randomUUID(),
      alias: "potential_duplicates",
      sql: [
        `table_name IN (SELECT table_name FROM ${prefix}.mdg_tables GROUP BY table_name HAVING COUNT(DISTINCT CONCAT(table_catalog, '.', table_schema)) > 1)`,
      ],
      synonyms: ["duplicated tables", "table copies", "redundant tables"],
    },
    {
      id: randomUUID(),
      alias: "full_table_name",
      sql: [`CONCAT(table_catalog, '.', table_schema, '.', table_name)`],
      synonyms: ["FQN", "qualified name", "full name", "fully qualified"],
    },
    {
      id: randomUUID(),
      alias: "table_type",
      sql: [`table_type`],
      synonyms: ["type", "managed or external", "table kind"],
    },
    {
      id: randomUUID(),
      alias: "data_format",
      sql: [`data_source_format`],
      synonyms: ["format", "storage format", "delta or parquet"],
    },
    {
      id: randomUUID(),
      alias: "creation_month",
      sql: [`DATE_TRUNC('MONTH', created)`],
      synonyms: ["created month", "by month", "monthly"],
    },
    {
      id: randomUUID(),
      alias: "owner",
      sql: [`table_owner`],
      synonyms: ["owned by", "creator", "responsible", "table owner"],
    },
  ];

  return { measures, filters, expressions };
}

// ---------------------------------------------------------------------------
// Benchmarks -- gold-standard Q&A for Genie quality
// ---------------------------------------------------------------------------

function buildBenchmarks(prefix: string): BenchmarkQuestion[] {
  const bq = (question: string, sql: string, alternates: string[]): BenchmarkQuestion[] => {
    return [question, ...alternates].map((q) => ({
      id: randomUUID(),
      question: [q],
      answer: [{ format: "SQL", content: [sql] }],
    }));
  };

  return [
    ...bq(
      "How many tables do we have?",
      `SELECT COUNT(*) AS total_tables FROM ${prefix}.mdg_tables`,
      ["total number of tables", "count all tables"],
    ),
    ...bq(
      "Which schemas have the most tables?",
      `SELECT table_catalog, table_schema, COUNT(*) AS table_count FROM ${prefix}.mdg_tables GROUP BY table_catalog, table_schema ORDER BY table_count DESC LIMIT 20`,
      ["largest schemas", "biggest schemas by table count"],
    ),
    ...bq(
      "Show undocumented tables",
      `SELECT table_catalog, table_schema, table_name, table_type FROM ${prefix}.mdg_tables WHERE comment IS NULL OR TRIM(comment) = '' ORDER BY table_catalog, table_schema, table_name`,
      ["tables without descriptions", "missing comments", "tables with no description"],
    ),
    ...bq(
      "What data formats are used?",
      `SELECT data_source_format, COUNT(*) AS table_count FROM ${prefix}.mdg_tables WHERE data_source_format IS NOT NULL GROUP BY data_source_format ORDER BY table_count DESC`,
      ["delta vs parquet", "storage formats", "table formats"],
    ),
    ...bq(
      "Who owns the most tables?",
      `SELECT table_owner, COUNT(*) AS table_count FROM ${prefix}.mdg_tables GROUP BY table_owner ORDER BY table_count DESC LIMIT 20`,
      ["table owners", "top table owners"],
    ),
    ...bq(
      "What catalogs do we have?",
      `SELECT catalog_name, catalog_owner, comment FROM ${prefix}.mdg_catalogs ORDER BY catalog_name`,
      ["list catalogs", "show all catalogs", "available catalogs"],
    ),
  ];
}
