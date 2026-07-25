/**
 * LLM Prompt Builder for Dashboard Design.
 *
 * Builds the system + user messages for the dashboard design pass.
 * Uses JSON mode to get a structured DashboardDesign response.
 */

import type { UseCase, BusinessContext } from "@/lib/domain/types";
import type {
  EnrichedSqlSnippetMeasure,
  EnrichedSqlSnippetDimension,
  EnrichedSqlSnippetFilter,
} from "@/lib/genie/types";
import type { FilterCandidate } from "./types";
import type { SemanticAssetManifest } from "@/lib/semantic-assets/types";
import { DATABRICKS_SQL_RULES } from "@/lib/toolkit/sql-rules";
import "@/lib/skills/content";
import { resolveForIntent, formatContextSections } from "@/lib/skills/resolver";
import { DASHBOARD_DATE_TRUNC_UNITS } from "./expressions";

export const DASHBOARD_SYSTEM_MESSAGE =
  "You are a Principal Analytics Engineer specialising in Databricks AI/BI (Lakeview) dashboards. " +
  "You design data-driven dashboards with SQL datasets and appropriate visualisations. " +
  "You produce structured JSON output only. Never include text outside the JSON object.";

export interface DashboardPromptInput {
  businessName: string;
  businessContext: BusinessContext | null;
  domain: string;
  subdomains: string[];
  useCases: UseCase[];
  /** Table FQNs available in this domain */
  tables: string[];
  /** Column schema info: "catalog.schema.table: col1 (TYPE), col2 (TYPE)" */
  columnSchemas: string[];
  measures?: EnrichedSqlSnippetMeasure[];
  dimensions?: EnrichedSqlSnippetDimension[];
  filters?: EnrichedSqlSnippetFilter[];
  filterCandidates?: FilterCandidate[];
  /** Persisted governed IDs available for deterministic dataset source resolution. */
  semanticManifest?: SemanticAssetManifest;
}

