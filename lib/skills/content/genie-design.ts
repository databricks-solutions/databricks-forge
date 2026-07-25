/**
 * Genie Space Design skill.
 *
 * Distilled from:
 *   - External databricks-genie skill (spaces.md, SKILL.md)
 *   - passes/semantic-expressions.ts (snippet rules, expression constraints)
 *   - assembler.ts (join SQL rewriting, alias handling, relationship types)
 *   - time-periods.ts (date filters, fiscal calendars, auto-dimensions)
 *   - passes/trusted-assets.ts (question style, SQL preservation rules)
 *   - passes/instruction-generation.ts (banned patterns, character limits)
 *   - passes/example-query-generation.ts (question complexity tiers)
 *
 * Covers table selection, descriptions, sample questions, snippet expression
 * rules, join inference patterns, date filter patterns, question style, and
 * instruction anti-patterns.
 */

import type { SkillDefinition } from "../types";
import { registerSkill } from "../registry";

const TABLE_SELECTION_RULES = `Genie Table Selection Rules:
- Use Silver or Gold layer tables; avoid Bronze (raw data has quality issues that confuse Genie)
- Include related tables together (e.g. customers + orders + products) for join coverage
- Use tables with descriptive column names (customer_lifetime_value not clv)
- Ensure tables have COMMENT metadata on both tables and key columns
- Define PRIMARY KEY and FOREIGN KEY constraints for relationship discovery
- Include proper DATE/TIMESTAMP columns for time-based queries
- Prefer tables with low null rates on important columns
- Maximum 30 data objects per space (tables + views + metric views)`;

const DESCRIPTION_PATTERNS = `Genie Space Description Patterns:
- Explain table relationships and join logic (e.g. "Tables join on customer_id and product_id")
- List key columns by role: date columns for time filters, metric columns for aggregation, dimension columns for grouping, FK columns for joins
- Describe the business context and data time range (e.g. "Last 6 months of e-commerce transactions")
- Include the grain of each table (e.g. "One row per order line item")
- Mention any important filters or caveats (e.g. "Only active customers, excludes test accounts")`;

const SNIPPET_RULES = `Genie Knowledge Store Expression Rules (CRITICAL):
- Expressions MUST be SHORT: under 200 characters, single aggregate or simple CASE WHEN
- GOOD expressions: SUM(CAST(amount AS DECIMAL(18,2))), COUNT(DISTINCT customer_id), status = 'active', DATE_TRUNC('month', order_date)
- BAD expressions (REJECT these):
  - Window functions (anything with OVER clause)
  - Statistical functions: REGR_SLOPE, REGR_R2, CORR, STDDEV, SKEWNESS, KURTOSIS, CUME_DIST
  - PERCENTILE_APPROX in measure expressions (too complex for snippets)
  - Nested subqueries (SELECT inside SELECT)
  - Chained multi-step functions (function of function of function)
- Maximum 12 snippets per category (measures, dimensions, filters)
- Maximum 500 characters per snippet description
- Snippet SQL must reference ONLY columns that exist in the space's tables`;

const JOIN_PATTERNS = `Genie Join Inference Patterns:
- Join SQL uses alias-based references with backtick quoting: \`alias\`.\`column\`
- Relationship type encoding via SQL comment: --rt=FROM_RELATIONSHIP_TYPE_ONE_TO_MANY
- FK discovery: match key synonym groups (customer_id, cust_id, customerid, customer_key all map to the same entity)
- Alias collision: if right alias equals left alias, append _2 to the right alias
- Cardinality hints: 1:1, 1:N, N:1, N:M -- derive from PK/FK constraints and column uniqueness
- Join type: default to LEFT JOIN for dimension lookups, INNER JOIN only when both sides required
- Maximum join depth: avoid chains longer than 3 hops (performance degrades)`;

const DATE_FILTER_PATTERNS = `Genie Date Filter & Dimension Patterns:
- Primary date columns: created_at, order_date, transaction_date, event_date, updated_at
- Auto-generated filters: Last 7 days, Last 30 days, Last 90 days, MTD, QTD, YTD, Last Fiscal Year
- Auto-generated dimensions: Month (DATE_TRUNC('MONTH', col)), Quarter, Year, Day of Week (DAYOFWEEK)
- Fiscal calendar SQL: MAKE_DATE(YEAR(date_col) + CASE WHEN MONTH(date_col) >= fiscal_start THEN 0 ELSE -1 END, fiscal_start, 1)
- MTD filter: date_col >= DATE_TRUNC('MONTH', CURRENT_DATE()) AND date_col < CURRENT_DATE()
- YTD filter: date_col >= DATE_TRUNC('YEAR', CURRENT_DATE()) AND date_col < CURRENT_DATE()
- Identifier quoting: use backtick quoting for columns with non-word characters`;

const QUESTION_STYLE = `Genie Sample Question Style Guidelines:
- Simple questions (<10 words): no column names, no SQL jargon. "What were total sales last month?"
- Medium questions (<15 words): business concepts, light context. "Show top 10 customers by revenue this quarter"
- Complex/analytical: can reference joins, comparisons. "Compare average order value by region year over year"
- NEVER reference PII columns (email, phone, ssn, address, date_of_birth) in sample questions
- Reference actual column names from the schema to help Genie learn the data vocabulary
- Cover common analytical patterns: time-based, comparison, top-N, aggregation, trend
- Maximum 8 SQL example queries per space, maximum 4000 characters per example`;

