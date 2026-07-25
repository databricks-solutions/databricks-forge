/**
 * Builds the `serialized_space` JSON for a Genie space focused on the
 * Databricks Well-Architected Framework.
 *
 * The space points at the `system.*` tables our pillar SQL queries touch,
 * plus `system.compute.node_timeline` for CPU / memory questions. Curated
 * text instructions teach Genie the WAF mapping (e.g. "SCP-01-13 means
 * jobs running as a service principal") so users can ask questions in
 * plain language.
 */
import crypto from "crypto";
import type {
  DataSourceTable,
  ExampleQuestionSql,
  SampleQuestion,
  SerializedInstructions,
  SerializedSpace,
  TextInstruction,
} from "@/lib/genie/types";

export const WAF_GENIE_TITLE = "Forge WAF Genie";
export const WAF_GENIE_DESCRIPTION =
  "Ask questions about your Databricks workspace in WAF terms — failing controls, jobs without service principals, table comment coverage, CPU/memory utilisation. Backed by system.* tables.";

function newId(): string {
  return crypto.randomBytes(16).toString("hex");
}

const TABLES: Array<Omit<DataSourceTable, "description"> & { description: string }> = [
  {
    identifier: "system.lakeflow.jobs",
    description:
      "Latest snapshot of every job (one row per change_time). `run_as` is the principal that runs the job — UUID-shape values are service principals (SCP-01-13).",
  },
  {
    identifier: "system.lakeflow.job_run_timeline",
    description:
      "One row per job run with `trigger_type` (PERIODIC / CONTINUOUS / MANUAL) and `result_state`. Used to detect scheduled vs ad-hoc jobs (OE-02-03).",
  },
  {
    identifier: "system.lakeflow.pipelines",
    description:
      "Delta Live Tables / Lakeflow Declarative Pipelines registered in the workspace. Their presence satisfies OE-02-05.",
  },
  {
    identifier: "system.compute.clusters",
    description:
      "All-purpose and job clusters. `cluster_source = 'UI'` flags interactive clusters (cost optimisation signals).",
  },
  {
    identifier: "system.compute.warehouses",
    description:
      "SQL warehouses. `warehouse_type='PRO'` indicates a serverless-capable tier (IU-03-02).",
  },
  {
    identifier: "system.compute.warehouse_events",
    description:
      "Operational events for SQL warehouses. Presence of recent rows is a monitoring signal (OE-03-01).",
  },
  {
    identifier: "system.compute.node_timeline",
    description:
      "Per-node, per-minute CPU and memory utilisation. Columns: `cpu_user_percent`, `cpu_system_percent`, `cpu_wait_percent`, `mem_used_percent`, `driver` (boolean), `start_time`, `cluster_id`. Use for utilisation Q&A.",
  },
  {
    identifier: "system.access.audit",
    description:
      "Workspace audit log. Presence of recent rows satisfies SCP-06-01 / SCP-06-02 / DG-02-02.",
  },
  {
    identifier: "system.billing.usage",
    description:
      "DBU usage records. Joins to `system.billing.list_prices` for list-cost calculations. `usage_metadata.job_id` and `cluster_id` link back to the workloads.",
  },
  {
    identifier: "system.query.history",
    description:
      "All SQL queries executed on warehouses. `executed_by`, `total_task_duration_ms`, and `read_bytes` are useful for performance Q&A.",
  },
  {
    identifier: "system.information_schema.tables",
    description:
      "Catalog inventory. `data_source_format` (DELTA / ICEBERG / DELTASHARING), `comment` (DG-01-04), and `storage_path` (SCP-02-01 — DBFS detection).",
  },
];

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  "pt-BR": "Brazilian Portuguese",
  es: "Spanish",
};

function languageDirective(locale?: string): string {
  if (!locale) return "";
  const name = LANGUAGE_NAMES[locale] ?? locale;
  return `Respond preferentially in ${name}. Translate column names, labels, and explanatory prose into ${name} when possible; keep SQL identifiers, table names, and WAF control IDs (e.g. SCP-01-13) unchanged.\n\n`;
}

