/**
 * Shared Databricks SQL quality rules for all LLM prompts.
 *
 * Sourced from the "gold standard" pipeline SQL gen prompt (templates.ts)
 * and the databricks-dbsql skill best practices.
 *
 * DATABRICKS_SQL_RULES            -- full rule set for prompts generating complete SQL queries
 * DATABRICKS_SQL_RULES_COMPACT    -- shorter set for prompts generating SQL expressions/snippets
 * DATABRICKS_SQL_REVIEW_CHECKLIST -- structured checklist for the LLM reviewer endpoint
 */

export const DATABRICKS_SQL_RULES = `
DATABRICKS SQL QUALITY RULES (mandatory for all generated SQL):

Syntax and type safety:
- NEVER use MEDIAN() -- it is not supported in Databricks SQL. Use PERCENTILE_APPROX(col, 0.5) instead.
- NEVER nest a window function (OVER) inside an aggregate function (SUM, AVG, COUNT, MIN, MAX). Compute window values in a CTE first, then aggregate.
- NEVER use an aggregate function (SUM, AVG, COUNT, MIN, MAX) as an argument to a window function (LAG, LEAD, REGR_SLOPE, NTILE, etc.). Example of WRONG: LAG(AVG(cost)) OVER (...), REGR_SLOPE(AVG(x), ...) OVER (...). CORRECT: aggregate in one CTE first, then apply LAG/REGR_SLOPE on the pre-aggregated result in the next CTE.
- NEVER reference a SELECT-list alias in sibling expressions within the same SELECT block. SQL evaluates all SELECT expressions logically in parallel, so \`SELECT from_json(...) AS parsed_result, parsed_result.field1\` is INVALID. CORRECT: compute the alias in a CTE or subquery first, then reference it in the outer SELECT.
- Use DECIMAL(18,2) instead of FLOAT/DOUBLE for financial and monetary calculations. Cast DOUBLE source columns to DECIMAL(18,2) BEFORE aggregation: use SUM(CAST(amount AS DECIMAL(18,2))), NOT CAST(SUM(amount) AS DECIMAL(18,2)) -- the latter loses precision during double-precision accumulation.
- All string literals must use single quotes. COALESCE text defaults must be quoted: COALESCE(col, 'Unknown') not COALESCE(col, Unknown).
- NEVER use AI functions (ai_analyze_sentiment, ai_classify, ai_extract, ai_gen, ai_query) in metric view definitions. They are non-deterministic and prohibitively expensive. Use only deterministic expressions over materialized columns.
- NEVER use TO_DATE() or TO_TIMESTAMP() to parse string columns -- they throw on format mismatches. Use COALESCE(try_to_date(col, 'yyyy-MM-dd'), try_to_date(col, 'MM/dd/yyyy'), try_to_date(col, 'dd/MM/yyyy')) to handle mixed date formats gracefully. If the column is already DATE or TIMESTAMP type, use it directly without parsing.
- ai_query() only accepts these named parameters: modelParameters, responseFormat, failOnError. NEVER use systemPrompt, system_prompt, or any other invented parameter names. Embed persona/system instructions in the request text via CONCAT.
- ai_query() with failOnError => false returns STRUCT<result: STRING, errorMessage: STRING>. The result field is ALWAYS STRING regardless of responseFormat. Do NOT use responseFormat with failOnError => false. To get structured output: (1) instruct the model to return JSON in the prompt text, (2) parse with from_json(col.result, 'STRUCT<field1: TYPE, ...>') AS parsed_result. Accessing nested struct fields directly on the result (e.g. ai_result.result.field) causes INVALID_EXTRACT_BASE_FIELD_TYPE errors.
- from_json() alias naming: ALWAYS use exactly \`ai_result\` for the ai_query() output and \`parsed_result\` for the from_json() output. NEVER abbreviate to \`parsed\`, \`result\`, \`ai_res\`, or other variations -- inconsistent naming breaks automated validation.
- ai_forecast() requires time-series-ready data with explicit time and value columns. Only use ai_forecast() when the schema explicitly contains time-series columns (date/timestamp + numeric value). NEVER assume or invent columns to satisfy ai_forecast() input requirements.

AI function performance:
- AI functions (ai_query, ai_similarity, ai_gen) are expensive per-row. Filter and aggregate data BEFORE passing to AI functions. Structure queries as a cost funnel: cheap filters first, then blocking joins, then ai_similarity scoring, then ai_query LLM calls on the smallest possible set.
- For pairwise operations (deduplication, matching), split candidate generation into multiple narrow blocking joins with equality predicates on normalized columns, UNION the candidate sets, then score only the blocked pairs with ai_similarity.
- Normalize text columns (lower(trim(coalesce(col, ''))), soundex()) in an early CTE and reuse the normalized columns for blocking joins. Reserve ai_similarity() for the scoring stage after blocking.
- ALWAYS LIMIT the input rows to ai_query() / ai_gen() to at most 1000 rows. Apply the LIMIT after filtering and scoring, not before.

Identifier quoting:
- ALWAYS backtick-quote column names that contain spaces, special characters, or mixed case (e.g. \`Net Cash Flow\`, \`Account ID\`).
- Use column names EXACTLY as they appear in the schema. NEVER transform them (do NOT convert \`Net Cash Flow\` to net_cash_flow).
- Table names should use fully-qualified three-part names: catalog.schema.table

Query structure:
- When mixing aggregate functions (COUNT, SUM, AVG, MIN, MAX) with non-aggregated columns in SELECT, you MUST include a GROUP BY clause listing every non-aggregated column -- even when CROSS JOINing a single-row CTE or subquery. The SQL analyzer cannot infer cardinality and will reject the query with MISSING_GROUP_BY.
- For top-N queries, ALWAYS use ORDER BY ... LIMIT N. NEVER use RANK() or DENSE_RANK() for top-N because ties can return more than N rows. ANY query with ORDER BY that ranks, sorts by a metric, or serves as a preview MUST include LIMIT.
- Use QUALIFY for per-group deduplication (e.g. latest row per customer), NOT for top-N lists.
- NEVER use aggregate functions (SUM, AVG, COUNT, MIN, MAX) in the same SELECT block as QUALIFY. QUALIFY operates before GROUP BY, so aggregates are invalid in that context. Split into two CTEs: first CTE uses QUALIFY for row-level deduplication on raw columns, second CTE aggregates the result.
- SELECT DISTINCT: Use SELECT DISTINCT only when the source is known to have duplicates or when a JOIN can produce them. Do NOT use DISTINCT as a defensive pattern when the source key is already unique -- it adds an expensive shuffle and masks data quality issues. Prefer QUALIFY ROW_NUMBER() for deterministic deduplication with explicit ordering.
- Always include human-readable identifying columns (e.g. customer name, email, product name) in entity-level query output.
- Prefer explicit column lists over SELECT *.
- Filter early, aggregate late -- push WHERE clauses as close to the source tables as possible.
- Use window functions instead of self-joins where possible.
- NEVER use LATERAL VIEW EXPLODE -- it is deprecated Hive syntax that cannot be combined with subsequent JOINs. Use EXPLODE() inside a CTE with comma-join or CROSS JOIN LATERAL syntax instead.

SQL formatting:
- Format SQL across multiple lines with proper indentation. SELECT, FROM, WHERE, JOIN, GROUP BY, ORDER BY, LIMIT on separate lines.
- One column/expression per line in SELECT lists for queries with more than 3 columns.
- CTE definitions on separate lines: WITH name AS ( on one line, closing ) on its own line.
- NEVER output single-line SQL -- it is unreadable and unmaintainable.

Databricks SQL features:
- Use COLLATE UTF8_LCASE for case-insensitive string comparisons instead of LOWER()/UPPER() wrappers. Apply COLLATE to BOTH sides of the comparison: \`col COLLATE UTF8_LCASE = :param COLLATE UTF8_LCASE\`. Applying only to one side can produce incorrect results.
- Use PERCENTILE_APPROX for percentile calculations (P20, P50, P75, etc.).
- Prefer native SQL functions over UDFs -- UDFs require serialization and are dramatically slower.
- Use pipe syntax (|>) for complex multi-step transformations where it improves readability.
- Databricks has NO STRING_AGG(). Use array_join(collect_list(col), ',') instead.

Window functions:
- Prefer window functions over self-joins for row comparisons, running totals, and ranking.
- Specify explicit window frames (ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) when cumulative behaviour is intended -- the default RANGE frame may group duplicate ORDER BY values unexpectedly.
- Use named windows (WINDOW w AS (PARTITION BY ...)) when multiple columns share the same partitioning to reduce repetition.
- NEVER extend a named window with a frame spec -- OVER (w ROWS BETWEEN ...) is a syntax error in Databricks SQL. Either inline the full window spec (PARTITION BY + ORDER BY + frame) in every OVER clause, or define separate named windows for each distinct frame.
- Use LAST_VALUE with ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING to get the partition last value (default frame stops at CURRENT ROW).

Lambda / higher-order functions:
- Prefer transform(), filter(), exists(), aggregate() for array operations instead of EXPLODE + re-aggregate patterns -- fewer shuffles, better performance.
- Use array_sort(array, (l, r) -> comparator) for custom sort orders instead of EXPLODE + ORDER BY + collect_list.
- Use map_filter(), transform_keys(), transform_values() for map manipulation instead of exploding map entries.
- Lambda expressions cannot contain subqueries or SQL UDFs.

MERGE and DML best practices:
- Prefer MERGE INTO over separate DELETE + INSERT for upsert patterns.
- Always use WHEN MATCHED AND / WHEN NOT MATCHED for conditional merge logic.
- After MERGE, do NOT manually OPTIMIZE -- Delta auto-optimizes on write.

Complex types:
- Access STRUCT fields with dot notation: col.field (no need for brackets).
- Use EXPLODE(array_col) or INLINE(array_of_structs_col) to flatten arrays.
- Avoid filtering on complex-type columns (STRUCT/ARRAY/MAP) in WHERE clauses -- it defeats data skipping and partition pruning.
- Use map_keys(), map_values(), or element_at(map_col, key) for MAP operations.

Timestamps and intervals:
- Prefer TIMESTAMP_NTZ over TIMESTAMP for timezone-independent values (audit dates, created_at).
- Use standard interval syntax: INTERVAL '30' DAY, INTERVAL '1' MONTH, INTERVAL '2' HOUR.
- Use DATE_ADD / DATE_SUB for simple date arithmetic; use INTERVAL for timestamp arithmetic.
- DATE_FORMAT() patterns: ONLY use Spark-supported letters: y, M, d, H, m, s, S, E, a, G, Q, F. NEVER use 'u' (ISO day-of-week), 'e', 'c', or 'L' -- they throw DATETIME_PATTERN_RECOGNITION errors. Prefer built-in functions (DAYOFWEEK, MONTH, QUARTER, WEEKOFYEAR) over DATE_FORMAT for extracting numeric date parts.

DDL patterns:
- Prefer CREATE OR REPLACE TABLE/VIEW over DROP IF EXISTS + CREATE.
- Use CLUSTER BY (col1, col2) for liquid clustering (replaces Z-ORDER in modern tables).
- Include TBLPROPERTIES for table metadata (tier, owner, quality tags).

Querying metric views (WITH METRICS views):
- When querying a metric view, ALL measure columns MUST be wrapped in MEASURE(): e.g. MEASURE(total_revenue) AS total_revenue. Bare column references on measures cause runtime errors.
- Every MEASURE() call MUST have an explicit AS alias: MEASURE(total_txn_count) AS total_txn_count. Without the alias, downstream CTEs, widget expressions, and filter references cannot resolve the column.
- NEVER prefix measure columns with a table alias. Use MEASURE(col), NOT alias.col or mv.col.
- Dimension columns are referenced by bare name (no MEASURE() wrapper).
- Always include GROUP BY ALL (or explicit GROUP BY on dimension columns) when selecting MEASURE() aggregates from a metric view.
- NEVER use SELECT * on a metric view -- it is not supported.
- CORRECT: SELECT month, MEASURE(total_revenue) AS total_revenue FROM catalog.schema.mv GROUP BY ALL
- WRONG:  SELECT tam.total_revenue FROM catalog.schema.mv AS tam
`.trim();

