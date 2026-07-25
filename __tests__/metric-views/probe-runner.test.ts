import { describe, expect, it, vi } from "vitest";
import {
  buildMetricViewProbes,
  createTempMetricView,
  dryRunMetricViewDdlWithProbes,
  runMetricViewProbes,
} from "@/lib/metric-views/probes";
import {
  dryRunMetricViewDdl,
  validateMetricViewDefinitionWithProbes,
} from "@/lib/genie/passes/metric-view-proposals";
import type { SqlExecutor, SqlResult } from "@/lib/ports/sql-executor";

const emptyDdlResult: SqlResult = { columns: [], rows: [], totalRowCount: 0 };
const matchingProbeResult: SqlResult = {
  columns: [{ name: "total_revenue", typeName: "DECIMAL(18,2)", position: 0 }],
  rows: [],
  totalRowCount: 0,
};

function executorWith(
  execute: SqlExecutor["execute"] = vi
    .fn<SqlExecutor["execute"]>()
    .mockResolvedValue(emptyDdlResult),
): SqlExecutor {
  return {
    execute,
    executeMapped: vi.fn(),
    executeScalar: vi.fn(),
  };
}

const ddl = `CREATE OR REPLACE VIEW \`catalog\`.\`schema\`.\`sales_metrics\`
WITH METRICS
LANGUAGE YAML
AS $$
version: "1.1"
source: catalog.schema.sales
dimensions:
  - name: region
    expr: region
measures:
  - name: total_revenue
    expr: SUM(revenue)
$$`;

