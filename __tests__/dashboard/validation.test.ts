import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  lintMissingGroupBy,
  validateDatasetSql,
  validateMetricViewSql,
  validateSelectedMetricViewBinding,
} from "@/lib/dashboard/validation";
import type { SqlExecutor } from "@/lib/ports/sql-executor";

const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@/lib/dbx/sql", () => ({
  executeSQL: vi.fn(),
}));

const _mockValidationLog = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
  timed: vi.fn(),
  context: {},
};
vi.mock("@/lib/logger", () => ({
  logger: mockLogger,
  createScopedLogger: () => _mockValidationLog,
  apiLogger: () => _mockValidationLog,
}));

import { executeSQL } from "@/lib/dbx/sql";

const mockExecuteSQL = vi.mocked(executeSQL);

describe("validateDatasetSql", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when EXPLAIN succeeds", async () => {
    mockExecuteSQL.mockResolvedValueOnce({ columns: [], rows: [], totalRowCount: 0 });
    const result = await validateDatasetSql("SELECT 1", "test_ds");
    expect(result).toBeNull();
    expect(mockExecuteSQL).toHaveBeenCalledWith("EXPLAIN SELECT 1");
  });

  it("returns error message when EXPLAIN fails", async () => {
    mockExecuteSQL.mockRejectedValueOnce(new Error("UNRESOLVED_COLUMN: col_x"));
    const result = await validateDatasetSql("SELECT col_x FROM t", "test_ds");
    expect(result).toEqual({
      errorCategory: "runtime",
      message: "UNRESOLVED_COLUMN: col_x",
    });
  });

  it("handles non-Error exceptions", async () => {
    mockExecuteSQL.mockRejectedValueOnce("some string error");
    const result = await validateDatasetSql("SELECT 1", "test_ds");
    expect(result).toEqual({
      errorCategory: "runtime",
      message: "some string error",
    });
  });

  it("redacts executor diagnostics before returning evidence data or logging", async () => {
    const failure = new Error(
      "MISSING_AGGREGATION: SELECT 'private-literal' FROM main.sales.orders; " +
        "Authorization: Bearer bearer-secret; access_token=access-secret; " +
        "client_secret=client-secret; prompt=private plan",
    ) as Error & { code: string };
    failure.code = "ETIMEDOUT";
    mockExecuteSQL.mockRejectedValueOnce(failure);

    const result = await validateDatasetSql("SELECT category, SUM(amount) FROM orders", "test_ds");

    expect(result).toMatchObject({
      errorCategory: "runtime",
      errorCode: "ETIMEDOUT",
      message: expect.any(String),
    });
    expect(mockLogger.warn).toHaveBeenCalledWith("Dashboard SQL EXPLAIN failed", {
      dataset: "test_ds",
      errorCategory: "runtime",
      errorCode: "ETIMEDOUT",
      errorMessage: expect.any(String),
    });
    const diagnostics = JSON.stringify({
      result,
      loggerCalls: mockLogger.warn.mock.calls,
    });
    for (const secret of [
      "private-literal",
      "main.sales.orders",
      "Bearer",
      "bearer-secret",
      "access-secret",
      "client-secret",
      "private plan",
    ]) {
      expect(diagnostics).not.toContain(secret);
    }
  });

  it("uses the injected executor for EXPLAIN", async () => {
    const executor: SqlExecutor = {
      execute: vi.fn().mockResolvedValue({ columns: [], rows: [], totalRowCount: 0 }),
      executeMapped: vi.fn(),
      executeScalar: vi.fn(),
    };

    await expect(validateDatasetSql("SELECT 1", "test_ds", executor)).resolves.toBeNull();

    expect(executor.execute).toHaveBeenCalledWith("EXPLAIN SELECT 1");
    expect(mockExecuteSQL).not.toHaveBeenCalled();
  });
});

describe("lintMissingGroupBy", () => {
  it("accepts an aggregate-only SELECT without GROUP BY", () => {
    expect(lintMissingGroupBy("SELECT COUNT(*) AS total FROM orders")).toBeNull();
  });

  it("rejects mixed aggregate and non-aggregate projections without GROUP BY", () => {
    expect(lintMissingGroupBy("SELECT region, SUM(revenue) AS total FROM orders")).toContain(
      "without GROUP BY",
    );
  });
});