const INSTRUCTION_ANTI_PATTERNS = `Genie Instruction Anti-Patterns (BANNED content):
- "sample dataset" or "dataset simulates" -- implies fake data, undermines trust
- "synthetically curated" or "artificially generated" -- same problem
- "suitable for any Databricks workload" -- generic marketing, not useful
- "building data pipelines" or platform feature pitches -- not analyst instructions
- SQL syntax lessons in text instructions -- teach SQL via example queries and knowledge store instead
- Overly long instructions -- keep total under 3000 characters for optimal Genie performance
- Generic instructions that don't reference specific tables, columns, or business rules
- Instructions that contradict the knowledge store expressions`;

const BEST_PRACTICES = `Genie Space Best Practices (Priority Order):
1. SQL over Text: Prioritize SQL-based teaching (measures, filters, example queries, benchmarks) over text instructions. Genie learns patterns from SQL far more effectively than prose.
2. Entity Matching: Enable entity matching on bounded-cardinality string columns (status, category, region) so Genie can match user terms to stored values. Key for columns where users say "active" but data stores "ACTIVE".
3. Benchmark-Driven Quality: Always include 5-20 benchmark questions with expected SQL. These are the ground truth for measuring and improving space quality.
4. Join Coverage: Every table in the space must participate in at least one join (except single-table spaces). Unjoined tables cause cross-table queries to fail silently.
5. Synonym Precision: Column synonyms must be unambiguous. A synonym should map to exactly one column. Remove synonyms that match other column names.
6. Instruction Economy: Text instructions should be concise (under 3000 chars), specific (reference actual columns/tables), and operational (disambiguation rules, time conventions, business rules). Not marketing copy.
7. Measure Quality: Measures should use proper types (DECIMAL for money, not DOUBLE), explicit aggregation (SUM, COUNT, AVG), and FILTER clauses for conditional metrics. No window functions in measures.
8. Time Awareness: Include at least one time-based filter and one time dimension for every date column. Users expect "last month", "this quarter", "year over year".
9. Schema Grounding: All generated SQL must reference only columns that exist in the space. Hallucinated identifiers cause silent failures.
10. Iterative Improvement: Use benchmark scoring → failure analysis → targeted fixes → re-score loop. Single-pass generation is never sufficient for production quality.`;

const SAMPLE_QUESTION_PATTERNS = `Genie Sample Question Best Practices:
- Reference actual column names from the schema (helps Genie learn the data vocabulary)
- Cover the most common analytical use cases the space supports
- Use natural language, not SQL terms (say "top 10 customers by revenue" not "SELECT ... ORDER BY ... LIMIT 10")
- Include time-based questions ("last month", "Q4", "year over year")
- Include comparison questions ("by region", "by segment", "by category")
- Include top-N questions ("top 10", "bottom 5", "highest", "lowest")
- Include aggregation questions ("total", "average", "count of distinct")`;

const skill: SkillDefinition = {
  id: "genie-design",
  name: "Genie Space Design Patterns",
  description:
    "Table selection, descriptions, snippet expression rules, join inference, " +
    "date filter patterns, question style, and instruction anti-patterns for " +
    "high-quality Databricks Genie Spaces.",
  relevance: {
    intents: ["business"],
    geniePasses: [
      "instructions",
      "benchmarks",
      "columnIntelligence",
      "semanticExpressions",
      "exampleQueries",
      "joinInference",
    ],
  },
  chunks: [
    {
      id: "genie-table-selection",
      title: "Table Selection Rules",
      content: TABLE_SELECTION_RULES,
      category: "rules",
    },
    {
      id: "genie-descriptions",
      title: "Description Patterns",
      content: DESCRIPTION_PATTERNS,
      category: "patterns",
    },
    {
      id: "genie-snippet-rules",
      title: "Knowledge Store Expression Rules",
      content: SNIPPET_RULES,
      category: "rules",
    },
    {
      id: "genie-join-patterns",
      title: "Join Inference Patterns",
      content: JOIN_PATTERNS,
      category: "patterns",
    },
    {
      id: "genie-date-filters",
      title: "Date Filter & Dimension Patterns",
      content: DATE_FILTER_PATTERNS,
      category: "patterns",
    },
    {
      id: "genie-question-style",
      title: "Sample Question Style",
      content: QUESTION_STYLE,
      category: "patterns",
    },
    {
      id: "genie-sample-questions",
      title: "Sample Question Best Practices",
      content: SAMPLE_QUESTION_PATTERNS,
      category: "patterns",
    },
    {
      id: "genie-instruction-anti-patterns",
      title: "Instruction Anti-Patterns",
      content: INSTRUCTION_ANTI_PATTERNS,
      category: "anti-patterns",
    },
    {
      id: "genie-best-practices",
      title: "Genie Space Best Practices",
      content: BEST_PRACTICES,
      category: "rules",
    },
  ],
};

registerSkill(skill);

export default skill;
