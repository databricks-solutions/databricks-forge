/**
 * Prompt templates for the Data Engine.
 *
 * Covers narrative design, schema design, seed SQL, and fact SQL
 * generation passes.
 */

import { DATABRICKS_SQL_RULES_COMPACT } from "@/lib/ai/sql-rules";

/**
 * Shared "DATA RECENCY" block injected into every data-generation prompt.
 *
 * The Data Engine computes a single `DemoDateWindow` per run (see
 * `lib/demo/data-engine/date-window.ts`) and threads it through every pass.
 * This block makes the window a hard, non-negotiable constraint for the LLM.
 *
 * Placeholders: {start_date}, {end_date}, {fy_label}, {date_range_days}
 */
export const DATA_RECENCY_BLOCK = `
# DATA RECENCY (CRITICAL -- non-negotiable)
All dates and timestamps in this table MUST land inside:
  start: DATE '{start_date}' (start of {fy_label})
  end:   CURRENT_DATE() (today, approx. {end_date})
  span:  {date_range_days} days

HARD RULES:
- NEVER hardcode a year literal (no DATE '2024-...', no DATE '2025-...').
- ALWAYS derive dates from CURRENT_DATE() using DATE_SUB / DATE_ADD / make_interval.
- For a random date inside the window, use:
    DATE_SUB(CURRENT_DATE(), CAST(RAND() * {date_range_days} AS INT))
- For fact tables, bias the distribution toward the most recent 90 days
  (roughly 40% of rows in the last 90 days, 60% spread across the rest of the window)
  so "current state" questions have fresh data to answer.
- For seed / dimension tables with a created_at / updated_at, place those
  timestamps anywhere inside the window (uniform is fine for reference data).
`;

