import { withPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  BENCHMARK_LIFECYCLE,
  type BenchmarkKind,
  type BenchmarkLifecycle,
  type BenchmarkSeedRecord,
  computeBenchmarkFreshUntil,
  isPublicSourceUrl,
} from "@/lib/domain/benchmarks";

export type SourceFetchStatus = "pending" | "fetched" | "failed" | "manual";

export interface BenchmarkRecord {
  benchmarkId: string;
  kind: BenchmarkKind;
  title: string;
  summary: string;
  sourceType: string;
  sourceUrl: string;
  publisher: string;
  publishedAt: string | null;
  industry: string | null;
  region: string | null;
  metricDefinition: string | null;
  methodologyNote: string | null;
  licenseClass: string;
  confidence: number;
  ttlDays: number;
  lifecycleStatus: BenchmarkLifecycle;
  tags: string[];
  provenance: Record<string, unknown> | null;
  sourceContent: string | null;
  sourceFetchStatus: SourceFetchStatus;
  sourceChunkCount: number;
  createdBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  publishedBy: string | null;
  publishedAtAudit: string | null;
  deprecatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toRecord(row: {
  benchmarkId: string;
  kind: string;
  title: string;
  summary: string;
  sourceType: string;
  sourceUrl: string;
  publisher: string;
  publishedAt: Date | null;
  industry: string | null;
  region: string | null;
  metricDefinition: string | null;
  methodologyNote: string | null;
  licenseClass: string;
  confidence: number;
  ttlDays: number;
  lifecycleStatus: string;
  tagsJson: string | null;
  provenanceJson: string | null;
  sourceContent: string | null;
  sourceFetchStatus: string;
  sourceChunkCount: number;
  createdBy: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  publishedBy: string | null;
  publishedAtAudit: Date | null;
  deprecatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): BenchmarkRecord {
  return {
    benchmarkId: row.benchmarkId,
    kind: row.kind as BenchmarkKind,
    title: row.title,
    summary: row.summary,
    sourceType: row.sourceType,
    sourceUrl: row.sourceUrl,
    publisher: row.publisher,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    industry: row.industry,
    region: row.region,
    metricDefinition: row.metricDefinition,
    methodologyNote: row.methodologyNote,
    licenseClass: row.licenseClass,
    confidence: row.confidence,
    ttlDays: row.ttlDays,
    lifecycleStatus: row.lifecycleStatus as BenchmarkLifecycle,
    tags: parseJson<string[]>(row.tagsJson, []),
    provenance: parseJson<Record<string, unknown> | null>(row.provenanceJson, null),
    sourceContent: row.sourceContent,
    sourceFetchStatus: row.sourceFetchStatus as SourceFetchStatus,
    sourceChunkCount: row.sourceChunkCount,
    createdBy: row.createdBy,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    publishedBy: row.publishedBy,
    publishedAtAudit: row.publishedAtAudit?.toISOString() ?? null,
    deprecatedAt: row.deprecatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function upsertBenchmarkRecord(
  input: BenchmarkSeedRecord,
  opts: {
    createdBy?: string | null;
    lifecycleStatus?: BenchmarkLifecycle;
  } = {},
): Promise<BenchmarkRecord> {
  if (!isPublicSourceUrl(input.source_url)) {
    throw new Error(`Source URL is not in allowed public-source classes: ${input.source_url}`);
  }
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeBenchmarkRecord.upsert({
      where: {
        kind_title_sourceUrl: {
          kind: input.kind,
          title: input.title,
          sourceUrl: input.source_url,
        },
      },
      create: {
        kind: input.kind,
        title: input.title,
        summary: input.summary,
        sourceType: input.source_type,
        sourceUrl: input.source_url,
        publisher: input.publisher,
        publishedAt: input.published_at ? new Date(input.published_at) : null,
        industry: input.industry ?? null,
        region: input.region ?? null,
        metricDefinition: input.metric_definition ?? null,
        methodologyNote: input.methodology_note ?? null,
        licenseClass: input.license_class,
        confidence: input.confidence,
        ttlDays: input.ttl_days,
        tagsJson: JSON.stringify(input.tags ?? []),
        provenanceJson: input.provenance ? JSON.stringify(input.provenance) : null,
        lifecycleStatus: opts.lifecycleStatus ?? "draft",
        createdBy: opts.createdBy ?? null,
      },
      update: {
        summary: input.summary,
        sourceType: input.source_type,
        publisher: input.publisher,
        publishedAt: input.published_at ? new Date(input.published_at) : null,
        industry: input.industry ?? null,
        region: input.region ?? null,
        metricDefinition: input.metric_definition ?? null,
        methodologyNote: input.methodology_note ?? null,
        licenseClass: input.license_class,
        confidence: input.confidence,
        ttlDays: input.ttl_days,
        tagsJson: JSON.stringify(input.tags ?? []),
        provenanceJson: input.provenance ? JSON.stringify(input.provenance) : null,
        updatedAt: new Date(),
      },
    });
    return toRecord(row);
  });
}

export async function listBenchmarkRecords(
  filters: {
    lifecycleStatus?: BenchmarkLifecycle;
    industry?: string;
    kind?: BenchmarkKind;
    includeExpired?: boolean;
    limit?: number;
  } = {},
): Promise<BenchmarkRecord[]> {
  const where: Record<string, unknown> = {};
  if (filters.lifecycleStatus) where.lifecycleStatus = filters.lifecycleStatus;
  if (filters.industry) where.industry = filters.industry;
  if (filters.kind) where.kind = filters.kind;

  const rows = await withPrisma(async (prisma) =>
    prisma.forgeBenchmarkRecord.findMany({
      where,
      orderBy: [{ lifecycleStatus: "asc" }, { updatedAt: "desc" }],
      take: Math.min(Math.max(filters.limit ?? 200, 1), 1000),
    }),
  );

  const now = new Date();
  return rows.map(toRecord).filter((r) => {
    if (filters.includeExpired) return true;
    const freshUntil = computeBenchmarkFreshUntil(
      r.publishedAt ? new Date(r.publishedAt) : null,
      r.ttlDays,
    );
    return freshUntil >= now;
  });
}

export async function getBenchmarkById(benchmarkId: string): Promise<BenchmarkRecord | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeBenchmarkRecord.findUnique({
      where: { benchmarkId },
    });
    return row ? toRecord(row) : null;
  });
}

