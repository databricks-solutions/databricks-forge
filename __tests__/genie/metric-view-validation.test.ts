import { describe, it, expect } from "vitest";
import {
  stripFqnPrefixes,
  nestSnowflakeJoins,
  detectFlatSnowflakeJoins,
  qualifyNestedAliasRefs,
  autoRenameCollidingJoinAliases,
  autoRenameShadowedDimensions,
  autoFixMaterializationRefs,
  sanitizeMetricViewYaml,
  validateColumnReferences,
  validateMetricViewYaml,
} from "@/lib/genie/passes/metric-view-proposals";
import type { SchemaAllowlist } from "@/lib/genie/schema-allowlist";

function makeAllowlist(tables: Record<string, string[]>): SchemaAllowlist {
  const tableSet = new Set<string>();
  const columns = new Map<string, Set<string>>();
  const columnTypes = new Map<string, string>();

  for (const [fqn, cols] of Object.entries(tables)) {
    const key = fqn.toLowerCase();
    tableSet.add(key);
    columns.set(key, new Set(cols.map((c) => c.toLowerCase())));
    for (const c of cols) {
      columnTypes.set(`${key}.${c.toLowerCase()}`, "string");
    }
  }

  return { tables: tableSet, columns, columnTypes, metricViews: new Set() };
}

// ---------------------------------------------------------------------------
// stripFqnPrefixes
// ---------------------------------------------------------------------------

describe("stripFqnPrefixes", () => {
  it("strips unquoted 4-part FQN", () => {
    expect(stripFqnPrefixes("SUM(retail.demo.loans.amount)")).toBe("SUM(amount)");
  });

  it("strips backtick-quoted 4-part FQN", () => {
    expect(stripFqnPrefixes("SUM(retail.demo.loans.`Origination Quarter`)")).toBe(
      "SUM(`Origination Quarter`)",
    );
  });

  it("strips multiple FQN refs in one expression", () => {
    const sql = "retail.demo.loans.`Total Amount` / retail.demo.loans.count";
    expect(stripFqnPrefixes(sql)).toBe("`Total Amount` / count");
  });

  it("leaves bare column names untouched", () => {
    expect(stripFqnPrefixes("SUM(amount)")).toBe("SUM(amount)");
    expect(stripFqnPrefixes("SUM(`Total Amount`)")).toBe("SUM(`Total Amount`)");
  });
});

describe("sanitizeMetricViewYaml", () => {
  it("normalizes a numeric v1 version before typed parsing", () => {
    expect(sanitizeMetricViewYaml("version: 1.1\nsource: main.sales.orders\n")).toContain(
      'version: "1.1"',
    );
  });
});

// ---------------------------------------------------------------------------
// validateColumnReferences
// ---------------------------------------------------------------------------

describe("validateColumnReferences", () => {
  const allowlist = makeAllowlist({
    "retail.demo.complaints": ["District", "Total Complaints", "Product", "Submitted Via"],
    "retail.demo.loans": ["District", "Loan Status", "Origination Quarter", "amount"],
  });

  it("passes valid unquoted column references", () => {
    const yaml = `
version: 1.1
source: retail.demo.complaints
dimensions:
  - name: District
    expr: source.District
measures:
  - name: Total
    expr: SUM(source.Product)
`;
    const issues = validateColumnReferences(yaml, allowlist);
    expect(issues).toEqual([]);
  });

  it("passes valid backtick-quoted column references", () => {
    const yaml = `
version: 1.1
source: retail.demo.complaints
dimensions:
  - name: Submission Channel
    expr: source.\`Submitted Via\`
measures:
  - name: Complaint Volume
    expr: SUM(CAST(source.\`Total Complaints\` AS BIGINT))
`;
    const issues = validateColumnReferences(yaml, allowlist);
    expect(issues).toEqual([]);
  });

  it("flags hallucinated backtick-quoted column", () => {
    const yaml = `
version: 1.1
source: retail.demo.complaints
measures:
  - name: Defaulted Count
    expr: SUM(source.\`Defaulted Loans\`)
`;
    const issues = validateColumnReferences(yaml, allowlist);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toContain("Defaulted Loans");
    expect(issues[0]).toContain("not found in table");
  });

  it("validates backtick-quoted columns across joins", () => {
    const yaml = `
version: 1.1
source: retail.demo.complaints
joins:
  - name: lending
    source: retail.demo.loans
    on: source.\`District\` = lending.\`District\`
dimensions:
  - name: Loan Status
    expr: lending.\`Loan Status\`
measures:
  - name: Amount
    expr: SUM(lending.amount)
`;
    const issues = validateColumnReferences(yaml, allowlist);
    expect(issues).toEqual([]);
  });

  it("flags hallucinated column in joined table", () => {
    const yaml = `
version: 1.1
source: retail.demo.complaints
joins:
  - name: lending
    source: retail.demo.loans
    on: source.\`District\` = lending.\`District\`
measures:
  - name: Defaulted
    expr: SUM(lending.\`Defaulted Loan Count\`)
`;
    const issues = validateColumnReferences(yaml, allowlist);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toContain("Defaulted Loan Count");
  });
});