/** SQL constraints for demo data generation to avoid Databricks rejection. */
export const DEMO_DATA_SQL_CONSTRAINTS = `
# CRITICAL DATABRICKS SQL CONSTRAINTS FOR DATA GENERATION

## Random & Deterministic Values
- NEVER pass a column or expression as a rand() seed: rand(col) is INVALID.
  Use rand() with NO arguments for random values.
  For deterministic bucketing per row, use: abs(hash(col_name)) % N

## Explode
- NEVER nest explode() inside CAST or any expression.
  CORRECT:  SELECT explode(sequence(1, N)) AS seq_id
  WRONG:    SELECT CAST(explode(sequence(1, N)) AS BIGINT)

## Intervals & Timestamps (CRITICAL -- most common error)
- NEVER use INTERVAL with CAST or expressions.
  WRONG:    + INTERVAL CAST(expr AS INT) HOURS
  CORRECT:  + make_interval(0, 0, 0, 0, CAST(expr AS INT), 0, 0)
  CORRECT:  + (CAST(expr AS INT) * INTERVAL '1' HOUR)
- NEVER add make_interval() or any time-component INTERVAL to a DATE value.
  Databricks throws INVALID_INTERVAL_WITH_MICROSECONDS_ADDITION.
  WRONG:    date_col + make_interval(0, 0, 0, 0, hours, mins, secs)
  WRONG:    DATE_SUB(CURRENT_DATE(), 30) + make_interval(0, 0, 0, 0, 8, 30, 0)
  WRONG:    date_sub(current_date(), N) + make_interval(...)
  CORRECT:  CAST(date_col AS TIMESTAMP) + make_interval(0, 0, 0, 0, hours, mins, secs)
  CORRECT:  CAST(DATE_SUB(CURRENT_DATE(), 30) AS TIMESTAMP) + make_interval(0, 0, 0, 0, 8, 30, 0)
  Always CAST to TIMESTAMP before adding any interval with hour/minute/second components.
  For created_at/updated_at columns, use this pattern:
    CAST(CAST(some_date AS TIMESTAMP) + make_interval(0,0,0,0,h,m,s) AS TIMESTAMP)

## Array Lookups (CRITICAL -- use get() not element_at())
- NEVER use element_at() for FK dimension lookups -- it throws INVALID_ARRAY_INDEX on empty arrays.
  WRONG:    element_at(arr, (abs(hash(col)) % size(arr)) + 1)
  CORRECT:  get(arr, pmod(abs(hash(col)), GREATEST(size(arr), 1)))
  get() returns NULL for out-of-bounds instead of throwing.

## Division & Modulo Safety
- NEVER use modulo (%) where divisor could be zero.
  WRONG:    hash(col) % size(arr)
  CORRECT:  pmod(abs(hash(col)), GREATEST(size(arr), 1))

## Integer Overflow
- When multiplying hash() values or large integers, CAST to BIGINT first.
  WRONG:    hash(col1) * hash(col2)
  CORRECT:  CAST(hash(col1) AS BIGINT) * CAST(hash(col2) AS BIGINT)
  Also use abs() around hash() to avoid negative overflow: abs(hash(col))

## Self-References
- NEVER generate SQL that references its own output table in a CTE or subquery.
  The table being created does NOT exist yet -- you cannot SELECT from it.

## CTE Column Scoping
- When a CTE aliases a column (e.g., CAST(seq_id AS BIGINT) AS product_id),
  the original name (seq_id) is NOT available in later CTEs or the final SELECT.
  You MUST use the new alias (product_id) everywhere downstream.
- If you need the original value in later CTEs, keep it as a separate column
  or do not rename it in the earlier CTE.

## CTAS Format
- Use a SINGLE CREATE OR REPLACE TABLE ... AS SELECT statement.
  NEVER follow with INSERT INTO -- all data must come from the SELECT.
- Use fully qualified backtick-quoted names: \`catalog\`.\`schema\`.\`table\`
- Fact tables MUST ONLY reference dimension tables, never other fact tables.
- Include COMMENT on the CREATE TABLE: CREATE OR REPLACE TABLE ... COMMENT 'description' AS SELECT ...

## Date/Calendar Dimension Tables
- NEVER hardcode a year literal such as DATE '2024-01-01'. All date generation
  MUST be relative to CURRENT_DATE() so the demo stays fresh over time.
- For a rolling calendar that ends today and spans {date_range_days} days, use:
    DATE_ADD(DATE_SUB(CURRENT_DATE(), {date_range_days} - 1), seq_id - 1)
- Derive date parts using built-in functions: YEAR(), MONTH(), DAY(), QUARTER(),
  DAYOFWEEK(), WEEKOFYEAR(), DAYOFYEAR(). Use DATE_FORMAT() ONLY with these safe
  patterns: 'yyyy', 'MM', 'dd', 'HH', 'mm', 'ss', 'E', 'EEEE', 'MMM', 'MMMM'.
  NEVER use 'u', 'e', 'c', or 'L' in DATE_FORMAT -- Spark does NOT support them.
`;

// ---------------------------------------------------------------------------
// Genie Mode bias blocks
// ---------------------------------------------------------------------------
// When Genie Mode is on, these blocks are substituted into the `{genie_bias}`
// placeholder of each prompt to steer the LLM toward a richer, Genie-Space-
// optimal schema + dataset. When Genie Mode is off, the placeholder is
// replaced with an empty string.

/** Narrative-design bias: more stories, each tied to concrete Genie questions. */
export const GENIE_NARRATIVE_BIAS = `
# GENIE MODE (ACTIVE)
This dataset will power a Databricks Genie Space demo for a business-user audience.
Design 5-8 narratives (not 3-5). Each narrative MUST:
- Name 2-4 concrete business questions a Genie user would realistically ask
  (e.g. "Which regions saw the biggest revenue spike last quarter?",
  "What is the average ticket size by channel this year?").
- Create a pattern that is clearly VISIBLE in a simple GROUP BY / aggregate
  query -- no subtle sub-percent shifts.
- Spread across at least two fact tables so Genie has to JOIN across domains
  to answer cleanly.
`;