export const DATABRICKS_SQL_RULES_COMPACT = `
DATABRICKS SQL RULES:
- NEVER use MEDIAN(). Use PERCENTILE_APPROX(col, 0.5) instead.
- NEVER nest a window function (OVER) inside an aggregate (SUM, AVG, COUNT, MIN, MAX).
- NEVER use an aggregate as an argument to a window function: LAG(AVG(x)) OVER (...) is INVALID. Aggregate first in a CTE, then apply the window function on the aggregated result.
- NEVER reference a SELECT-list alias in sibling expressions in the same SELECT. Compute the alias in a CTE first, then reference it in the outer query.
- NEVER combine aggregate functions (SUM, AVG, etc.) with QUALIFY in the same SELECT. QUALIFY runs before GROUP BY. Split deduplication and aggregation into separate CTEs.
- Use DECIMAL(18,2) for financial/monetary calculations. Cast DOUBLE to DECIMAL(18,2) BEFORE aggregation: SUM(CAST(amt AS DECIMAL(18,2))), not CAST(SUM(amt) AS DECIMAL(18,2)).
- Use COLLATE UTF8_LCASE on BOTH sides for case-insensitive comparisons: col COLLATE UTF8_LCASE = :param COLLATE UTF8_LCASE.
- Use PERCENTILE_APPROX for percentile calculations.
- For top-N/ranked/preview queries, ALWAYS use ORDER BY ... LIMIT N. Any ORDER BY without LIMIT wastes resources.
- SELECT DISTINCT: use only when source is known to have duplicates. Do NOT use defensively on unique keys -- prefer QUALIFY ROW_NUMBER() for deterministic deduplication.
- Filter early, aggregate late.
- Prefer native SQL functions over UDFs.
- NEVER use AI functions (ai_analyze_sentiment, ai_classify, etc.) in metric views.
- NEVER use TO_DATE()/TO_TIMESTAMP(). Use COALESCE(try_to_date(col, fmt1), try_to_date(col, fmt2)) for safe string-to-date parsing.
- ai_query() named parameters: ONLY modelParameters, responseFormat, failOnError. NEVER use systemPrompt or other invented names.
- ai_query() with failOnError => false: result field is ALWAYS STRING. Do NOT use responseFormat with failOnError. Parse structured output with from_json(ai_result.result, 'STRUCT<...>') AS parsed_result. ALWAYS use exactly \`ai_result\` and \`parsed_result\` as alias names.
- AI functions are expensive per-row. Filter/aggregate BEFORE ai_query/ai_similarity. For pairwise ops: block first (narrow joins + UNION), score second (ai_similarity), LLM last (ai_query on filtered LIMIT-ed set).
- ALWAYS backtick-quote column names with spaces or special characters. Use names EXACTLY as in the schema.
- No STRING_AGG() -- use array_join(collect_list(col), ',') instead.
- Prefer MERGE INTO over DELETE + INSERT for upserts.
- Access STRUCT fields with dot notation; use EXPLODE for arrays. NEVER use LATERAL VIEW EXPLODE (deprecated Hive syntax).
- Prefer TIMESTAMP_NTZ for timezone-independent timestamps.
- Use INTERVAL '30' DAY syntax for interval literals.
- DATE_FORMAT(): ONLY use y, M, d, H, m, s, S, E, a, G, Q, F. NEVER use 'u', 'e', 'c', 'L' -- they throw DATETIME_PATTERN_RECOGNITION. Prefer DAYOFWEEK()/MONTH()/QUARTER() for numeric date parts.
- Prefer CREATE OR REPLACE over DROP + CREATE.
- Specify explicit window frames (ROWS BETWEEN ...) for cumulative calculations.
- NEVER extend a named window with a frame spec -- OVER (w ROWS BETWEEN ...) is a syntax error. Inline the full spec or define separate named windows per frame.
- Prefer transform()/filter()/aggregate() for array ops over EXPLODE + re-aggregate.
- When querying metric views: wrap ALL measure columns in MEASURE(col) AS col. Use GROUP BY ALL. NEVER use SELECT * or alias-prefixed measure references.
- Format SQL across multiple lines with proper indentation. NEVER output single-line SQL.
`.trim();