// ---------------------------------------------------------------------------
// validateMetricViewSql
// ---------------------------------------------------------------------------

const MV_FQN = "retail_banking.demo_data.transaction_anomaly_metrics";
const mvFqns = new Set([MV_FQN]);
const mvMeasures = new Map([[MV_FQN, ["total_txn_amount", "total_txn_count", "avg_txn_amount"]]]);

describe("validateMetricViewSql", () => {
  it("returns valid when SQL does not reference a metric view", () => {
    const sql = "SELECT region, SUM(amount) FROM catalog.schema.orders GROUP BY region";
    const result = validateMetricViewSql(sql, mvFqns, mvMeasures);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("returns valid for correct MEASURE() syntax with aliases and GROUP BY ALL", () => {
    const sql = [
      "SELECT transaction_date_day,",
      "  MEASURE(total_txn_amount) AS total_txn_amount,",
      "  MEASURE(total_txn_count) AS total_txn_count,",
      "  MEASURE(avg_txn_amount) AS avg_txn_amount",
      `FROM ${MV_FQN}`,
      "WHERE transaction_date_day IS NOT NULL",
      "GROUP BY ALL",
    ].join("\n");

    const result = validateMetricViewSql(sql, mvFqns, mvMeasures);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("detects SELECT * on a metric view", () => {
    const sql = `SELECT * FROM ${MV_FQN}`;
    const result = validateMetricViewSql(sql, mvFqns, mvMeasures);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.stringContaining("SELECT *"));
  });

  it("detects missing GROUP BY", () => {
    const sql = `SELECT transaction_date_day, MEASURE(total_txn_amount) AS total_txn_amount FROM ${MV_FQN}`;
    const result = validateMetricViewSql(sql, mvFqns, mvMeasures);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.stringContaining("GROUP BY"));
  });

  it("allows a measure-only metric-view query without GROUP BY", () => {
    const sql = `SELECT MEASURE(total_txn_amount) AS total_txn_amount FROM ${MV_FQN}`;
    expect(validateMetricViewSql(sql, mvFqns, mvMeasures)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("detects bare measure references without MEASURE() wrapper", () => {
    const sql = [
      "SELECT tam.total_txn_amount, tam.total_txn_count",
      `FROM ${MV_FQN} AS tam`,
      "GROUP BY ALL",
    ].join("\n");

    const result = validateMetricViewSql(sql, mvFqns, mvMeasures);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes("total_txn_amount"))).toBe(true);
  });

  it("detects MEASURE() calls missing AS alias", () => {
    const sql = [
      "SELECT MEASURE(total_txn_amount),",
      "  MEASURE(total_txn_count) AS total_txn_count",
      `FROM ${MV_FQN}`,
      "GROUP BY ALL",
    ].join("\n");

    const result = validateMetricViewSql(sql, mvFqns, mvMeasures);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.stringContaining("missing AS alias"));
  });

  it("passes when all MEASURE() calls have AS aliases", () => {
    const sql = [
      "SELECT MEASURE(total_txn_amount) AS total_txn_amount,",
      "  MEASURE(total_txn_count) AS total_txn_count",
      `FROM ${MV_FQN}`,
      "GROUP BY ALL",
    ].join("\n");

    const result = validateMetricViewSql(sql, mvFqns, mvMeasures);
    expect(result.valid).toBe(true);
  });

  it("handles case-insensitive FQN matching", () => {
    const sql = [
      "SELECT MEASURE(total_txn_amount) AS total_txn_amount",
      `FROM RETAIL_BANKING.DEMO_DATA.TRANSACTION_ANOMALY_METRICS`,
      "GROUP BY ALL",
    ].join("\n");

    const result = validateMetricViewSql(sql, mvFqns, mvMeasures);
    expect(result.valid).toBe(true);
  });

  it("validates fully quoted metric-view FQNs and quoted measure identifiers", () => {
    const validSql = [
      "SELECT `transaction_date_day`,",
      "  MEASURE(`total_txn_amount`) AS `total_txn_amount`",
      "FROM `retail_banking`.`demo_data`.`transaction_anomaly_metrics`",
      "GROUP BY ALL",
      "LIMIT 1000",
    ].join("\n");
    const invalidSql = validSql.replace(
      "MEASURE(`total_txn_amount`) AS",
      "`total_txn_amount` AS",
    );

    expect(validateMetricViewSql(validSql, mvFqns, mvMeasures)).toEqual({
      valid: true,
      issues: [],
    });
    expect(validateMetricViewSql(invalidSql, mvFqns, mvMeasures)).toMatchObject({
      valid: false,
      issues: [expect.stringContaining("MEASURE() wrapper")],
    });
  });
});

describe("validateSelectedMetricViewBinding", () => {
  const binding = {
    fqn: MV_FQN,
    measureNames: ["total_txn_amount"],
    dimensionNames: ["transaction_date_day"],
    limit: 1000,
  };
  const validSql = [
    "SELECT `transaction_date_day`,",
    "  MEASURE(`total_txn_amount`) AS `total_txn_amount`",
    "FROM `retail_banking`.`demo_data`.`transaction_anomaly_metrics`",
    "GROUP BY ALL",
    "LIMIT 1000",
  ].join("\n");
  const expectInvalid = (sql: string, selectedBinding = binding) => {
    expect(validateSelectedMetricViewBinding(sql, selectedBinding)).toMatchObject({
      valid: false,
    });
  };

  it("accepts the exact selected FQN and requested fields", () => {
    expect(validateSelectedMetricViewBinding(validSql, binding)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it.each([
    [
      "unmatched opening backtick",
      "`retail_banking.demo_data.transaction_anomaly_metrics",
    ],
    [
      "unmatched closing backtick",
      "retail_banking`.demo_data.transaction_anomaly_metrics",
    ],
    [
      "partially quoted segment",
      "retail_banking.`demo_data.transaction_anomaly_metrics",
    ],
  ])("rejects a selected FQN with %s", (_name, malformedFqn) => {
    expectInvalid(
      validSql.replace(
        "`retail_banking`.`demo_data`.`transaction_anomaly_metrics`",
        malformedFqn,
      ),
    );
  });

  it.each([
    [
      "fully quoted",
      "`retail_banking`.`demo_data`.`transaction_anomaly_metrics`",
    ],
    ["fully bare", "retail_banking.demo_data.transaction_anomaly_metrics"],
  ])("accepts a %s selected FQN", (_name, fqn) => {
    const sql = validSql.replace(
      "`retail_banking`.`demo_data`.`transaction_anomaly_metrics`",
      fqn,
    );
    expect(validateSelectedMetricViewBinding(sql, binding)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("accepts safe whitespace, case, and backtick variations", () => {
    const sql = [
      "  select",
      " `TRANSACTION_DATE_DAY` ,",
      " measure( `TOTAL_TXN_AMOUNT` ) as `TOTAL_TXN_AMOUNT`",
      " from `RETAIL_BANKING` . `DEMO_DATA` . `TRANSACTION_ANOMALY_METRICS`",
      " group   by   all",
      " limit 1000  ",
    ].join("\n");

    expect(validateSelectedMetricViewBinding(sql, binding)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("accepts quoted governed identifiers that match SQL keywords", () => {
    const keywordBinding = {
      ...binding,
      measureNames: ["limit"],
      dimensionNames: ["from"],
      limit: 10,
    };
    const sql = [
      "SELECT `FROM`,",
      "  MEASURE(`LIMIT`) AS `limit`",
      "FROM `retail_banking`.`demo_data`.`transaction_anomaly_metrics`",
      "GROUP BY ALL",
      "LIMIT 10",
    ].join("\n");

    expect(validateSelectedMetricViewBinding(sql, keywordBinding)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("does not treat comment markers inside quoted identifiers as comments", () => {
    const hyphenBinding = {
      ...binding,
      measureNames: ["gross--margin"],
      dimensionNames: [],
      limit: 10,
    };
    const sql = [
      "SELECT MEASURE(`gross--margin`) AS `gross--margin`",
      "FROM `retail_banking`.`demo_data`.`transaction_anomaly_metrics`",
      "LIMIT 10",
    ].join("\n");

    expect(validateSelectedMetricViewBinding(sql, hyphenBinding)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it.each([
    [
      "extra projection",
      validSql.replace(
        "MEASURE(`total_txn_amount`) AS `total_txn_amount`",
        "MEASURE(`total_txn_amount`) AS `total_txn_amount`, 1 AS `rogue`",
      ),
    ],
    [
      "COUNT projection",
      validSql.replace(
        "MEASURE(`total_txn_amount`) AS `total_txn_amount`",
        "COUNT(*) AS `total_txn_amount`",
      ),
    ],
    [
      "unqualified JOIN source",
      validSql.replace(
        "GROUP BY ALL",
        "JOIN rogue ON 1 = 1\nGROUP BY ALL",
      ),
    ],
    [
      "comma source",
      validSql.replace(
        "FROM `retail_banking`.`demo_data`.`transaction_anomaly_metrics`",
        "FROM `retail_banking`.`demo_data`.`transaction_anomaly_metrics`, rogue",
      ),
    ],
    [
      "duplicate output alias",
      validSql.replace(
        "MEASURE(`total_txn_amount`) AS `total_txn_amount`",
        [
          "MEASURE(`total_txn_amount`) AS `total_txn_amount`,",
          "  MEASURE(`total_txn_amount`) AS `TOTAL_TXN_AMOUNT`",
        ].join("\n"),
      ),
    ],
    ["missing GROUP BY ALL", validSql.replace("GROUP BY ALL\n", "")],
    ["oversized LIMIT", validSql.replace("LIMIT 1000", "LIMIT 1001")],
    ["missing LIMIT", validSql.replace("\nLIMIT 1000", "")],
    ["nonliteral LIMIT", validSql.replace("LIMIT 1000", "LIMIT :row_limit")],
    ["ORDER BY clause", validSql.replace("LIMIT 1000", "ORDER BY 1\nLIMIT 1000")],
    ["multiple statements", `${validSql}; SELECT 1`],
    ["tokens before SELECT", `\`hidden\` ${validSql}`],
    ["line comment", validSql.replace("GROUP BY ALL", "-- hidden\nGROUP BY ALL")],
    ["block comment", validSql.replace("GROUP BY ALL", "/* hidden */ GROUP BY ALL")],
    [
      "subquery source",
      validSql.replace(
        "`retail_banking`.`demo_data`.`transaction_anomaly_metrics`",
        "(SELECT * FROM retail_banking.demo_data.transaction_anomaly_metrics)",
      ),
    ],
  ])("rejects %s", (_name, sql) => {
    expectInvalid(sql);
  });

  it("rejects GROUP BY ALL when no dimensions are requested", () => {
    const measureOnlyBinding = {
      ...binding,
      dimensionNames: [],
    };
    const sql = [
      "SELECT MEASURE(`total_txn_amount`) AS `total_txn_amount`",
      "FROM `retail_banking`.`demo_data`.`transaction_anomaly_metrics`",
      "GROUP BY ALL",
      "LIMIT 1000",
    ].join("\n");

    expectInvalid(sql, measureOnlyBinding);
  });

  it("accepts measure-only SQL without GROUP BY ALL", () => {
    const measureOnlyBinding = {
      ...binding,
      dimensionNames: [],
    };
    const sql = [
      "SELECT MEASURE(`total_txn_amount`) AS `total_txn_amount`",
      "FROM `retail_banking`.`demo_data`.`transaction_anomaly_metrics`",
      "LIMIT 1000",
    ].join("\n");

    expect(validateSelectedMetricViewBinding(sql, measureOnlyBinding)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("rejects review drift to table or another qualified source", () => {
    expectInvalid(
      "SELECT SUM(amount) AS total_txn_amount FROM retail_banking.demo_data.transactions LIMIT 1000",
    );
  });

  it("rejects review drift that removes a requested governed field", () => {
    const drifted = validSql.replace(
      "MEASURE(`total_txn_amount`) AS `total_txn_amount`",
      "1 AS `total_txn_amount`",
    );

    expectInvalid(drifted);
  });
});
