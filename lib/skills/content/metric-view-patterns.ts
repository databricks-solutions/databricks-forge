/**
 * Metric View Patterns skill.
 *
 * Distilled from databricks-metric-views skill:
 *   - yaml-reference.md (full YAML spec, dimensions, measures, joins, materialization)
 *   - patterns.md (ratio measures, filtered measures, window measures)
 *
 * Provides the YAML specification and patterns needed for metric view
 * proposals and semantic expression generation.
 */

import type { SkillDefinition } from "../types";
import { registerSkill } from "../registry";

const YAML_REFERENCE = `Metric View YAML Specification (version 1.1, DBR 17.2+):

Top-level fields:
  version: "1.1"
  source: catalog.schema.table (fully qualified)
  comment: "Description of the metric view"
  filter: SQL boolean expression (global WHERE clause)
  dimensions: list of dimension definitions
  measures: list of measure definitions
  joins: star/snowflake join definitions (optional)
  materialization: pre-computation config (optional, experimental)

Dimensions:
  - name: Display name (backtick-quoted in queries if spaces)
    expr: SQL expression (column reference, DATE_TRUNC, CASE WHEN, etc.)
    comment: Optional description
  - Can reference source columns, SQL functions, other dimensions, and joined table columns (join_name.column)
  - Cannot use aggregate functions (those belong in measures)

Measures:
  - name: Display name (queried via MEASURE(\`name\`) AS name)
    expr: Aggregate expression (SUM, COUNT, AVG, MIN, MAX, COUNT DISTINCT)
    comment: Optional description
  - Ratio: SUM(a) / COUNT(DISTINCT b)
  - Filtered: SUM(x) FILTER (WHERE status = 'active')
  - Filtered ratio: SUM(x) FILTER (WHERE ...) / COUNT(DISTINCT y) FILTER (WHERE ...)

Window Measures (experimental):
  - name: Running Total
    expr: SUM(total_price)
    window:
      - order: date_dimension_name
        range: cumulative | trailing N day | leading N day | current | all
        semiadditive: first | last (value when order dim absent from GROUP BY)
  - trailing 7 day = 7 days BEFORE current, EXCLUDING current day
  - Derived measures can reference window measures: MEASURE(current_day) - MEASURE(previous_day)

Joins (star schema):
  joins:
    - name: alias_name
      source: catalog.schema.dim_table
      on: source.fk_col = alias_name.pk_col
  - Snowflake (nested, DBR 17.1+): nest joins inside join definitions
  - Use either "on" (expression) or "using" (column list), not both
  - Reference joined columns as: join_name.column_name

Materialization (experimental):
  materialization:
    schedule: every 6 hours
    mode: relaxed
    materialized_views:
      - name: baseline
        type: unaggregated (full data model)
      - name: summary
        type: aggregated
        dimensions: [dim1, dim2]
        measures: [measure1, measure2]`;

const QUERY_RULES = `Metric View Query Rules (CRITICAL):
- ALL measure columns MUST be wrapped in MEASURE(): MEASURE(total_revenue) AS total_revenue
- Every MEASURE() call MUST have an explicit AS alias
- NEVER prefix measure columns with a table alias (use MEASURE(col), NOT alias.col)
- Dimension columns are referenced by bare name (no MEASURE() wrapper)
- Always include GROUP BY ALL or explicit GROUP BY on dimension columns
- NEVER use SELECT * on a metric view (not supported)
- CORRECT: SELECT month, MEASURE(total_revenue) AS total_revenue FROM mv GROUP BY ALL
- WRONG:  SELECT tam.total_revenue FROM mv AS tam`;

const MEASURE_PATTERNS = `Common Metric View Measure Patterns:
- Simple aggregate: SUM(amount), COUNT(1), AVG(price), COUNT(DISTINCT customer_id)
- Ratio (safe re-aggregation): SUM(revenue) / COUNT(DISTINCT customer_id)
- Filtered measure: COUNT(1) FILTER (WHERE status = 'completed')
- Filtered ratio: SUM(amount) FILTER (WHERE type = 'sale') / COUNT(DISTINCT order_id) FILTER (WHERE type = 'sale')
- Year-to-date: SUM(revenue) with window [order: date, range: cumulative] + [order: year, range: current]
- Rolling window: COUNT(DISTINCT customer_id) with window [order: date, range: trailing 7 day, semiadditive: last]
- Day-over-day growth: (MEASURE(current_day) - MEASURE(previous_day)) / MEASURE(previous_day) * 100`;

