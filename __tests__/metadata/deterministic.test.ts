import { describe, it, expect } from "vitest";
import {
  detectTierFromName,
  detectRoleFromName,
  detectNamingSignals,
  inferColumnRole,
  inferFkTarget,
  inferRelationshipsFromNaming,
  analyzeWriteFrequency,
  enrichColumns,
  buildSchemaNamingProfile,
} from "@/lib/metadata/deterministic";

// ---------------------------------------------------------------------------
// detectTierFromName
// ---------------------------------------------------------------------------

describe("detectTierFromName", () => {
  it("detects bronze from schema prefix", () => {
    expect(detectTierFromName("bronze_raw", "customers")).toBe("bronze");
    expect(detectTierFromName("raw_data", "orders")).toBe("bronze");
    expect(detectTierFromName("landing_zone", "events")).toBe("bronze");
    expect(detectTierFromName("staging", "transactions")).toBe("bronze");
  });

  it("detects silver from schema prefix", () => {
    expect(detectTierFromName("silver_clean", "customers")).toBe("silver");
    expect(detectTierFromName("cleansed", "orders")).toBe("silver");
    expect(detectTierFromName("curated", "events")).toBe("silver");
  });

  it("detects gold from schema prefix", () => {
    expect(detectTierFromName("gold_marts", "customers")).toBe("gold");
    expect(detectTierFromName("business_layer", "orders")).toBe("gold");
    expect(detectTierFromName("presentation", "events")).toBe("gold");
    expect(detectTierFromName("reporting", "summary")).toBe("gold");
  });

  it("detects tier from table prefix when schema has no prefix", () => {
    expect(detectTierFromName("default", "bronze_customers")).toBe("bronze");
    expect(detectTierFromName("default", "gold_summary")).toBe("gold");
  });

  it("returns null for unrecognized names", () => {
    expect(detectTierFromName("default", "customers")).toBeNull();
    expect(detectTierFromName("main", "orders")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectRoleFromName
// ---------------------------------------------------------------------------

describe("detectRoleFromName", () => {
  it("detects dimension tables", () => {
    expect(detectRoleFromName("dim_customers")).toBe("dimension");
    expect(detectRoleFromName("dimension_products")).toBe("dimension");
  });

  it("detects fact tables", () => {
    expect(detectRoleFromName("fact_orders")).toBe("fact");
    expect(detectRoleFromName("fct_transactions")).toBe("fact");
  });

  it("detects staging tables", () => {
    expect(detectRoleFromName("stg_raw_orders")).toBe("staging");
    expect(detectRoleFromName("tmp_processing")).toBe("staging");
  });

  it("detects lookup tables", () => {
    expect(detectRoleFromName("lkp_country_codes")).toBe("lookup");
    expect(detectRoleFromName("ref_currencies")).toBe("lookup");
  });

  it("detects audit tables", () => {
    expect(detectRoleFromName("audit_access_log")).toBe("audit");
    expect(detectRoleFromName("log_api_requests")).toBe("audit");
  });

  it("detects bridge tables", () => {
    expect(detectRoleFromName("bridge_customer_product")).toBe("bridge");
    expect(detectRoleFromName("xref_user_role")).toBe("bridge");
  });

  it("returns null for unrecognized names", () => {
    expect(detectRoleFromName("customers")).toBeNull();
    expect(detectRoleFromName("orders")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectNamingSignals
// ---------------------------------------------------------------------------

describe("detectNamingSignals", () => {
  it("combines tier and role detection", () => {
    const signals = detectNamingSignals("gold_marts", "dim_customers");
    expect(signals.prefixTier).toBe("gold");
    expect(signals.prefixRole).toBe("dimension");
    expect(signals.convention).toBe("snake_case");
  });

  it("detects mixed convention", () => {
    const signals = detectNamingSignals("default", "CustomerOrders123");
    expect(signals.convention).toBe("PascalCase");
  });
});

// ---------------------------------------------------------------------------
// inferColumnRole
// ---------------------------------------------------------------------------

describe("inferColumnRole", () => {
  it("detects primary keys", () => {
    expect(inferColumnRole("id", "BIGINT")).toBe("pk");
    expect(inferColumnRole("pk", "INT")).toBe("pk");
  });

  it("detects foreign keys", () => {
    expect(inferColumnRole("customer_id", "BIGINT")).toBe("fk");
    expect(inferColumnRole("order_key", "STRING")).toBe("fk");
    expect(inferColumnRole("product_fk", "INT")).toBe("fk");
  });

  it("detects timestamps", () => {
    expect(inferColumnRole("created_at", "TIMESTAMP")).toBe("timestamp");
    expect(inferColumnRole("updated_ts", "TIMESTAMP")).toBe("timestamp");
    expect(inferColumnRole("order_date", "DATE")).toBe("timestamp");
    expect(inferColumnRole("event_time", "TIMESTAMP")).toBe("timestamp");
  });

  it("detects boolean types as flags regardless of name", () => {
    expect(inferColumnRole("some_column", "BOOLEAN")).toBe("flag");
  });

  it("detects flag columns by name", () => {
    expect(inferColumnRole("is_active", "INT")).toBe("flag");
    expect(inferColumnRole("has_subscription", "INT")).toBe("flag");
    expect(inferColumnRole("active_flag", "STRING")).toBe("flag");
  });

  it("detects measure columns", () => {
    expect(inferColumnRole("total_amount", "DECIMAL")).toBe("measure");
    expect(inferColumnRole("order_qty", "INT")).toBe("measure");
    expect(inferColumnRole("unit_price", "DOUBLE")).toBe("measure");
    expect(inferColumnRole("balance_total", "DECIMAL")).toBe("measure");
  });

  it("detects code columns", () => {
    expect(inferColumnRole("country_code", "STRING")).toBe("code");
    expect(inferColumnRole("status_code", "STRING")).toBe("code");
  });

  it("returns null for unrecognized patterns", () => {
    expect(inferColumnRole("name", "STRING")).toBeNull();
    expect(inferColumnRole("description", "STRING")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// inferFkTarget
// ---------------------------------------------------------------------------

describe("inferFkTarget", () => {
  const allFqns = [
    "catalog.schema.customers",
    "catalog.schema.orders",
    "catalog.schema.products",
    "catalog.schema.dim_categories",
  ];

  it("infers FK target from _id suffix", () => {
    const target = inferFkTarget("customer_id", "catalog.schema.orders", allFqns);
    expect(target).toBe("catalog.schema.customers");
  });

  it("infers FK target from _key suffix", () => {
    const target = inferFkTarget("product_key", "catalog.schema.orders", allFqns);
    expect(target).toBe("catalog.schema.products");
  });

  it("handles plural matching (order -> orders)", () => {
    const target = inferFkTarget("order_id", "catalog.schema.products", allFqns);
    expect(target).toBe("catalog.schema.orders");
  });

  it("returns null when no match found", () => {
    const target = inferFkTarget("unknown_id", "catalog.schema.orders", allFqns);
    expect(target).toBeNull();
  });

  it("returns null for non-FK columns", () => {
    expect(inferFkTarget("name", "catalog.schema.orders", allFqns)).toBeNull();
    expect(inferFkTarget("total_amount", "catalog.schema.orders", allFqns)).toBeNull();
  });

  it("does not self-reference", () => {
    const target = inferFkTarget("customer_id", "catalog.schema.customers", allFqns);
    expect(target).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// inferRelationshipsFromNaming
// ---------------------------------------------------------------------------

describe("inferRelationshipsFromNaming", () => {
  it("discovers relationships across tables", () => {
    const tables = [
      {
        fqn: "c.s.orders",
        columns: [
          { name: "id", dataType: "BIGINT" },
          { name: "customer_id", dataType: "BIGINT" },
          { name: "product_id", dataType: "BIGINT" },
        ],
      },
      {
        fqn: "c.s.customers",
        columns: [
          { name: "id", dataType: "BIGINT" },
          { name: "name", dataType: "STRING" },
        ],
      },
      {
        fqn: "c.s.products",
        columns: [
          { name: "id", dataType: "BIGINT" },
          { name: "title", dataType: "STRING" },
        ],
      },
    ];

    const rels = inferRelationshipsFromNaming(tables);
    expect(rels.length).toBeGreaterThanOrEqual(2);

    const customerRel = rels.find(
      (r) => r.sourceTable === "c.s.orders" && r.targetTable === "c.s.customers",
    );
    expect(customerRel).toBeDefined();
    expect(customerRel!.sourceColumn).toBe("customer_id");
    expect(customerRel!.confidence).toBe("high");
    expect(customerRel!.basis).toBe("naming_pattern");
  });

  it("deduplicates relationships", () => {
    const tables = [
      {
        fqn: "c.s.orders",
        columns: [{ name: "customer_id", dataType: "BIGINT" }],
      },
      {
        fqn: "c.s.customers",
        columns: [{ name: "id", dataType: "BIGINT" }],
      },
    ];

    const rels = inferRelationshipsFromNaming(tables);
    const customerRels = rels.filter((r) => r.sourceColumn === "customer_id");
    expect(customerRels.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// analyzeWriteFrequency
// ---------------------------------------------------------------------------

describe("analyzeWriteFrequency", () => {
  it("returns unknown for null timestamp", () => {
    expect(analyzeWriteFrequency(null)).toBe("unknown");
  });

  it("detects stale tables", () => {
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    expect(analyzeWriteFrequency(old)).toBe("stale");
  });

  it("detects hourly writes from recent timestamp", () => {
    const recent = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    expect(analyzeWriteFrequency(recent)).toBe("hourly");
  });

  it("detects daily writes", () => {
    const yesterday = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
    expect(analyzeWriteFrequency(yesterday)).toBe("daily");
  });

  it("uses write count for more precise frequency", () => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    // 100 writes in a week = ~0.6 writes/hour = hourly
    expect(analyzeWriteFrequency(now.toISOString(), 100, weekAgo)).toBe("hourly");
  });
});

// ---------------------------------------------------------------------------
// enrichColumns
// ---------------------------------------------------------------------------

describe("enrichColumns", () => {
  it("adds inferred roles and FK targets", () => {
    const columns = [
      { name: "id", dataType: "BIGINT", ordinalPosition: 1, isNullable: false, comment: null },
      {
        name: "customer_id",
        dataType: "BIGINT",
        ordinalPosition: 2,
        isNullable: true,
        comment: null,
      },
      {
        name: "total_amount",
        dataType: "DECIMAL",
        ordinalPosition: 3,
        isNullable: true,
        comment: "Order total",
      },
    ];

    const enriched = enrichColumns(columns, "c.s.orders", ["c.s.orders", "c.s.customers"]);

    expect(enriched[0].inferredRole).toBe("pk");
    expect(enriched[1].inferredRole).toBe("fk");
    expect(enriched[1].inferredFkTarget).toBe("c.s.customers");
    expect(enriched[2].inferredRole).toBe("measure");
    expect(enriched[2].comment).toBe("Order total");
  });
});

// ---------------------------------------------------------------------------
// buildSchemaNamingProfile
// ---------------------------------------------------------------------------

describe("buildSchemaNamingProfile", () => {
  it("detects medallion pattern", () => {
    const tables = [
      { tableName: "bronze_orders", columns: [{ name: "id" }] },
      { tableName: "bronze_customers", columns: [{ name: "id" }] },
      { tableName: "silver_orders", columns: [{ name: "id" }] },
      { tableName: "gold_summary", columns: [{ name: "id" }] },
    ];

    const profile = buildSchemaNamingProfile(tables);
    expect(profile.hasMedallionPattern).toBe(true);
    expect(profile.commonPrefixes).toContain("bronze_");
    expect(profile.dominantConvention).toBe("snake_case");
  });

  it("detects common suffixes", () => {
    const tables = [
      {
        tableName: "orders",
        columns: [{ name: "order_id" }, { name: "customer_id" }, { name: "created_at" }],
      },
      { tableName: "customers", columns: [{ name: "customer_id" }, { name: "updated_at" }] },
      { tableName: "products", columns: [{ name: "product_id" }, { name: "created_at" }] },
    ];

    const profile = buildSchemaNamingProfile(tables);
    expect(profile.commonSuffixes).toContain("_id");
    expect(profile.commonSuffixes).toContain("_at");
  });
});