describe("runMetricViewProbes", () => {
  it("passes empty result rows when the observed schema matches", async () => {
    const sqlExecutor = executorWith(vi.fn().mockResolvedValue(matchingProbeResult));
    const probes = buildMetricViewProbes({
      tempFqn: "catalog.schema.__forge_validate_test",
      dimensions: [],
      measures: [{ name: "total_revenue" }],
      hasJoins: false,
    });

    const result = await runMetricViewProbes(probes, sqlExecutor);

    expect(result.ok).toBe(true);
    expect(result.evidence).toEqual([
      expect.objectContaining({
        stage: "metric_view_probe",
        status: "passed",
        code: "ATOMIC_MEASURE_PROBE_PASSED",
        observedSchema: [{ name: "total_revenue", dataType: "DECIMAL(18,2)" }],
        observedRowCount: 0,
      }),
    ]);
    expect(result.evidence.every((entry) => !("rows" in entry))).toBe(true);
  });

  it.each(["BYTE", "SHORT", "LONG"])(
    "accepts Databricks Statement Execution %s as a numeric measure type",
    async (measureType) => {
      const sqlExecutor = executorWith(
        vi.fn().mockResolvedValue({
          columns: [{ name: "record_count", typeName: measureType, position: 0 }],
          rows: [["1"]],
          totalRowCount: 1,
        }),
      );
      const probes = buildMetricViewProbes({
        tempFqn: "catalog.schema.__forge_validate_test",
        dimensions: [],
        measures: [{ name: "record_count" }],
        hasJoins: false,
      });

      const result = await runMetricViewProbes(probes, sqlExecutor);

      expect(result.ok).toBe(true);
      expect(result.evidence[0]).toMatchObject({
        status: "passed",
        code: "ATOMIC_MEASURE_PROBE_PASSED",
      });
    },
  );

  it("fails closed when a probe schema omits an expected column", async () => {
    const sqlExecutor = executorWith(
      vi.fn().mockResolvedValue({
        columns: [{ name: "wrong_alias", typeName: "DECIMAL(18,2)", position: 0 }],
        rows: [["private value"]],
        totalRowCount: 1,
      }),
    );
    const probes = buildMetricViewProbes({
      tempFqn: "catalog.schema.__forge_validate_test",
      dimensions: [],
      measures: [{ name: "total_revenue" }],
      hasJoins: false,
    });

    const result = await runMetricViewProbes(probes, sqlExecutor);

    expect(result.ok).toBe(false);
    expect(result.evidence[0]).toMatchObject({
      status: "failed",
      code: "ATOMIC_MEASURE_PROBE_SCHEMA_MISMATCH",
    });
    expect(JSON.stringify(result.evidence)).not.toContain("private value");
  });

  it("fails a temporal probe when its dimension is returned as STRING", async () => {
    const sqlExecutor = executorWith(
      vi.fn().mockResolvedValue({
        columns: [
          { name: "order_month", typeName: "STRING", position: 0 },
          { name: "total_revenue", typeName: "DECIMAL(18,2)", position: 1 },
        ],
        rows: [],
        totalRowCount: 0,
      }),
    );
    const temporalProbe = buildMetricViewProbes({
      tempFqn: "catalog.schema.__forge_validate_test",
      dimensions: [{ name: "order_month", kind: "temporal" }],
      measures: [{ name: "total_revenue" }],
      hasJoins: false,
    }).find((probe) => probe.kind === "temporal_group")!;

    const result = await runMetricViewProbes([temporalProbe], sqlExecutor);

    expect(result.ok).toBe(false);
    expect(result.evidence[0]).toMatchObject({
      status: "failed",
      code: "TEMPORAL_GROUP_PROBE_SCHEMA_MISMATCH",
      message: expect.stringContaining("STRING"),
    });
  });

  it.each(["DATE", "TIMESTAMP", "TIMESTAMP_NTZ"])(
    "passes a temporal probe with a %s dimension",
    async (dimensionType) => {
      const sqlExecutor = executorWith(
        vi.fn().mockResolvedValue({
          columns: [
            { name: "order_month", typeName: dimensionType, position: 0 },
            { name: "total_revenue", typeName: "DOUBLE", position: 1 },
          ],
          rows: [],
          totalRowCount: 0,
        }),
      );
      const temporalProbe = buildMetricViewProbes({
        tempFqn: "catalog.schema.__forge_validate_test",
        dimensions: [{ name: "order_month", kind: "temporal" }],
        measures: [{ name: "total_revenue" }],
        hasJoins: false,
      }).find((probe) => probe.kind === "temporal_group")!;

      const result = await runMetricViewProbes([temporalProbe], sqlExecutor);

      expect(result.ok).toBe(true);
    },
  );

  it.each(["TINYINT", "SMALLINT", "INT", "BIGINT", "BYTE", "SHORT", "LONG"])(
    "passes a calendar-extraction temporal probe with a %s dimension",
    async (dimensionType) => {
      const sqlExecutor = executorWith(
        vi.fn().mockResolvedValue({
          columns: [
            { name: "order_year", typeName: dimensionType, position: 0 },
            { name: "total_revenue", typeName: "DOUBLE", position: 1 },
          ],
          rows: [],
          totalRowCount: 0,
        }),
      );
      const temporalProbe = buildMetricViewProbes({
        tempFqn: "catalog.schema.__forge_validate_test",
        dimensions: [
          { name: "order_year", kind: "temporal", temporalType: "calendar_integer" },
        ],
        measures: [{ name: "total_revenue" }],
        hasJoins: false,
      }).find((probe) => probe.kind === "temporal_group")!;

      const result = await runMetricViewProbes([temporalProbe], sqlExecutor);

      expect(temporalProbe.expectedDimensionClass).toBe("calendar_integer");
      expect(result.ok).toBe(true);
    },
  );

  it("fails a calendar-extraction temporal probe with a STRING dimension", async () => {
    const sqlExecutor = executorWith(
      vi.fn().mockResolvedValue({
        columns: [
          { name: "order_year", typeName: "STRING", position: 0 },
          { name: "total_revenue", typeName: "DOUBLE", position: 1 },
        ],
        rows: [],
        totalRowCount: 0,
      }),
    );
    const temporalProbe = buildMetricViewProbes({
      tempFqn: "catalog.schema.__forge_validate_test",
      dimensions: [
        { name: "order_year", kind: "temporal", temporalType: "calendar_integer" },
      ],
      measures: [{ name: "total_revenue" }],
      hasJoins: false,
    }).find((probe) => probe.kind === "temporal_group")!;

    const result = await runMetricViewProbes([temporalProbe], sqlExecutor);

    expect(result.ok).toBe(false);
    expect(result.evidence[0].message).toContain("STRING");
  });

  it("passes a categorical probe with a STRING dimension", async () => {
    const sqlExecutor = executorWith(
      vi.fn().mockResolvedValue({
        columns: [
          { name: "region", typeName: "STRING", position: 0 },
          { name: "total_revenue", typeName: "DOUBLE", position: 1 },
        ],
        rows: [],
        totalRowCount: 0,
      }),
    );
    const categoricalProbe = buildMetricViewProbes({
      tempFqn: "catalog.schema.__forge_validate_test",
      dimensions: [{ name: "region", kind: "categorical" }],
      measures: [{ name: "total_revenue" }],
      hasJoins: false,
    }).find((probe) => probe.kind === "categorical_group")!;

    const result = await runMetricViewProbes([categoricalProbe], sqlExecutor);

    expect(result.ok).toBe(true);
  });
});