export function buildDashboardDesignPrompt(input: DashboardPromptInput): string {
  const {
    businessName,
    businessContext,
    domain,
    subdomains,
    useCases,
    tables,
    columnSchemas,
    measures,
    dimensions,
    filters,
    filterCandidates,
    semanticManifest,
  } = input;

  const sections: string[] = [];

  sections.push(`# Dashboard Design for "${domain}" Domain`);
  sections.push("");
  sections.push(`Business: ${businessName}`);
  if (businessContext) {
    sections.push(`Industry: ${businessContext.industries}`);
    if (businessContext.strategicGoals) {
      sections.push(`Strategic Goals: ${businessContext.strategicGoals}`);
    }
  }
  if (subdomains.length > 0) {
    sections.push(`Subdomains: ${subdomains.join(", ")}`);
  }
  sections.push("");

  // Use cases with SQL
  sections.push("## Use Cases");
  sections.push("");
  const topUseCases = useCases
    .filter((uc) => uc.sqlCode)
    .sort((a, b) => b.overallScore - a.overallScore)
    .slice(0, 8);

  if (topUseCases.length === 0) {
    const fallback = useCases.sort((a, b) => b.overallScore - a.overallScore).slice(0, 5);
    for (const uc of fallback) {
      sections.push(`### ${uc.name} (score: ${uc.overallScore.toFixed(2)})`);
      sections.push(`Statement: ${uc.statement}`);
      sections.push(`Tables: ${uc.tablesInvolved.join(", ")}`);
      sections.push("");
    }
  } else {
    for (const uc of topUseCases) {
      sections.push(`### ${uc.name} (score: ${uc.overallScore.toFixed(2)})`);
      sections.push(`Statement: ${uc.statement}`);
      sections.push(`Tables: ${uc.tablesInvolved.join(", ")}`);
      sections.push(`SQL:\n\`\`\`sql\n${uc.sqlCode}\n\`\`\``);
      sections.push("");
    }
  }

  // Available tables and columns
  sections.push("## Available Tables");
  sections.push("");
  for (const t of tables.slice(0, 20)) {
    sections.push(`- ${t}`);
  }
  sections.push("");

  if (columnSchemas.length > 0) {
    sections.push("## Column Schemas");
    sections.push("");
    for (const cs of columnSchemas.slice(0, 20)) {
      sections.push(cs);
    }
    sections.push("");
  }

  if (semanticManifest) {
    sections.push("## Governed Semantic IDs");
    sections.push(
      "Choose only exact IDs listed below. Do not invent IDs or write metric-view SQL; the engine resolves governed SQL deterministically.",
    );
    for (const measure of semanticManifest.measures) {
      sections.push(`- measure: ${measure.id} (${measure.name}, source: ${measure.source})`);
    }
    for (const dimension of semanticManifest.dimensions) {
      sections.push(
        `- dimension: ${dimension.id} (${dimension.name}, source: ${dimension.source})`,
      );
    }
    sections.push("");
  }

  // Legacy Genie enrichments remain a fallback when no persisted manifest exists.
  if (!semanticManifest && measures && measures.length > 0) {
    sections.push("## Known Measures");
    for (const m of measures.slice(0, 10)) {
      sections.push(`- ${m.name}: ${m.sql}`);
    }
    sections.push("");
  }

  if (!semanticManifest && dimensions && dimensions.length > 0) {
    sections.push("## Known Dimensions");
    for (const d of dimensions.slice(0, 10)) {
      sections.push(`- ${d.name}: ${d.sql}`);
    }
    sections.push("");
  }

  if (!semanticManifest && filters && filters.length > 0) {
    sections.push("## Known Filters");
    for (const f of filters.slice(0, 10)) {
      sections.push(`- ${f.name}: ${f.sql}`);
    }
    sections.push("");
  }

  if (filterCandidates && filterCandidates.length > 0) {
    sections.push("## Filter Candidates");
    sections.push("These columns are good candidates for interactive dashboard filters:");
    for (const fc of filterCandidates.slice(0, 8)) {
      sections.push(`- ${fc.name} (\`${fc.column}\` in ${fc.tableFqn}, type: ${fc.dataType})`);
    }
    sections.push("");
  }

  // Instructions
  sections.push("## Instructions");
  sections.push("");
  sections.push("Design a Databricks AI/BI dashboard for this domain. Create:");
  sections.push("");
  sections.push("1. **Datasets** (2-4 SQL queries):");
  sections.push(
    '   - A KPI summary dataset (purpose: "kpi") returning a single row with 3 aggregate metrics',
  );
  sections.push(
    '   - A trend dataset (purpose: "trend") with a date/time column for time-series charts',
  );
  sections.push(
    '   - A breakdown dataset (purpose: "breakdown") grouping by a categorical dimension',
  );
  sections.push('   - Optionally a detail dataset (purpose: "detail") showing key records');
  sections.push(
    "   - For each non-detail dataset, set measureIds and dimensionIds to exact governed IDs when available",
  );
  sections.push(
    "   - Keep grounded table SQL in sql as the fail-closed fallback; never write metric-view SQL",
  );
  sections.push("   - Detail datasets must use table SQL with empty semantic ID arrays");
  sections.push("");
  sections.push("2. **Widgets** (6-10 visualisations):");
  sections.push('   - 3 counters for KPIs (type: "counter") referencing the KPI dataset');
  sections.push('   - 1-2 line/bar charts for trends (type: "line" or "bar")');
  sections.push('   - 1-2 bar/pie charts for breakdowns (type: "bar" or "pie")');
  sections.push('   - Optionally 1 table for detail records (type: "table")');
  sections.push("");
  sections.push("3. **Filter widgets** (1-3 global filters, included in the widgets array):");
  sections.push(
    '   - 1 date-range filter (type: "filter-date-range-picker") if a date/timestamp column exists in any dataset',
  );
  sections.push(
    '   - 1-2 categorical filters (type: "filter-multi-select") for dimensions with 3-10 distinct values',
  );
  sections.push("   - Filter fields MUST reference columns that exist in at least one dataset");
  sections.push(
    '   - Each filter widget has one field with role: "filter" and expression: "`column_name`"',
  );
  sections.push(
    "   - The filter column name in the filter widget must match the column alias used in the dataset SQL",
  );
  sections.push("");
  const dashSkills = resolveForIntent("dashboard", { contextBudget: 2500 });
  const dashSkillBlock = formatContextSections(dashSkills.contextSections);
  if (dashSkillBlock) {
    sections.push("### Dashboard Design Patterns");
    sections.push(dashSkillBlock);
    sections.push("");
  }
  sections.push("### SQL Rules");
  sections.push(DATABRICKS_SQL_RULES);
  sections.push("");
  sections.push("Dashboard-specific SQL rules:");
  sections.push("- Use ONLY fully-qualified table names (catalog.schema.table)");
  sections.push("- Use ONLY tables listed in Available Tables above");
  sections.push("- Use Spark SQL syntax (date_sub, DATE_TRUNC, not INTERVAL)");
  sections.push(
    "- When a date/time column is STRING type, parse it safely with COALESCE(try_to_date(col, 'yyyy-MM-dd'), try_to_date(col, 'MM/dd/yyyy')) -- NEVER use TO_DATE() which throws on format mismatches.",
  );
  sections.push(
    "- Each dataset is a SINGLE SELECT query (no semicolons, no CTEs with multiple statements)",
  );
  sections.push("- KPI dataset must return exactly 1 row");
  sections.push("- Trend dataset must include a date column");
  sections.push("- Breakdown dataset should use GROUP BY with ORDER BY and LIMIT 10");
  sections.push(
    "- When mixing aggregate functions (COUNT, SUM, AVG) with non-aggregated columns, you MUST include GROUP BY for every non-aggregated column, even when CROSS JOINing a single-row CTE.",
  );
  sections.push("- Always validate that each query can run standalone with no syntax errors.");
  sections.push("");
  sections.push("### Widget Fields");
  sections.push("Each widget field needs:");
  sections.push('- `name`: unique identifier (e.g., "sum(revenue)", "category", "order_date")');
  sections.push(
    '- `expression`: Lakeview expression — for counters: "`column_name`", for charts: "SUM(`col`)", "DATE_TRUNC(\\"MONTH\\", `date_col`)"',
  );
  sections.push(
    `- DATE_TRUNC uses a double-quoted unit from: ${DASHBOARD_DATE_TRUNC_UNITS.join(", ")}`,
  );
  sections.push(
    '- `role`: one of "value" (counters), "x" (chart x-axis), "y" (chart y-axis), "color" (chart grouping), "column" (table columns), "filter" (filter widgets)',
  );
  sections.push("");
  sections.push("### CRITICAL Rules");
  sections.push(
    '- Counter fields use role: "value" and expression should be a simple column reference like "`metric_name`"',
  );
  sections.push('- Chart x-axis fields need role: "x", y-axis fields need role: "y"');
  sections.push(
    '- Pie charts need one field with role: "y" (angle/size) and one with role: "color" (categories)',
  );
  sections.push('- Table fields all use role: "column"');
  sections.push("- Limit chart color/grouping dimensions to 3-8 distinct values");
  sections.push("");
  sections.push("### Output Format");
  sections.push("");
  sections.push("Return a single JSON object matching this schema:");
  sections.push("```");
  sections.push("{");
  sections.push('  "title": "Dashboard Title",');
  sections.push('  "description": "Brief description",');
  sections.push('  "datasets": [');
  sections.push(
    '    {"name": "snake_case_name", "displayName": "Human Name", "sql": "grounded table SQL fallback", "purpose": "kpi|trend|breakdown|detail", "measureIds": ["exact governed measure ID"], "dimensionIds": ["exact governed dimension ID"]}',
  );
  sections.push("  ],");
  sections.push('  "widgets": [');
  sections.push(
    '    {"type": "counter|bar|line|pie|table|filter-multi-select|filter-single-select|filter-date-range-picker", "title": "Widget Title", "datasetName": "snake_case_name", "fields": [{"name": "field_id", "expression": "`col`", "role": "value|x|y|color|column|filter"}]}',
  );
  sections.push("  ]");
  sections.push("}");
  sections.push("```");
  sections.push("");
  sections.push("Return ONLY the JSON object. No markdown fences, no preamble, no explanation.");

  return sections.join("\n");
}