export const DATABRICKS_SQL_REVIEW_CHECKLIST = `
REVIEW CHECKLIST (evaluate each dimension independently):

1. CORRECTNESS
   - All table/column references exist in the provided schema
   - JOIN conditions use correct keys (match FK relationships)
   - Aggregations are grouped correctly (no missing GROUP BY columns)
   - WHERE/HAVING filters are logically sound
   - Data types are handled correctly (no implicit lossy casts)
   - No SELECT-list alias reuse: an alias defined in a SELECT block MUST NOT be referenced by sibling expressions in the same SELECT (compute in a CTE first)
   - No aggregate inside window function: LAG(AVG(...)), REGR_SLOPE(AVG(...), ...) etc. are INVALID -- aggregate first, then window

2. PERFORMANCE
   - Filters are pushed early (WHERE before aggregation, not HAVING for non-aggregate conditions)
   - No unnecessary self-joins (use window functions instead)
   - No SELECT * in production queries
   - LIMIT is present for ANY query using ORDER BY for ranking, top-N, or preview purposes (not RANK/DENSE_RANK)
   - CTEs are used to avoid repeated subquery evaluation
   - SELECT DISTINCT is justified: not used defensively on already-unique keys (adds unnecessary shuffle)
   - Financial DECIMAL casting done BEFORE aggregation: SUM(CAST(col AS DECIMAL(18,2))), not CAST(SUM(col) AS DECIMAL(18,2))

3. READABILITY
   - Meaningful aliases for tables and columns
   - Consistent formatting and indentation -- multi-line SQL with SELECT/FROM/WHERE/JOIN/GROUP BY/ORDER BY on separate lines. Single-line SQL is a fail
   - Complex logic broken into CTEs rather than deeply nested subqueries
   - Column order makes business sense (identifiers first, measures second)

4. SECURITY
   - No SQL injection vectors (dynamic string concatenation in expressions)
   - No exposure of sensitive columns without business justification
   - Read-only patterns only (no DDL/DML in analytical queries)

5. DATABRICKS IDIOM ADHERENCE
   - PERCENTILE_APPROX instead of MEDIAN()
   - COLLATE UTF8_LCASE on BOTH sides for case-insensitive comparisons: col COLLATE UTF8_LCASE = :param COLLATE UTF8_LCASE
   - try_to_date/try_to_timestamp instead of TO_DATE/TO_TIMESTAMP
   - QUALIFY for per-group deduplication
   - Pipe syntax (|>) for complex multi-step transformations
   - DECIMAL(18,2) for financial calculations
   - No nested window functions inside aggregates
   - No aggregate functions (SUM/AVG/COUNT/MIN/MAX) in the same SELECT as QUALIFY -- split into separate CTEs
   - Backtick-quoted identifiers with spaces/special chars
   - Three-part fully-qualified table names (catalog.schema.table)
   - array_join(collect_list(col), ',') instead of STRING_AGG()
   - MERGE INTO for upserts (not DELETE + INSERT)
   - STRUCT dot notation, EXPLODE for arrays, map_keys()/element_at() for MAPs
   - TIMESTAMP_NTZ for timezone-independent timestamps
   - INTERVAL '30' DAY syntax (not DATEADD with integer)
   - CREATE OR REPLACE over DROP IF EXISTS + CREATE
   - CLUSTER BY for liquid clustering (replaces Z-ORDER)
   - Explicit window frames (ROWS BETWEEN) for cumulative calculations
   - Named windows when multiple columns share partitioning -- but NEVER extend a named window with a frame (OVER (w ROWS BETWEEN ...) is invalid); inline the full spec or define separate named windows per frame
   - transform()/filter()/aggregate() for array operations instead of EXPLODE + re-aggregate
   - array_sort() with lambda for custom sort orders

6. METRIC VIEW COMPLIANCE (if query references a metric view)
   - All measure columns wrapped in MEASURE(): MEASURE(col) AS col
   - Every MEASURE() call has an explicit AS alias
   - No bare column references or alias-prefixed references for measure columns
   - GROUP BY ALL or explicit GROUP BY on dimension columns is present
   - No SELECT * on metric views

7. AI FUNCTION COMPLIANCE (if query uses ai_query, ai_similarity, ai_gen)
   - ai_query() with failOnError => false: result parsed via from_json(ai_result.result, 'STRUCT<...>') -- NOT via direct struct field access (ai_result.result.field causes INVALID_EXTRACT_BASE_FIELD_TYPE)
   - Structured output instructions included in prompt text (CONCAT with JSON format example), NOT via responseFormat when failOnError => false
   - Input rows to ai_query()/ai_gen() are LIMIT-ed to at most 1000
   - Cheap relational filters applied BEFORE expensive AI function calls
   - For pairwise operations: blocking joins with normalized columns BEFORE ai_similarity scoring
   - ai_sys_prompt column present as last column for auditability
   - Only valid named parameters used: modelParameters, responseFormat, failOnError (no systemPrompt or invented names)
   - from_json() alias uses canonical name \`parsed_result\` (not \`parsed\`, \`result\`, or other abbreviations)
`.trim();