const DIMENSION_PATTERNS = `Common Metric View Dimension Patterns:
- Direct column: expr: region_name
- Time truncation: expr: DATE_TRUNC('MONTH', order_date)
- Year extraction: expr: EXTRACT(YEAR FROM order_date)
- Bucketing: expr: CASE WHEN amount > 1000 THEN 'High' WHEN amount > 100 THEN 'Medium' ELSE 'Low' END
- Joined column: expr: customer.segment (from join named "customer")
- Boolean flag: expr: CASE WHEN return_date IS NOT NULL THEN 'Returned' ELSE 'Kept' END`;

const JOIN_PATTERNS = `Metric View Join Patterns:
- Star schema join: joins: [{name: dim_customer, source: catalog.schema.dim_customer, on: source.customer_id = dim_customer.customer_id}]
- Snowflake (nested joins under parent, DBR 17.1+): joins under a parent join definition inherit the parent's source
- Parent-chain column references: customer.nation.n_name traverses customer join -> nation sub-join
- Join alias MUST NOT match any source column name (use _dim suffix if collision: customer_dim)
- Dimension name MUST NOT match join alias (causes ambiguous resolution)
- Use either "on" (expression) or "using" (column list) in a join, NEVER both
- Reference joined columns as: join_name.column_name (e.g. customer.segment)`;

const MV_GOTCHAS = `Metric View Gotchas (AVOID these):
- Measure name shadowing a source column: triggers NESTED_AGGREGATE_FUNCTION error (rename the measure)
- OVER / window functions in measure expr: not supported (use window: block instead)
- AI functions (ai_query, ai_classify) in measure/dimension expr: not supported
- MEDIAN() in measure expr: not available -- use PERCENTILE_APPROX(col, 0.5) instead
- Bare column in expr: use just the column name (amount), NOT the FQN (catalog.schema.table.amount)
- Materialization view names must match declared measure/dimension names exactly
- Backtick-quote dimension and measure names that contain spaces: MEASURE(\`Total Revenue\`) AS total_revenue
- SELECT * on a metric view: NOT supported -- must explicitly list dimensions and MEASURE() calls
- JOIN at query time: NOT supported -- all joins must be defined in the YAML, not the SELECT`;

const WINDOW_EXAMPLES = `Metric View Window Measure Examples:
- YTD Revenue:
    name: YTD Revenue
    expr: SUM(revenue)
    window:
      - order: Order Month
        range: cumulative
      - order: Order Year
        range: current
- Rolling 7-Day Active Users:
    name: Rolling 7-Day Users
    expr: COUNT(DISTINCT user_id)
    window:
      - order: Activity Date
        range: trailing 7 day
        semiadditive: last
- Period-over-Period (derived from window measures):
    name: MoM Growth
    expr: (MEASURE(Current Month Revenue) - MEASURE(Previous Month Revenue)) / MEASURE(Previous Month Revenue) * 100`;

const BEST_PRACTICES = `Metric View Best Practices:
- Start with atomic measures (SUM, COUNT, AVG), then build complex KPIs using MEASURE() composability
- Composability: reference other measures via MEASURE(other_measure) instead of duplicating SQL logic
  Example: Revenue per Order = MEASURE(Total Revenue) / MEASURE(Order Count)
- Model business-friendly dimensions: use CASE, DATE_TRUNC, etc. to turn cryptic codes into clear labels
- Be intentional with the global filter: scope KPIs consistently (e.g. exclude test data, old records)
- Use joins to model star/snowflake schemas: fact table as source, dimension tables via joins
- Leverage window measures for moving averages, running totals, period-over-period (avoid reimplementing in each query)
- Use metric views as the semantic layer for AI/BI and Genie: enforce consistent KPIs, stay within Genie table limits
- Manage governance via Unity Catalog: register metric views in UC, use group ownership for collaborative editing`;

