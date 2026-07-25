/**
 * Tech-to-System taxonomy.
 *
 * Sourced from the Master Repository "FYI - Mapping Tech to System" sheet
 * (30 rows). Maps a specific technology product (e.g. "AWS Glue Data Catalog",
 * "Snowflake", "Salesforce", "Workday Reports") to one or more canonical
 * SystemKind buckets used throughout the master repository's `systemLocation`
 * column on Reference Data Assets.
 *
 * Used by:
 *   - `lib/metadata/classifier.ts` to inform table -> ReferenceDataAsset
 *     mapping when a catalog table is tagged with a recognizable tech.
 *   - The Data Gap Analysis engine to choose per-missing-asset integration
 *     recommendations (e.g. "Salesforce -> CRM -> prefer Lakeflow Connect").
 */

/**
 * Canonical system kinds used in the master repository.
 *
 * The list deliberately mirrors the strings found in
 * `ReferenceDataAsset.systemLocation` so that classifiers and prompts can
 * pivot on a single vocabulary. Use `Other` for systems that do not cleanly
 * map (the master repo has long-tail values like "Plant SCADA -> Lake" that
 * are kept verbatim in `systemLocation`).
 */
export type SystemKind =
  | "Data Catalog"
  | "Data Lake"
  | "Data Warehouse"
  | "Lakehouse"
  | "Doc Store"
  | "ECM"
  | "EDMS"
  | "CMS"
  | "DAM"
  | "MAM"
  | "CRM"
  | "CDP"
  | "ERP"
  | "Billing"
  | "Order Management"
  | "HRIS"
  | "ITSM"
  | "ESP"
  | "Identity Graph / Clean Room"
  | "Ad Server / DSP / SSP"
  | "Feature Store / Vector DB"
  | "BI / Analytics"
  | "Experimentation"
  | "Observability"
  | "SIEM / Security"
  | "MES"
  | "SCADA / Historian"
  | "CMMS / EAM"
  | "QMS / LIMS"
  | "PLM / PDM"
  | "Other";

export interface TechMapping {
  /** Specific technology product as it appears in the source sheet. */
  tech: string;
  /**
   * One or more canonical system kinds the technology underpins. Some
   * technologies (e.g. SQL Server, SharePoint) underpin several systems and
   * carry multiple kinds.
   */
  systemKinds: SystemKind[];
  /** Rationale text from the source sheet, with citation links preserved. */
  rationale: string;
}

/**
 * The 30 tech-to-system mappings from the Master Repository.
 *
 * Rows with no explicit system mapping in the source (e.g. Kafka, Kinesis,
 * Pulsar) are intentionally omitted - the source sheet leaves the column
 * blank. Streaming platforms cross multiple system kinds and are better
 * disambiguated by the downstream destination (often a Data Lake).
 */
