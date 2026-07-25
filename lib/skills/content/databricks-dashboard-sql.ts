/**
 * Databricks Dashboard SQL skill.
 *
 * Distilled from:
 *   - dashboard/prompts.ts (DASHBOARD_SYSTEM_MESSAGE, widget rules)
 *   - dashboard/assembler.ts (layout, field matching)
 *   - dashboard/validation.ts (metric view compliance)
 *   - External databricks-aibi-dashboards skill
 *
 * Covers Lakeview dataset SQL rules, widget field matching, layout constraints,
 * and metric view SQL compliance for dashboard generation.
 */

import type { SkillDefinition } from "../types";
import { registerSkill } from "../registry";

const DATASET_RULES = `Dashboard Dataset SQL Rules (Lakeview):
- Each dataset is a SINGLE SELECT statement (no semicolons, no multiple queries)
- Always use fully-qualified table names: catalog.schema.table_name
- KPI dataset: must return exactly 1 row (pre-aggregated summary)
- Trend dataset: must include a DATE or TIMESTAMP column for time series
- Breakdown dataset: GROUP BY dimension + ORDER BY metric DESC + LIMIT 10 for top-N
- Spark SQL syntax ONLY: use date_sub(current_date(), N) not INTERVAL, DATE_TRUNC not EXTRACT
- Safe date parsing: try_to_date(col, 'yyyy-MM-dd') with COALESCE chain -- NEVER TO_DATE
- Put ALL business logic (CASE/WHEN, COALESCE, ratios) into the dataset SQL with explicit AS aliases
- Every widget fieldName must exactly match a dataset column or alias -- the contract is strict`;

const WIDGET_RULES = `Dashboard Widget Rules (CRITICAL for valid rendering):
- Widget field name in query.fields MUST exactly match fieldName in encodings (e.g. both "sum(spend)")
- Aggregation pattern: {"name": "sum(revenue)", "expression": "SUM(\`revenue\`)"} in query.fields; {"fieldName": "sum(revenue)"} in encodings
- Counter widgets: version=2, use disaggregated=true for 1-row datasets, disaggregated=false with aggregation when filters apply
- Table widgets: version=2, columns only need fieldName and displayName (no type/format properties)
- Chart widgets (bar/line/pie): version=3
- Text widgets: NO spec block at all -- use multilineTextboxSpec directly on widget object; SEPARATE widgets for title and subtitle (multiple lines array items concatenate, not stack)
- Filter widgets: use filter-multi-select, filter-single-select, or filter-date-range-picker -- NEVER "filter" (invalid)
- Filter widgets: version=2, disaggregated=false, queryName in encodings must match query name exactly
- Filter widgets: always include frame with showTitle=true
- Widget name: alphanumeric + hyphens + underscores ONLY (no spaces, parentheses, colons)`;

const LAYOUT_RULES = `Dashboard Layout Rules (12-Column GRID_V1):
- Every page must set layoutVersion="GRID_V1"; every widget must fit within columns 0-11 with no overlaps
- Counter rows: three counters at width=4, height=3
- Charts (bar/line/pie): paired charts at width=6, height=5
- Full-width chart: width=12, height=5
- Table: width=12, height=6
- Text header: width=12, height=1
- Global filters: three filters per row at width=4, height=2
- Chart color/grouping dimensions: limit to 3-8 distinct values for readability
- High-cardinality dimensions (customer_id, SKU): use table widget, never chart
- Standard layout: title (y=0) → subtitle (y=1) → KPIs (y=2, 3 x w=4) → section header → charts → table`;

const MV_SQL_RULES = `Metric View SQL in Dashboards:
- MEASURE() wrapper with AS alias on ALL measures: MEASURE(\`Total Revenue\`) AS total_revenue
- NEVER prefix measure columns with a table alias (use MEASURE(col), NOT alias.col)
- Always GROUP BY ALL or explicit GROUP BY on dimension columns
- NEVER use SELECT * on a metric view (not supported)
- Validate with EXPLAIN dry-run before deploying
- Dimension columns referenced by bare name (no MEASURE wrapper)`;

const skill: SkillDefinition = {
  id: "databricks-dashboard-sql",
  name: "Databricks Dashboard SQL Patterns",
  description:
    "Lakeview dashboard dataset SQL rules, widget field matching, 12-column GRID_V1 layout, " +
    "filter widget patterns, and metric view SQL compliance.",
  relevance: {
    intents: ["dashboard"],
    geniePasses: ["metricViews"],
    pipelineSteps: ["sql-generation"],
  },
  chunks: [
    {
      id: "dash-dataset-rules",
      title: "Dataset SQL Rules",
      content: DATASET_RULES,
      category: "rules",
    },
    {
      id: "dash-widget-rules",
      title: "Widget Field Rules",
      content: WIDGET_RULES,
      category: "rules",
    },
    {
      id: "dash-layout-rules",
      title: "Layout Rules",
      content: LAYOUT_RULES,
      category: "rules",
    },
    {
      id: "dash-mv-sql",
      title: "Metric View SQL in Dashboards",
      content: MV_SQL_RULES,
      category: "rules",
    },
  ],
};

registerSkill(skill);

export default skill;
