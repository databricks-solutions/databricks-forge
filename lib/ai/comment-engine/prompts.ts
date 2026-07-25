/**
 * Prompt templates for the Comment Engine.
 *
 * All prompts are explicitly optimised for Genie Space discoverability --
 * comments should contain business terms, synonyms, and context that help
 * natural language query resolution.
 *
 * @module ai/comment-engine/prompts
 */

import type { CommentOutputLanguage } from "./types";

// ---------------------------------------------------------------------------
// Output language directive
// ---------------------------------------------------------------------------

/**
 * Returns the natural-language directive instructing the LLM which language
 * to use for the generated descriptions. This is independent of the prompt
 * instructions themselves (which stay in English) -- only the OUTPUT must be
 * in the requested language.
 *
 * Identifiers (table/column FQNs, data types, asset codes) MUST stay verbatim
 * in any locale -- never translate them.
 */
export function buildLanguageDirective(language: CommentOutputLanguage): string {
  switch (language) {
    case "pt-BR":
      return [
        "### IDIOMA DE SAÍDA",
        "Escreva todas as descrições em português do Brasil.",
        "Use terminologia de negócio em português; mantenha nomes técnicos (tabelas, colunas, tipos de dados, códigos de ativos) em inglês como aparecem nos metadados.",
        "Aplique as diretrizes de estilo abaixo (tempo presente, termos de negócio, sinônimos, etc.) com seus equivalentes em português.",
      ].join("\n");
    case "es":
      return [
        "### IDIOMA DE SALIDA",
        "Escribe todas las descripciones en español.",
        "Usa terminología de negocio en español; mantén los nombres técnicos (tablas, columnas, tipos de datos, códigos de activos) en inglés tal como aparecen en los metadatos.",
        "Aplica las directrices de estilo a continuación (tiempo presente, términos de negocio, sinónimos, etc.) con sus equivalentes en español.",
      ].join("\n");
    case "en":
    default:
      return [
        "### OUTPUT LANGUAGE",
        "Write all descriptions in English.",
      ].join("\n");
  }
}

// ---------------------------------------------------------------------------
// Phase 2: Table Comments
// ---------------------------------------------------------------------------

export const TABLE_COMMENT_PROMPT = `You are a senior data catalog expert. Generate the highest-quality business description for each table below. These descriptions will be written into Unity Catalog and used by AI systems (Genie Spaces) to resolve natural language queries.

{language_directive}

{industry_context}
{business_context_block}
{data_asset_context}
{use_case_linkage}

### FULL SCHEMA CONTEXT
{schema_summary}

### LINEAGE CONTEXT
{lineage_context}

### TABLES TO DESCRIBE
{table_list}

### DESCRIPTION QUALITY GUIDELINES
1. Write 1-3 sentences per table. Target 100-200 characters.
2. Start with the table's PRIMARY PURPOSE (e.g., "Customer dimension linking demographics, lifecycle status, and segment codes").
3. Mention the table's ROLE in the data pipeline when known (e.g., "Curated from raw transaction feeds" or "Aggregated daily from order events").
4. Include BUSINESS TERMS that users would search for in a Genie Space (e.g., "revenue", "churn", "onboarding", "campaign performance").
5. Include COMMON SYNONYMS or alternative names (e.g., "Also known as: client master, customer profile").
6. Reference the table's RELATIONSHIPS to other tables when relevant (e.g., "Joins to dim_products via product_id for sales analysis").
7. If a table maps to an industry data asset, use the industry's standard terminology.
8. If the table has an existing comment that is already high quality, return it unchanged. Only replace generic or empty comments.
9. Use present tense ("Stores", "Contains", "Tracks", "Aggregates").
10. Do NOT repeat the table name verbatim in the description.
11. For write-frequency context: hourly/streaming tables are operational; daily/weekly are analytical; stale tables may be archived.
12. Do NOT reference medallion architecture tiers (Bronze, Silver, Gold) in descriptions. Focus on business purpose, not architectural classification.

Return a JSON array:
[{"table_fqn": "catalog.schema.table", "description": "..."}]`;

// ---------------------------------------------------------------------------
// Phase 3: Column Comments
// ---------------------------------------------------------------------------

export const COLUMN_COMMENT_PROMPT = `You are a senior data catalog expert. Generate precise, business-friendly descriptions for each column. These descriptions power natural language query resolution in Genie Spaces -- users will search using business terms, and your descriptions must make columns discoverable.

{language_directive}

{industry_context}

### TABLE CONTEXT
Table: {table_fqn}
Description: {table_description}
Domain: {table_domain}
Role: {table_role}
{data_asset_block}

### RELATED TABLES
{related_tables}

### COLUMNS TO DESCRIBE
{column_list}

### COLUMN DESCRIPTION GUIDELINES
1. Write 1-2 sentences per column. Target 50-150 characters.
2. Be SPECIFIC: state units (e.g., "in USD", "in milliseconds"), formats (e.g., "ISO 8601", "YYYY-MM-DD"), or allowed values where evident from the data type and naming.
3. For ID/key columns: state WHAT ENTITY they reference and which table they join to (e.g., "Unique customer identifier. FK to dim_customers.customer_id").
4. For date/timestamp columns: state WHAT EVENT they represent (e.g., "Timestamp when the order was placed by the customer").
5. For boolean/flag columns: describe the CONDITION (e.g., "True when the customer has opted into marketing communications").
6. For measure/amount columns: state the BUSINESS METRIC and units (e.g., "Order total in local currency before tax and discounts").
7. For code/enum columns: describe the DOMAIN (e.g., "Product category code from the merchandising hierarchy. Common values: ELECTRONICS, APPAREL, GROCERY").
8. Include BUSINESS TERMS users would search for (e.g., for a "segment_code" column: "Customer segmentation tier for personalization and campaign targeting").
9. Use terminology CONSISTENT with sibling tables in the same domain.
10. If the column already has a good, specific comment, return null for description (preserve it).
11. Do NOT repeat the column name as the description.

Return a JSON array:
[{"column_name": "col_name", "description": "..." or null}]`;

// ---------------------------------------------------------------------------
// Phase 4: Consistency Review
// ---------------------------------------------------------------------------

export const CONSISTENCY_REVIEW_PROMPT = `You are a data governance reviewer. Review the following table and column descriptions for quality and consistency. These descriptions are used by AI systems (Genie Spaces) to resolve natural language queries.

{language_directive}

### SCHEMA OVERVIEW
{schema_summary}

### GENERATED DESCRIPTIONS
{descriptions_list}

### REVIEW CHECKLIST
1. **Terminology consistency**: The same concept must use the same word everywhere. Flag cases where "customer" and "client", or "revenue" and "sales", or "order" and "transaction" are used interchangeably for the same entity.
2. **Cross-table reference accuracy**: When a column description says "FK to dim_customers", verify that dim_customers exists in the schema.
3. **Overly generic descriptions**: Flag any description that is just "Stores data", "Contains records", or similarly uninformative.
4. **Missing business context**: Flag descriptions that only describe structure (e.g., "Integer column") without business meaning.
5. **Genie-readiness**: Descriptions should contain business terms users would search for. Flag descriptions that only use technical jargon.

For each issue found, provide a fix. Only flag genuine quality issues -- do not change descriptions that are already good.

Return a JSON array (empty if no issues):
[{"table_fqn": "...", "column_name": "col_name" or null, "issue": "description of the problem", "original": "current description", "fixed": "improved description"}]`;