export const DATABRICKS_SQL_SELF_CHECK = `
BEFORE YOU RESPOND -- verify your SQL against this checklist:

CORRECTNESS:
[ ] Every column reference exists in the AVAILABLE TABLES AND COLUMNS section
[ ] JOIN conditions match the foreign key relationships provided
[ ] Every non-aggregated column in SELECT appears in GROUP BY (or is inside an aggregate)
[ ] No SELECT-list alias reused in sibling expressions (compute in CTE first)
[ ] No aggregate function nested inside a window function or vice versa

PERFORMANCE:
[ ] WHERE filters applied early (before aggregation, not in HAVING)
[ ] Final SELECT includes ORDER BY ... LIMIT N (not RANK/DENSE_RANK for top-N)
[ ] SELECT DISTINCT used ONLY when source genuinely has duplicates (not defensively)
[ ] Financial columns cast to DECIMAL(18,2) BEFORE aggregation

READABILITY:
[ ] Multi-line SQL with SELECT/FROM/WHERE/JOIN/GROUP BY/ORDER BY on separate lines
[ ] 3-7 CTEs with business-friendly names (not cte1, temp, base)
[ ] Identifying columns (names, IDs) included in entity-level output

DATABRICKS IDIOMS:
[ ] PERCENTILE_APPROX instead of MEDIAN()
[ ] array_join(collect_list(col), ',') instead of STRING_AGG()
[ ] try_to_date/try_to_timestamp instead of TO_DATE/TO_TIMESTAMP
[ ] COLLATE UTF8_LCASE on BOTH sides for case-insensitive comparisons
[ ] Explicit window frames (ROWS BETWEEN ...) for cumulative calculations
[ ] Named windows NOT extended with frame specs (inline full spec instead)
`.trim();