/** Schema-design bias: more tables, star schema discipline, Genie-friendly columns. */
export const GENIE_SCHEMA_BIAS = `
# GENIE MODE OVERRIDES (HIGHEST PRIORITY -- supersede any earlier table count above)
This schema will back a Databricks Genie Space demo, so it must be RICHER than
a LEAN demo model. Override the "8-12 tables" rule and apply these instead:

## Counts
- Design 12-18 tables TOTAL: 6-9 dimension tables + 4-6 fact tables.
- AT LEAST 2 fact tables. Prefer 3+ so Genie can demonstrate joins across
  transaction domains (e.g. orders + shipments + returns, claims + policies,
  loans + payments).

## Star schema discipline
- INCLUDE at least one role-playing or bridge dimension (e.g. a customer dim
  referenced as both "customer" and "referring_customer"; a date dim
  referenced as both "order_date" and "ship_date").
- Every fact MUST have:
  - >= 1 DATE or TIMESTAMP column (for time-based Genie queries).
  - >= 3 numeric measure columns (DOUBLE/DECIMAL/BIGINT) with business meaning.
  - >= 3 FK columns to distinct dimension tables (for GROUP BY drill-downs).
- Every dimension MUST have:
  - >= 1 low-cardinality categorical STRING column (10-50 distinct values)
    that Genie can use for GROUP BY slicing.
  - >= 1 descriptive text / name column.
  - Hierarchy columns where natural (region -> country, category -> subcategory,
    segment -> tier) so Genie can drill down.

## Geography + identity
- Customer/location/site dimensions MUST include explicit geography columns
  (country, region, state_province, city, postcode) so Genie can answer
  "by region" / "by country" questions without inference.
- Every table keeps a primary key named \`<table>_id\`.
- Every FK column MUST be named \`<target_table>_id\` (e.g.
  \`customer_id\`, \`product_id\`). This is non-negotiable -- Forge's
  deterministic FK inference relies on this pattern.

## Narrative coverage
- Every narrative in DATA NARRATIVES must touch at least one fact table in
  this schema. No orphan narratives.
`;

/** Seed-generation bias: richer categorical distributions for Genie entity matching. */
export const GENIE_SEED_BIAS = `
# GENIE MODE
This table will be queried by a Databricks Genie Space. Populate categorical
STRING columns with stable, human-readable values (NOT placeholder codes) --
Genie's entity matcher keys off sample values, so realism directly improves
answer quality:
- Names, locations, categories, segments: use real-looking values drawn from
  the customer's nomenclature (e.g. "Enterprise", "Mid-Market", "SMB" for
  segment; "North America", "EMEA", "APAC" for region).
- Keep enum cardinalities moderate (5-50 distinct values per column) so Genie
  can comfortably display them in grouped results.
`;

/** Fact-generation bias: higher row counts, stronger trends, seasonality. */
export const GENIE_FACT_BIAS = `
# GENIE MODE
This fact table will be queried by a Databricks Genie Space. Ensure the
distributions make common Genie questions produce MEANINGFUL answers:
- Create clear, visible trends (month-over-month growth or decline of 10-30%
  somewhere in the window) so "How did X change over time?" has a real answer.
- Embed a recognisable seasonal pattern (weekly, monthly or quarterly) so
  "Is there seasonality in X?" shows an actual cycle.
- Ensure GROUP BY dimensional breakdowns produce an uneven distribution
  (e.g. top 3 regions account for >50% of rows, not an even split) so
  "Which X is the largest?" returns a real ranking.
- Keep the DATA RECENCY bias (40% in last 90 days) but spread the rest so
  year-over-year comparisons are possible.
`;

// ---------------------------------------------------------------------------
// Pass 0: Narrative Design
// ---------------------------------------------------------------------------

