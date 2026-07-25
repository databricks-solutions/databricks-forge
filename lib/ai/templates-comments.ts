/**
 * Prompt templates for AI Comment generation (table + column descriptions).
 *
 * These produce catalog-quality descriptions suitable for applying directly
 * to Unity Catalog via COMMENT ON TABLE / ALTER COLUMN COMMENT.
 */

export const TABLE_COMMENT_PROMPT = `You are a senior data catalog documentation expert. Generate a concise, business-friendly description for each table listed below. These descriptions will be written directly into Unity Catalog as the official table comment.

{industry_context}
{business_context}
Tables requiring descriptions:
{table_list}

{lineage_context}
Guidelines:
- Write 1-2 sentences per table. Target 80-150 characters.
- Be factual, specific, and business-oriented. Avoid jargon unless domain-appropriate.
- Do NOT repeat the table name in the description.
- Mention the table's role in the data pipeline or business process when lineage is available.
- If the table already has a comment, improve it -- do not return the original unchanged.
- Use present tense ("Stores", "Contains", "Tracks") not past tense.
- Reference relevant business entities, metrics, or processes.

Return a JSON array:
[{"table_fqn": "catalog.schema.table", "description": "..."}]`;

export const COLUMN_COMMENT_PROMPT = `You are a senior data catalog documentation expert. Generate concise, business-friendly descriptions for each column in the table below. These descriptions will be written directly into Unity Catalog as official column comments.

{industry_context}
Table: {table_fqn}
Table description: {table_description}

Columns:
{column_list}

Guidelines:
- Write 1 sentence per column. Target 40-120 characters.
- Be specific: mention units (e.g., "in USD", "in milliseconds"), formats, or allowed values where evident.
- For ID/key columns, state what entity they reference.
- For date/timestamp columns, state what event they represent.
- For boolean/flag columns, describe the condition they represent.
- If the column already has a good comment, return null for description.
- Do NOT repeat the column name as the description.
- Use domain-appropriate terminology for the industry context.

Return a JSON array:
[{"column_name": "col_name", "description": "..." or null}]`;
