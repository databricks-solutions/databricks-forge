import { describe, expect, it } from "vitest";
import { buildDeterministicExampleQueries } from "@/lib/genie/passes/example-query-generation";
import { statementToQuestion } from "@/lib/genie/engine";
import { buildSchemaAllowlist } from "@/lib/genie/schema-allowlist";
import type { MetadataSnapshot } from "@/lib/domain/types";

const metadata: MetadataSnapshot = {
  cacheKey: "test",
  ucPath: "samples.bakehouse",
  tables: [
    {
      fqn: "samples.bakehouse.sales_customers",
      catalog: "samples",
      schema: "bakehouse",
      tableName: "sales_customers",
      tableType: "MANAGED",
      comment: null,
    },
    {
      fqn: "samples.bakehouse.sales_transactions",
      catalog: "samples",
      schema: "bakehouse",
      tableName: "sales_transactions",
      tableType: "MANAGED",
      comment: null,
    },
  ],
  columns: [
    {
      tableFqn: "samples.bakehouse.sales_customers",
      columnName: "customer_id",
      dataType: "string",
      ordinalPosition: 1,
      isNullable: false,
      comment: null,
    },
    {
      tableFqn: "samples.bakehouse.sales_customers",
      columnName: "customer_segment",
      dataType: "string",
      ordinalPosition: 2,
      isNullable: true,
      comment: null,
    },
    {
      tableFqn: "samples.bakehouse.sales_transactions",
      columnName: "customer_id",
      dataType: "string",
      ordinalPosition: 1,
      isNullable: false,
      comment: null,
    },
    {
      tableFqn: "samples.bakehouse.sales_transactions",
      columnName: "transaction_date",
      dataType: "date",
      ordinalPosition: 2,
      isNullable: true,
      comment: null,
    },
    {
      tableFqn: "samples.bakehouse.sales_transactions",
      columnName: "sales_amount",
      dataType: "double",
      ordinalPosition: 3,
      isNullable: true,
      comment: null,
    },
  ],
  foreignKeys: [],
  metricViews: [],

  tableCount: 2,
  columnCount: 5,
  cachedAt: new Date().toISOString(),
  lineageDiscoveredFqns: [],
};

const tableFqns = ["samples.bakehouse.sales_customers", "samples.bakehouse.sales_transactions"];

const joinSpecs = [
  {
    leftTable: "samples.bakehouse.sales_transactions",
    rightTable: "samples.bakehouse.sales_customers",
    sql: "samples.bakehouse.sales_transactions.customer_id = samples.bakehouse.sales_customers.customer_id",
  },
];

describe("example-query-generation", () => {
  it("builds deterministic example queries with join coverage", () => {
    const allowlist = buildSchemaAllowlist(metadata);
    const queries = buildDeterministicExampleQueries(
      "Customer Insights",
      tableFqns,
      metadata,
      allowlist,
      joinSpecs,
    );

    expect(queries.length).toBeGreaterThan(0);
    expect(queries.some((q) => q.sql.includes("JOIN"))).toBe(true);
  });

  it("generates simple questions by default", () => {
    const allowlist = buildSchemaAllowlist(metadata);
    const queries = buildDeterministicExampleQueries(
      "Customer Insights",
      tableFqns,
      metadata,
      allowlist,
      joinSpecs,
      undefined,
      "simple",
    );

    expect(queries.length).toBeGreaterThan(0);
    const joinQ = queries.find((q) => q.sql.includes("JOIN"));
    expect(joinQ).toBeDefined();
    expect(joinQ!.question).toContain("related");
    const groupQ = queries.find((q) => !q.sql.includes("JOIN"));
    expect(groupQ).toBeDefined();
    expect(groupQ!.question).toMatch(/^What are the top/);
  });

  it("generates medium questions", () => {
    const allowlist = buildSchemaAllowlist(metadata);
    const queries = buildDeterministicExampleQueries(
      "Customer Insights",
      tableFqns,
      metadata,
      allowlist,
      joinSpecs,
      undefined,
      "medium",
    );

    expect(queries.length).toBeGreaterThan(0);
    const joinQ = queries.find((q) => q.sql.includes("JOIN"));
    expect(joinQ).toBeDefined();
    expect(joinQ!.question).toContain("linked");
    const groupQ = queries.find((q) => !q.sql.includes("JOIN"));
    expect(groupQ).toBeDefined();
    expect(groupQ!.question).toContain("Customer Insights");
  });

  it("generates complex questions", () => {
    const allowlist = buildSchemaAllowlist(metadata);
    const queries = buildDeterministicExampleQueries(
      "Customer Insights",
      tableFqns,
      metadata,
      allowlist,
      joinSpecs,
      undefined,
      "complex",
    );

    expect(queries.length).toBeGreaterThan(0);
    const joinQ = queries.find((q) => q.sql.includes("JOIN"));
    expect(joinQ).toBeDefined();
    expect(joinQ!.question).toContain("strongly");
    const groupQ = queries.find((q) => !q.sql.includes("JOIN"));
    expect(groupQ).toBeDefined();
    expect(groupQ!.question).toContain("trends");
  });
});

describe("statementToQuestion", () => {
  it("returns question as-is if it ends with ?", () => {
    expect(statementToQuestion("What is revenue?")).toBe("What is revenue?");
    expect(statementToQuestion("What is revenue?", "complex")).toBe("What is revenue?");
  });

  it("simple: uses direct phrasing without verbose wrappers", () => {
    expect(statementToQuestion("Identify revenue leakage", "simple")).toBe(
      "How do we identify revenue leakage?",
    );
    expect(statementToQuestion("Analyse customer churn", "simple")).toBe(
      "How do we analyse customer churn?",
    );
    expect(statementToQuestion("Build a dashboard", "simple")).toBe(
      "How would we build a dashboard?",
    );
    expect(statementToQuestion("Revenue by region", "simple")).toBe("Revenue by region?");
  });

  it("medium: uses moderate phrasing", () => {
    expect(statementToQuestion("Identify revenue leakage", "medium")).toBe(
      "How can we identify revenue leakage?",
    );
    expect(statementToQuestion("Analyse customer churn", "medium")).toBe("Analyse customer churn?");
  });

  it("complex: uses verbose wrappers for unmatched patterns", () => {
    expect(statementToQuestion("Revenue by region", "complex")).toBe(
      "What insights can we gain from: Revenue by region?",
    );
    expect(statementToQuestion("Identify revenue leakage", "complex")).toBe(
      "How can we identify revenue leakage?",
    );
  });

  it("defaults to simple when no complexity specified", () => {
    expect(statementToQuestion("Identify revenue leakage")).toBe(
      "How do we identify revenue leakage?",
    );
    expect(statementToQuestion("Revenue by region")).toBe("Revenue by region?");
  });
});