export const NARRATIVE_DESIGN_PROMPT = `You are a data engineer designing realistic demo data stories for {customer_name} in the {industry_name} industry.

# RESEARCH CONTEXT
{research_summary}

# DATA NARRATIVES FROM RESEARCH
{existing_narratives}

# SCOPE
Division: {division}
Target Row Count: {min_rows} - {max_rows} per fact table

# DATA RECENCY WINDOW (CRITICAL)
Every narrative MUST live inside the demo's rolling data window:
  start: {start_date} (start of {fy_label})
  end:   today ({end_date})
  span:  {date_range_days} days (approx. {date_range_months} months)

Use \`temporalRange\` in days relative to today (0 = today, negative = past):
  - startOffset MUST be >= -{date_range_days}
  - endOffset MUST be <= 0
Spread narratives across the full window (some rooted in the completed FY,
some in year-to-date) so the demo shows a real trend curve, not a 6-month stub.

# TASK
Design 3-5 data stories that will be embedded as patterns in the generated tables.
Each story creates visible, queryable trends that make the demo compelling.

Stories must be:
- Specific to {customer_name}'s division and industry
- Use their nomenclature: {nomenclature}
- Create patterns that use cases can discover (spikes, trends, anomalies, seasonal patterns)
- Distributed across the full data window ({fy_label}), not clustered in one quarter

# OUTPUT FORMAT
Return JSON:
{
  "narratives": [
    {
      "title": "string",
      "description": "Detailed description of what the data pattern looks like",
      "affectedTables": ["table_name"],
      "pattern": "spike|trend|anomaly|seasonal|correlation",
      "temporalRange": { "startOffset": -{date_range_days}, "endOffset": 0 },
      "magnitudeDescription": "e.g., 23% increase, 3x spike"
    }
  ],
  "globalSettings": {
    "dateRangeMonths": {date_range_months},
    "primaryCurrency": "USD",
    "primaryTimezone": "UTC",
    "geographicFocus": ["region1", "region2"]
  }
}
{genie_bias}`;

// ---------------------------------------------------------------------------
// Pass 1: Schema Design
// ---------------------------------------------------------------------------

export const SCHEMA_DESIGN_PROMPT = `You are a senior data architect designing a LEAN demo data model for {customer_name} in the {industry_name} industry.

# MATCHED DATA ASSETS
{data_assets_context}

# DATA NARRATIVES
{narratives_json}

# NOMENCLATURE
{nomenclature}

# SCOPE
Division: {division}
Target Row Count: {min_rows} - {max_rows} per fact table
Dimension tables: 20-100 rows each

# CRITICAL CONSTRAINTS
- Design 8-12 tables TOTAL: 3-4 dimension tables + 5-8 fact tables.
- This is a DEMO, not an enterprise data warehouse. Fewer tables with richer data beats many thin tables.
- Consolidate related data assets into single tables where possible (a fact table can serve 2-3 assets).
- Each table: 6-12 columns MAX. Focus on columns that enable the narrative patterns.
- Keep shared dimensions small: site/location (5-10 rows), date (365 rows), category/type (10-25 rows).
- Do NOT create equipment, shipment, or contract dimension tables unless they are critical to a narrative.

# TASK
Design a focused relational schema that:
1. Maps selected data assets to tables (consolidate where possible)
2. Uses {customer_name}'s terminology (from nomenclature)
3. Supports the data narratives (tables must have columns that enable the patterns)
4. Follows star schema conventions (dimension tables + fact tables)
5. Orders tables for creation (dimensions first, then facts)

# RULES
- Table names: lowercase, underscored, descriptive
- Column types: STRING, INT, BIGINT, DOUBLE, DECIMAL(18,2), DATE, TIMESTAMP, BOOLEAN
- Every table needs a primary key column
- FK columns must match the PK type of the referenced dimension
- Include created_at TIMESTAMP, updated_at TIMESTAMP on every table
- Fact tables MUST NOT have FK references to other fact tables. Only reference dimension tables.

# OUTPUT FORMAT
Return JSON:
{
  "tables": [
    {
      "name": "table_name",
      "assetId": "A01",
      "description": "One-sentence table description for COMMENT clause",
      "tableType": "dimension|fact",
      "columns": [
        { "name": "col_name", "dataType": "STRING", "description": "string", "role": "pk|fk|measure|dimension|timestamp|flag", "fkTarget": "other_table.pk_col|null" }
      ],
      "rowTarget": 5000,
      "creationOrder": 1,
      "narrativeLinks": ["Narrative Title 1"]
    }
  ]
}
{genie_bias}`;

// ---------------------------------------------------------------------------
// Pass 2: Seed SQL Generation (per dimension table)
// ---------------------------------------------------------------------------

