/**
 * Data Gap — per-asset Source-System Resolver (Phase 3.3, honesty refresh).
 *
 * Given a Reference Data Asset + the lineage-attributed source systems
 * from upstream use cases (Phase 3.1 output on `ForgeUseCase`), return
 * the concrete source-system attribution(s) for THIS asset along with a
 * recommended ingestion strategy hint. The Data Gap engine wires this
 * resolver into every `AssetCoverage` row so the UI can render:
 *
 *   "Customer Master Data — sourced from Salesforce CRM
 *      → Preferred path: Lakeflow Connect (Salesforce connector)"
 *
 * Pure function. No I/O, no LLM. Unit-tested in
 * `__tests__/engines/data-gap-source-systems.test.ts`.
 *
 * Resolution order (highest confidence first):
 *
 *   1. **lineage**     — at least one use case linked to this asset has
 *                        `sourceSystems` populated by the upstream-lineage
 *                        attribution pass (P3.1). The asset's source is
 *                        therefore CONFIRMED by what the customer is
 *                        actually using today. `name` is the concrete
 *                        vendor (Salesforce / SAP / Snowflake / …) because
 *                        evidence supports naming it.
 *   2. **master-repo** — fall back to the asset's `systemKind` /
 *                        `systemLocation`. The asset's source is therefore
 *                        EXPECTED but not yet confirmed by observed usage,
 *                        so `name` is the CATEGORY ("CRM systems",
 *                        "ERP systems", "Cloud data warehouse"…) and
 *                        `exampleVendors` lists common vendors in that
 *                        category. We deliberately do NOT name a specific
 *                        vendor here — the master repo describes a
 *                        typical industry pattern, not what THIS customer
 *                        actually runs. Sales asks the customer which
 *                        vendor they use; the recommended ingestion
 *                        strategy is the typical path for the category.
 *   3. **unknown**     — neither signal fires. The UI should render
 *                        "Unconfirmed sources — confirm with the
 *                        customer". `likelyCategories` lists the
 *                        SystemKind(s) the missing assets would normally
 *                        come from, so sales can ask targeted discovery
 *                        questions.
 *
 * The recommendation hint is a single canonical `IngestionStrategy`
 * derived from the resolved source (concrete vendor for lineage, category
 * for master-repo). P3.4 uses this hint to override the generic ranking
 * produced by `buildIngestionRecommendations` when a concrete source has
 * been resolved.
 */

import {
  classifySystemLocation,
  type SystemKind,
} from "@/lib/domain/tech-to-system";
import type { ReferenceDataAsset } from "@/lib/domain/industry-outcomes/master-repo-types";
import type { IngestionStrategy } from "./types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SourceSystemOrigin = "lineage" | "master-repo" | "unknown";

export interface ResolvedSourceSystem {
  /**
   * Display name. Examples:
   *   - lineage     → concrete vendor ("Salesforce", "SAP", "Snowflake")
   *   - master-repo → category name ("CRM systems", "Cloud data warehouse")
   *   - unknown     → "Unknown"
   */
  name: string;
  /** Where the attribution came from — drives the UI badge color. */
  origin: SourceSystemOrigin;
  /**
   * Canonical SystemKind for this source. For lineage rows this maps via
   * `systemKindFor(vendor)`; for master-repo rows this is the asset's
   * resolved kind; for unknown rows this is `null`.
   */
  systemKind: SystemKind | null;
  /**
   * Hinted preferred ingestion strategy for this resolved source. Drives
   * the P3.4 override of `buildIngestionRecommendations`. Null when no
   * concrete hint is available (e.g. unknown rows fall through to the
   * generic master-repo ranking).
   */
  preferredStrategy: IngestionStrategy | null;
  /**
   * For `origin === "master-repo"`: common vendors in the resolved
   * category, used by the UI to render "e.g. Salesforce, HubSpot,
   * Microsoft Dynamics 365" beneath the category name. Undefined for
   * lineage rows (we have the actual vendor) and unknown rows (we have
   * no signal at all).
   */
  exampleVendors?: string[];
  /**
   * For `origin === "unknown"`: the SystemKind(s) the missing assets
   * would typically come from in the industry reference architecture.
   * Lets the UI render "Likely categories: CRM, ERP, ITSM" so sales
   * knows which discovery questions to ask. Undefined for any row whose
   * source is actually resolved.
   */
  likelyCategories?: SystemKind[];
}