const TEXT_INSTRUCTION = `You are an assistant for the Databricks Well-Architected Framework (WAF).

WAF pillars (use these IDs when the user asks about a control by name):
  - DG  Data and AI Governance
  - IU  Interoperability and Usability
  - OE  Operational Excellence
  - SCP Security, Compliance and Privacy
  - RO  Reliability
  - PE  Performance Efficiency
  - CO  Cost Optimisation

Key control mappings to system tables:
  - SCP-01-13 (service principals for production jobs) -> system.lakeflow.jobs.run_as RLIKE '^[0-9a-f]{8}-[0-9a-f]{4}'
  - SCP-02-01 (avoid DBFS for production data)         -> system.information_schema.tables.storage_path LIKE 'dbfs:/%'
  - SCP-06-01 / SCP-06-02 / DG-02-02 (audit logging)   -> any recent rows in system.access.audit
  - OE-02-03 (scheduled vs ad-hoc jobs)                -> system.lakeflow.job_run_timeline.trigger_type LIKE 'PERIODIC%' OR LIKE 'CONTINUOUS%'
  - OE-02-05 (declarative pipelines)                   -> any rows in system.lakeflow.pipelines where delete_time IS NULL
  - OE-03-01 (warehouse monitoring)                    -> recent rows in system.compute.warehouse_events
  - IU-02-01 (open data formats)                       -> system.information_schema.tables.data_source_format IN ('DELTA','ICEBERG','DELTASHARING')
  - IU-03-02 (serverless / modern compute)             -> system.compute.warehouses.warehouse_type = 'PRO'
  - IU-04-03 (central catalog adoption)                -> system.information_schema.tables.table_catalog != 'hive_metastore'
  - DG-01-03 (lineage)                                 -> system.access.table_lineage
  - DG-01-04 (table comments)                          -> system.information_schema.tables.comment IS NOT NULL
  - DG-03-03 (Delta enforcement)                       -> data_source_format = 'DELTA'

Compute utilisation:
  - CPU and memory live in system.compute.node_timeline. cpu_user_percent + cpu_system_percent gives total CPU usage. Driver vs workers is the boolean column \`driver\`. Always default to a 30-day window (CURRENT_DATE() - INTERVAL 30 DAYS) unless the user asks otherwise.

When the user asks about a control by ID, prefer running the SQL pattern above; when they ask in business terms ("are we storing prod data in DBFS?"), translate to the matching SQL.`;

const SAMPLE_QUESTIONS: string[] = [
  "Which jobs are not running as a service principal? (SCP-01-13)",
  "How many tables are in DBFS rather than UC managed locations? (SCP-02-01)",
  "What share of tables use Delta or Iceberg? (DG-03-03 / IU-02-01)",
  "Show me the average CPU utilisation across cluster nodes for the last 30 days, split by driver vs workers.",
  "Show me the average memory utilisation across cluster nodes for the last 60 days.",
  "How many jobs have no tags? (OE-04-02 / SCP-06-05)",
  "Which catalogs and tables are still on hive_metastore? (IU-04-03)",
  "List the 10 most expensive jobs over the last 30 days using system.billing.usage.",
];

const EXAMPLE_SQLS: Array<{ question: string; sql: string }> = [
  {
    question: "Which jobs are not running as a service principal?",
    sql: `WITH latest AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY change_time DESC) AS rn
  FROM system.lakeflow.jobs
)
SELECT job_id, name, run_as
FROM latest
WHERE rn = 1
  AND delete_time IS NULL
  AND NOT (run_as RLIKE '^[0-9a-f]{8}-[0-9a-f]{4}')
ORDER BY name`,
  },
  {
    question: "Average CPU and memory utilisation per day for the last 30 days, by driver vs workers",
    sql: `SELECT
  date_trunc('day', start_time)                                AS day,
  CASE WHEN driver THEN 'driver' ELSE 'workers' END             AS node_role,
  ROUND(AVG(cpu_user_percent + cpu_system_percent), 2)          AS avg_cpu_pct,
  ROUND(AVG(mem_used_percent), 2)                               AS avg_mem_pct
FROM system.compute.node_timeline
WHERE start_time >= CURRENT_DATE() - INTERVAL 30 DAYS
GROUP BY 1, 2
ORDER BY 1, 2`,
  },
  {
    question: "Tables stored in DBFS",
    sql: `SELECT table_catalog, table_schema, table_name, storage_path
FROM system.information_schema.tables
WHERE table_type IN ('MANAGED', 'EXTERNAL')
  AND (storage_path LIKE 'dbfs:/%' OR storage_path LIKE '/dbfs/%')`,
  },
];

