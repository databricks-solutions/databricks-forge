import { z } from "zod/v4";

export const BENCHMARK_KINDS = [
  "kpi",
  "benchmark_principle",
  "advisory_theme",
  "platform_best_practice",
] as const;

export const BENCHMARK_SOURCE_TYPES = [
  "regulator",
  "standards_body",
  "public_dataset",
  "databricks_doc",
  "open_report",
  "academic",
] as const;

export const BENCHMARK_LICENSE_CLASSES = [
  "public_domain",
  "permissive",
  "citation_required",
  "restricted",
] as const;

export const BENCHMARK_LIFECYCLE = ["draft", "reviewed", "published", "deprecated"] as const;

export type BenchmarkKind = (typeof BENCHMARK_KINDS)[number];
export type BenchmarkLifecycle = (typeof BENCHMARK_LIFECYCLE)[number];

export const BenchmarkRecordSchema = z.object({
  kind: z.enum(BENCHMARK_KINDS),
  title: z.string().min(8).max(240),
  summary: z.string().min(20).max(4000),
  source_type: z.enum(BENCHMARK_SOURCE_TYPES),
  source_url: z.url(),
  publisher: z.string().min(2).max(200),
  published_at: z.string().datetime().optional(),
  industry: z.string().min(2).max(80).optional(),
  region: z.string().min(2).max(80).optional(),
  metric_definition: z.string().max(2000).optional(),
  methodology_note: z.string().max(2000).optional(),
  license_class: z.enum(BENCHMARK_LICENSE_CLASSES),
  confidence: z.number().min(0).max(1),
  ttl_days: z.number().int().min(1).max(3650),
  tags: z.array(z.string().min(1).max(80)).optional().default([]),
  provenance: z
    .object({
      source_class: z.string().min(2).max(80),
      captured_at: z.string().datetime().optional(),
      citation: z.string().min(8).max(500).optional(),
      notes: z.string().max(1000).optional(),
    })
    .passthrough()
    .optional(),
});

export type BenchmarkSeedRecord = z.infer<typeof BenchmarkRecordSchema>;

export const BenchmarkPackSchema = z.object({
  pack_id: z.string().min(3).max(100),
  industry: z.string().min(2).max(80),
  version: z.string().min(1).max(40),
  records: z.array(BenchmarkRecordSchema).min(1),
});

export type BenchmarkSeedPack = z.infer<typeof BenchmarkPackSchema>;

const PUBLIC_HOST_ALLOWLIST = [
  "databricks.com",
  "mckinsey.com",
  "oecd.org",
  "worldbank.org",
  "who.int",
  "cms.gov",
  "fda.gov",
  "hhs.gov",
  "federalreserve.gov",
  "ecb.europa.eu",
  "bis.org",
  "nist.gov",
  "iso.org",
  "iea.org",
  "itu.int",
  "era.europa.eu",
  "deloitte.com",
  "iaisweb.org",
];

export function isPublicSourceUrl(sourceUrl: string): boolean {
  try {
    const url = new URL(sourceUrl);
    if (!["https:", "http:"].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    return PUBLIC_HOST_ALLOWLIST.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
  } catch {
    return false;
  }
}

export function computeBenchmarkFreshUntil(publishedAt: Date | null, ttlDays: number): Date {
  const start = publishedAt ?? new Date();
  return new Date(start.getTime() + ttlDays * 24 * 60 * 60 * 1000);
}