export const TECH_TO_SYSTEM_MAP: readonly TechMapping[] = [
  {
    tech: "AWS Glue Data Catalog",
    systemKinds: ["Data Catalog"],
    rationale:
      "AWS Glue Data Catalog is a centralized metadata store (managed Hive-compatible metastore) for datasets - commonly used to underpin data catalogs in lakes/warehouses.",
  },
  {
    tech: "Amazon Redshift",
    systemKinds: ["Data Warehouse"],
    rationale: "Amazon Redshift is a fully managed cloud data warehouse used for EDW workloads.",
  },
  {
    tech: "Amazon S3 (object storage)",
    systemKinds: ["Data Lake"],
    rationale: "Amazon S3 is object storage that underpins data lakes and archival content stores.",
  },
  {
    tech: "Azure Data Lake Storage Gen2 (ADLS Gen2)",
    systemKinds: ["Data Lake"],
    rationale:
      "Azure Data Lake Storage Gen2 provides hierarchical namespace object storage - the foundation for Azure data lakes.",
  },
  {
    tech: "Azure Synapse (SQL DW)",
    systemKinds: ["Data Warehouse"],
    rationale:
      "Azure Synapse Dedicated SQL pool (formerly SQL DW) provides enterprise data warehousing capabilities.",
  },
  {
    tech: "Databricks (other workspaces/catalogs)",
    systemKinds: ["Lakehouse", "Data Lake"],
    rationale:
      "Databricks lakehouse commonly uses cloud object storage as its data lake foundation, often cataloged via HMS / Unity Catalog.",
  },
  {
    tech: "External Hive Metastore (HMS)",
    systemKinds: ["Data Catalog"],
    rationale:
      "Hive Metastore stores table metadata (schemas / locations) used by engines across data lakes - the backbone of many lake catalogs.",
  },
  {
    tech: "Google BigQuery",
    systemKinds: ["Data Warehouse"],
    rationale: "BigQuery is Google Cloud's serverless enterprise data warehouse for analytics.",
  },
  {
    tech: "Google Cloud Storage (GCS)",
    systemKinds: ["Data Lake"],
    rationale: "Google Cloud Storage is durable object storage widely used as a data lake layer.",
  },
  {
    tech: "IBM DataStage (ETL)",
    systemKinds: ["Data Warehouse", "Data Lake"],
    rationale:
      "IBM DataStage is an ETL / ELT data integration tool that pipelines data into lakes and warehouses.",
  },
  {
    tech: "Informatica PowerCenter (ETL)",
    systemKinds: ["Data Warehouse", "Data Lake"],
    rationale:
      "Informatica PowerCenter is an enterprise ETL platform often used to load data warehouses / lakes.",
  },
  {
    tech: "Legacy Databricks Hive Metastore",
    systemKinds: ["Data Catalog"],
    rationale:
      "Legacy Databricks workspaces used an external Hive Metastore to hold table metadata for lakehouse tables.",
  },
  {
    tech: "Local files & internet downloads",
    systemKinds: ["Doc Store"],
    rationale:
      "Local files (CSV / XLSX / JSON) frequently act as ad-hoc document stores feeding content / document systems and analysis.",
  },
  {
    tech: "Microsoft SQL Server",
    systemKinds: ["ERP", "CRM", "Billing", "CMS", "Doc Store", "ECM", "EDMS"],
    rationale:
      "SQL Server underpins many enterprise apps including Microsoft Dynamics (via Azure SQL / Dataverse) and SharePoint content databases - typical sources for ERP / CRM / CMS data.",
  },
  {
    tech: "MySQL",
    systemKinds: ["CMS"],
    rationale:
      "MySQL is the canonical RDBMS for many CMS platforms (e.g. WordPress / Drupal), so it often underpins CMS content stores.",
  },
  {
    tech: "Oracle",
    systemKinds: ["ERP", "Billing", "CRM"],
    rationale:
      "Oracle Database is the required backend for Oracle E-Business Suite and commonly used with Siebel CRM - typical sources of ERP / Billing / CRM data.",
  },
  {
    tech: "PostgreSQL",
    systemKinds: ["Doc Store", "CMS"],
    rationale:
      "PostgreSQL is a supported backend for Atlassian Confluence (knowledge / document store) and other CMS-style apps.",
  },
  {
    tech: "Salesforce (Platform CRM / core objects)",
    systemKinds: ["CRM"],
    rationale:
      "Salesforce is a CRM platform; core objects model sales / service data that anchor enterprise CRM systems.",
  },
  {
    tech: "Salesforce Data Cloud",
    systemKinds: ["CDP"],
    rationale:
      "Salesforce Data Cloud is a customer data platform (CDP) unifying profiles and engagement data.",
  },
  {
    tech: "ServiceNow",
    systemKinds: ["ITSM"],
    rationale:
      "ServiceNow provides IT Service Management (ITSM) processes and data (incidents, CMDB).",
  },
  {
    tech: "SharePoint (files)",
    systemKinds: ["Doc Store", "ECM", "EDMS", "CMS"],
    rationale:
      "SharePoint is an enterprise document / content management system backed by SQL Server content databases.",
  },
  {
    tech: "Snowflake",
    systemKinds: ["Data Warehouse"],
    rationale:
      "Snowflake is a cloud data platform widely used as a data warehouse for analytics.",
  },
  {
    tech: "Teradata",
    systemKinds: ["Data Warehouse"],
    rationale:
      "Teradata is an enterprise data warehouse platform for large-scale analytics.",
  },
  {
    tech: "Workday Reports",
    systemKinds: ["HRIS"],
    rationale: "Workday is an HRIS / HCM / Finance platform; reports expose HRIS data domains.",
  },
];

