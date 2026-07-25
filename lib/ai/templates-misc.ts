/**
 * Miscellaneous prompts: Outcome Map parsing, Export summaries, Metadata Genie.
 */

export const PARSE_OUTCOME_MAP = `You are an expert at extracting structured data from industry outcome map documents.

Your task is to parse the following markdown document into a structured JSON format representing an industry outcome map.

### INPUT DOCUMENT

{markdown_content}

### EXTRACTION RULES

1. **Industry Identity**: Extract the industry name, a short kebab-case id, and any sub-verticals mentioned.
2. **Objectives**: Identify the major strategic objectives (e.g., "Drive Growth", "Protect the Firm", "Optimize Operations"). These are the top-level groupings.
3. **Strategic Priorities**: Within each objective, identify strategic priorities (e.g., "Hyper Personalization", "Risk Management").
4. **Use Cases**: Within each priority, extract the core use cases with their name and description. If business value is mentioned, include it.
5. **Data Gap Hints**: For each use case, infer 2-4 typicalDataEntities (the data models/tables typically needed, e.g. "Customer Profiles", "Transaction History") and 2-3 typicalSourceSystems (common source systems, e.g. "Salesforce CRM", "SAP S/4HANA", "Core Banking Platform"). These help customers identify what data to onboard.
6. **KPIs**: Extract Key Objectives / KPIs for each priority. These are measurable metrics.
7. **Personas**: Extract Key Personas for each priority. These are job titles.
8. **Why Change**: For each objective, extract the "Why Change" or "Why Now" narrative as a concise summary (2-3 sentences).
9. **Suggested Domains**: Infer 4-6 suggested business domains based on the content.
10. **Suggested Priorities**: Infer 4-5 suggested business priorities from: "Increase Revenue", "Reduce Cost", "Mitigate Risk", "Enhance Experience", "Optimize Operations", "Drive Innovation", "Achieve ESG", "Protect Revenue".

### IMPORTANT

- Extract REAL content from the document. Do NOT invent or hallucinate content.
- If a section is missing (e.g., no KPIs listed), use an empty array.
- Combine "Why Change" and "Why Now" narratives into a single concise whyChange string per objective.
- Use cases should have clear, actionable names and descriptions.
- The id should be a short, unique kebab-case identifier (e.g., "banking", "energy-utilities", "digital-natives").
- Skip TODO placeholders, empty sections, and navigation/table-of-contents entries.

### OUTPUT FORMAT

Return a single valid JSON object matching this TypeScript interface:

{"id": string, "name": string, "subVerticals": string[], "suggestedDomains": string[], "suggestedPriorities": string[], "objectives": [{"name": string, "whyChange": string, "priorities": [{"name": string, "useCases": [{"name": string, "description": string, "businessValue": string | undefined, "typicalDataEntities": string[], "typicalSourceSystems": string[]}], "kpis": string[], "personas": string[]}]}]}

Return ONLY the JSON object. No markdown fences, no preamble, no explanation.`;

export const SUMMARY_GEN_PROMPT = `You are a senior management consultant writing an executive briefing on data-driven opportunities for **{business_name}**.

## CONTEXT

A discovery pipeline has generated **{total_cases}** use cases across these domains:
{domain_list}

## TASK

Produce a JSON object with two keys:

1. **"executiveSummary"** — a 3–5 sentence executive summary highlighting the most impactful opportunities, the breadth of the data estate, and recommended next steps.

2. **"domainSummaries"** — an object keyed by domain name, where each value is a 2–3 sentence narrative summary of the opportunities in that domain, the key tables involved, and the expected business impact.

Write in {output_language}. Be specific and reference actual domain names and use case themes. Avoid generic statements.

## OUTPUT FORMAT

Return ONLY a valid JSON object:

{"executiveSummary": "...", "domainSummaries": {"Domain A": "...", "Domain B": "..."}}

No markdown fences, no preamble.`;

export const METADATA_GENIE_INDUSTRY_DETECT_PROMPT = `### PERSONA

You are a **Senior Data Industry Analyst** with deep expertise in identifying business domains from data catalog metadata. You can determine an organisation's industry and key business areas purely from table and schema naming conventions.

### TASK

Given the following table names from a Unity Catalog metastore, identify the primary and secondary industries this data estate serves. Be specific — say "Commercial Banking, Wealth Management, Insurance" not just "Financial Services".

### TABLE / SCHEMA NAMES

{table_names}

### OUTPUT (JSON)

Return a single valid JSON object with these fields:

1. **industries** — A descriptive string of the primary and secondary industries represented. Be specific and use industry terminology that a business analyst would recognise.

2. **domains** — An array of key business domains you can identify from the table names (e.g. ["Claims", "Members", "Providers", "Pharmacy"] for insurance, or ["Orders", "Products", "Customers", "Inventory"] for retail). Include 3-10 domains.

3. **duplication_notes** — An array of observations about potential data duplication or redundancy patterns. For example, tables with the same name across different schemas, or near-identical table names suggesting copies. If none observed, return an empty array.

Return ONLY the JSON object. No markdown fences, no preamble.`;

export const METADATA_GENIE_DESCRIBE_TABLES_PROMPT = `Generate a concise 1-sentence business description for each table listed below. These tables have no existing description in the data catalog.

Tables (with their column names for context):
{table_list}

Guidelines:
- Describe the table's business purpose, not its technical structure.
- Be factual and specific — infer purpose from the table name and column names.
- Keep each description under 150 characters.
- If you cannot determine the purpose, write "General data table" rather than guessing wildly.

Return a JSON object: {"descriptions": [{"table_fqn": "catalog.schema.table", "description": "..."}]}`;
