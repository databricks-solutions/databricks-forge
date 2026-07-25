import { describe, it, expect } from "vitest";
import {
  categoryEntryForAsset,
  preferredStrategyFor,
  resolveAssetSourceSystems,
  systemKindFor,
} from "@/lib/engines/data-gap-analysis/source-systems";
import type { ReferenceDataAsset } from "@/lib/domain/industry-outcomes/master-repo-types";

// -- Test fixtures -----------------------------------------------------------

function makeAsset(overrides: Partial<ReferenceDataAsset> = {}): ReferenceDataAsset {
  return {
    id: "customer-master",
    name: "Customer Master Data",
    description: "",
    assetFamily: "Customer Data",
    systemLocation: "CRM",
    systemKind: "CRM",
    easeOfAccess: "",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
    bespoke: "Low",
    accessRationale: undefined,
    ...overrides,
  } as ReferenceDataAsset;
}

// -- Tests -------------------------------------------------------------------

describe("resolveAssetSourceSystems — lineage path (vendor names preserved)", () => {
  it("prefers lineage signal over master-repo when both are present", () => {
    const out = resolveAssetSourceSystems({
      asset: makeAsset({ systemLocation: "CRM" }),
      useCaseSourceSystems: ["Salesforce"],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.origin).toBe("lineage");
    expect(out[0]?.name).toBe("Salesforce");
    expect(out[0]?.preferredStrategy).toBe("lakeflow_connect");
    // Lineage rows do NOT carry exampleVendors — we have the actual vendor.
    expect(out[0]?.exampleVendors).toBeUndefined();
  });

  it("dedups duplicate lineage hits and returns alphabetically sorted names", () => {
    const out = resolveAssetSourceSystems({
      asset: makeAsset(),
      useCaseSourceSystems: ["Workday", "Salesforce", "Workday", "Salesforce"],
    });
    expect(out.map((r) => r.name)).toEqual(["Salesforce", "Workday"]);
    expect(out.every((r) => r.origin === "lineage")).toBe(true);
  });
});

describe("resolveAssetSourceSystems — master-repo fallback (category + examples, NEVER a vendor)", () => {
  it("emits 'CRM systems' with example vendors when origin is master-repo (CRM)", () => {
    const out = resolveAssetSourceSystems({
      asset: makeAsset({ systemKind: "CRM", systemLocation: "CRM / Customer Master" }),
      useCaseSourceSystems: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.origin).toBe("master-repo");
    expect(out[0]?.name).toBe("CRM systems");
    expect(out[0]?.systemKind).toBe("CRM");
    expect(out[0]?.preferredStrategy).toBe("lakeflow_connect");
    expect(out[0]?.exampleVendors).toEqual([
      "Salesforce",
      "HubSpot",
      "Microsoft Dynamics 365",
    ]);
  });

  it("emits 'Cloud data warehouse' for Data Warehouse assets (preferredStrategy: uc_federation)", () => {
    const out = resolveAssetSourceSystems({
      asset: makeAsset({ systemKind: "Data Warehouse", systemLocation: "Data Warehouse" }),
      useCaseSourceSystems: [],
    });
    expect(out[0]?.origin).toBe("master-repo");
    expect(out[0]?.name).toBe("Cloud data warehouse");
    expect(out[0]?.preferredStrategy).toBe("uc_federation");
    expect(out[0]?.exampleVendors).toEqual(
      expect.arrayContaining(["Snowflake", "BigQuery", "Amazon Redshift"]),
    );
    // Crucially: even though the legacy code would have returned "Snowflake",
    // we now never name a single vendor when the source is only inferred.
    expect(out[0]?.name).not.toBe("Snowflake");
  });

  it("emits 'ERP systems' for ERP assets (preferredStrategy: lakebridge_migrate)", () => {
    const out = resolveAssetSourceSystems({
      asset: makeAsset({ systemKind: "ERP", systemLocation: "ERP" }),
      useCaseSourceSystems: [],
    });
    expect(out[0]?.name).toBe("ERP systems");
    expect(out[0]?.preferredStrategy).toBe("lakebridge_migrate");
    expect(out[0]?.exampleVendors).toEqual(
      expect.arrayContaining(["SAP", "Oracle EBS", "NetSuite"]),
    );
  });

  it("emits 'HRIS systems' for an HRIS-named systemLocation even when systemKind is missing", () => {
    const out = resolveAssetSourceSystems({
      asset: makeAsset({ systemKind: undefined, systemLocation: "Workday HCM" }),
      useCaseSourceSystems: [],
    });
    // classifySystemLocation maps "HCM" → HRIS; we re-derive when systemKind
    // is not pre-populated on the asset.
    expect(out[0]?.origin).toBe("master-repo");
    expect(out[0]?.name).toBe("HRIS systems");
    // Even though "Workday HCM" mentions Workday verbatim, we don't promote
    // the vendor — the master-repo's hint is still an industry pattern,
    // not customer reality.
    expect(out[0]?.name).not.toBe("Workday");
  });

  it("emits 'ITSM platforms' for ServiceNow-like systems", () => {
    const out = resolveAssetSourceSystems({
      asset: makeAsset({ systemKind: "ITSM", systemLocation: "ITSM" }),
      useCaseSourceSystems: [],
    });
    expect(out[0]?.name).toBe("ITSM platforms");
    expect(out[0]?.preferredStrategy).toBe("lakeflow_connect");
    expect(out[0]?.exampleVendors).toEqual(
      expect.arrayContaining(["ServiceNow"]),
    );
  });

  it("emits 'Customer Data Platforms' for CDP assets (previously fell through to Unknown)", () => {
    const out = resolveAssetSourceSystems({
      asset: makeAsset({ systemKind: "CDP", systemLocation: "CDP" }),
      useCaseSourceSystems: [],
    });
    expect(out[0]?.origin).toBe("master-repo");
    expect(out[0]?.name).toBe("Customer Data Platforms");
  });
});

describe("resolveAssetSourceSystems — unknown branch (no signal at all)", () => {
  it("emits a single 'Unknown' row with likelyCategories populated from systemKind", () => {
    const out = resolveAssetSourceSystems({
      asset: makeAsset({ systemKind: "Other", systemLocation: "" }),
      useCaseSourceSystems: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.origin).toBe("unknown");
    expect(out[0]?.name).toBe("Unknown");
    expect(out[0]?.preferredStrategy).toBeNull();
    expect(out[0]?.likelyCategories).toEqual(["Other"]);
  });

  it("emits Unknown with no likelyCategories when neither systemKind nor systemLocation classify", () => {
    const out = resolveAssetSourceSystems({
      asset: makeAsset({ systemKind: undefined, systemLocation: "" }),
      useCaseSourceSystems: [],
    });
    expect(out[0]?.origin).toBe("unknown");
    expect(out[0]?.likelyCategories).toBeUndefined();
  });

  it("ignores blank / whitespace-only lineage entries before falling back", () => {
    const out = resolveAssetSourceSystems({
      asset: makeAsset({ systemLocation: "CRM" }),
      useCaseSourceSystems: ["", "   ", " "],
    });
    expect(out[0]?.origin).toBe("master-repo");
    expect(out[0]?.name).toBe("CRM systems");
  });
});

describe("categoryEntryForAsset", () => {
  it("looks up the entry from asset.systemKind without re-classifying systemLocation", () => {
    const out = categoryEntryForAsset({ systemKind: "CRM", systemLocation: "irrelevant text" });
    expect(out?.kind).toBe("CRM");
    expect(out?.entry.displayName).toBe("CRM systems");
  });

  it("falls back to classifying systemLocation when systemKind is missing", () => {
    const out = categoryEntryForAsset({ systemKind: undefined, systemLocation: "Workday HCM" });
    expect(out?.kind).toBe("HRIS");
    expect(out?.entry.displayName).toBe("HRIS systems");
  });

  it("returns null for unmapped SystemKind values (Other / unclassifiable)", () => {
    // "Other" intentionally isn't in CATEGORY_TO_EXAMPLES so the resolver
    // falls through to the unknown branch instead of pretending to know.
    const out = categoryEntryForAsset({ systemKind: "Other", systemLocation: "" });
    expect(out).toBeNull();
  });
});

describe("preferredStrategyFor / systemKindFor (lineage-path lookups)", () => {
  it("maps SaaS apps to lakeflow_connect", () => {
    expect(preferredStrategyFor("Salesforce")).toBe("lakeflow_connect");
    expect(preferredStrategyFor("Workday")).toBe("lakeflow_connect");
    expect(preferredStrategyFor("ServiceNow")).toBe("lakeflow_connect");
  });

  it("maps cloud warehouses to uc_federation", () => {
    expect(preferredStrategyFor("Snowflake")).toBe("uc_federation");
    expect(preferredStrategyFor("BigQuery")).toBe("uc_federation");
    expect(preferredStrategyFor("Amazon Redshift")).toBe("uc_federation");
  });

  it("maps heavy legacy migrations to lakebridge_migrate", () => {
    expect(preferredStrategyFor("SAP")).toBe("lakebridge_migrate");
    expect(preferredStrategyFor("Oracle")).toBe("lakebridge_migrate");
    expect(preferredStrategyFor("Teradata")).toBe("lakebridge_migrate");
  });

  it("maps object storage / streaming to bespoke", () => {
    expect(preferredStrategyFor("Apache Kafka")).toBe("bespoke");
    expect(preferredStrategyFor("Amazon S3")).toBe("bespoke");
    expect(preferredStrategyFor("Azure Data Lake Storage")).toBe("bespoke");
  });

  it("returns null for unrecognised system names", () => {
    expect(preferredStrategyFor("Some Made-Up Vendor")).toBeNull();
    expect(systemKindFor("Some Made-Up Vendor")).toBeNull();
  });

  it("returns the canonical SystemKind for known systems", () => {
    expect(systemKindFor("Salesforce")).toBe("CRM");
    expect(systemKindFor("SAP")).toBe("ERP");
    expect(systemKindFor("Snowflake")).toBe("Data Warehouse");
  });
});
