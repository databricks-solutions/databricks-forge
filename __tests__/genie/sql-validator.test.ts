import { describe, it, expect } from "vitest";
import {
  buildTestQuery,
  classifySqlError,
  isSqlRepairEnabled,
} from "@/lib/genie/sql-validator";

describe("buildTestQuery", () => {
  it("returns the trusted_asset SQL unchanged", () => {
    const out = buildTestQuery({
      sql: "SELECT 1",
      kind: "trusted_asset",
    });
    expect(out).toBe("SELECT 1");
  });

  it("wraps a measure as SELECT <expr> FROM <fqn> LIMIT 1", () => {
    const out = buildTestQuery({
      sql: "SUM(amount)",
      kind: "measure",
      tableFqn: "cat.sch.orders",
    });
    expect(out).toBe("SELECT SUM(amount) AS measure_value FROM cat.sch.orders LIMIT 1");
  });

  it("wraps a filter as SELECT * FROM <fqn> WHERE <expr> LIMIT 1", () => {
    const out = buildTestQuery({
      sql: "status = 'active'",
      kind: "filter",
      tableFqn: "cat.sch.users",
    });
    expect(out).toBe("SELECT * FROM cat.sch.users WHERE status = 'active' LIMIT 1");
  });

  it("wraps a named expression with an alias", () => {
    const out = buildTestQuery({
      sql: "DATE_TRUNC('month', order_date)",
      kind: "named_expression",
      tableFqn: "cat.sch.orders",
    });
    expect(out).toBe(
      "SELECT DATE_TRUNC('month', order_date) AS expr_value FROM cat.sch.orders LIMIT 1",
    );
  });

  it("wraps a join with INNER JOIN syntax", () => {
    const out = buildTestQuery({
      sql: "a.user_id = b.id",
      kind: "join",
      leftTable: "cat.sch.events",
      rightTable: "cat.sch.users",
    });
    expect(out).toBe(
      "SELECT events.* FROM cat.sch.events events INNER JOIN cat.sch.users users ON a.user_id = b.id LIMIT 1",
    );
  });

  it("strips a trailing semicolon from fragments", () => {
    const out = buildTestQuery({
      sql: "status = 'active';",
      kind: "filter",
      tableFqn: "cat.sch.users",
    });
    expect(out).toBe("SELECT * FROM cat.sch.users WHERE status = 'active' LIMIT 1");
  });

  it("returns null when context is missing for fragment kinds", () => {
    expect(buildTestQuery({ sql: "SUM(x)", kind: "measure" })).toBeNull();
    expect(buildTestQuery({ sql: "x = y", kind: "join", leftTable: "t" })).toBeNull();
  });

  it("returns null for empty SQL", () => {
    expect(buildTestQuery({ sql: "  ", kind: "trusted_asset" })).toBeNull();
  });
});

describe("classifySqlError", () => {
  it("classifies metric view unbound parameter errors", () => {
    expect(
      classifySqlError(
        "[METRIC_VIEW_UNBOUND_PARAMETER] Metric view requires parameter `start_date`",
      ),
    ).toBe("metric_view_unbound_param");
  });

  it("classifies unknown column errors", () => {
    expect(classifySqlError("Cannot resolve column 'foo'")).toBe("unknown_column");
    expect(classifySqlError("UnresolvedColumn: bar")).toBe("unknown_column");
  });

  it("classifies syntax errors", () => {
    expect(classifySqlError("ParseException: extraneous input")).toBe("syntax");
    expect(classifySqlError("Syntax error near LIMIT")).toBe("syntax");
  });

  it("classifies permission errors", () => {
    expect(classifySqlError("PERMISSION_DENIED: user lacks access")).toBe("permission");
  });

  it("falls back to other for unknown messages", () => {
    expect(classifySqlError("something completely random")).toBe("other");
  });
});

describe("isSqlRepairEnabled", () => {
  it("is OFF by default", () => {
    const before = process.env.FORGE_SQL_REPAIR_ENABLED;
    delete process.env.FORGE_SQL_REPAIR_ENABLED;
    try {
      expect(isSqlRepairEnabled()).toBe(false);
    } finally {
      if (before !== undefined) process.env.FORGE_SQL_REPAIR_ENABLED = before;
    }
  });

  it("is ON when env var is 'true'", () => {
    const before = process.env.FORGE_SQL_REPAIR_ENABLED;
    process.env.FORGE_SQL_REPAIR_ENABLED = "true";
    try {
      expect(isSqlRepairEnabled()).toBe(true);
    } finally {
      if (before !== undefined) process.env.FORGE_SQL_REPAIR_ENABLED = before;
      else delete process.env.FORGE_SQL_REPAIR_ENABLED;
    }
  });
});
