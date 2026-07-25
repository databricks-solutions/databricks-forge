import { describe, it, expect } from "vitest";
import {
  extractColumnReferences,
  extractSqlAliases,
  validateColumnReferences,
  stripSqlComments,
  AI_FUNCTION_RETURN_FIELDS,
} from "@/lib/validation/sql-columns";

// ---------------------------------------------------------------------------
// stripSqlComments
// ---------------------------------------------------------------------------

describe("stripSqlComments", () => {
  it("strips single-line comments", () => {
    const sql = "SELECT a.col -- e.g. example\nFROM t";
    expect(stripSqlComments(sql)).toBe("SELECT a.col \nFROM t");
  });

  it("strips block comments", () => {
    const sql = "SELECT /* e.g. test */ a.col FROM t";
    expect(stripSqlComments(sql)).toBe("SELECT  a.col FROM t");
  });

  it("strips multi-line block comments", () => {
    const sql = "SELECT a.col\n/* multi\nline\ncomment */\nFROM t";
    expect(stripSqlComments(sql)).toBe("SELECT a.col\n\nFROM t");
  });

  it("leaves SQL intact when no comments", () => {
    const sql = "SELECT a.col FROM t WHERE a.id = 1";
    expect(stripSqlComments(sql)).toBe(sql);
  });
});

// ---------------------------------------------------------------------------
// extractSqlAliases
// ---------------------------------------------------------------------------

