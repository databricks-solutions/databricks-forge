/**
 * Allowlist of legal field paths in a `SerializedSpace` v2 payload.
 *
 * Mirrors upstream `_VALID_FIELDS` from databricks-genie-workbench
 * (`backend/services/fix_agent.py`). Used by space-fixer / fix agent code
 * to validate any patch destination *before* attempting to apply it,
 * which stops a malformed LLM patch from creating an unrecognized
 * field that would later cause a confusing API error.
 *
 * The allowlist is conservative: only paths the engine actually writes
 * to are included. Add new entries when introducing new pass output
 * locations.
 */

const RAW_VALID_PATHS: ReadonlyArray<string> = [
  // Top-level
  "title",
  "description",
  "version",

  // Config
  "config.sample_questions",
  "config.sample_questions[].id",
  "config.sample_questions[].question",

  // Data sources
  "data_sources.tables",
  "data_sources.tables[].identifier",
  "data_sources.tables[].description",
  "data_sources.tables[].column_configs",
  "data_sources.tables[].column_configs[].column_name",
  "data_sources.tables[].column_configs[].description",
  "data_sources.tables[].column_configs[].synonyms",
  "data_sources.tables[].column_configs[].enable_entity_matching",
  "data_sources.tables[].column_configs[].enable_format_assistance",
  "data_sources.metric_views",
  "data_sources.metric_views[].identifier",
  "data_sources.metric_views[].description",
  "data_sources.metric_views[].column_configs",

  // Instructions
  "instructions.text_instructions",
  "instructions.text_instructions[].id",
  "instructions.text_instructions[].content",
  "instructions.example_question_sqls",
  "instructions.example_question_sqls[].id",
  "instructions.example_question_sqls[].question",
  "instructions.example_question_sqls[].sql",
  "instructions.example_question_sqls[].usage_guidance",
  "instructions.join_specs",
  "instructions.join_specs[].id",
  "instructions.join_specs[].left",
  "instructions.join_specs[].left.identifier",
  "instructions.join_specs[].left.alias",
  "instructions.join_specs[].right",
  "instructions.join_specs[].right.identifier",
  "instructions.join_specs[].right.alias",
  "instructions.join_specs[].sql",
  "instructions.join_specs[].comment",
  "instructions.join_specs[].relationship_type",
  "instructions.sql_snippets.measures",
  "instructions.sql_snippets.measures[].id",
  "instructions.sql_snippets.measures[].alias",
  "instructions.sql_snippets.measures[].sql",
  "instructions.sql_snippets.measures[].synonyms",
  "instructions.sql_snippets.measures[].display_name",
  "instructions.sql_snippets.measures[].comment",
  "instructions.sql_snippets.filters",
  "instructions.sql_snippets.filters[].id",
  "instructions.sql_snippets.filters[].sql",
  "instructions.sql_snippets.filters[].display_name",
  "instructions.sql_snippets.filters[].synonyms",
  "instructions.sql_snippets.filters[].comment",
  "instructions.sql_snippets.expressions",
  "instructions.sql_snippets.expressions[].id",
  "instructions.sql_snippets.expressions[].alias",
  "instructions.sql_snippets.expressions[].sql",
  "instructions.sql_snippets.expressions[].synonyms",
  "instructions.sql_snippets.expressions[].display_name",
  "instructions.sql_snippets.expressions[].instruction",

  // Benchmarks
  "benchmarks.questions",
  "benchmarks.questions[].id",
  "benchmarks.questions[].question",
  "benchmarks.questions[].answer",
  "benchmarks.questions[].answer[].format",
  "benchmarks.questions[].answer[].content",
];

const VALID_FIELD_PATHS: Set<string> = new Set(RAW_VALID_PATHS);

/**
 * Return true if `path` is a legal serialized-space field destination.
 *
 * Accepts paths in our internal `[]`-style notation, e.g.
 *   `data_sources.tables[].column_configs[].synonyms`.
 *
 * Numeric array indices (e.g. `[0]`) are normalized to `[]` before lookup so
 * a fix agent can target a specific item by index without needing a separate
 * registry entry.
 */
export function validateFieldPath(path: string): boolean {
  if (!path || typeof path !== "string") return false;
  const normalized = path.replace(/\[\d+\]/g, "[]");
  return VALID_FIELD_PATHS.has(normalized);
}

/** Return the underlying allowlist as a frozen array (for diagnostics/tests). */
export function listValidFieldPaths(): ReadonlyArray<string> {
  return RAW_VALID_PATHS;
}
