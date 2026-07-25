import { describe, expect, it, vi } from "vitest";
import { isMetricViewValidationDeployable } from "@/lib/metric-views/deployability";
import { runLegacyMetricViewProposalsBySchema } from "@/lib/metric-views/legacy-generation";
import type { MetricViewProposalsInput } from "@/lib/genie/passes/metric-view-proposals";

const evidence = [
  ["metric_view_static", "METRIC_VIEW_STATIC_VALIDATION_PASSED"],
  ["metric_view_create", "TEMP_METRIC_VIEW_CREATED"],
  ["metric_view_probe", "ATOMIC_MEASURE_PROBE_PASSED"],
  ["metric_view_cleanup", "TEMP_METRIC_VIEW_DROPPED"],
].map(([stage, code]) => ({ stage, code, status: "passed" as const, message: "ok" }));

describe("legacy metric-view rollout generation", () => {
  it("keeps flag-off proposals deployable with an exact per-schema target", async () => {
    const runner = vi.fn(async (input: MetricViewProposalsInput) => {
      const target = input.deploymentTarget;
      return {
        proposals: [
          {
            name: `${target?.schema}_metrics`,
            description: "Validated legacy proposal",
            definition: {
              version: "1.1" as const,
              name: `${target?.schema}_metrics`,
              source: { kind: "table" as const, table: input.tableFqns[0] },
              joins: [],
              dimensions: [],
              measures: [{ kind: "expression" as const, name: "row_count", expr: "COUNT(*)" }],
              requiredFeatures: [],
            },
            yaml: 'version: "1.1"',
            ddl: target
              ? `CREATE VIEW \`${target.catalog}\`.\`${target.schema}\`.\`${target.schema}_metrics\``
              : "",
            sourceTables: input.tableFqns,
            hasJoins: false,
            hasFilteredMeasures: false,
            hasWindowMeasures: false,
            hasMaterialization: false,
            validationStatus: "valid" as const,
            validationIssues: [],
            validatorVersion: "metric-view-probes-v1",
            validationEvidence: evidence,
            validatedAt: "2026-07-24T10:00:00.000Z",
          },
        ],
      };
    });

    const result = await runLegacyMetricViewProposalsBySchema(
      {
        domain: "Sales",
        tableFqns: ["main.sales.orders", "main.finance.invoices"],
        metadata: { tables: [], columns: [] } as never,
        allowlist: {} as never,
        useCases: [],
        measures: [],
        dimensions: [],
        joinSpecs: [],
        columnEnrichments: [],
        endpoint: "endpoint",
      },
      runner,
    );

    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls.map(([input]) => input.deploymentTarget)).toEqual([
      { catalog: "main", schema: "finance" },
      { catalog: "main", schema: "sales" },
    ]);
    expect(result.proposals).toHaveLength(2);
    expect(result.proposals.every(isMetricViewValidationDeployable)).toBe(true);
    expect(result.proposals.every((proposal) => proposal.ddl.length > 0)).toBe(true);
  });
});