export async function updateBenchmarkLifecycle(
  benchmarkId: string,
  status: BenchmarkLifecycle,
  actorEmail: string | null,
): Promise<BenchmarkRecord | null> {
  if (!BENCHMARK_LIFECYCLE.includes(status)) {
    throw new Error(`Invalid lifecycle status: ${status}`);
  }
  return withPrisma(async (prisma) => {
    try {
      const now = new Date();
      const row = await prisma.forgeBenchmarkRecord.update({
        where: { benchmarkId },
        data: {
          lifecycleStatus: status,
          reviewedBy: status === "reviewed" ? actorEmail : undefined,
          reviewedAt: status === "reviewed" ? now : undefined,
          publishedBy: status === "published" ? actorEmail : undefined,
          publishedAtAudit: status === "published" ? now : undefined,
          deprecatedAt: status === "deprecated" ? now : undefined,
        },
      });
      return toRecord(row);
    } catch (err) {
      logger.warn("[benchmarks] Failed to update lifecycle", {
        benchmarkId,
        status,
        error: String(err),
      });
      return null;
    }
  });
}

export async function updateBenchmarkSourceContent(
  benchmarkId: string,
  data: {
    sourceContent?: string | null;
    sourceFetchStatus?: SourceFetchStatus;
    sourceChunkCount?: number;
  },
): Promise<BenchmarkRecord | null> {
  return withPrisma(async (prisma) => {
    try {
      const row = await prisma.forgeBenchmarkRecord.update({
        where: { benchmarkId },
        data: {
          sourceContent: data.sourceContent,
          sourceFetchStatus: data.sourceFetchStatus,
          sourceChunkCount: data.sourceChunkCount,
          updatedAt: new Date(),
        },
      });
      return toRecord(row);
    } catch (err) {
      logger.warn("[benchmarks] Failed to update source content", {
        benchmarkId,
        error: String(err),
      });
      return null;
    }
  });
}

export async function deleteBenchmarkRecord(benchmarkId: string): Promise<boolean> {
  return withPrisma(async (prisma) => {
    try {
      await prisma.forgeBenchmarkRecord.delete({ where: { benchmarkId } });
      return true;
    } catch {
      return false;
    }
  });
}