/**
 * Heuristics for classifying a free-form `systemLocation` string (e.g.
 * "CRM / ERP & Billing", "CDP", "Identity Graph / Clean Room") into a single
 * best-fit SystemKind.
 *
 * Order matters: more specific patterns must be checked before catch-all
 * patterns. Returns null when nothing matches confidently.
 */
const LOCATION_HEURISTICS: ReadonlyArray<{ kind: SystemKind; needles: RegExp[] }> = [
  { kind: "CDP", needles: [/\bcdp\b/i] },
  {
    kind: "Identity Graph / Clean Room",
    needles: [/identity graph/i, /clean ?room/i],
  },
  { kind: "Lakehouse", needles: [/lakehouse/i, /unity catalog/i] },
  { kind: "Data Warehouse", needles: [/data ?warehouse/i, /\bdwh\b/i, /redshift|snowflake|bigquery|synapse|teradata/i] },
  { kind: "Data Lake", needles: [/data ?lake/i, /\bs3\b/i, /adls/i, /\bgcs\b/i] },
  { kind: "Data Catalog", needles: [/data ?catalog/i, /metastore/i] },
  { kind: "Order Management", needles: [/\boms\b/i, /order management/i] },
  { kind: "Billing", needles: [/billing/i, /cc&b/i] },
  { kind: "ERP", needles: [/\berp\b/i] },
  { kind: "CRM", needles: [/\bcrm\b/i] },
  { kind: "HRIS", needles: [/hris/i, /\bhcm\b/i] },
  { kind: "ITSM", needles: [/itsm/i, /service ?now/i] },
  { kind: "ESP", needles: [/\besp\b/i, /journey orchestration/i] },
  { kind: "Ad Server / DSP / SSP", needles: [/ad ?server/i, /\bdsp\b/i, /\bssp\b/i, /ssai/i] },
  { kind: "Feature Store / Vector DB", needles: [/feature ?store/i, /vector ?db/i] },
  { kind: "BI / Analytics", needles: [/\bbi\b/i, /research\/bi/i, /analytics/i] },
  { kind: "Experimentation", needles: [/experimentation/i, /feature ?flag/i] },
  { kind: "Observability", needles: [/observability/i, /monitoring/i] },
  { kind: "SIEM / Security", needles: [/siem/i, /soar/i] },
  { kind: "MES", needles: [/\bmes\b/i] },
  { kind: "SCADA / Historian", needles: [/scada/i, /historian/i, /\bpi\b/i] },
  { kind: "CMMS / EAM", needles: [/cmms/i, /\beam\b/i] },
  { kind: "QMS / LIMS", needles: [/qms/i, /lims/i, /\beln\b/i] },
  { kind: "PLM / PDM", needles: [/\bplm\b/i, /\bpdm\b/i] },
  { kind: "DAM", needles: [/\bdam\b/i] },
  { kind: "MAM", needles: [/\bmam\b/i] },
  { kind: "CMS", needles: [/\bcms\b/i] },
  { kind: "ECM", needles: [/\becm\b/i, /sharepoint/i] },
  { kind: "EDMS", needles: [/edms/i] },
  { kind: "Doc Store", needles: [/doc ?store/i, /confluence/i, /wiki/i] },
];

/**
 * Classify a `systemLocation` string into a canonical SystemKind. Returns
 * the most specific match, or null when no heuristic fires. Used by the seed
 * script to populate `ReferenceDataAsset.systemKind` from the free-form
 * `systemLocation` strings sourced from the master repository.
 */
export function classifySystemLocation(location: string): SystemKind | null {
  if (!location) return null;
  for (const { kind, needles } of LOCATION_HEURISTICS) {
    for (const re of needles) {
      if (re.test(location)) return kind;
    }
  }
  return null;
}

/**
 * Look up a tech mapping by free-form tech name (case-insensitive substring).
 */
export function findTechMapping(needle: string): TechMapping | undefined {
  if (!needle) return undefined;
  const lower = needle.toLowerCase();
  return TECH_TO_SYSTEM_MAP.find((m) => m.tech.toLowerCase().includes(lower) || lower.includes(m.tech.toLowerCase()));
}
