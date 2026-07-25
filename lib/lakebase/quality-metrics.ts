import { withPrisma } from "@/lib/prisma";

export interface QualityMetricInput {
  metricType: "run" | "assistant";
  metricName: string;
  metricValue: number;
  floorValue?: number | null;
  passed?: boolean | null;
  runId?: string | null;
  assistantLogId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function insertQualityMetrics(inputs: QualityMetricInput[]): Promise<void> {
  if (inputs.length === 0) return;
  await withPrisma(async (prisma) => {
    await prisma.forgeQualityMetric.createMany({
      data: inputs.map((input) => ({
        metricType: input.metricType,
        metricName: input.metricName,
        metricValue: input.metricValue,
        floorValue: input.floorValue ?? null,
        passed: input.passed ?? null,
        runId: input.runId ?? null,
        assistantLogId: input.assistantLogId ?? null,
        metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
      })),
    });
  });
}

export async function listQualityMetrics(
  filter: {
    metricType?: "run" | "assistant";
    metricName?: string;
    runId?: string;
    sinceHours?: number;
    limit?: number;
  } = {},
): Promise<
  Array<{
    metricId: string;
    metricType: string;
    metricName: string;
    metricValue: number;
    floorValue: number | null;
    passed: boolean | null;
    runId: string | null;
    assistantLogId: string | null;
    metadataJson: string | null;
    createdAt: string;
  }>
> {
  const where: Record<string, unknown> = {};
  if (filter.metricType) where.metricType = filter.metricType;
  if (filter.metricName) where.metricName = filter.metricName;
  if (filter.runId) where.runId = filter.runId;
  if (filter.sinceHours && filter.sinceHours > 0) {
    where.createdAt = {
      gte: new Date(Date.now() - filter.sinceHours * 60 * 60 * 1000),
    };
  }

  const rows = await withPrisma(async (prisma) =>
    prisma.forgeQualityMetric.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(filter.limit ?? 500, 1), 2000),
    }),
  );

  return rows.map((r) => ({
    metricId: r.metricId,
    metricType: r.metricType,
    metricName: r.metricName,
    metricValue: r.metricValue,
    floorValue: r.floorValue,
    passed: r.passed,
    runId: r.runId,
    assistantLogId: r.assistantLogId,
    metadataJson: r.metadataJson,
    createdAt: r.createdAt.toISOString(),
  }));
}
