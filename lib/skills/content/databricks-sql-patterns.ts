/**
 * Databricks SQL Generation Craft skill.
 *
 * Pure SQL writing recipes distilled from:
 *   - templates-sql-gen.ts (tuned prompts and fix patterns)
 *   - sql-rules.ts (quality rules and review checklist)
 *   - External window-lambda-functions.md, best-practices.md
 *
 * Covers: window functions, CTE patterns, date idioms, lambda/higher-order
 * functions, and query anti-patterns. Data modeling content has been moved
 * to the separate databricks-data-modeling skill.
 */

import type { SkillDefinition } from "../types";
import { registerSkill } from "../registry";

const WINDOW_RECIPES = `Window Function Recipes (Databricks SQL):
- Running total: SUM(amount) OVER (PARTITION BY region ORDER BY order_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
- MoM growth: (amount - LAG(amount, 1) OVER (PARTITION BY region ORDER BY month)) / NULLIF(LAG(amount, 1) OVER (PARTITION BY region ORDER BY month), 0) * 100
- YoY comparison: LAG(revenue, 12) OVER (PARTITION BY region ORDER BY month) AS prior_year_revenue
- Gap-and-island: Use ROW_NUMBER() to detect consecutive sequences; subtract ROW_NUMBER from a monotonic column to form group ids
- Cumulative distribution: CUME_DIST() OVER (PARTITION BY segment ORDER BY score), NTILE(4) OVER (ORDER BY score) for quartiles
- Per-group dedup: QUALIFY ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY updated_at DESC) = 1
- Named windows: SELECT ... OVER w FROM t WINDOW w AS (PARTITION BY region ORDER BY date)
- LAST_VALUE: Always include ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING (default frame excludes future rows)
- Moving average: AVG(amount) OVER (PARTITION BY region ORDER BY order_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
- NEVER nest a window function inside an aggregate -- split into two CTEs: first CTE computes the window, second CTE aggregates the result
- QUALIFY runs before GROUP BY -- NEVER combine aggregates (SUM/AVG/COUNT) with QUALIFY in the same SELECT; split into CTE + QUALIFY`;

const CTE_PATTERNS = `CTE Patterns for Clean SQL Generation:
- First CTE should use SELECT DISTINCT when pulling base entities to deduplicate early
- Use 3-7 CTEs with business-friendly names (e.g. active_customers, monthly_revenue, churn_candidates -- NOT cte1, cte2)
- Filter early, aggregate late: push WHERE conditions into the first CTE, aggregate in later CTEs
- Staged window-then-aggregate: CTE1 computes window functions, CTE2 aggregates the windowed results
- Pipe syntax (|>) can replace deeply nested CTEs for linear transformation chains: FROM t |> WHERE ... |> AGGREGATE ... |> ORDER BY ...
- Final SELECT should include LIMIT 10 for preview (unless the use case explicitly needs all rows)
- Each CTE should have a single clear purpose; avoid multi-purpose CTEs that do filtering + joining + aggregating
- Prefer UNION ALL over UNION unless deduplication is genuinely needed (UNION triggers a sort)`;

const DATE_IDIOMS = `Date Idioms for Databricks SQL:
- Truncation: DATE_TRUNC('MONTH', order_date), DATE_TRUNC('QUARTER', order_date), DATE_TRUNC('YEAR', order_date)
- Safe parsing: try_to_date(col, 'yyyy-MM-dd') with COALESCE fallback -- NEVER use TO_DATE (throws on bad data)
- Interval arithmetic: date_col + INTERVAL '30' DAY, date_col - INTERVAL '1' YEAR, DATE_ADD(date_col, 7), DATE_SUB(date_col, 30)
- Fiscal calendar: MAKE_DATE(YEAR(date_col) + CASE WHEN MONTH(date_col) >= fiscal_start THEN 0 ELSE -1 END, fiscal_start, 1) for fiscal year start
- Period comparison: Use DATE_TRUNC + LAG for period-over-period; use DATEDIFF for day counts
- Current period: CURRENT_DATE(), CURRENT_TIMESTAMP(); for deterministic caching use a parameter instead
- Month boundaries: LAST_DAY(date_col) for end of month, DATE_TRUNC('MONTH', date_col) for start of month
- Extract components: YEAR(date_col), MONTH(date_col), DAY(date_col), DAYOFWEEK(date_col), WEEKOFYEAR(date_col)
- Timezone-safe: Use TIMESTAMP_NTZ for timezone-independent timestamps; CAST(ts AS DATE) to strip time`;

