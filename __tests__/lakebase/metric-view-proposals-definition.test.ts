import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MetricViewDefinition, MetricViewProposal } from "@/lib/metric-views/types";

type StoredRow = Record<string, unknown>;

let rows: StoredRow[] = [];

const metricTable = {
  deleteMany: vi.fn(async () => ({ count: 0 })),
  createMany: vi.fn(async ({ data }: { data: StoredRow[] }) => {
    rows.push(
      ...data.map((row) => ({
        ...row,
        deployedFqn: null,
        deployedAt: null,
        createdAt: new Date("2026-07-24T00:00:00.000Z"),
        updatedAt: new Date("2026-07-24T00:00:00.000Z"),
      })),
    );
    return { count: data.length };
  }),
  findMany: vi.fn(async () => rows),
  findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
    return rows.find((row) => row.id === where.id) ?? null;
  }),
  update: vi.fn(async (_args: { where: { id: string }; data: Record<string, unknown> }) => ({})),
};

vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T>(
    callback: (prisma: {
      $transaction: (callback: (tx: unknown) => Promise<T>) => Promise<T>;
      forgeMetricViewProposal: typeof metricTable;
    }) => Promise<T>,
  ) => {
    const prisma = {
      $transaction: async (transaction: (tx: unknown) => Promise<T>) =>
        transaction({ forgeMetricViewProposal: metricTable }),
      forgeMetricViewProposal: metricTable,
    };
    return callback(prisma);
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  getMetricViewProposalsByRun,
  saveMetricViewProposals,
  updateDeploymentStatus,
  updateMetricViewProposal,
} from "@/lib/lakebase/metric-view-proposals";
import { buildMetricViewImproveDiff } from "@/lib/metric-views/improve-diff";

const legacyYaml = `version: "1.1"
source: main.sales.orders
dimensions:
  - name: order_month
    expr: DATE_TRUNC('MONTH', order_date)
measures:
  - name: total_revenue
    expr: SUM(amount)
`;

const definition: MetricViewDefinition = {
  version: "1.1",
  name: "revenue_metrics",
  comment: "Canonical revenue metrics",
  source: { kind: "table", table: "main.sales.orders" },
  joins: [],
  dimensions: [
    {
      kind: "local",
      name: "order_month",
      expr: "DATE_TRUNC('MONTH', order_date)",
    },
  ],
  measures: [
    {
      kind: "expression",
      name: "total_revenue",
      expr: "SUM(amount)",
      format: "currency",
    },
  ],
  requiredFeatures: [],
};

const validProvenance = {
  validatorVersion: "metric-view-probes-v1",
  validatedAt: "2026-07-24T01:02:03.000Z",
  validationEvidence: [
    {
      stage: "metric_view_static",
      status: "passed" as const,
      code: "METRIC_VIEW_STATIC_VALIDATION_PASSED",
      message: "Static validation passed",
    },
    {
      stage: "metric_view_create",
      status: "passed" as const,
      code: "TEMP_METRIC_VIEW_CREATED",
      message: "Temporary metric view created",
    },
    {
      stage: "metric_view_probe",
      status: "passed" as const,
      code: "ATOMIC_MEASURE_PROBE_PASSED",
      message: "Measure probes passed",
    },
    {
      stage: "metric_view_cleanup",
      status: "passed" as const,
      code: "TEMP_METRIC_VIEW_DROPPED",
      message: "Temporary metric view dropped",
    },
  ],
};

function proposal(overrides: Partial<MetricViewProposal> = {}): MetricViewProposal {
  return {
    name: "revenue_metrics",
    description: "Revenue metrics",
    definition,
    yaml: legacyYaml,
    ddl:
      "CREATE OR REPLACE VIEW `published`.`metrics`.`stable_revenue`\n" +
      "WITH METRICS\nLANGUAGE YAML\nAS $$\n" +
      legacyYaml +
      "$$",
    sourceTables: ["main.sales.orders"],
    hasJoins: false,
    hasFilteredMeasures: false,
    hasWindowMeasures: false,
    hasMaterialization: false,
    validationStatus: "valid",
    validationIssues: [],
    ...validProvenance,
    ...overrides,
  };
}

