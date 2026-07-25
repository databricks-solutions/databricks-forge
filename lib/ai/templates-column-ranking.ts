/**
 * Prompt template for LLM-based column ranking.
 *
 * Used by the adaptive column budget engine when trimming is needed.
 * The LLM evaluates table/column descriptions and business context to
 * select the most business-relevant columns from wide tables.
 */

export const COLUMN_RANKING_PROMPT = `You are selecting the most business-relevant columns from wide database tables for use in AI-generated analytics use cases.

## Business Context

{business_context_summary}

## Instructions

For each table below, select exactly the requested number of columns. Return ONLY the column names, in priority order (most important first).

**Prioritise columns that:**
1. Are primary keys or foreign keys (needed for joins and relationships)
2. Directly relate to the business goals and priorities described above
3. Represent measurable business outcomes (revenue, cost, quantity, rate, score)
4. Provide important categorical context (status, type, segment, region, category)
5. Have descriptions indicating business importance or domain relevance
6. Are timestamps that enable time-series analysis (created_at, order_date, etc.)

**Deprioritise:**
- Audit/ETL columns (loaded_at, etl_batch_id, updated_by, row_hash)
- Deprecated columns (descriptions containing "deprecated", "do not use", "legacy")
- Internal system fields (internal_id, sys_*, _metadata)
- Redundant columns that duplicate information already covered by a selected column

## Tables

{tables_json}

## Output Format

Return a JSON object with a "rankings" key mapping each table identifier to an array of selected column names:

\`\`\`json
{{
  "rankings": {{
    "<table_identifier>": ["col1", "col2", "col3", ...],
    ...
  }}
}}
\`\`\`

Select EXACTLY the requested number of columns per table. Use the exact column names as provided.`;