export const SEED_TABLE_PROMPT = `You are a SQL engineer generating realistic seed data for a demo.

# TABLE
Name: {catalog}.{schema}.{table_name}
Type: Dimension / Lookup
Description: {description}
Columns: {columns_json}

# CONTEXT
Customer: {customer_name} ({industry_name})
Division: {division}
Nomenclature: {nomenclature}

# DATABRICKS SQL RULES
${DATABRICKS_SQL_RULES_COMPACT}
${DEMO_DATA_SQL_CONSTRAINTS}
${DATA_RECENCY_BLOCK}

# TASK
Generate a single CREATE OR REPLACE TABLE ... COMMENT '{description}' AS SELECT statement with {row_target} rows.
Use EXPLODE(SEQUENCE(1, {row_target})) to generate the row set.

CRITICAL REMINDERS:
- For TIMESTAMP columns (created_at, updated_at): ALWAYS CAST date to TIMESTAMP before adding intervals.
  Pattern: CAST(CAST(date_val AS TIMESTAMP) + make_interval(0,0,0,0,h,m,s) AS TIMESTAMP)
- Use abs(hash(col)) for deterministic bucketing, NEVER rand(col).
- Use pmod(abs(hash(col)), GREATEST(N, 1)) for safe modulo.

Requirements:
- Values must be realistic for {customer_name}'s industry and division
- Product names, locations, categories must use their nomenclature
- IDs should be formatted strings (e.g., "CUST-001", "PROD-042")
- All dates/timestamps MUST obey the DATA RECENCY block above (inside {fy_label})
- Non-uniform distributions (80/20 for categories, realistic geographic spread)
- No placeholder or Lorem Ipsum text
{genie_bias}

Return ONLY the SQL statement. No markdown, no explanation.`;

// ---------------------------------------------------------------------------
// Pass 3: Fact SQL Generation (per fact table)
// ---------------------------------------------------------------------------

export const FACT_TABLE_PROMPT = `You are a SQL engineer generating realistic fact/transaction data for a demo.

# TABLE
Name: {catalog}.{schema}.{table_name}
Type: Fact / Transaction
Description: {description}
Columns: {columns_json}
Target Rows: {row_target}

# RELATED DIMENSION TABLES (only these exist -- do NOT reference any other tables)
{dimension_tables_context}

# DATA NARRATIVES TO EMBED
{narrative_context}

# CONTEXT
Customer: {customer_name} ({industry_name})
Nomenclature: {nomenclature}

# DATABRICKS SQL RULES
${DATABRICKS_SQL_RULES_COMPACT}
${DEMO_DATA_SQL_CONSTRAINTS}
${DATA_RECENCY_BLOCK}

# TASK
Generate a single CREATE OR REPLACE TABLE ... COMMENT '{description}' AS SELECT statement.
Use CTAS only -- NEVER CREATE TABLE + INSERT INTO.

1. Uses EXPLODE(SEQUENCE(1, {row_target})) to generate the row set (never nest explode in CAST)
2. For FK lookups: use get() with COLLECT_LIST, NEVER element_at():
   Pattern: get(dim_arr, pmod(abs(hash(seq_id, 'SALT')), GREATEST(size(dim_arr), 1)))
3. Creates non-uniform distributions:
   - CASE WHEN RAND() < 0.3 THEN 'X' for weighted categories (RAND() with no seed)
   - RAND() * range + offset for numeric measures
   - DATE_SUB(CURRENT_DATE(), CAST(RAND() * {date_range_days} AS INT)) for dates,
     biased toward the last 90 days (see DATA RECENCY block)
4. Embeds the narrative patterns:
   - Temporal spikes/dips using CASE WHEN date BETWEEN ... conditions
   - Correlated anomalies across related columns
   - Seasonal patterns using MONTH() or DAYOFWEEK()
5. For TIMESTAMP columns: ALWAYS CAST date to TIMESTAMP before adding time intervals.
6. NEVER reference the table being created -- it does not exist yet.
{genie_bias}

Return ONLY the SQL statement. No markdown, no explanation.`;