/**
 * Build a `SerializedSpace` ready to be passed to `createGenieSpace`.
 * The Genie API will further sanitise it (`sanitizeSerializedSpace`).
 */
export function buildWafGenieSpace(locale?: string): SerializedSpace {
  const tables: DataSourceTable[] = TABLES.map((t) => ({
    identifier: t.identifier,
    description: [t.description],
  }));

  const textInstructions: TextInstruction[] = [
    { id: newId(), content: [languageDirective(locale) + TEXT_INSTRUCTION] },
  ];

  const sampleQuestions: SampleQuestion[] = SAMPLE_QUESTIONS.map((q) => ({
    id: newId(),
    question: [q],
  }));

  const exampleSqls: ExampleQuestionSql[] = EXAMPLE_SQLS.map((e) => ({
    id: newId(),
    question: [e.question],
    sql: [e.sql],
  }));

  return {
    version: 2,
    config: { sample_questions: sampleQuestions },
    data_sources: { tables },
    instructions: {
      text_instructions: textInstructions,
      example_question_sqls: exampleSqls,
      join_specs: [],
      sql_snippets: { measures: [], filters: [], expressions: [] },
    },
  };
}

/** Return the `serialized_space` string ready for the Genie API. */
export function buildWafGenieSerializedSpace(locale?: string): string {
  return JSON.stringify(buildWafGenieSpace(locale));
}

/**
 * Merge user-curated joins, filters, measures, and expressions from an existing
 * Genie space into the freshly built one. Lets users hand-tune the WAF space in
 * the UI without losing their work on the next regenerate.
 *
 * Curated text_instructions and example_question_sqls beyond our defaults are
 * also preserved (matched by id). Our default content always wins.
 */
export function mergeWafGenieSerializedSpace(
  newSerialized: string,
  existingSerialized: string | undefined,
): string {
  if (!existingSerialized) return newSerialized;

  let next: SerializedSpace;
  let prev: Partial<SerializedSpace> & {
    instructions?: Partial<SerializedInstructions>;
  };
  try {
    next = JSON.parse(newSerialized) as SerializedSpace;
    prev = JSON.parse(existingSerialized) as SerializedSpace;
  } catch {
    return newSerialized;
  }

  const prevInstr: Partial<SerializedInstructions> = prev.instructions ?? {};
  const nextInstr = next.instructions;

  const prevJoins = Array.isArray(prevInstr.join_specs) ? prevInstr.join_specs : [];
  if (prevJoins.length > 0) nextInstr.join_specs = prevJoins;

  const prevSnippets = prevInstr.sql_snippets ?? {
    measures: [],
    filters: [],
    expressions: [],
  };
  nextInstr.sql_snippets = {
    measures:
      Array.isArray(prevSnippets.measures) && prevSnippets.measures.length > 0
        ? prevSnippets.measures
        : nextInstr.sql_snippets.measures,
    filters:
      Array.isArray(prevSnippets.filters) && prevSnippets.filters.length > 0
        ? prevSnippets.filters
        : nextInstr.sql_snippets.filters,
    expressions:
      Array.isArray(prevSnippets.expressions) && prevSnippets.expressions.length > 0
        ? prevSnippets.expressions
        : nextInstr.sql_snippets.expressions,
  };

  return JSON.stringify(next);
}