describe("extractSqlAliases", () => {
  it("detects table aliases from FROM clause", () => {
    const sql = "SELECT t.col FROM catalog.schema.table t";
    const aliases = extractSqlAliases(sql);
    expect(aliases.tableAliases.has("t")).toBe(true);
  });

  it("detects table aliases with AS keyword", () => {
    const sql = "SELECT t.col FROM catalog.schema.table AS t";
    const aliases = extractSqlAliases(sql);
    expect(aliases.tableAliases.has("t")).toBe(true);
  });

  it("detects table aliases from JOIN clause", () => {
    const sql = "SELECT a.col FROM t1 a JOIN t2 b ON a.id = b.id";
    const aliases = extractSqlAliases(sql);
    expect(aliases.tableAliases.has("a")).toBe(true);
    expect(aliases.tableAliases.has("b")).toBe(true);
  });

  it("detects plain column aliases", () => {
    const sql = "SELECT SUM(amount) AS total_revenue FROM t";
    const aliases = extractSqlAliases(sql);
    expect(aliases.columnAliases.has("total_revenue")).toBe(true);
  });

  it("detects backtick-quoted column aliases", () => {
    const sql = "SELECT COALESCE(`Client Age Group`, 'Unknown') AS `Age Group` FROM t";
    const aliases = extractSqlAliases(sql);
    expect(aliases.columnAliases.has("age group")).toBe(true);
  });

  it("detects multiple backtick-quoted aliases", () => {
    const sql = [
      "SELECT",
      "  COALESCE(col1, 'X') AS `Age Group`,",
      "  SUM(col2) AS `Avg Complaints Per Client`,",
      "  COUNT(*) AS `Total Count`",
      "FROM t",
    ].join("\n");
    const aliases = extractSqlAliases(sql);
    expect(aliases.columnAliases.has("age group")).toBe(true);
    expect(aliases.columnAliases.has("avg complaints per client")).toBe(true);
    expect(aliases.columnAliases.has("total count")).toBe(true);
  });

  it("detects CTE names", () => {
    const sql = "WITH base_data AS (SELECT 1), enriched AS (SELECT 2) SELECT * FROM base_data";
    const aliases = extractSqlAliases(sql);
    expect(aliases.cteNames.has("base_data")).toBe(true);
    expect(aliases.cteNames.has("enriched")).toBe(true);
  });

  it("includes all alias types in the all set", () => {
    const sql =
      "WITH cte AS (SELECT SUM(x) AS total FROM catalog.schema.t1 t) SELECT t.total FROM cte";
    const aliases = extractSqlAliases(sql);
    expect(aliases.all.has("cte")).toBe(true);
    expect(aliases.all.has("t")).toBe(true);
    expect(aliases.all.has("total")).toBe(true);
  });

  it("detects CTE-derived aliases (FROM cte_name alias)", () => {
    const sql = [
      "WITH loan_counts AS (SELECT month, COUNT(*) AS cnt FROM t1 GROUP BY 1),",
      "loan_amounts AS (SELECT month, SUM(amt) AS total FROM t1 GROUP BY 1)",
      "SELECT lc.cnt, la.total FROM loan_counts lc JOIN loan_amounts la ON lc.month = la.month",
    ].join("\n");
    const aliases = extractSqlAliases(sql);
    expect(aliases.cteNames.has("loan_counts")).toBe(true);
    expect(aliases.cteNames.has("loan_amounts")).toBe(true);
    expect(aliases.cteAliases.has("lc")).toBe(true);
    expect(aliases.cteAliases.has("la")).toBe(true);
  });

  it("does not mark aliases to real tables as CTE-derived", () => {
    const sql = "SELECT t.id FROM catalog.schema.orders t";
    const aliases = extractSqlAliases(sql);
    expect(aliases.cteAliases.size).toBe(0);
    expect(aliases.tableAliases.has("t")).toBe(true);
  });

  it("detects implicit column aliases (without AS keyword)", () => {
    const sql = "SELECT COUNT(*) total_count, SUM(amount) total_amount\nFROM t";
    const aliases = extractSqlAliases(sql);
    expect(aliases.columnAliases.has("total_count")).toBe(true);
    expect(aliases.columnAliases.has("total_amount")).toBe(true);
  });

  it("does not capture SQL keywords as implicit aliases", () => {
    const sql = "SELECT COALESCE(a, b) FROM t";
    const aliases = extractSqlAliases(sql);
    expect(aliases.columnAliases.has("from")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractColumnReferences
// ---------------------------------------------------------------------------

describe("extractColumnReferences", () => {
  it("extracts plain column references", () => {
    const sql = "SELECT t.id, t.name FROM table1 t";
    const refs = extractColumnReferences(sql);
    const columns = refs.map((r) => `${r.prefix}.${r.column}`);
    expect(columns).toContain("t.id");
    expect(columns).toContain("t.name");
  });

  it("extracts backtick-quoted column references", () => {
    const sql = "SELECT s.`Age Group`, s.`Total Count` FROM segment s";
    const refs = extractColumnReferences(sql);
    const quoted = refs.filter((r) => r.isQuoted);
    expect(quoted).toHaveLength(2);
    expect(quoted[0].column).toBe("Age Group");
    expect(quoted[1].column).toBe("Total Count");
  });

  it("extracts both plain and quoted from the same SQL", () => {
    const sql = "SELECT t.id, t.`Full Name` FROM table1 t";
    const refs = extractColumnReferences(sql);
    expect(refs.some((r) => !r.isQuoted && r.column === "id")).toBe(true);
    expect(refs.some((r) => r.isQuoted && r.column === "Full Name")).toBe(true);
  });

  it("does not extract references from comments", () => {
    const sql = "SELECT t.id -- e.g. example\nFROM table1 t";
    const refs = extractColumnReferences(sql);
    const columns = refs.map((r) => `${r.prefix}.${r.column}`);
    expect(columns).toContain("t.id");
    expect(columns).not.toContain("e.g");
  });

  it("does not extract references from block comments", () => {
    const sql = "SELECT t.id /* see a.fake_col for details */ FROM table1 t";
    const refs = extractColumnReferences(sql);
    const columns = refs.map((r) => `${r.prefix}.${r.column}`);
    expect(columns).toContain("t.id");
    expect(columns).not.toContain("a.fake_col");
  });
});

// ---------------------------------------------------------------------------
// validateColumnReferences
// ---------------------------------------------------------------------------

describe("validateColumnReferences", () => {
  const knownColumns = new Set([
    "id",
    "name",
    "amount",
    "customer_id",
    "client age group",
    "total complaint events",
  ]);

  it("passes when all columns are known", () => {
    const sql = "SELECT t.id, t.name FROM table1 t";
    const result = validateColumnReferences(sql, knownColumns);
    expect(result.valid).toBe(true);
    expect(result.unknownColumns).toHaveLength(0);
  });

  it("flags unknown plain columns", () => {
    const sql = "SELECT t.id, t.fake_column FROM table1 t";
    const result = validateColumnReferences(sql, knownColumns);
    expect(result.valid).toBe(false);
    expect(result.unknownColumns).toContain("t.fake_column");
  });

  it("flags unknown backtick-quoted columns", () => {
    const sql = "SELECT s.`Invented Metric` FROM segment s";
    const result = validateColumnReferences(sql, knownColumns);
    expect(result.valid).toBe(false);
    expect(result.unknownColumns).toContain("s.`Invented Metric`");
  });

  it("does not flag backtick-quoted columns that are CTE aliases", () => {
    const sql = [
      "WITH segment AS (",
      "  SELECT COALESCE(`Client Age Group`, 'Unknown') AS `Age Group`",
      "  FROM table1",
      ")",
      "SELECT s.`Age Group` FROM segment s",
    ].join("\n");
    const result = validateColumnReferences(sql, knownColumns);
    expect(result.unknownColumns).not.toContain("s.`Age Group`");
  });

  it("does not flag plain CTE-computed aliases", () => {
    const sql = [
      "WITH base AS (",
      "  SELECT SUM(amount) AS total_amount FROM table1",
      ")",
      "SELECT b.total_amount FROM base b",
    ].join("\n");
    const result = validateColumnReferences(sql, knownColumns);
    expect(result.unknownColumns).not.toContain("b.total_amount");
  });

  it("skips SQL keywords", () => {
    const sql = "SELECT t.count FROM table1 t ORDER BY t.count DESC";
    const result = validateColumnReferences(sql, new Set(["id"]));
    expect(result.unknownColumns).not.toContain("t.count");
  });

  it("skips FQN parts when tablesInvolved is provided", () => {
    const sql = "SELECT catalog.schema.table1.id FROM catalog.schema.table1";
    const result = validateColumnReferences(sql, knownColumns, {
      tablesInvolved: ["catalog.schema.table1"],
    });
    expect(result.unknownColumns).not.toContain("catalog.schema");
    expect(result.unknownColumns).not.toContain("schema.table1");
  });

  it("skips AI function return fields when enabled", () => {
    const sql = [
      "WITH ai_result AS (",
      "  SELECT ai_query('endpoint', prompt) AS response FROM t",
      ")",
      "SELECT r.result, r.errorMessage FROM ai_result r",
    ].join("\n");
    const result = validateColumnReferences(sql, knownColumns, {
      allowAiFunctionFields: true,
    });
    for (const field of AI_FUNCTION_RETURN_FIELDS) {
      expect(result.unknownColumns.join(",").toLowerCase()).not.toContain(field);
    }
  });

  it("flags AI function return fields when NOT enabled", () => {
    const sql = "SELECT r.errorMessage FROM ai_result r";
    const result = validateColumnReferences(sql, knownColumns, {
      allowAiFunctionFields: false,
    });
    expect(result.unknownColumns).toContain("r.errorMessage");
  });

  it("does not flag references in comments", () => {
    const sql = "SELECT t.id -- e.g. example usage\nFROM table1 t";
    const result = validateColumnReferences(sql, knownColumns);
    expect(result.unknownColumns).not.toContain("e.g");
  });

  it("deduplicates unknown columns", () => {
    const sql = "SELECT t.fake, t.fake FROM table1 t";
    const result = validateColumnReferences(sql, knownColumns);
    expect(result.unknownColumns).toHaveLength(1);
  });

  it("skips CTE-prefixed column references (CTE columns are user-defined)", () => {
    const sql = [
      "WITH loan_stats AS (",
      "  SELECT",
      "    EXTRACT(MONTH FROM loan_date) AS loan_month,",
      "    COUNT(*) AS monthly_loan_count,",
      "    PERCENTILE_APPROX(amount, 0.975) AS monthly_amount_upper,",
      "    PERCENTILE_APPROX(amount, 0.025) AS monthly_amount_lower",
      "  FROM catalog.schema.loans",
      "  GROUP BY 1",
      ")",
      "SELECT",
      "  ls.loan_month,",
      "  ls.monthly_loan_count,",
      "  ls.monthly_amount_upper,",
      "  ls.monthly_amount_lower",
      "FROM loan_stats ls",
    ].join("\n");
    const result = validateColumnReferences(sql, new Set(["loan_date", "amount"]), {
      tablesInvolved: ["catalog.schema.loans"],
    });
    expect(result.valid).toBe(true);
    expect(result.unknownColumns).toHaveLength(0);
  });

  it("skips references via CTE alias even for columns not defined with AS", () => {
    const sql = [
      "WITH base AS (",
      "  SELECT id, COUNT(*) total_count",
      "  FROM catalog.schema.orders",
      "  GROUP BY id",
      ")",
      "SELECT b.id, b.total_count FROM base b",
    ].join("\n");
    const result = validateColumnReferences(sql, new Set(["id"]), {
      tablesInvolved: ["catalog.schema.orders"],
    });
    expect(result.valid).toBe(true);
    expect(result.unknownColumns).toHaveLength(0);
  });

  it("still flags hallucinated columns on real table aliases", () => {
    const sql = "SELECT t.id, t.nonexistent_col FROM catalog.schema.orders t";
    const result = validateColumnReferences(sql, new Set(["id"]), {
      tablesInvolved: ["catalog.schema.orders"],
    });
    expect(result.valid).toBe(false);
    expect(result.unknownColumns).toContain("t.nonexistent_col");
  });

  it("reproduces the dashboard vulnerability_demographic_detail scenario", () => {
    const sql = [
      "WITH segment AS (",
      "  SELECT",
      "    COALESCE(`Client Age Group`, 'Unknown') AS `Age Group`,",
      "    COALESCE(`Client Gender`, 'Unknown') AS `Gender`,",
      "    SUM(`Total Complaint Events`) AS `Total Complaints`,",
      "    AVG(complaint_rate) AS `Avg Complaints Per Client`,",
      "    SUM(disputed) AS `Disputed Events`,",
      "    SUM(late) AS `Late Responses`,",
      "    SUM(relief) AS `Monetary Relief Events`",
      "  FROM catalog.schema.complaints",
      ")",
      "SELECT",
      "  s.`Age Group`,",
      "  s.`Gender`,",
      "  s.`Total Complaints`,",
      "  s.`Avg Complaints Per Client`,",
      "  s.`Disputed Events`,",
      "  s.`Late Responses`,",
      "  s.`Monetary Relief Events`",
      "FROM segment s",
    ].join("\n");
    const dashboardKnown = new Set([
      "client age group",
      "client gender",
      "total complaint events",
      "complaint_rate",
      "disputed",
      "late",
      "relief",
    ]);
    const result = validateColumnReferences(sql, dashboardKnown);
    expect(result.valid).toBe(true);
    expect(result.unknownColumns).toHaveLength(0);
  });
});