export const DATABRICKS_DATA_MODELING_RULES = `
DATA MODELING RULES (for schema design, table analysis, and dimensional modeling):

Star Schema:
- Gold layer should use star schema: denormalized dimensions, normalized facts at the grain of the business event.
- Silver layer may use OBT or Data Vault for rapid integration and cleansing.
- Kimball methodology: (1) identify the business process, (2) declare the grain, (3) choose dimensions (who/what/where/when/why/how), (4) identify facts (numeric measures at declared grain).
- Fact table types: Transaction (one row per event), Periodic Snapshot (one row per entity per period), Accumulating Snapshot (one row per lifecycle).

Keys and Constraints:
- Use GENERATED ALWAYS AS IDENTITY for surrogate keys; prefer integer surrogates over strings for join performance.
- Define PRIMARY KEY on dimension surrogate keys and FOREIGN KEY on fact FK columns to help the query optimizer.
- Highly denormalize dimension tables: flatten many-to-one relationships within a single dimension.

Liquid Clustering:
- Prefer Liquid Clustering over traditional partitioning for ALL new Delta tables.
- Choose 1-4 clustering keys; fewer is better for tables under 10 TB.
- Cluster fact tables by the most commonly filtered foreign keys.
- Cluster dimension tables by primary key plus common filter columns.
- Liquid Clustering is NOT compatible with partitioning or Z-ORDER on the same table.

Metadata:
- Add COMMENT on all tables and columns for AI/BI discoverability.
- Apply TAGS for governance (PII, sensitivity level, tier).
- Use DECIMAL(18,2) for financial/monetary values, never FLOAT/DOUBLE.

Anti-Patterns to Avoid:
- Over-partitioning (>5000 partitions; use Liquid Clustering instead).
- String surrogate keys (integer IDENTITY columns are faster for joins).
- Missing PK/FK constraints (deprives the optimizer of relationship information).
- Missing COMMENT and TAGS (reduces discoverability for AI/BI tools).
- Filtering on ARRAY/MAP columns in WHERE clauses (no column statistics for data skipping).
`.trim();
