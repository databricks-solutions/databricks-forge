/**
 * Databricks AI Functions skill.
 *
 * Distilled from:
 *   - ai-functions.md (13 AI functions, http_request, remote_query, read_files)
 *   - templates-sql-gen.ts (ai_query gotchas, cost funnel, persona embedding)
 *   - sql-rules.ts (AI use case rules)
 *
 * Covers ai_query parameter rules, cost pyramid, task-specific functions,
 * and external data access patterns.
 */

import type { SkillDefinition } from "../types";
import { registerSkill } from "../registry";

const AI_QUERY_RULES = `ai_query() Rules (CRITICAL -- many non-obvious gotchas):
- Signature: ai_query(endpoint, request, ...) where request is the user prompt string
- ONLY supported named params: modelParameters (STRUCT), responseFormat (STRING schema), failOnError (BOOLEAN)
- NEVER use systemPrompt parameter -- it does NOT exist; embed persona context via CONCAT into the request string
- failOnError => false: returns STRUCT<result:STRING, errorMessage:STRING> -- always parse with from_json(col.result, 'STRUCT<...>'), never access struct fields directly from ai_query output
- failOnError => true (default): returns STRING directly but throws on any model error
- responseFormat: top-level STRUCT must have exactly one field when requesting structured output
- For auditability, store the prompt in a column: CONCAT('You are a ', persona, '. ', task) AS ai_sys_prompt
- LIMIT usage during development: always LIMIT 1000 or less to control costs
- Prefer task-specific AI functions (ai_classify, ai_extract, etc.) over ai_query when they fit the use case`;

const COST_FUNNEL = `AI Function Cost Pyramid (filter -> block -> score -> LLM):
1. FILTER FIRST: Use standard SQL WHERE to remove irrelevant rows before any AI call
2. BLOCK: For pairwise operations, narrow candidates with deterministic joins
   - Normalize text: lower(trim(coalesce(col, '')))
   - Phonetic blocking: soundex(name) for fuzzy name matching
   - Join blocking keys + UNION candidate sets
3. SCORE: Use ai_similarity(text1, text2) for ranking (returns 0-1 similarity, much cheaper than ai_query)
4. LLM LAST: Call ai_query only on the LIMIT-ed, highest-scoring candidates
- ALWAYS apply LIMIT when using ai_query or ai_gen to control token costs
- For batch processing: process in chunks of 100-1000 rows, not entire tables`;

const TASK_FUNCTIONS = `AI Task Functions (prefer these over ai_query when applicable):
- ai_classify(content, ARRAY('label1', 'label2', ...)) -> STRING: Multi-class classification, 2-20 labels
- ai_extract(content, ARRAY('entity1', 'entity2', ...)) -> STRUCT: Named entity extraction, returns STRUCT with one field per label
- ai_analyze_sentiment(content) -> STRING: Sentiment analysis ('positive', 'negative', 'neutral', 'mixed')
- ai_similarity(text1, text2) -> DOUBLE: Semantic similarity 0-1, use for ranking not thresholding
- ai_mask(content, ARRAY('entity_type', ...)) -> STRING: PII redaction (replaces entities with [MASKED])
- ai_summarize(content, max_words => N) -> STRING: Text summarization with length control
- ai_forecast(observed => TABLE, time_col => 'col', value_col => 'col', group_col => 'col', horizon => N, frequency => 'day'|'month') -> TABLE: Time series forecasting TVF
- vector_search(index => 'catalog.schema.index', query => text_or_vector, num_results => N) -> TABLE: Vector similarity search TVF, supports ANN and HYBRID modes
- ai_parse_document(content, version => '2.0') -> STRING: Parse PDF/image content (BINARY input)
- http_request(conn => 'connection_name', method => 'POST', path => '/endpoint', json => to_json(struct)) -> STRUCT: Call external APIs via SQL (requires CONNECTION object)
- remote_query('connection_name', database => 'db', query => 'SELECT ...') -> TABLE: Lakehouse Federation read-only query
- read_files(path, format => 'json'|'csv'|'parquet', schemaHints => '...') -> TABLE: Ingest files from Volumes`;

const skill: SkillDefinition = {
  id: "databricks-ai-functions",
  name: "Databricks AI Functions",
  description:
    "ai_query parameter rules, cost pyramid (filter->block->score->LLM), " +
    "13+ task-specific AI functions, http_request, remote_query, and read_files patterns.",
  relevance: {
    intents: ["technical"],
    geniePasses: ["trustedAssets", "semanticExpressions"],
    pipelineSteps: ["sql-generation"],
  },
  chunks: [
    {
      id: "ai-query-rules",
      title: "ai_query() Rules",
      content: AI_QUERY_RULES,
      category: "rules",
    },
    {
      id: "ai-cost-funnel",
      title: "AI Function Cost Pyramid",
      content: COST_FUNNEL,
      category: "rules",
    },
    {
      id: "ai-task-functions",
      title: "AI Task Functions Reference",
      content: TASK_FUNCTIONS,
      category: "vocabulary",
    },
  ],
};

registerSkill(skill);

export default skill;