export interface AssetSourceSystemInput {
  asset: ReferenceDataAsset;
  /**
   * Canonical source-system names attributed (via P3.1) to ANY use case
   * that references this asset. Pass the union across all MC+VA use
   * cases — the resolver dedups and weights by how many upstream UCs
   * voted for each system.
   */
  useCaseSourceSystems: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Canonical system-name → preferred Lakeflow ingestion strategy (lineage path)
// ---------------------------------------------------------------------------

/**
 * For the canonical source-system names produced by the Phase 3.1
 * attribution pass, pick the single best ingestion strategy that the
 * Databricks platform currently supports.
 *
 * The values reflect mid-2026 reality:
 *
 *   - **lakeflow_connect** — SaaS apps (Salesforce, Workday, ServiceNow,
 *     etc.) and Postgres/MySQL/MongoDB CDC where a managed connector
 *     exists today.
 *   - **uc_federation** — peer cloud warehouses where federation is
 *     cheaper than copy (Snowflake, BigQuery, Redshift, Synapse).
 *   - **lakebridge_migrate** — heavy legacy migrations where one-time
 *     re-platforming is the right move (SAP, Teradata, Oracle EBS,
 *     SQL Server).
 *   - **bespoke** — object storage / streaming where Auto Loader or a
 *     custom consumer is the typical pattern (S3, ADLS, GCS, Kafka, etc.).
 *
 * Unknown / unmatched names return `null` and the UI falls through to the
 * generic per-asset ranking in `buildIngestionRecommendations`.
 */
const SYSTEM_TO_PREFERRED_STRATEGY: Record<string, IngestionStrategy> = {
  // CRM / sales / marketing — Lakeflow Connect connectors today
  Salesforce: "lakeflow_connect",
  HubSpot: "lakeflow_connect",
  "Microsoft Dynamics": "lakeflow_connect",
  Marketo: "lakeflow_connect",
  Mailchimp: "lakeflow_connect",
  // Service / ITSM / HRIS
  Workday: "lakeflow_connect",
  ServiceNow: "lakeflow_connect",
  Zendesk: "lakeflow_connect",
  // ERP / finance — heavy legacy = Lakebridge / on-prem migrate
  SAP: "lakebridge_migrate",
  Oracle: "lakebridge_migrate",
  NetSuite: "lakeflow_connect",
  // OLTP — Lakeflow Connect CDC connectors
  PostgreSQL: "lakeflow_connect",
  MySQL: "lakeflow_connect",
  MongoDB: "lakeflow_connect",
  "Microsoft SQL Server": "lakebridge_migrate",
  // Cloud warehouses — UC Federation is cheaper than copy
  Snowflake: "uc_federation",
  BigQuery: "uc_federation",
  "Amazon Redshift": "uc_federation",
  "Azure Synapse": "uc_federation",
  Teradata: "lakebridge_migrate",
  // Object storage / streaming — Auto Loader / bespoke consumer
  "Amazon S3": "bespoke",
  "Azure Data Lake Storage": "bespoke",
  "Google Cloud Storage": "bespoke",
  "Apache Kafka": "bespoke",
  "AWS Kinesis": "bespoke",
  "Azure Event Hubs": "bespoke",
  // 3rd-party ingestion tools — already in place, treat as bespoke
  Fivetran: "bespoke",
  Airbyte: "bespoke",
};

/** Canonical name → coarse SystemKind for badge grouping. */
const SYSTEM_TO_KIND: Record<string, SystemKind> = {
  Salesforce: "CRM",
  HubSpot: "CRM",
  "Microsoft Dynamics": "CRM",
  Marketo: "ESP",
  Mailchimp: "ESP",
  Workday: "HRIS",
  ServiceNow: "ITSM",
  Zendesk: "ITSM",
  SAP: "ERP",
  Oracle: "ERP",
  NetSuite: "ERP",
  "Microsoft SQL Server": "ERP",
  PostgreSQL: "Other",
  MySQL: "CMS",
  MongoDB: "Other",
  Snowflake: "Data Warehouse",
  BigQuery: "Data Warehouse",
  "Amazon Redshift": "Data Warehouse",
  "Azure Synapse": "Data Warehouse",
  Teradata: "Data Warehouse",
  "Amazon S3": "Data Lake",
  "Azure Data Lake Storage": "Data Lake",
  "Google Cloud Storage": "Data Lake",
  "Apache Kafka": "Other",
  "AWS Kinesis": "Other",
  "Azure Event Hubs": "Other",
  Fivetran: "Other",
  Airbyte: "Other",
};

// ---------------------------------------------------------------------------
// Category → display name + example vendors + preferred strategy (master-repo path)
// ---------------------------------------------------------------------------

/**
 * Per-SystemKind defaults used when origin is `master-repo`. We never
 * name a specific vendor in this branch — the master repository describes
 * the typical industry pattern, not what THIS customer runs. Instead we
 * render the CATEGORY ("CRM systems") with EXAMPLES so sales asks the
 * customer "which CRM do you use?" rather than walking in saying "I see
 * you use Salesforce" when the customer actually runs HubSpot.
 *
 * The `preferredStrategy` reflects the canonical onboarding path for the
 * whole category — e.g. CRMs almost always have Lakeflow Connect
 * connectors, cloud warehouses are best UC-federated, legacy ERPs move
 * with Lakebridge, object storage / streaming is bespoke. The strategy
 * still applies even when we don't know the specific vendor, because the
 * preferred path is a property of the category for SaaS-anchored
 * systems.
 */
interface CategoryEntry {
  displayName: string;
  examples: string[];
  preferredStrategy: IngestionStrategy;
}

const CATEGORY_TO_EXAMPLES: Partial<Record<SystemKind, CategoryEntry>> = {
  // -- Customer-facing apps -------------------------------------------------
  CRM: {
    displayName: "CRM systems",
    examples: ["Salesforce", "HubSpot", "Microsoft Dynamics 365"],
    preferredStrategy: "lakeflow_connect",
  },
  CDP: {
    displayName: "Customer Data Platforms",
    examples: ["Salesforce Data Cloud", "Segment", "mParticle", "Adobe Real-Time CDP"],
    preferredStrategy: "lakeflow_connect",
  },
  ESP: {
    displayName: "Marketing automation / ESP",
    examples: ["Marketo", "Mailchimp", "Salesforce Marketing Cloud", "HubSpot Marketing"],
    preferredStrategy: "lakeflow_connect",
  },
  // -- Back office ---------------------------------------------------------
  ERP: {
    displayName: "ERP systems",
    examples: ["SAP", "Oracle EBS", "NetSuite", "Workday Financials"],
    preferredStrategy: "lakebridge_migrate",
  },
  Billing: {
    displayName: "Billing / subscription platforms",
    examples: ["Zuora", "Stripe Billing", "SAP Billing", "Oracle Billing"],
    preferredStrategy: "lakeflow_connect",
  },
  "Order Management": {
    displayName: "Order Management systems",
    examples: ["Manhattan Active Omni", "IBM Sterling", "SAP OMS", "Oracle OMS"],
    preferredStrategy: "lakebridge_migrate",
  },
  HRIS: {
    displayName: "HRIS systems",
    examples: ["Workday", "ADP", "SAP SuccessFactors", "Oracle HCM"],
    preferredStrategy: "lakeflow_connect",
  },
  ITSM: {
    displayName: "ITSM platforms",
    examples: ["ServiceNow", "Jira Service Management", "Zendesk", "Freshservice"],
    preferredStrategy: "lakeflow_connect",
  },
  // -- Data infrastructure -------------------------------------------------
  "Data Warehouse": {
    displayName: "Cloud data warehouse",
    examples: ["Snowflake", "BigQuery", "Amazon Redshift", "Azure Synapse", "Teradata"],
    preferredStrategy: "uc_federation",
  },
  "Data Lake": {
    displayName: "Cloud object storage / data lake",
    examples: ["Amazon S3", "Azure Data Lake Storage", "Google Cloud Storage"],
    preferredStrategy: "bespoke",
  },
  Lakehouse: {
    displayName: "External Databricks Lakehouse",
    examples: ["Databricks (other workspace / catalog)"],
    preferredStrategy: "uc_federation",
  },
  "Data Catalog": {
    displayName: "Data catalog / metastore",
    examples: ["AWS Glue Data Catalog", "Hive Metastore", "Apache Atlas"],
    preferredStrategy: "bespoke",
  },
  // -- Content / collaboration ---------------------------------------------
  "Doc Store": {
    displayName: "Document / knowledge stores",
    examples: ["Confluence", "SharePoint", "Notion", "Google Drive"],
    preferredStrategy: "bespoke",
  },
  ECM: {
    displayName: "Enterprise Content Management",
    examples: ["SharePoint", "OpenText Content Suite", "Documentum"],
    preferredStrategy: "bespoke",
  },
  EDMS: {
    displayName: "Electronic Document Management",
    examples: ["OpenText", "M-Files", "DocuWare"],
    preferredStrategy: "bespoke",
  },
  CMS: {
    displayName: "Content Management Systems",
    examples: ["WordPress", "Drupal", "Adobe Experience Manager", "Contentful"],
    preferredStrategy: "bespoke",
  },
  DAM: {
    displayName: "Digital Asset Management",
    examples: ["Bynder", "Adobe AEM Assets", "Brandfolder"],
    preferredStrategy: "bespoke",
  },
  MAM: {
    displayName: "Media Asset Management",
    examples: ["Avid MediaCentral", "Cantemo", "EditShare"],
    preferredStrategy: "bespoke",
  },
  // -- Marketing / ad-tech / experimentation -------------------------------
  "Identity Graph / Clean Room": {
    displayName: "Identity graph / clean room",
    examples: ["LiveRamp", "InfoSum", "AWS Clean Rooms", "Habu"],
    preferredStrategy: "bespoke",
  },
  "Ad Server / DSP / SSP": {
    displayName: "Ad-tech platforms (DSP / SSP / ad server)",
    examples: ["Google Ad Manager", "The Trade Desk", "Google DV360", "Magnite"],
    preferredStrategy: "bespoke",
  },
  Experimentation: {
    displayName: "Experimentation / feature flag platforms",
    examples: ["LaunchDarkly", "Optimizely", "Split.io", "Statsig"],
    preferredStrategy: "bespoke",
  },
  "BI / Analytics": {
    displayName: "BI / analytics platforms",
    examples: ["Tableau", "Power BI", "Looker", "ThoughtSpot"],
    preferredStrategy: "bespoke",
  },
  // -- ML / observability / security ---------------------------------------
  "Feature Store / Vector DB": {
    displayName: "Feature stores / vector DBs",
    examples: ["Databricks Feature Store", "Pinecone", "Weaviate", "Tecton"],
    preferredStrategy: "bespoke",
  },
  Observability: {
    displayName: "Observability platforms",
    examples: ["Datadog", "Splunk Observability", "New Relic", "Honeycomb"],
    preferredStrategy: "bespoke",
  },
  "SIEM / Security": {
    displayName: "Security / SIEM platforms",
    examples: ["Splunk", "Microsoft Sentinel", "CrowdStrike", "Palo Alto Cortex XSIAM"],
    preferredStrategy: "bespoke",
  },
  // -- Industrial / OT -----------------------------------------------------
  MES: {
    displayName: "Manufacturing Execution Systems",
    examples: ["Siemens Opcenter", "Rockwell FactoryTalk", "GE Proficy"],
    preferredStrategy: "bespoke",
  },
  "SCADA / Historian": {
    displayName: "SCADA / process historians",
    examples: ["AVEVA PI System (OSIsoft)", "AVEVA Wonderware Historian", "GE Proficy Historian"],
    preferredStrategy: "bespoke",
  },
  "CMMS / EAM": {
    displayName: "Asset Management (CMMS / EAM)",
    examples: ["IBM Maximo", "SAP EAM", "Infor EAM"],
    preferredStrategy: "lakebridge_migrate",
  },
  "QMS / LIMS": {
    displayName: "Quality / lab systems (QMS / LIMS)",
    examples: ["Veeva Vault QMS", "LabWare LIMS", "STARLIMS"],
    preferredStrategy: "bespoke",
  },
  "PLM / PDM": {
    displayName: "Product Lifecycle / Data Management",
    examples: ["Siemens Teamcenter", "PTC Windchill", "Dassault ENOVIA"],
    preferredStrategy: "bespoke",
  },
  // Intentionally NOT mapping `Other` — when the only signal is `Other`
  // we fall through to the unknown branch so the UI prompts sales to
  // confirm the source with the customer rather than pretending to know.
};

// ---------------------------------------------------------------------------
// Helpers — also exported for tests + P3.4 ingestion override
// ---------------------------------------------------------------------------

export function preferredStrategyFor(systemName: string): IngestionStrategy | null {
  return SYSTEM_TO_PREFERRED_STRATEGY[systemName] ?? null;
}

export function systemKindFor(systemName: string): SystemKind | null {
  return SYSTEM_TO_KIND[systemName] ?? null;
}

/**
 * Look up the master-repo category entry for an asset. Returns null when
 * neither `asset.systemKind` nor `classifySystemLocation(asset.systemLocation)`
 * resolves to a SystemKind we have a category entry for. Caller falls
 * through to the unknown branch in that case.
 *
 * Exported for tests + the unknown row's `likelyCategories` derivation.
 */
export function categoryEntryForAsset(
  asset: Pick<ReferenceDataAsset, "systemKind" | "systemLocation">,
): { entry: CategoryEntry; kind: SystemKind } | null {
  // Prefer the master-repo-classified kind on the asset itself; fall back
  // to re-classifying the free-form `systemLocation` for assets where
  // `systemKind` was not populated at build time.
  let kind: SystemKind | null = asset.systemKind ?? null;
  if (!kind && asset.systemLocation) {
    kind = classifySystemLocation(asset.systemLocation);
  }
  if (!kind) return null;
  const entry = CATEGORY_TO_EXAMPLES[kind];
  if (!entry) return null;
  return { entry, kind };
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/**
 * Resolve the source system(s) for a single Reference Data Asset.
 *
 * Returns an array because an asset can legitimately be sourced from
 * multiple systems (e.g. "Customer Master Data" might come from
 * Salesforce + SAP, both confirmed by lineage). When no signal fires at
 * all, returns a single `Unknown` entry so UI code can render a
 * consistent badge.
 */
export function resolveAssetSourceSystems(
  input: AssetSourceSystemInput,
): ResolvedSourceSystem[] {
  // 1. Lineage signal (highest confidence) — dedupe + canonicalise.
  const lineageHits = new Set<string>();
  for (const raw of input.useCaseSourceSystems) {
    const cleaned = (raw ?? "").trim();
    if (cleaned.length === 0) continue;
    lineageHits.add(cleaned);
  }

  if (lineageHits.size > 0) {
    return [...lineageHits]
      .sort()
      .map((name) => ({
        name,
        origin: "lineage" as const,
        systemKind: systemKindFor(name),
        preferredStrategy: preferredStrategyFor(name),
      }));
  }

  // 2. Master-repo fallback — emit CATEGORY + EXAMPLES, never a single
  //    vendor. We only know the asset's typical category from the
  //    industry reference architecture; the actual vendor varies by
  //    customer and must be confirmed in discovery.
  const category = categoryEntryForAsset(input.asset);
  if (category) {
    return [
      {
        name: category.entry.displayName,
        origin: "master-repo",
        systemKind: category.kind,
        preferredStrategy: category.entry.preferredStrategy,
        exampleVendors: [...category.entry.examples],
      },
    ];
  }

  // 3. Unknown — emit a single placeholder so the UI renders a stable
  //    badge. `likelyCategories` carries the asset's own systemKind (if
  //    known) so the UI can still hint "Likely category: <kind>" — but
  //    we don't name a vendor because we have no signal at all.
  const likelyCategories: SystemKind[] = [];
  if (input.asset.systemKind) likelyCategories.push(input.asset.systemKind);
  return [
    {
      name: "Unknown",
      origin: "unknown",
      systemKind: null,
      preferredStrategy: null,
      likelyCategories: likelyCategories.length > 0 ? likelyCategories : undefined,
    },
  ];
}