const SEMANTIC_METADATA = `Metric View Semantic Metadata (for Genie and AI/BI discoverability):
- comment: on measures and dimensions, describe the business meaning concisely
  Example: comment: "Net revenue after refunds and discounts"
- format: on measures, specify display format for dashboards and Genie
  Supported: "percent", "currency", "number", "decimal(N)"
  Example: format: "currency"
- synonyms: on dimensions, list alternative names for Genie natural language matching
  Example: synonyms: ["region", "territory", "geo"]
- display_name: on measures/dimensions, human-friendly label if the name field uses snake_case
  Example: display_name: "Total Revenue"`;

const VALIDATION_RULES = `Metric View YAML Validation Rules (SQL Ref Spec):
- Measure expr MUST contain an aggregate function (SUM, COUNT, AVG, MIN, MAX, COUNT DISTINCT, PERCENTILE_APPROX)
- Measure expr MUST NOT contain: JOIN, GROUP BY, HAVING, QUALIFY, ORDER BY, LIMIT
- Measure expr MUST NOT contain window functions (OVER clause) -- use the window: block instead
- Dimension expr MUST NOT contain aggregate functions
- source: MUST be a fully qualified three-part name (catalog.schema.table)
- Join source: MUST be a fully qualified three-part name
- Join alias MUST NOT collide with any source column name
- Dimension name MUST NOT collide with any join alias
- Measure name MUST NOT shadow a source column name (causes NESTED_AGGREGATE_FUNCTION)
- All joined column references must use the form: join_alias.column_name
- MEASURE() composability: derived measures referencing MEASURE(other) must still wrap in an aggregate context
- format: values must be one of: "percent", "currency", "number", or "decimal(N)"
- version: must be "1.1" (string, not numeric 1.1)`;

const skill: SkillDefinition = {
  id: "metric-view-patterns",
  name: "Metric View YAML Patterns",
  description:
    "Unity Catalog metric view YAML specification, best practices, " +
    "measure patterns (ratio, filtered, window, composable), dimension patterns, " +
    "join definitions, semantic metadata (format, synonyms, comments), " +
    "gotchas, validation rules, and query rules (MEASURE(), GROUP BY ALL).",
  relevance: {
    intents: ["dashboard", "technical"],
    geniePasses: ["metricViews", "semanticExpressions"],
    pipelineSteps: ["sql-generation"],
  },
  chunks: [
    {
      id: "mv-yaml-reference",
      title: "Metric View YAML Reference",
      content: YAML_REFERENCE,
      category: "patterns",
      maxCharBudget: 2500,
    },
    {
      id: "mv-best-practices",
      title: "Metric View Best Practices",
      content: BEST_PRACTICES,
      category: "patterns",
    },
    {
      id: "mv-query-rules",
      title: "Metric View Query Rules",
      content: QUERY_RULES,
      category: "rules",
    },
    {
      id: "mv-measure-patterns",
      title: "Measure Patterns",
      content: MEASURE_PATTERNS,
      category: "patterns",
    },
    {
      id: "mv-dimension-patterns",
      title: "Dimension Patterns",
      content: DIMENSION_PATTERNS,
      category: "patterns",
    },
    {
      id: "mv-join-patterns",
      title: "Join Patterns",
      content: JOIN_PATTERNS,
      category: "patterns",
    },
    {
      id: "mv-semantic-metadata",
      title: "Semantic Metadata for Genie",
      content: SEMANTIC_METADATA,
      category: "patterns",
    },
    {
      id: "mv-gotchas",
      title: "Metric View Gotchas",
      content: MV_GOTCHAS,
      category: "anti-patterns",
    },
    {
      id: "mv-window-examples",
      title: "Window Measure Examples",
      content: WINDOW_EXAMPLES,
      category: "examples",
    },
    {
      id: "mv-validation-rules",
      title: "Validation Rules (SQL Ref Spec)",
      content: VALIDATION_RULES,
      category: "rules",
    },
  ],
};

registerSkill(skill);

export default skill;