const LAMBDA_PATTERNS = `Lambda / Higher-Order Function Patterns:
- transform(array, x -> expr): Apply function to each element -- prefer over EXPLODE + re-aggregate
- filter(array, x -> predicate): Keep matching elements: filter(tags, t -> t LIKE 'premium%')
- exists(array, x -> predicate): TRUE if any element matches (short-circuits)
- forall(array, x -> predicate): TRUE if all elements match
- aggregate(array, zero, (acc, x) -> merge, acc -> finish): Reduce: aggregate(quantities, 0, (a, x) -> a + x)
- array_sort(array, (a, b) -> comparator): Custom sort: array_sort(items, (a, b) -> CASE WHEN a.price < b.price THEN -1 WHEN a.price > b.price THEN 1 ELSE 0 END)
- zip_with(array1, array2, (a, b) -> expr): Pair-wise combination of two arrays
- map_filter(map, (k, v) -> predicate): Filter map entries
- transform_keys/transform_values: Transform map keys or values with a lambda
- RULE: Prefer lambda functions over EXPLODE + GROUP BY + re-aggregate for array manipulation -- it avoids expensive shuffles
- RULE: Lambdas cannot contain subqueries or aggregate functions`;

const QUERY_ANTI_PATTERNS = `SQL Query Anti-Patterns (AVOID these):
- Nesting a window function inside an aggregate: SUM(ROW_NUMBER() OVER ...) -- split into two CTEs
- Using MEDIAN() -- not available in Databricks SQL; use PERCENTILE_APPROX(col, 0.5) instead
- Using STRING_AGG() -- not available; use array_join(collect_list(col), ', ') instead
- Using RANK()/DENSE_RANK() for top-N queries -- use ORDER BY col DESC LIMIT N instead (much cheaper)
- Combining QUALIFY + aggregate in the same SELECT -- QUALIFY runs before GROUP BY, so aggregates are not available
- Using TO_DATE or TO_TIMESTAMP without try_ prefix -- throws on malformed data; use try_to_date / try_to_timestamp
- Non-deterministic functions in cached queries -- NOW(), CURRENT_TIMESTAMP(), RAND() prevent query result caching; pass as parameters
- Self-joins for row comparison -- use LAG/LEAD/window functions instead
- SELECT * in production queries -- always name columns explicitly
- Python/Scala UDFs when native SQL exists -- serialization overhead is dramatic
- UNION when UNION ALL suffices -- UNION forces a sort for dedup
- DELETE + INSERT when MERGE INTO achieves the same result
- Missing COALESCE on nullable columns used in calculations -- NULL propagates through arithmetic
- Using FLOAT/DOUBLE for monetary values -- use DECIMAL(18,2) to avoid precision errors`;

const skill: SkillDefinition = {
  id: "databricks-sql-patterns",
  name: "Databricks SQL Generation Craft",
  description:
    "SQL writing recipes for Databricks: window functions, CTE patterns, date idioms, " +
    "lambda/higher-order functions, and query anti-patterns. Focused on generation quality.",
  relevance: {
    intents: ["technical", "business", "dashboard"],
    geniePasses: [
      "trustedAssets",
      "benchmarks",
      "instructions",
      "exampleQueries",
      "semanticExpressions",
    ],
    pipelineSteps: ["sql-generation"],
  },
  chunks: [
    {
      id: "sql-window-recipes",
      title: "Window Function Recipes",
      content: WINDOW_RECIPES,
      category: "patterns",
    },
    {
      id: "sql-cte-patterns",
      title: "CTE Patterns",
      content: CTE_PATTERNS,
      category: "patterns",
    },
    {
      id: "sql-date-idioms",
      title: "Date Idioms",
      content: DATE_IDIOMS,
      category: "patterns",
    },
    {
      id: "sql-lambda-patterns",
      title: "Lambda / Higher-Order Function Patterns",
      content: LAMBDA_PATTERNS,
      category: "patterns",
    },
    {
      id: "sql-query-anti-patterns",
      title: "SQL Query Anti-Patterns",
      content: QUERY_ANTI_PATTERNS,
      category: "anti-patterns",
    },
  ],
};

registerSkill(skill);

export default skill;