function legacyRow(overrides: StoredRow = {}): StoredRow {
  return {
    id: "legacy-mv",
    runId: "run-1",
    schemaScope: "main.sales",
    domain: "Sales",
    subdomain: null,
    name: "legacy_revenue",
    description: null,
    definitionJson: null,
    yaml: legacyYaml,
    ddl: "CREATE VIEW legacy_revenue",
    sourceTablesJson: null,
    hasJoins: false,
    classification: null,
    rationale: null,
    existingFqn: null,
    validationStatus: "unverified",
    validationIssues: null,
    validatorVersion: null,
    validationEvidenceJson: null,
    validatedAt: null,
    deploymentStatus: "proposed",
    deployedFqn: null,
    deployedAt: null,
    ownerEmail: null,
    createdAt: new Date("2026-07-24T00:00:00.000Z"),
    updatedAt: new Date("2026-07-24T00:00:00.000Z"),
    ...overrides,
  };
}

describe("metric view typed-definition persistence", () => {
  beforeEach(() => {
    rows = [];
    vi.clearAllMocks();
  });

  it("rejects raw deployed status without semantic manifest promotion", async () => {
    const rawStatusUpdate = updateDeploymentStatus as unknown as (
      id: string,
      status: string,
      deployedFqn?: string,
    ) => Promise<void>;
    await expect(rawStatusUpdate("mv-1", "deployed", "main.sales.revenue_metrics")).rejects.toThrow(
      /promoteMetricViewDeployment/,
    );
    expect(metricTable.update).not.toHaveBeenCalled();
  });

  it("serializes only the canonical definition into definitionJson", async () => {
    const input = proposal();

    await saveMetricViewProposals("run-1", "main.sales", "Sales", [input], "owner@example.com");

    const persisted = metricTable.createMany.mock.calls[0][0].data[0];
    expect(JSON.parse(persisted.definitionJson as string)).toEqual(definition);
    expect(JSON.parse(persisted.definitionJson as string)).not.toHaveProperty("yaml");
    expect(persisted.yaml).toBe(input.yaml);
    expect(persisted.ddl).toBe(input.ddl);
  });

  it("round-trips a safely parsed typed definition", async () => {
    await saveMetricViewProposals("run-1", "main.sales", "Sales", [proposal()]);

    const [stored] = await getMetricViewProposalsByRun("run-1");

    expect(stored.definition).toEqual(definition);
    expect(stored.yaml).toBe(legacyYaml);
    expect(stored.ddl).toContain("`published`.`metrics`.`stable_revenue`");
  });

  it("prefers definitionJson over conflicting legacy YAML", async () => {
    rows.push(
      legacyRow({
        definitionJson: JSON.stringify(definition),
        yaml: legacyYaml.replace("SUM(amount)", "SUM(discount)"),
      }),
    );

    const [stored] = await getMetricViewProposalsByRun("run-1");

    expect(stored.definition).toEqual(definition);
  });

  it("lazily parses null definitionJson using the proposal name without writing", async () => {
    rows.push(legacyRow());

    const [stored] = await getMetricViewProposalsByRun("run-1");

    expect(stored.definition).toEqual(
      expect.objectContaining({
        name: "legacy_revenue",
        source: { kind: "table", table: "main.sales.orders" },
      }),
    );
    expect(metricTable.update).not.toHaveBeenCalled();
  });

  it("keeps invalid legacy YAML readable and unverified", async () => {
    rows.push(legacyRow({ yaml: "version: [", validationStatus: "unverified" }));

    const [stored] = await getMetricViewProposalsByRun("run-1");

    expect(stored.name).toBe("legacy_revenue");
    expect(stored.yaml).toBe("version: [");
    expect(stored.definition).toBeUndefined();
    expect(stored.validationStatus).toBe("unverified");
    expect(metricTable.update).not.toHaveBeenCalled();
  });

  it("fails closed on malformed non-null definitionJson without legacy adaptation", async () => {
    rows.push(
      legacyRow({
        definitionJson: JSON.stringify({ ...definition, measures: "not-an-array" }),
        validationStatus: "valid",
        validatorVersion: validProvenance.validatorVersion,
        validatedAt: new Date(validProvenance.validatedAt),
        validationEvidenceJson: JSON.stringify(validProvenance.validationEvidence),
      }),
    );

    const [stored] = await getMetricViewProposalsByRun("run-1");

    expect(stored.definition).toBeUndefined();
    expect(stored.validationStatus).toBe("unverified");
    expect(stored.validatorVersion).toBeNull();
    expect(stored.validatedAt).toBeNull();
    expect(stored.validationEvidence).not.toContainEqual(
      expect.objectContaining({ status: "passed" }),
    );
    expect(metricTable.update).not.toHaveBeenCalled();
  });

  it("fails closed when typed JSON and legacy YAML are both corrupt", async () => {
    rows.push(
      legacyRow({
        definitionJson: JSON.stringify({ ...definition, measures: "not-an-array" }),
        yaml: "version: [",
        validationStatus: "valid",
        validatorVersion: validProvenance.validatorVersion,
        validatedAt: new Date(validProvenance.validatedAt),
        validationEvidenceJson: JSON.stringify(validProvenance.validationEvidence),
      }),
    );

    const [stored] = await getMetricViewProposalsByRun("run-1");

    expect(stored.definition).toBeUndefined();
    expect(stored.validationStatus).toBe("unverified");
    expect(stored.validatorVersion).toBeNull();
    expect(stored.validatedAt).toBeNull();
    expect(stored.validationEvidence).not.toContainEqual(
      expect.objectContaining({ status: "passed" }),
    );
    expect(stored.validationIssues).toContain(
      "Typed metric view definition is unavailable or corrupt.",
    );
    expect(metricTable.update).not.toHaveBeenCalled();
  });

  it("fails closed when a persisted improvement diff is corrupt", async () => {
    const desired = {
      ...definition,
      measures: [
        ...definition.measures,
        { kind: "expression" as const, name: "order_count", expr: "COUNT(*)" },
      ],
    };
    const validDiff = {
      ...buildMetricViewImproveDiff(definition, desired),
      existingFqn: "main.sales.stable_revenue",
    };
    rows.push(
      legacyRow({
        classification: "improve",
        existingFqn: "main.sales.stable_revenue",
        definitionJson: JSON.stringify(desired),
        improveBaseJson: JSON.stringify(definition),
        improveDiffJson: JSON.stringify({ ...validDiff, addMeasures: "corrupt" }),
        validationStatus: "valid",
        validatorVersion: validProvenance.validatorVersion,
        validatedAt: new Date(validProvenance.validatedAt),
        validationEvidenceJson: JSON.stringify(validProvenance.validationEvidence),
      }),
    );

    const [stored] = await getMetricViewProposalsByRun("run-1");

    expect(stored.validationStatus).toBe("unverified");
    expect(stored.improveDiff).toBeNull();
    expect(stored.validationIssues).toContain(
      "Metric view improvement binding is unavailable, corrupt, or drifted.",
    );
  });

  it("downgrades valid saves without a canonical typed definition", async () => {
    await saveMetricViewProposals("run-1", "main.sales", "Sales", [
      proposal({ definition: undefined, yaml: "version: [" }),
    ]);

    const persisted = metricTable.createMany.mock.calls[0][0].data[0];
    expect(persisted.definitionJson).toBeNull();
    expect(persisted.validationStatus).toBe("unverified");
    expect(persisted.validatorVersion).toBeNull();
    expect(persisted.validatedAt).toBeNull();
    expect(JSON.parse(persisted.validationEvidenceJson as string)).not.toContainEqual(
      expect.objectContaining({ status: "passed" }),
    );
  });

  it("downgrades typed valid saves without complete Release 1 provenance", async () => {
    await saveMetricViewProposals("run-1", "main.sales", "Sales", [
      proposal({
        validatorVersion: undefined,
        validatedAt: undefined,
        validationEvidence: undefined,
      }),
    ]);

    const persisted = metricTable.createMany.mock.calls[0][0].data[0];
    expect(persisted.definitionJson).not.toBeNull();
    expect(persisted.validationStatus).toBe("unverified");
    expect(persisted.validatorVersion).toBeNull();
    expect(persisted.validatedAt).toBeNull();
  });

  it("retains valid status only with typed definition and complete provenance", async () => {
    await saveMetricViewProposals("run-1", "main.sales", "Sales", [proposal()]);

    const persisted = metricTable.createMany.mock.calls[0][0].data[0];
    expect(persisted.definitionJson).not.toBeNull();
    expect(persisted.validationStatus).toBe("valid");
    expect(persisted.validatorVersion).toBe("metric-view-probes-v1");
    expect(persisted.validatedAt).toEqual(new Date(validProvenance.validatedAt));
  });

  it("fails closed when an update requests valid without complete typed provenance", async () => {
    await updateMetricViewProposal("mv-1", {
      definition: null,
      validationStatus: "valid",
      validatorVersion: validProvenance.validatorVersion,
      validatedAt: validProvenance.validatedAt,
      validationEvidence: validProvenance.validationEvidence,
    });

    const update = metricTable.update.mock.calls[0][0];
    expect(update.data.definitionJson).toBeNull();
    expect(update.data.validationStatus).toBe("unverified");
    expect(update.data.validatorVersion).toBeNull();
    expect(update.data.validatedAt).toBeNull();
    expect(JSON.parse(update.data.validationEvidenceJson as string)).not.toContainEqual(
      expect.objectContaining({ status: "passed" }),
    );
  });

  it("preserves repair parse error while clearing stale success provenance", async () => {
    const parseEvidence = {
      stage: "metric_view_parse",
      status: "failed" as const,
      code: "METRIC_VIEW_PARSE_FAILED",
      message: "Metric view YAML could not be canonicalized.",
    };

    await updateMetricViewProposal("mv-1", {
      definition: null,
      validationStatus: "error",
      validationIssues: [parseEvidence.message],
      validatorVersion: validProvenance.validatorVersion,
      validatedAt: validProvenance.validatedAt,
      validationEvidence: [...validProvenance.validationEvidence, parseEvidence],
    });

    const update = metricTable.update.mock.calls[0][0];
    expect(update.data.definitionJson).toBeNull();
    expect(update.data.validationStatus).toBe("error");
    expect(update.data.validatorVersion).toBeNull();
    expect(update.data.validatedAt).toBeNull();
    const evidence = JSON.parse(update.data.validationEvidenceJson as string);
    expect(evidence).toContainEqual(parseEvidence);
    expect(evidence).not.toContainEqual(expect.objectContaining({ status: "passed" }));
  });

  it("preserves explicit unverified while clearing stale success provenance", async () => {
    await updateMetricViewProposal("mv-1", {
      definition: null,
      validationStatus: "unverified",
      validationIssues: ["Typed definition unavailable."],
      validatorVersion: validProvenance.validatorVersion,
      validatedAt: validProvenance.validatedAt,
      validationEvidence: validProvenance.validationEvidence,
    });

    const update = metricTable.update.mock.calls[0][0];
    expect(update.data.validationStatus).toBe("unverified");
    expect(update.data.validatorVersion).toBeNull();
    expect(update.data.validatedAt).toBeNull();
    expect(JSON.parse(update.data.validationEvidenceJson as string)).not.toContainEqual(
      expect.objectContaining({ status: "passed" }),
    );
  });

  it("does not synthesize unverified over another explicit non-valid status", async () => {
    await updateMetricViewProposal("mv-1", {
      definition: null,
      validationStatus: "warning",
      validatorVersion: validProvenance.validatorVersion,
      validatedAt: validProvenance.validatedAt,
      validationEvidence: validProvenance.validationEvidence,
    });

    const update = metricTable.update.mock.calls[0][0];
    expect(update.data.validationStatus).toBe("warning");
    expect(update.data.validatorVersion).toBeNull();
    expect(update.data.validatedAt).toBeNull();
  });

  it("rejects valid update provenance when definition is omitted", async () => {
    await updateMetricViewProposal("mv-1", {
      validationStatus: "valid",
      validationIssues: [],
      ...validProvenance,
    });

    const update = metricTable.update.mock.calls[0][0];
    expect(update.data.validationStatus).toBe("unverified");
    expect(update.data.validatorVersion).toBeNull();
    expect(update.data.validatedAt).toBeNull();
  });

  it("does not trust a corrupt existing definition for a valid update", async () => {
    rows.push(
      legacyRow({
        id: "mv-1",
        definitionJson: JSON.stringify({ ...definition, measures: "corrupt" }),
        yaml: "version: [",
        validationStatus: "valid",
        validatorVersion: validProvenance.validatorVersion,
        validatedAt: new Date(validProvenance.validatedAt),
        validationEvidenceJson: JSON.stringify(validProvenance.validationEvidence),
      }),
    );

    await updateMetricViewProposal("mv-1", {
      validationStatus: "valid",
      validationIssues: [],
      ...validProvenance,
    });

    const update = metricTable.update.mock.calls[0][0];
    expect(update.data.validationStatus).toBe("unverified");
    expect(update.data.validatorVersion).toBeNull();
    expect(update.data.validatedAt).toBeNull();
  });

  it("explicitly clears stale provenance when a valid update omits it", async () => {
    await updateMetricViewProposal("mv-1", {
      definition,
      validationStatus: "valid",
      validationIssues: [],
    });

    const update = metricTable.update.mock.calls[0][0];
    expect(update.data.validationStatus).toBe("unverified");
    expect(update.data.validatorVersion).toBeNull();
    expect(update.data.validatedAt).toBeNull();
    expect(update.data.validationEvidenceJson).toBeNull();
  });

  it("fails closed when an update clears the definition without supplying status", async () => {
    await updateMetricViewProposal("mv-1", { definition: null });

    const update = metricTable.update.mock.calls[0][0];
    expect(update.data.definitionJson).toBeNull();
    expect(update.data.validationStatus).toBe("unverified");
    expect(update.data.validatorVersion).toBeNull();
    expect(update.data.validatedAt).toBeNull();
  });

  it("invalidates prior provenance when replacing definition without atomic validation", async () => {
    await updateMetricViewProposal("mv-1", { definition });

    const update = metricTable.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: "mv-1" });
    expect(JSON.parse(update.data.definitionJson as string)).toEqual(definition);
    expect(update.data.validationStatus).toBe("unverified");
    expect(update.data.validatorVersion).toBeNull();
    expect(update.data.validatedAt).toBeNull();
    expect(update.data.validationEvidenceJson).toBeNull();
    expect(update.data).not.toHaveProperty("yaml");
    expect(update.data).not.toHaveProperty("ddl");
  });

  it("allows atomic valid definition replacement with complete current provenance", async () => {
    await updateMetricViewProposal("mv-1", {
      definition,
      validationStatus: "valid",
      validationIssues: [],
      ...validProvenance,
    });

    const update = metricTable.update.mock.calls[0][0];
    expect(JSON.parse(update.data.definitionJson as string)).toEqual(definition);
    expect(update.data.validationStatus).toBe("valid");
    expect(update.data.validationIssues).toBe("[]");
    expect(update.data.validatorVersion).toBe(validProvenance.validatorVersion);
    expect(update.data.validatedAt).toEqual(new Date(validProvenance.validatedAt));
    expect(JSON.parse(update.data.validationEvidenceJson as string)).toEqual(
      validProvenance.validationEvidence,
    );
  });
});
