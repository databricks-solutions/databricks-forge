/**
 * Databricks Data Modeling skill.
 *
 * Star schema design, Kimball methodology, Liquid Clustering, SCD patterns,
 * key constraints, and data modeling anti-patterns. Split from the original
 * databricks-sql-patterns skill to separate concerns.
 */

import type { SkillDefinition } from "../types";
import { registerSkill } from "../registry";

const STAR_SCHEMA = `Databricks Star Schema & Kimball Patterns:
- Gold layer: star schema (denormalized dimensions, normalized facts at the grain of the business event)
- Silver layer: OBT (One Big Table) or Data Vault for rapid integration and cleansing
- Kimball methodology: (1) identify the business process, (2) declare the grain, (3) choose dimensions (who/what/where/when/why/how), (4) identify facts (numeric measures at declared grain)
- Fact table types: Transaction (one row per event, most common), Periodic Snapshot (one row per entity per period), Accumulating Snapshot (one row per lifecycle, updated at milestones)
- Dimension tables: highly denormalized -- flatten many-to-one relationships within a single dimension table
- Conformed dimensions: shared across multiple fact tables (e.g. dim_date, dim_customer) for consistent reporting
- Degenerate dimensions: dimensions stored directly in the fact table (e.g. order_number, invoice_id) with no separate dim table`;

const KEYS_CONSTRAINTS = `Key Constraints & Metadata for Databricks Tables:
- Use GENERATED ALWAYS AS IDENTITY for surrogate keys; integer surrogates outperform string keys for joins
- Define PRIMARY KEY constraints on dimension surrogate keys for optimizer hints
- Define FOREIGN KEY constraints on fact table FK columns to help the query optimizer
- Add COMMENT on ALL tables and columns -- critical for AI/BI Genie and metric view discoverability
- Apply TAGS for governance: PII sensitivity, data tier (bronze/silver/gold), data owner, freshness SLA
- Store DECIMAL(18,2) for financial/monetary values -- NEVER FLOAT/DOUBLE (precision errors)
- Use DATE type for date-only columns, TIMESTAMP_NTZ for timezone-independent timestamps`;

const LIQUID_CLUSTERING = `Liquid Clustering Guidance (Databricks):
- Prefer Liquid Clustering over traditional partitioning for ALL new Delta tables
- Choose 1-4 clustering keys; fewer is better for tables under 10 TB (2 keys often outperform 4)
- Cluster fact tables by the most commonly filtered foreign keys (e.g. date_key, customer_key)
- Cluster dimension tables by primary key plus common filter columns
- Use CLUSTER BY AUTO when unsure about clustering keys -- Databricks auto-selects
- Liquid Clustering is NOT compatible with partitioning or Z-ORDER on the same table
- Traditional partitioning: only for very large tables (hundreds of TB) with stable, low-cardinality partition key
- Z-ORDER is legacy; always prefer Liquid Clustering for new tables
- Enable predictive optimization for managed tables (auto OPTIMIZE + VACUUM)`;

const SCD_PATTERNS = `Slowly Changing Dimension (SCD) Patterns:
- SCD Type 1 (overwrite): in-place updates via MERGE INTO with WHEN MATCHED THEN UPDATE SET *
- SCD Type 2 (history): version records with surrogate keys, effective_start_date, effective_end_date, is_current columns
- SCD Type 2 implementation: MERGE INTO to close current record (SET is_current = FALSE, effective_end_date = current_timestamp()) WHEN MATCHED AND source has changes + INSERT new version WHEN NOT MATCHED
- Delta Lake Time Travel provides complementary historical access within configured retention
- Prefer CREATE OR REPLACE TABLE over DROP IF EXISTS + CREATE`;

const DM_ANTI_PATTERNS = `Data Modeling Anti-Patterns (AVOID these):
- Skipping dimensional modeling in Gold layer (OBTs are fine for Silver, but Gold should use star schemas)
- Over-partitioning (more than 5000 partitions degrades performance; use Liquid Clustering instead)
- String surrogate keys (integer IDENTITY columns are faster for joins)
- Missing PK/FK constraints (deprives the optimizer of relationship information)
- Missing COMMENT and TAGS on tables/columns (reduces discoverability for AI/BI tools)
- Using FLOAT/DOUBLE for financial data (use DECIMAL to avoid precision errors)
- Filtering on ARRAY/MAP columns in WHERE clauses (lacks column-level statistics for data skipping)
- Too many Liquid Clustering keys (for tables under 10 TB, 2 keys often outperform 4)
- Manual OPTIMIZE/VACUUM without predictive optimization
- DELETE + INSERT when MERGE INTO achieves the same result`;

const skill: SkillDefinition = {
  id: "databricks-data-modeling",
  name: "Databricks Data Modeling Patterns",
  description:
    "Star schema design, Kimball methodology, Liquid Clustering, SCD patterns, " +
    "key constraints, metadata best practices, and data modeling anti-patterns.",
  relevance: {
    intents: ["technical"],
    geniePasses: ["columnIntelligence", "instructions", "joinInference"],
    pipelineSteps: ["table-filtering", "sql-generation"],
  },
  chunks: [
    {
      id: "dm-star-schema",
      title: "Star Schema & Kimball Patterns",
      content: STAR_SCHEMA,
      category: "patterns",
    },
    {
      id: "dm-keys-constraints",
      title: "Key Constraints & Metadata",
      content: KEYS_CONSTRAINTS,
      category: "rules",
    },
    {
      id: "dm-liquid-clustering",
      title: "Liquid Clustering Guidance",
      content: LIQUID_CLUSTERING,
      category: "patterns",
    },
    {
      id: "dm-scd",
      title: "SCD Patterns",
      content: SCD_PATTERNS,
      category: "patterns",
    },
    {
      id: "dm-anti-patterns",
      title: "Data Modeling Anti-Patterns",
      content: DM_ANTI_PATTERNS,
      category: "anti-patterns",
    },
  ],
};

registerSkill(skill);

export default skill;
