/**
 * Environment Intelligence (Estate Scan) pipeline prompts.
 */

export const ENV_DOMAIN_CATEGORISATION_PROMPT = `You are a data governance expert. Categorise each table into a business domain and subdomain.

Tables:
{table_list}

{estate_context}
{lineage_summary}
{business_name_line}
Guidelines:
- Use standard domain names: Finance, Customer, Product, Operations, HR, Marketing, Supply Chain, Clinical, Data Engineering, etc.
- Tables in the same pipeline (via lineage) usually share a domain.
- Bronze/silver/gold layers within a domain share the domain.
- System/audit/log/quality tables go to "Data Engineering".

Return JSON array: [{"table_fqn": "...", "domain": "...", "subdomain": "..."}]`;

export const ENV_PII_DETECTION_PROMPT = `You are a data privacy expert. Scan each column for PII or sensitive data.

Tables and columns:
{table_list}

For EACH column that might contain sensitive data, classify it. Skip columns that are clearly non-sensitive (e.g., "id", "created_at", generic metrics).

Classifications: PII, Financial, Health, Authentication, Internal, Public
Confidence: high, medium, low
Regulations: GDPR, HIPAA, PCI-DSS, or null

Return JSON array: [{"table_fqn": "...", "column_name": "...", "classification": "...", "confidence": "...", "reason": "...", "regulation": "..."}]
Return empty array [] if no sensitive columns found.`;

export const ENV_AUTO_DESCRIPTIONS_PROMPT = `Generate a concise 1-2 sentence description for each table. The description should be suitable for a data catalog entry.

Tables (all missing descriptions):
{table_list}

{lineage_summary}
Guidelines:
- Be factual and specific. Don't repeat the table name.
- Mention the table's role in the data pipeline if lineage is available.
- Keep each description under 150 characters.

Return JSON array: [{"table_fqn": "...", "description": "..."}]`;

export const ENV_REDUNDANCY_DETECTION_PROMPT = `You are a data architect. Identify pairs of tables that appear to be duplicates or near-duplicates.

Tables and their columns:
{table_list}

Look for:
- Tables with 80%+ column name overlap
- Exact copies across schemas (staging vs production)
- Test copies of production tables
- Abandoned backups (e.g., table_name_bak, table_name_old)

Return JSON array: [{"tableA": "fqn", "tableB": "fqn", "similarityPercent": 95, "sharedColumns": ["col1","col2"], "reason": "...", "recommendation": "consolidate|archive|investigate"}]
Return empty array [] if no redundancies found.`;

export const ENV_IMPLICIT_RELATIONSHIPS_PROMPT = `You are a data modelling expert. Infer logical foreign key relationships from column naming patterns.

Tables and columns:
{table_list}

Look for:
- Columns like customer_id, cust_id, user_id matching id/key columns in other tables
- Naming conventions: _id, _key, _fk suffixes
- Compatible data types between source and target columns

Confidence levels:
- high: exact column name match + compatible type (e.g., orders.customer_id -> customers.customer_id)
- medium: semantic match (e.g., orders.cust_id -> customers.id)
- low: possible but uncertain

Return JSON array: [{"sourceTableFqn": "...", "sourceColumn": "...", "targetTableFqn": "...", "targetColumn": "...", "confidence": "high|medium|low", "reasoning": "..."}]
Return empty array [] if no relationships found.`;

export const ENV_MEDALLION_TIER_PROMPT = `Classify each table into a medallion architecture tier.

Tables:
{table_list}

{lineage_summary}
Tiers:
- bronze: raw/landing/ingestion data (naming hints: raw_, stg_, landing_, ingest_)
- silver: cleaned/conformed/joined data (naming hints: cleaned_, conformed_, enriched_)
- gold: business-ready aggregated/serving data (naming hints: dim_, fact_, agg_, report_, dashboard_)
- system: logs, audit, metadata, quality monitoring tables

Return JSON array: [{"table_fqn": "...", "tier": "bronze|silver|gold|system", "reasoning": "..."}]`;