// ---------------------------------------------------------------------------
// validateMetricViewYaml — measure name shadows column
// ---------------------------------------------------------------------------

describe("validateMetricViewYaml — measure shadowing", () => {
  const allowlist = makeAllowlist({
    "retail.demo.quality": [
      "Total Complaints",
      "Unique Complainants",
      "Timely Response Count",
      "District",
      "Product",
    ],
  });

  it("flags measure names identical to source column names", () => {
    const yaml = `
version: 1.1
source: retail.demo.quality
dimensions:
  - name: District
    expr: District
measures:
  - name: Total Complaints
    expr: SUM(CAST(\`Total Complaints\` AS BIGINT))
  - name: Unique Complainants
    expr: SUM(CAST(\`Unique Complainants\` AS BIGINT))
`;
    const ddl = `CREATE OR REPLACE VIEW retail.demo.mv WITH METRICS LANGUAGE YAML AS $$\n${yaml}\n$$`;
    const result = validateMetricViewYaml(yaml, ddl, allowlist);

    expect(result.status).toBe("error");
    expect(result.issues.some((i) => i.includes("shadows source column"))).toBe(true);
    const shadowIssues = result.issues.filter((i) => i.includes("shadows source column"));
    expect(shadowIssues.length).toBe(2);
  });

  it("passes when measure names differ from column names", () => {
    const yaml = `
version: 1.1
source: retail.demo.quality
dimensions:
  - name: District
    expr: District
measures:
  - name: Total Complaints Sum
    expr: SUM(CAST(\`Total Complaints\` AS BIGINT))
  - name: Complainant Count
    expr: SUM(CAST(\`Unique Complainants\` AS BIGINT))
`;
    const ddl = `CREATE OR REPLACE VIEW retail.demo.mv WITH METRICS LANGUAGE YAML AS $$\n${yaml}\n$$`;
    const result = validateMetricViewYaml(yaml, ddl, allowlist);

    const shadowIssues = result.issues.filter((i) => i.includes("shadows source column"));
    expect(shadowIssues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// validateMetricViewYaml — nested aggregate detection
// ---------------------------------------------------------------------------

describe("validateMetricViewYaml — nested aggregates", () => {
  const allowlist = makeAllowlist({
    "retail.demo.orders": ["amount", "customer_id", "status"],
  });

  it("flags nested aggregate functions", () => {
    const yaml = `
version: 1.1
source: retail.demo.orders
dimensions:
  - name: Status
    expr: status
measures:
  - name: Avg Order Count
    expr: AVG(COUNT(customer_id))
`;
    const ddl = `CREATE OR REPLACE VIEW retail.demo.mv WITH METRICS LANGUAGE YAML AS $$\n${yaml}\n$$`;
    const result = validateMetricViewYaml(yaml, ddl, allowlist);

    expect(result.status).toBe("error");
    expect(result.issues.some((i) => i.includes("Nested aggregate"))).toBe(true);
  });

  it("passes ratio measures (not nested)", () => {
    const yaml = `
version: 1.1
source: retail.demo.orders
dimensions:
  - name: Status
    expr: status
measures:
  - name: Revenue Per Customer
    expr: SUM(amount) / COUNT(DISTINCT customer_id)
`;
    const ddl = `CREATE OR REPLACE VIEW retail.demo.mv WITH METRICS LANGUAGE YAML AS $$\n${yaml}\n$$`;
    const result = validateMetricViewYaml(yaml, ddl, allowlist);

    const nestedIssues = result.issues.filter((i) => i.includes("Nested aggregate"));
    expect(nestedIssues).toEqual([]);
  });

  it("passes FILTER clause measures (not nested)", () => {
    const yaml = `
version: 1.1
source: retail.demo.orders
dimensions:
  - name: Status
    expr: status
measures:
  - name: Open Amount
    expr: SUM(amount) FILTER (WHERE status = 'OPEN')
`;
    const ddl = `CREATE OR REPLACE VIEW retail.demo.mv WITH METRICS LANGUAGE YAML AS $$\n${yaml}\n$$`;
    const result = validateMetricViewYaml(yaml, ddl, allowlist);

    const nestedIssues = result.issues.filter((i) => i.includes("Nested aggregate"));
    expect(nestedIssues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// nestSnowflakeJoins
// ---------------------------------------------------------------------------

describe("nestSnowflakeJoins", () => {
  it("restructures flat snowflake joins into nested joins", () => {
    const yaml = `version: 1.1
source: catalog.schema.fact_orders
joins:
  - name: member
    source: catalog.schema.dim_member
    on: source.member_id = member.member_id
  - name: location
    source: catalog.schema.dim_location
    on: member.location_id = location.location_id
  - name: segment
    source: catalog.schema.dim_segment
    on: member.segment_id = segment.segment_id
dimensions:
  - name: state
    expr: location.state
`;
    const result = nestSnowflakeJoins(yaml);

    // location and segment should be nested under member
    expect(result).toContain("- name: member");
    expect(result).toContain("    joins:");
    expect(result).toContain("      - name: location");
    expect(result).toContain("      - name: segment");
    // location and segment should NOT appear at the same indent as member
    // Extract the joins block and check only top-level join items in it
    const joinsSection = result.split("joins:")[1].split("dimensions:")[0];
    const topJoinNames = [...joinsSection.matchAll(/^  - name: (\w+)/gm)].map((m) => m[1]);
    expect(topJoinNames).toEqual(["member"]);
  });

  it("preserves star schema joins (no nesting needed)", () => {
    const yaml = `version: 1.1
source: catalog.schema.fact_orders
joins:
  - name: customer
    source: catalog.schema.dim_customer
    on: source.customer_id = customer.customer_id
  - name: product
    source: catalog.schema.dim_product
    on: source.product_id = product.product_id
dimensions:
  - name: cust_name
    expr: customer.name
`;
    const result = nestSnowflakeJoins(yaml);

    // Both joins should remain at top level
    expect(result).toContain("- name: customer");
    expect(result).toContain("- name: product");
    // No nested joins: block should be added
    expect(result).not.toMatch(/^\s+joins:\s*$/m);
  });

  it("handles multi-level nesting (fact -> A -> B -> C)", () => {
    const yaml = `version: 1.1
source: catalog.schema.fact
joins:
  - name: dim_a
    source: catalog.schema.dim_a
    on: source.a_id = dim_a.id
  - name: dim_b
    source: catalog.schema.dim_b
    on: dim_a.b_id = dim_b.id
  - name: dim_c
    source: catalog.schema.dim_c
    on: dim_b.c_id = dim_c.id
dimensions:
  - name: col
    expr: dim_c.col
`;
    const result = nestSnowflakeJoins(yaml);

    // dim_b should be under dim_a, dim_c should be under dim_b
    expect(result).toContain("- name: dim_a");
    expect(result).toContain("      - name: dim_b");
    expect(result).toContain("          - name: dim_c");
  });

  it("returns input unchanged when no joins block exists", () => {
    const yaml = `version: 1.1
source: catalog.schema.fact
dimensions:
  - name: col
    expr: col
measures:
  - name: cnt
    expr: COUNT(1)
`;
    expect(nestSnowflakeJoins(yaml)).toBe(yaml);
  });

  it("returns input unchanged for a single join", () => {
    const yaml = `version: 1.1
source: catalog.schema.fact
joins:
  - name: dim
    source: catalog.schema.dim
    on: source.dim_id = dim.id
dimensions:
  - name: col
    expr: dim.col
`;
    expect(nestSnowflakeJoins(yaml)).toBe(yaml);
  });

  it("preserves already-nested joins without producing duplicate joins: keys", () => {
    const yaml = `version: 1.1
source: catalog.schema.fact_accounts
joins:
  - name: account_type
    source: catalog.schema.dim_account_type
    on: source.type_id = account_type.type_id
    joins:
      - name: fee_schedule
        source: catalog.schema.dim_fee_schedule
        on: account_type.schedule_id = fee_schedule.schedule_id
dimensions:
  - name: type_name
    expr: account_type.name
`;
    const result = nestSnowflakeJoins(yaml);

    // Should not contain duplicate joins: keys (the bug produced two adjacent joins: lines)
    expect(result).not.toMatch(/joins:\s*\n\s*joins:/);
    // fee_schedule should still be nested under account_type
    expect(result).toContain("- name: fee_schedule");
    expect(result).toContain("- name: account_type");
  });

  it("completes partially-nested joins without duplicating existing joins: key", () => {
    const yaml = `version: 1.1
source: catalog.schema.fact_orders
joins:
  - name: member
    source: catalog.schema.dim_member
    on: source.member_id = member.member_id
    joins:
      - name: location
        source: catalog.schema.dim_location
        on: member.location_id = location.location_id
  - name: segment
    source: catalog.schema.dim_segment
    on: member.segment_id = segment.segment_id
dimensions:
  - name: state
    expr: location.state
`;
    const result = nestSnowflakeJoins(yaml);

    // segment should be nested under member alongside location
    expect(result).not.toMatch(/joins:\s*\n\s*joins:/);
    expect(result).toContain("- name: member");
    expect(result).toContain("- name: location");
    expect(result).toContain("- name: segment");
    // Only member should be a top-level join
    const joinsSection = result.split("joins:")[1].split("dimensions:")[0];
    const topJoinNames = [...joinsSection.matchAll(/^  - name: (\w+)/gm)].map((m) => m[1]);
    expect(topJoinNames).toEqual(["member"]);
  });
});

// ---------------------------------------------------------------------------
// detectFlatSnowflakeJoins
// ---------------------------------------------------------------------------

describe("detectFlatSnowflakeJoins", () => {
  it("flags flat joins referencing sibling aliases", () => {
    const yaml = `
version: 1.1
source: catalog.schema.fact
joins:
  - name: member
    source: catalog.schema.dim_member
    on: source.member_id = member.member_id
  - name: location
    source: catalog.schema.dim_location
    on: member.location_id = location.location_id
`;
    const issues = detectFlatSnowflakeJoins(yaml);
    expect(issues.length).toBe(1);
    expect(issues[0]).toContain("location");
    expect(issues[0]).toContain("member");
    expect(issues[0]).toContain("nested");
  });

  it("passes star schema joins (all reference source)", () => {
    const yaml = `
version: 1.1
source: catalog.schema.fact
joins:
  - name: customer
    source: catalog.schema.dim_customer
    on: source.customer_id = customer.customer_id
  - name: product
    source: catalog.schema.dim_product
    on: source.product_id = product.product_id
`;
    const issues = detectFlatSnowflakeJoins(yaml);
    expect(issues).toEqual([]);
  });

  it("passes when no joins block exists", () => {
    const yaml = `
version: 1.1
source: catalog.schema.fact
dimensions:
  - name: col
    expr: col
`;
    const issues = detectFlatSnowflakeJoins(yaml);
    expect(issues).toEqual([]);
  });

  it("passes already-nested joins without false positive", () => {
    const yaml = `
version: 1.1
source: catalog.schema.fact
joins:
  - name: calendar
    source: catalog.schema.dim_calendar
    on: source.month_id = calendar.month_id
  - name: account
    source: catalog.schema.dim_account
    on: source.account_id = account.account_id
    joins:
      - name: investment_option
        source: catalog.schema.dim_investment_option
        on: account.option_id = investment_option.option_id
dimensions:
  - name: month_date
    expr: calendar.month_date
  - name: option_name
    expr: account.investment_option.option_name
`;
    const issues = detectFlatSnowflakeJoins(yaml);
    expect(issues).toEqual([]);
  });

  it("passes deeply nested joins without false positive", () => {
    const yaml = `
version: 1.1
source: catalog.schema.fact
joins:
  - name: member
    source: catalog.schema.dim_member
    on: source.member_id = member.member_id
    joins:
      - name: employer
        source: catalog.schema.dim_employer
        on: member.employer_id = employer.employer_id
      - name: location
        source: catalog.schema.dim_location
        on: member.location_id = location.location_id
`;
    const issues = detectFlatSnowflakeJoins(yaml);
    expect(issues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// qualifyNestedAliasRefs
// ---------------------------------------------------------------------------

describe("qualifyNestedAliasRefs", () => {
  it("rewrites nested alias refs in expr to parent-chain syntax", () => {
    const yaml = `version: 1.1
source: catalog.schema.fact
joins:
  - name: account
    source: catalog.schema.dim_account
    on: source.account_id = account.account_id
    joins:
      - name: investment_option
        source: catalog.schema.dim_option
        on: account.option_id = investment_option.option_id
dimensions:
  - name: option_name
    expr: investment_option.option_name
  - name: account_name
    expr: account.account_name
measures:
  - name: cnt
    expr: COUNT(1)
`;
    const result = qualifyNestedAliasRefs(yaml);

    expect(result).toContain("expr: account.investment_option.option_name");
    expect(result).toContain("expr: account.account_name");
    // on: clause should NOT be rewritten
    expect(result).toContain("on: account.option_id = investment_option.option_id");
  });

  it("handles multi-level nesting (A -> B -> C)", () => {
    const yaml = `version: 1.1
source: catalog.schema.fact
joins:
  - name: customer
    source: catalog.schema.dim_customer
    on: source.cust_id = customer.cust_id
    joins:
      - name: nation
        source: catalog.schema.dim_nation
        on: customer.nation_id = nation.nation_id
        joins:
          - name: region
            source: catalog.schema.dim_region
            on: nation.region_id = region.region_id
dimensions:
  - name: nation_name
    expr: nation.n_name
  - name: region_name
    expr: region.r_name
`;
    const result = qualifyNestedAliasRefs(yaml);

    expect(result).toContain("expr: customer.nation.n_name");
    expect(result).toContain("expr: customer.nation.region.r_name");
  });

  it("does not modify star-schema joins (no nesting)", () => {
    const yaml = `version: 1.1
source: catalog.schema.fact
joins:
  - name: customer
    source: catalog.schema.dim_customer
    on: source.cust_id = customer.cust_id
  - name: product
    source: catalog.schema.dim_product
    on: source.product_id = product.product_id
dimensions:
  - name: cust_name
    expr: customer.name
  - name: prod_name
    expr: product.name
`;
    const result = qualifyNestedAliasRefs(yaml);

    expect(result).toContain("expr: customer.name");
    expect(result).toContain("expr: product.name");
  });

  it("returns input unchanged when no joins exist", () => {
    const yaml = `version: 1.1
source: catalog.schema.fact
dimensions:
  - name: col
    expr: col
measures:
  - name: cnt
    expr: COUNT(1)
`;
    expect(qualifyNestedAliasRefs(yaml)).toBe(yaml);
  });

  it("is idempotent (does not double-qualify already-qualified refs)", () => {
    const yaml = `version: 1.1
source: catalog.schema.fact
joins:
  - name: account
    source: catalog.schema.dim_account
    on: source.account_id = account.account_id
    joins:
      - name: investment_option
        source: catalog.schema.dim_option
        on: account.option_id = investment_option.option_id
dimensions:
  - name: option_name
    expr: account.investment_option.option_name
measures:
  - name: cnt
    expr: COUNT(1)
`;
    const result = qualifyNestedAliasRefs(yaml);
    expect(result).toContain("expr: account.investment_option.option_name");
    // Apply again — should be unchanged
    const result2 = qualifyNestedAliasRefs(result);
    expect(result2).toBe(result);
  });

  it("qualifies nested refs in filter fields", () => {
    const yaml = `version: 1.1
source: catalog.schema.fact
filter: investment_option.active = TRUE
joins:
  - name: account
    source: catalog.schema.dim_account
    on: source.account_id = account.account_id
    joins:
      - name: investment_option
        source: catalog.schema.dim_option
        on: account.option_id = investment_option.option_id
dimensions:
  - name: col
    expr: source.col
measures:
  - name: cnt
    expr: COUNT(1)
`;
    const result = qualifyNestedAliasRefs(yaml);
    expect(result).toContain("filter: account.investment_option.active = TRUE");
  });
});

// ---------------------------------------------------------------------------
// autoRenameCollidingJoinAliases
// ---------------------------------------------------------------------------

describe("autoRenameCollidingJoinAliases", () => {
  it("renames join alias that collides with source column", () => {
    const allowlist = makeAllowlist({
      "catalog.schema.fact_claim": ["claim_id", "claim_type", "amount"],
      "catalog.schema.dim_claim_type": ["claim_type_id", "claim_type_name"],
    });

    const yaml = `version: 1.1
source: catalog.schema.fact_claim
joins:
  - name: claim_type
    source: catalog.schema.dim_claim_type
    on: source.claim_type = claim_type.claim_type_id
dimensions:
  - name: type_name
    expr: claim_type.claim_type_name
`;
    const ddl = `CREATE OR REPLACE VIEW catalog.schema.mv WITH METRICS LANGUAGE YAML AS $$\n${yaml}\n$$`;

    const result = autoRenameCollidingJoinAliases(yaml, ddl, allowlist);

    expect(result.renamed).toBe(1);
    expect(result.yaml).toContain("- name: claim_type_dim");
    expect(result.yaml).toContain("on: source.claim_type = claim_type_dim.claim_type_id");
    expect(result.yaml).toContain("expr: claim_type_dim.claim_type_name");
    expect(result.ddl).toContain("- name: claim_type_dim");
  });

  it("does not rename aliases that do not collide", () => {
    const allowlist = makeAllowlist({
      "catalog.schema.fact": ["order_id", "customer_id"],
      "catalog.schema.dim_customer": ["customer_id", "name"],
    });

    const yaml = `version: 1.1
source: catalog.schema.fact
joins:
  - name: customer
    source: catalog.schema.dim_customer
    on: source.customer_id = customer.customer_id
dimensions:
  - name: cust_name
    expr: customer.name
`;
    const ddl = `CREATE OR REPLACE VIEW catalog.schema.mv WITH METRICS LANGUAGE YAML AS $$\n${yaml}\n$$`;

    const result = autoRenameCollidingJoinAliases(yaml, ddl, allowlist);

    expect(result.renamed).toBe(0);
    expect(result.yaml).toBe(yaml);
  });
});

// ---------------------------------------------------------------------------
// autoRenameShadowedDimensions
// ---------------------------------------------------------------------------

describe("autoRenameShadowedDimensions", () => {
  it("renames dimension that shadows a join alias", () => {
    const yaml = `version: 1.1
source: catalog.schema.fact_claim
dimensions:
  - name: claim_type
    expr: claim_type.claim_type_name
  - name: claim_status
    expr: claim_status
measures:
  - name: total_claims
    expr: COUNT(claim_id)
joins:
  - name: claim_type
    source: catalog.schema.dim_claim_type
    on: source.claim_type_id = claim_type.claim_type_id
`;
    const ddl = `CREATE OR REPLACE VIEW catalog.schema.mv WITH METRICS LANGUAGE YAML AS $$\n${yaml}\n$$`;

    const result = autoRenameShadowedDimensions(yaml, ddl);

    expect(result.renamed).toBe(1);
    expect(result.yaml).toContain("- name: claim_type_name");
    const dimsBlock = result.yaml.split("measures:")[0];
    expect(dimsBlock).not.toMatch(/- name: claim_type\n/);
    expect(result.yaml).toContain("- name: claim_status");
    expect(result.ddl).toContain("- name: claim_type_name");
    // Join alias should remain unchanged
    const joinsBlock = result.yaml.split("joins:")[1];
    expect(joinsBlock).toContain("- name: claim_type");
  });

  it("does not rename when no collision exists", () => {
    const yaml = `version: 1.1
source: catalog.schema.fact
dimensions:
  - name: cust_name
    expr: customer.name
measures:
  - name: cnt
    expr: COUNT(1)
joins:
  - name: customer
    source: catalog.schema.dim_customer
    on: source.customer_id = customer.customer_id
`;
    const ddl = `CREATE OR REPLACE VIEW catalog.schema.mv WITH METRICS LANGUAGE YAML AS $$\n${yaml}\n$$`;

    const result = autoRenameShadowedDimensions(yaml, ddl);

    expect(result.renamed).toBe(0);
    expect(result.yaml).toBe(yaml);
  });

  it("appends _val when derived name already exists", () => {
    const yaml = `version: 1.1
source: catalog.schema.fact
dimensions:
  - name: member
    expr: member.member_name
  - name: member_name
    expr: member.display_name
measures:
  - name: cnt
    expr: COUNT(1)
joins:
  - name: member
    source: catalog.schema.dim_member
    on: source.member_id = member.member_id
`;
    const ddl = `CREATE OR REPLACE VIEW catalog.schema.mv WITH METRICS LANGUAGE YAML AS $$\n${yaml}\n$$`;

    const result = autoRenameShadowedDimensions(yaml, ddl);

    expect(result.renamed).toBe(1);
    expect(result.yaml).toContain("- name: member_name_val");
  });

  it("returns unchanged when no joins block exists", () => {
    const yaml = `version: 1.1
source: catalog.schema.fact
dimensions:
  - name: col
    expr: col
measures:
  - name: cnt
    expr: COUNT(1)
`;
    const ddl = `CREATE OR REPLACE VIEW catalog.schema.mv WITH METRICS LANGUAGE YAML AS $$\n${yaml}\n$$`;

    const result = autoRenameShadowedDimensions(yaml, ddl);

    expect(result.renamed).toBe(0);
    expect(result.yaml).toBe(yaml);
  });
});

// ---------------------------------------------------------------------------
// validateColumnReferences — parent-chain nested join refs
// ---------------------------------------------------------------------------

describe("validateColumnReferences — nested join parent-chain", () => {
  const allowlist = makeAllowlist({
    "catalog.schema.fact_advice": ["advice_case_id", "member_id", "adviser_id"],
    "catalog.schema.dim_member": ["member_id", "lifecycle_stage", "employer_id"],
    "catalog.schema.dim_employer": ["employer_id", "industry", "employer_size"],
    "catalog.schema.dim_adviser": ["adviser_id", "adviser_name"],
  });

  it("passes 3-part parent-chain ref (member.employer_dim.industry)", () => {
    const yaml = `
version: 1.1
source: catalog.schema.fact_advice
joins:
  - name: adviser
    source: catalog.schema.dim_adviser
    on: source.adviser_id = adviser.adviser_id
  - name: member
    source: catalog.schema.dim_member
    on: source.member_id = member.member_id
    joins:
      - name: employer_dim
        source: catalog.schema.dim_employer
        on: member.employer_id = employer_dim.employer_id
dimensions:
  - name: employer_industry
    expr: member.employer_dim.industry
  - name: employer_size
    expr: member.employer_dim.employer_size
  - name: lifecycle
    expr: member.lifecycle_stage
`;
    const issues = validateColumnReferences(yaml, allowlist);
    expect(issues).toEqual([]);
  });

  it("passes 4-part parent-chain ref (customer.nation.region.col)", () => {
    const deepAllowlist = makeAllowlist({
      "catalog.schema.fact": ["order_id", "cust_id"],
      "catalog.schema.dim_customer": ["cust_id", "nation_id"],
      "catalog.schema.dim_nation": ["nation_id", "n_name", "region_id"],
      "catalog.schema.dim_region": ["region_id", "r_name"],
    });

    const yaml = `
version: 1.1
source: catalog.schema.fact
joins:
  - name: customer
    source: catalog.schema.dim_customer
    on: source.cust_id = customer.cust_id
    joins:
      - name: nation
        source: catalog.schema.dim_nation
        on: customer.nation_id = nation.nation_id
        joins:
          - name: region
            source: catalog.schema.dim_region
            on: nation.region_id = region.region_id
dimensions:
  - name: nation_name
    expr: customer.nation.n_name
  - name: region_name
    expr: customer.nation.region.r_name
`;
    const issues = validateColumnReferences(yaml, deepAllowlist);
    expect(issues).toEqual([]);
  });

  it("still flags genuinely missing columns on nested join table", () => {
    const yaml = `
version: 1.1
source: catalog.schema.fact_advice
joins:
  - name: member
    source: catalog.schema.dim_member
    on: source.member_id = member.member_id
    joins:
      - name: employer_dim
        source: catalog.schema.dim_employer
        on: member.employer_id = employer_dim.employer_id
dimensions:
  - name: employer_country
    expr: member.employer_dim.country
`;
    const issues = validateColumnReferences(yaml, allowlist);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toContain("country");
    expect(issues[0]).toContain("not found in table");
  });

  it("still flags missing columns on simple 2-part refs", () => {
    const yaml = `
version: 1.1
source: catalog.schema.fact_advice
dimensions:
  - name: nonexistent
    expr: source.nonexistent_col
`;
    const issues = validateColumnReferences(yaml, allowlist);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toContain("nonexistent_col");
  });
});

// ---------------------------------------------------------------------------
// validateMetricViewYaml — dimension shadows join alias
// ---------------------------------------------------------------------------

describe("validateMetricViewYaml — dimension shadows join alias", () => {
  const allowlist = makeAllowlist({
    "catalog.schema.fact_claim": ["claim_id", "claim_type_id", "amount"],
    "catalog.schema.dim_claim_type": ["claim_type_id", "claim_type_name"],
  });

  it("flags dimension name that matches a join alias", () => {
    const yaml = `
version: 1.1
source: catalog.schema.fact_claim
dimensions:
  - name: claim_type
    expr: claim_type.claim_type_name
measures:
  - name: claim_count
    expr: COUNT(claim_id)
joins:
  - name: claim_type
    source: catalog.schema.dim_claim_type
    on: source.claim_type_id = claim_type.claim_type_id
`;
    const ddl = `CREATE OR REPLACE VIEW catalog.schema.mv WITH METRICS LANGUAGE YAML AS $$\n${yaml}\n$$`;
    const result = validateMetricViewYaml(yaml, ddl, allowlist);

    expect(result.status).toBe("error");
    expect(result.issues.some((i) => i.includes("shadows join alias"))).toBe(true);
  });

  it("passes when dimension names do not match join aliases", () => {
    const yaml = `
version: 1.1
source: catalog.schema.fact_claim
dimensions:
  - name: claim_type_name
    expr: claim_type.claim_type_name
measures:
  - name: claim_count
    expr: COUNT(claim_id)
joins:
  - name: claim_type
    source: catalog.schema.dim_claim_type
    on: source.claim_type_id = claim_type.claim_type_id
`;
    const ddl = `CREATE OR REPLACE VIEW catalog.schema.mv WITH METRICS LANGUAGE YAML AS $$\n${yaml}\n$$`;
    const result = validateMetricViewYaml(yaml, ddl, allowlist);

    const shadowIssues = result.issues.filter((i) => i.includes("shadows join alias"));
    expect(shadowIssues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// autoFixMaterializationRefs
// ---------------------------------------------------------------------------

describe("autoFixMaterializationRefs", () => {
  it("maps join alias to declared dimension name via expr", () => {
    const yaml = `version: 1.1
source: catalog.schema.fact_complaint
dimensions:
  - name: category_name
    expr: complaint_category.category_name
  - name: complaint_severity
    expr: severity
measures:
  - name: complaint_count
    expr: COUNT(complaint_id)
joins:
  - name: complaint_category
    source: catalog.schema.dim_complaint_category
    on: source.category_id = complaint_category.category_id
materialization:
  schedule: every 6 hours
  mode: relaxed
  materialized_views:
    - name: summary
      type: aggregated
      dimensions: [complaint_category, complaint_severity]
      measures: [complaint_count]
`;
    const ddl = `CREATE OR REPLACE VIEW catalog.schema.mv WITH METRICS LANGUAGE YAML AS $$\n${yaml}\n$$`;

    const result = autoFixMaterializationRefs(yaml, ddl);

    expect(result.fixed).toBeGreaterThan(0);
    expect(result.yaml).toContain("dimensions: [category_name, complaint_severity]");
  });

  it("removes unresolvable refs", () => {
    const yaml = `version: 1.1
source: catalog.schema.fact
dimensions:
  - name: status
    expr: status
measures:
  - name: cnt
    expr: COUNT(1)
materialization:
  schedule: every 6 hours
  mode: relaxed
  materialized_views:
    - name: summary
      type: aggregated
      dimensions: [status, nonexistent_dim]
      measures: [cnt]
`;
    const ddl = `CREATE OR REPLACE VIEW catalog.schema.mv WITH METRICS LANGUAGE YAML AS $$\n${yaml}\n$$`;

    const result = autoFixMaterializationRefs(yaml, ddl);

    expect(result.fixed).toBeGreaterThan(0);
    expect(result.yaml).toContain("dimensions: [status]");
  });

  it("passes through valid refs unchanged", () => {
    const yaml = `version: 1.1
source: catalog.schema.fact
dimensions:
  - name: status
    expr: status
measures:
  - name: cnt
    expr: COUNT(1)
materialization:
  schedule: every 6 hours
  mode: relaxed
  materialized_views:
    - name: summary
      type: aggregated
      dimensions: [status]
      measures: [cnt]
`;
    const ddl = `CREATE OR REPLACE VIEW catalog.schema.mv WITH METRICS LANGUAGE YAML AS $$\n${yaml}\n$$`;

    const result = autoFixMaterializationRefs(yaml, ddl);

    expect(result.fixed).toBe(0);
    expect(result.yaml).toBe(yaml);
  });

  it("returns unchanged when no materialization block exists", () => {
    const yaml = `version: 1.1
source: catalog.schema.fact
dimensions:
  - name: status
    expr: status
measures:
  - name: cnt
    expr: COUNT(1)
`;
    const ddl = `CREATE OR REPLACE VIEW catalog.schema.mv WITH METRICS LANGUAGE YAML AS $$\n${yaml}\n$$`;

    const result = autoFixMaterializationRefs(yaml, ddl);

    expect(result.fixed).toBe(0);
    expect(result.yaml).toBe(yaml);
  });
});

// ---------------------------------------------------------------------------
// validateMetricViewYaml — materialization refs
// ---------------------------------------------------------------------------

describe("validateMetricViewYaml — materialization refs", () => {
  const allowlist = makeAllowlist({
    "catalog.schema.fact": ["complaint_id", "category_id", "severity"],
    "catalog.schema.dim_cat": ["category_id", "category_name"],
  });

  it("flags undeclared dimension in materialization block", () => {
    const yaml = `
version: 1.1
source: catalog.schema.fact
dimensions:
  - name: category_name
    expr: complaint_category.category_name
measures:
  - name: complaint_count
    expr: COUNT(complaint_id)
joins:
  - name: complaint_category
    source: catalog.schema.dim_cat
    on: source.category_id = complaint_category.category_id
materialization:
  schedule: every 6 hours
  mode: relaxed
  materialized_views:
    - name: summary
      type: aggregated
      dimensions: [complaint_category]
      measures: [complaint_count]
`;
    const ddl = `CREATE OR REPLACE VIEW catalog.schema.mv WITH METRICS LANGUAGE YAML AS $$\n${yaml}\n$$`;
    const result = validateMetricViewYaml(yaml, ddl, allowlist);

    expect(result.issues.some((i) => i.includes("undeclared dimension"))).toBe(true);
    expect(result.issues.some((i) => i.includes("complaint_category"))).toBe(true);
  });

  it("passes when materialization uses declared names", () => {
    const yaml = `
version: 1.1
source: catalog.schema.fact
dimensions:
  - name: severity_level
    expr: severity
measures:
  - name: complaint_count
    expr: COUNT(complaint_id)
materialization:
  schedule: every 6 hours
  mode: relaxed
  materialized_views:
    - name: summary
      type: aggregated
      dimensions: [severity_level]
      measures: [complaint_count]
`;
    const ddl = `CREATE OR REPLACE VIEW catalog.schema.mv WITH METRICS LANGUAGE YAML AS $$\n${yaml}\n$$`;
    const result = validateMetricViewYaml(yaml, ddl, allowlist);

    const matIssues = result.issues.filter((i) => i.includes("undeclared"));
    expect(matIssues).toEqual([]);
  });
});
