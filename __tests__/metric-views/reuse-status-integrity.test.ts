import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExistingMetricViewDetail } from "@/lib/metric-views/types";

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  runProposals: vi.fn(),
  validateDefinition: vi.fn(),
}));

vi.mock("@/lib/toolkit/llm-cache", () => ({
  cachedChatCompletion: mocks.chat,
}));
vi.mock("@/lib/toolkit/parse-llm-json", () => ({
  parseLLMJson: (value: string) => JSON.parse(value),
}));
vi.mock("@/lib/metric-views/subdomain-mapper", () => ({
  mapSubdomainsToTables: () => [
    {
      domain: "Sales",
      subdomain: "Revenue",
      tables: ["main.sales.orders"],
      useCases: [{ name: "Revenue analysis" }],
    },
  ],
}));
vi.mock("@/lib/metric-views/discovery", () => ({
  filterRelevantExistingViews: (views: ExistingMetricViewDetail[]) => views,
}));
vi.mock("@/lib/genie/passes/metric-view-proposals", () => ({
  runMetricViewProposals: mocks.runProposals,
  validateMetricViewDefinitionWithProbes: mocks.validateDefinition,
}));
vi.mock("@/lib/skills", () => ({
  resolveForGeniePass: () => ({ systemOverlay: "" }),
  formatSystemOverlay: () => "",
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { runMetricViewEngineV2 } from "@/lib/metric-views/engine";

const validYaml = `version: "1.1"
source: main.sales.orders
dimensions:
  - name: order_month
    expr: DATE_TRUNC('MONTH', order_date)
measures:
  - name: total_revenue
    expr: SUM(amount)
`;

function existing(yaml: string | null): ExistingMetricViewDetail {
  return {
    fqn: "main.sales.revenue_metrics",
    name: "revenue_metrics",
    comment: "Revenue metrics",
    yaml,
    sourceTable: "main.sales.orders",
    dimensions: ["order_month"],
    measures: ["total_revenue"],
    joinTargets: [],
  };
}

async function runReuse(view: ExistingMetricViewDetail) {
  mocks.chat.mockResolvedValue({
    content: JSON.stringify({
      summary: "Reuse the existing governed metric view.",
      views: [
        {
          name: view.name,
          subdomain: "Revenue",
          classification: "reuse",
          rationale: "Already covers the requirement.",
          existingFqn: view.fqn,
          focusTables: ["main.sales.orders"],
          suggestedMeasures: [],
          suggestedDimensions: [],
        },
      ],
    }),
  });

  return runMetricViewEngineV2({
    domain: "Sales",
    useCases: [] as never[],
    metadata: {} as never,
    allowlist: {} as never,
    existingMetricViews: [view],
    measures: [],
    dimensions: [],
    joinSpecs: [],
    columnEnrichments: [],
    endpoint: "endpoint",
  });
}

describe("reuse proposal status integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runProposals.mockResolvedValue({ proposals: [] });
    mocks.validateDefinition.mockResolvedValue({
      status: "valid",
      issues: [],
      evidence: [],
      validatorVersion: "metric-view-probes-v1",
      validatedAt: "2026-07-24T00:00:00.000Z",
    });
  });

  it("marks reuse with missing YAML unverified and records a structured reason", async () => {
    const result = await runReuse(existing(null));

    expect(result.proposals[0]).toEqual(
      expect.objectContaining({
        classification: "reuse",
        definition: undefined,
        validationStatus: "unverified",
        validatorVersion: undefined,
        validatedAt: undefined,
        validationEvidence: [
          expect.objectContaining({
            stage: "metric_view_parse",
            status: "skipped",
            code: "METRIC_VIEW_REUSE_DEFINITION_MISSING",
          }),
        ],
      }),
    );
  });

  it("marks reuse with malformed YAML as error without runtime provenance", async () => {
    const result = await runReuse(existing("version: ["));

    expect(result.proposals[0]).toEqual(
      expect.objectContaining({
        classification: "reuse",
        definition: undefined,
        validationStatus: "error",
        validatorVersion: undefined,
        validatedAt: undefined,
        validationEvidence: [
          expect.objectContaining({
            stage: "metric_view_parse",
            status: "failed",
            code: "METRIC_VIEW_REUSE_PARSE_FAILED",
          }),
        ],
      }),
    );
  });

  it("retains valid status only when reuse YAML produces typed IR", async () => {
    const result = await runReuse(existing(validYaml));

    expect(result.proposals[0]).toEqual(
      expect.objectContaining({
        classification: "reuse",
        definition: expect.objectContaining({
          name: "revenue_metrics",
          source: { kind: "table", table: "main.sales.orders" },
        }),
        validationStatus: "valid",
        validationIssues: [],
      }),
    );
  });
});