export const ENV_DATA_PRODUCTS_PROMPT = `You are a data mesh strategist. Identify logical data products from these tables.

A data product is a self-contained, reusable set of tables serving a business purpose (e.g., "Customer 360", "Order Fulfillment", "Clinical Trials").

Tables:
{table_list}

{estate_context}
{domain_summary}
{lineage_summary}
Consider:
- Domain clusters, lineage chains (bronze -> silver -> gold)
- Naming prefixes, shared ownership
- Tables that together answer business questions

Maturity levels:
- raw: just data tables, no clear product boundary
- curated: organised with some documentation
- productised: well-defined boundaries, clear ownership, documented

Return JSON array: [{"productName": "...", "description": "...", "tables": ["fqn1","fqn2"], "primaryDomain": "...", "maturityLevel": "raw|curated|productised", "ownerHint": "..."}]
Return empty array [] if no clear data products found.`;

export const ENV_CANONICAL_ENTITIES_PROMPT = `You are an enterprise data architect building a business ontology for a C-level audience.

Group the physical tables below into CANONICAL BUSINESS ENTITIES -- the real-world things the business cares about (e.g. "Well", "Cargo", "Refinery Unit", "Trade", "Customer", "Asset"). Several physical tables (bronze/silver/gold layers, staging copies, marts) often represent ONE canonical entity.

Tables (with domain and tier where known):
{table_list}

{estate_context}
{domain_summary}
Guidelines:
- Name entities as singular business nouns a director would recognise, NOT table names.
- Assign each entity to one of the business domains listed in the domain summary when possible.
- Group bronze/silver/gold and staging variants of the same thing into ONE entity.
- Every entity must list the physical table FQNs that represent it (use the exact FQNs given).
- Keep descriptions to one plain-language sentence for an executive.
- Also surface up to 12 BUSINESS GLOSSARY TERMS: domain terms an exec should know, each with a one-line definition.

Return JSON:
{"entities": [{"name": "...", "domain": "...", "description": "...", "tables": ["fqn1","fqn2"]}], "glossary": [{"term": "...", "definition": "...", "relatedEntities": ["..."]}]}`;

export const ENV_GOVERNANCE_GAPS_PROMPT = `You are a data governance analyst. For each table with detected gaps, provide a prioritised governance assessment.

Tables with detected gaps:
{table_list}

Gap categories: documentation, ownership, sensitivity, access_control, maintenance, lineage, tagging
Severity: critical, high, medium, low

For each table, produce an overall governance score (0-100, where 100 is perfect) and list the specific gaps with recommendations.

Return JSON array:
[{"tableFqn": "...", "overallScore": 75, "gaps": [{"category": "...", "severity": "...", "detail": "...", "recommendation": "..."}]}]`;

export const ENV_ANALYTICS_MATURITY_PROMPT = `You are an analytics strategy consultant. Assess the analytics maturity of this data estate based on the table inventory and existing analytics assets.

{business_name_line}
{estate_context}

## Table Inventory Summary
- Total tables: {table_count}
- Business domains: {domain_count}
- Gold/Silver/Bronze distribution: {tier_distribution}

## Existing Analytics Assets
{asset_summary}

## Tables
{table_list}

Evaluate along these dimensions:
1. **coverage** — What percentage of business-critical tables have analytics built on them? Are there domains with no analytics at all?
2. **depth** — Do analytics go beyond basic reporting (e.g., metric views, curated Genie spaces with instructions/benchmarks)?
3. **freshness** — Are analytics built on gold-tier (refined) tables or raw sources?
4. **completeness** — Are there obvious gaps where high-value tables lack any analytics coverage?
5. **recommendations** — What are the top 5 actionable steps to improve the analytics layer?

Produce an overall analytics maturity score (0-100) and a maturity level: "nascent" (<25), "developing" (25-49), "established" (50-74), "advanced" (75-100).

Return JSON:
{
  "overallScore": 55,
  "level": "established",
  "dimensions": {
    "coverage": { "score": 60, "summary": "..." },
    "depth": { "score": 45, "summary": "..." },
    "freshness": { "score": 70, "summary": "..." },
    "completeness": { "score": 40, "summary": "..." }
  },
  "uncoveredDomains": ["domain1", "domain2"],
  "topRecommendations": [
    { "priority": 1, "action": "...", "impact": "high", "effort": "medium" }
  ]
}`;