describe("createTempMetricView DDL envelope", () => {
  it("accepts backtick-quoted hyphenated Unity Catalog FQNs", async () => {
    const execute = vi.fn<SqlExecutor["execute"]>().mockResolvedValue(emptyDdlResult);
    const sqlExecutor = executorWith(execute);
    const hyphenatedDdl = ddl.replace(
      "`catalog`.`schema`.`sales_metrics`",
      "`sales-catalog`.`analytics-schema`.`sales-metrics`",
    );

    const handle = await createTempMetricView(hyphenatedDdl, "forge_", sqlExecutor);

    expect(handle).toMatchObject({
      catalog: "sales-catalog",
      schema: "analytics-schema",
    });
    expect(execute.mock.calls[0][0]).toMatch(
      /^CREATE OR REPLACE VIEW `sales-catalog`\.`analytics-schema`\.`__forge_validate_/,
    );
  });

  it.each([
    ["prepended statement", `SELECT 1;\n${ddl}`],
    [
      "missing metric-view clauses",
      "CREATE OR REPLACE VIEW `catalog`.`schema`.`sales_metrics` AS SELECT 1",
    ],
  ])("rejects a malformed %s envelope before execution", async (_label, malformedDdl) => {
    const execute = vi.fn<SqlExecutor["execute"]>().mockResolvedValue(emptyDdlResult);
    const sqlExecutor = executorWith(execute);

    await expect(createTempMetricView(malformedDdl, "forge_", sqlExecutor)).rejects.toThrow(
      /DDL envelope/i,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects an appended statement even when trailing text contains a later delimiter", async () => {
    const execute = vi.fn<SqlExecutor["execute"]>().mockResolvedValue(emptyDdlResult);
    const sqlExecutor = executorWith(execute);
    const appended = `${ddl}; DROP VIEW catalog.schema.victim; -- later delimiter $$`;

    await expect(createTempMetricView(appended, "forge_", sqlExecutor)).rejects.toThrow(
      /DDL envelope/i,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("accepts a valid envelope with an optional terminator and whitespace", async () => {
    const execute = vi.fn<SqlExecutor["execute"]>().mockResolvedValue(emptyDdlResult);
    const sqlExecutor = executorWith(execute);

    await expect(createTempMetricView(`${ddl}; \n\t`, "forge_", sqlExecutor)).resolves.toMatchObject(
      {
        catalog: "catalog",
        schema: "schema",
      },
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("dryRunMetricViewDdlWithProbes", () => {
  it("executes temporary create, probes, and drop in order", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(emptyDdlResult)
      .mockResolvedValueOnce(matchingProbeResult)
      .mockResolvedValueOnce(emptyDdlResult);
    const sqlExecutor = executorWith(execute);

    const result = await dryRunMetricViewDdlWithProbes({
      ddl,
      resourcePrefix: "forge_",
      dimensions: [],
      measures: [{ name: "total_revenue" }],
      hasJoins: false,
      sqlExecutor,
    });

    expect(result.ok).toBe(true);
    expect(result.unverified).toBe(false);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls[0][0]).toMatch(
      /CREATE OR REPLACE VIEW `catalog`\.`schema`\.`__forge_validate_/,
    );
    expect(execute.mock.calls[1][0]).toMatch(
      /SELECT MEASURE\(`total_revenue`\)[\s\S]*FROM catalog\.schema\.__forge_validate_/,
    );
    expect(execute.mock.calls[2][0]).toMatch(
      /DROP VIEW IF EXISTS `catalog`\.`schema`\.`__forge_validate_/,
    );
    expect(result.evidence.map((entry) => entry.stage)).toEqual([
      "metric_view_create",
      "metric_view_probe",
      "metric_view_cleanup",
    ]);
  });

  it("drops the temporary view after a failed probe", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(emptyDdlResult)
      .mockRejectedValueOnce(new Error("UNRESOLVED_COLUMN"))
      .mockResolvedValueOnce(emptyDdlResult);
    const sqlExecutor = executorWith(execute);

    const result = await dryRunMetricViewDdlWithProbes({
      ddl,
      dimensions: [],
      measures: [{ name: "total_revenue" }],
      hasJoins: false,
      sqlExecutor,
    });

    expect(result.ok).toBe(false);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls[2][0]).toContain("DROP VIEW IF EXISTS");
    expect(result.evidence.map((entry) => entry.code)).toEqual([
      "TEMP_METRIC_VIEW_CREATED",
      "ATOMIC_MEASURE_PROBE_EXECUTION_FAILED",
      "TEMP_METRIC_VIEW_DROPPED",
    ]);
  });

  it("marks create permission failures unverified and still attempts cleanup", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("PERMISSION_DENIED: does not have CREATE VIEW"))
      .mockResolvedValueOnce(emptyDdlResult);
    const sqlExecutor = executorWith(execute);

    const result = await dryRunMetricViewDdlWithProbes({
      ddl,
      dimensions: [],
      measures: [{ name: "total_revenue" }],
      hasJoins: false,
      sqlExecutor,
    });

    expect(result).toMatchObject({ ok: false, unverified: true });
    expect(result.evidence[0]).toMatchObject({
      stage: "metric_view_create",
      status: "skipped",
      code: "TEMP_METRIC_VIEW_PERMISSION_UNVERIFIED",
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0]).toContain("DROP VIEW IF EXISTS");
  });

  it.each([
    "permission_denied: cannot create view",
    "Insufficient Privileges to CREATE VIEW",
    "[INSUFFICIENT_PRIVILEGES] missing create",
    "User does not have   CREATE VIEW permission",
    "ACCESS   DENIED for schema",
  ])("classifies permission variant as unverified: %s", async (permissionMessage) => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error(permissionMessage))
      .mockResolvedValueOnce(emptyDdlResult);
    const sqlExecutor = executorWith(execute);

    const result = await dryRunMetricViewDdlWithProbes({
      ddl,
      dimensions: [],
      measures: [{ name: "total_revenue" }],
      hasJoins: false,
      sqlExecutor,
    });

    expect(result).toMatchObject({ ok: false, unverified: true });
    expect(result.evidence[0]).toMatchObject({
      status: "skipped",
      code: "TEMP_METRIC_VIEW_PERMISSION_UNVERIFIED",
    });
  });

  it("records cleanup failure as failed evidence", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(emptyDdlResult)
      .mockResolvedValueOnce(matchingProbeResult)
      .mockRejectedValueOnce(new Error("warehouse unavailable during drop"));
    const sqlExecutor = executorWith(execute);

    const result = await dryRunMetricViewDdlWithProbes({
      ddl,
      dimensions: [],
      measures: [{ name: "total_revenue" }],
      hasJoins: false,
      sqlExecutor,
    });

    expect(result.ok).toBe(false);
    expect(result.evidence.at(-1)).toMatchObject({
      stage: "metric_view_cleanup",
      status: "failed",
      code: "TEMP_METRIC_VIEW_CLEANUP_FAILED",
      message: expect.stringContaining("warehouse unavailable during drop"),
    });
  });
});

describe("dryRunMetricViewDdl compatibility wrapper", () => {
  it("retains create-and-drop behavior without running probes", async () => {
    const execute = vi.fn<SqlExecutor["execute"]>().mockResolvedValue(emptyDdlResult);
    const sqlExecutor = executorWith(execute);

    await expect(dryRunMetricViewDdl(ddl, "legacy_", sqlExecutor)).resolves.toBeNull();

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][0]).toMatch(/CREATE OR REPLACE VIEW/);
    expect(execute.mock.calls[1][0]).toMatch(/DROP VIEW IF EXISTS/);
  });

  it("returns a cleanup-specific error when create succeeds but drop fails", async () => {
    const execute = vi
      .fn<SqlExecutor["execute"]>()
      .mockResolvedValueOnce(emptyDdlResult)
      .mockRejectedValueOnce(new Error("drop unavailable"));
    const sqlExecutor = executorWith(execute);

    await expect(dryRunMetricViewDdl(ddl, "legacy_", sqlExecutor)).resolves.toMatch(
      /^Failed to drop temp validation view /,
    );
  });
});

describe("validateMetricViewDefinitionWithProbes", () => {
  it("marks a definition valid only after create, MEASURE probe, and cleanup pass", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(emptyDdlResult)
      .mockResolvedValueOnce(matchingProbeResult)
      .mockResolvedValueOnce({
        columns: [
          { name: "region", typeName: "STRING", position: 0 },
          { name: "total_revenue", typeName: "DECIMAL(18,2)", position: 1 },
        ],
        rows: [],
        totalRowCount: 0,
      })
      .mockResolvedValueOnce(emptyDdlResult);
    const sqlExecutor = executorWith(execute);

    const result = await validateMetricViewDefinitionWithProbes({
      yaml: ddl.slice(ddl.indexOf("version:"), ddl.lastIndexOf("$$")),
      ddl,
      allowlist: {
        tables: new Set(["catalog.schema.sales"]),
        columns: new Map([
          ["catalog.schema.sales", new Set(["region", "revenue"])],
        ]),
        columnTypes: new Map([
          ["catalog.schema.sales.region", "string"],
          ["catalog.schema.sales.revenue", "decimal(18,2)"],
        ]),
        metricViews: new Set(),
      },
      sqlExecutor,
    });

    expect(result.status, JSON.stringify(result)).toBe("valid");
    expect(result.validatorVersion).toBe("metric-view-probes-v1");
    expect(result.evidence.map((entry) => entry.stage)).toEqual([
      "metric_view_static",
      "metric_view_create",
      "metric_view_probe",
      "metric_view_probe",
      "metric_view_cleanup",
    ]);
    expect(execute).toHaveBeenCalledTimes(4);
  });
});
