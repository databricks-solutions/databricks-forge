import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  GenieEnginePassOutputs,
  GenieSpaceRecommendation,
} from "@/lib/genie/types";
import type { SemanticAssetManifest } from "@/lib/semantic-assets/types";

let rows: Array<Record<string, unknown>> = [];

const recommendationTable = {
  deleteMany: vi.fn(async () => ({ count: 0 })),
  createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
    rows.push(...data);
    return { count: data.length };
  }),
  findMany: vi.fn(async () => rows),
};

vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T,>(
    callback: (prisma: {
      $transaction: (callback: (tx: unknown) => Promise<T>) => Promise<T>;
      forgeGenieRecommendation: typeof recommendationTable;
    }) => Promise<T>,
  ) =>
    callback({
      $transaction: async (transaction: (tx: unknown) => Promise<T>) =>
        transaction({ forgeGenieRecommendation: recommendationTable }),
      forgeGenieRecommendation: recommendationTable,
    }),
}));

vi.mock("@/lib/embeddings/embed-pipeline", () => ({
  embedGenieRecommendations: vi.fn(async () => undefined),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  getGenieRecommendationsByRunId,
  saveGenieRecommendations,
} from "@/lib/lakebase/genie-recommendations";

const manifest: SemanticAssetManifest = {
  version: "1",
  domain: "Sales",
  subdomains: ["Revenue"],
  metricViews: [],
  measures: [],
  dimensions: [],
  filters: [],
  generatedAt: "2026-07-24T05:00:00.000Z",
};

const recommendation: GenieSpaceRecommendation = {
  domain: "Sales",
  subdomains: ["Revenue"],
  title: "Sales Intelligence",
  description: "Sales semantics",
  tableCount: 1,
  metricViewCount: 0,
  useCaseCount: 1,
  sqlExampleCount: 0,
  joinCount: 0,
  measureCount: 0,
  filterCount: 0,
  dimensionCount: 0,
  benchmarkCount: 0,
  instructionCount: 0,
  sampleQuestionCount: 0,
  sqlFunctionCount: 0,
  tables: ["main.sales.orders"],
  metricViews: [],
  serializedSpace: JSON.stringify({
    version: 2,
    config: { sample_questions: [] },
    data_sources: { tables: [] },
    instructions: {
      text_instructions: [],
      example_question_sqls: [],
      join_specs: [],
      sql_snippets: { measures: [], filters: [], expressions: [] },
    },
  }),
};

const passOutput = {
  domain: "Sales",
  subdomains: ["Revenue"],
  tables: ["main.sales.orders"],
  metricViews: [],
  columnEnrichments: [],
  entityMatchingCandidates: [],
  measures: [],
  filters: [],
  dimensions: [],
  trustedQueries: [],
  trustedFunctions: [],
  textInstructions: [],
  sampleQuestions: [],
  benchmarkQuestions: [],
  metricViewProposals: [],
  joinSpecs: [],
  semanticAssetManifest: manifest,
} satisfies GenieEnginePassOutputs;

describe("Genie semantic manifest persistence", () => {
  beforeEach(() => {
    rows = [];
    vi.clearAllMocks();
  });

  it("round-trips the manifest with the existing recommendation pass output", async () => {
    await saveGenieRecommendations("run-1", [recommendation], [passOutput], 1);

    expect(recommendationTable.createMany.mock.calls[0][0].data[0].trustedFunctions).toBe(
      JSON.stringify(manifest),
    );

    const [stored] = await getGenieRecommendationsByRunId("run-1");
    expect(stored.semanticAssetManifest).toBe(JSON.stringify(manifest));
    expect(stored.trustedFunctions).toBeNull();
  });

  it("preserves legacy-only trusted functions without adapting DDL as semantic SQL", async () => {
    await saveGenieRecommendations("run-1", [recommendation], [], 1);
    const legacyFunctions = [
      {
        name: "legacy_revenue",
        ddl: "CREATE FUNCTION legacy_revenue() RETURNS DOUBLE RETURN 0",
        description: "Legacy revenue fallback",
      },
    ];
    rows[0].trustedFunctions = JSON.stringify(legacyFunctions);
    vi.clearAllMocks();

    const [stored] = await getGenieRecommendationsByRunId("run-1");

    expect(stored.trustedFunctions).toBe(JSON.stringify(legacyFunctions));
    expect(stored.semanticAssetManifest).toBeNull();
    expect(recommendationTable.createMany).not.toHaveBeenCalled();
    expect(recommendationTable.deleteMany).not.toHaveBeenCalled();
  });

  it("uses trimmed display names for decorated aliases and falls back for blank names", async () => {
    const serializedSpace = JSON.parse(recommendation.serializedSpace);
    serializedSpace.instructions.sql_snippets = {
      measures: [
        {
          id: "measure-1",
          alias: "__total_revenue_internal__",
          display_name: " Total Revenue ",
          sql: ["SUM(amount)"],
          synonyms: ["revenue"],
          comment: ["Fallback revenue"],
        },
        {
          id: "measure-2",
          alias: " net_margin ",
          display_name: "   ",
          sql: ["AVG(margin)"],
          synonyms: [],
          comment: [],
        },
      ],
      filters: [
        {
          id: "filter-1",
          alias: "__completed_orders_internal__",
          display_name: " Completed Orders ",
          sql: ["status = 'completed'"],
          synonyms: ["completed"],
          comment: ["Completed only"],
        },
      ],
      expressions: [
        {
          id: "dimension-1",
          alias: "__order_month_internal__",
          display_name: " Order Month ",
          sql: ["DATE_TRUNC('MONTH', order_date)"],
          synonyms: ["month"],
          instruction: ["Order month"],
        },
      ],
    };
    await saveGenieRecommendations(
      "run-1",
      [{ ...recommendation, serializedSpace: JSON.stringify(serializedSpace) }],
      [],
      1,
    );
    vi.clearAllMocks();

    const [stored] = await getGenieRecommendationsByRunId("run-1");
    const adapted = JSON.parse(stored.semanticAssetManifest ?? "null") as SemanticAssetManifest;

    expect(stored.trustedFunctions).toBeNull();
    expect(adapted.metricViews).toEqual([]);
    expect(adapted.measures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "measure:genie:sales:total_revenue",
          name: "Total Revenue",
          fallback: true,
        }),
        expect.objectContaining({
          id: "measure:genie:sales:net_margin",
          name: "net_margin",
          fallback: true,
        }),
      ]),
    );
    expect(adapted.dimensions).toEqual([
      expect.objectContaining({
        id: "dimension:genie:sales:order_month",
        name: "Order Month",
        fallback: true,
      }),
    ]);
    expect(adapted.filters).toEqual([
      expect.objectContaining({
        id: "filter:genie:sales:completed_orders",
        name: "Completed Orders",
        fallback: true,
      }),
    ]);
    expect(recommendationTable.createMany).not.toHaveBeenCalled();
    expect(recommendationTable.deleteMany).not.toHaveBeenCalled();
  });

  it("keeps legacy arrays in mixed payloads without placing function DDL in fallback SQL", async () => {
    const serializedSpace = JSON.parse(recommendation.serializedSpace);
    serializedSpace.instructions.sql_snippets.measures = [
      {
        id: "measure-1",
        alias: "__revenue_internal__",
        display_name: "Revenue",
        sql: ["SUM(amount)"],
      },
    ];
    await saveGenieRecommendations(
      "run-1",
      [{ ...recommendation, serializedSpace: JSON.stringify(serializedSpace) }],
      [],
      1,
    );
    const legacyFunctions = [
      {
        name: "legacy_revenue",
        ddl: "CREATE FUNCTION legacy_revenue() RETURNS DOUBLE RETURN 0",
        description: "Legacy revenue",
      },
    ];
    rows[0].trustedFunctions = JSON.stringify(legacyFunctions);
    vi.clearAllMocks();

    const [stored] = await getGenieRecommendationsByRunId("run-1");
    const adapted = JSON.parse(stored.semanticAssetManifest ?? "null") as SemanticAssetManifest;

    expect(stored.trustedFunctions).toBe(JSON.stringify(legacyFunctions));
    expect(adapted.measures).toEqual([
      expect.objectContaining({ name: "Revenue", sql: "SUM(amount)" }),
    ]);
    expect(
      adapted.measures.every(
        (measure) => !("sql" in measure) || !measure.sql.includes("CREATE FUNCTION"),
      ),
    ).toBe(true);
  });
});
