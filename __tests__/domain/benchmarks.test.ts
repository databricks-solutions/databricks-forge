import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  BenchmarkPackSchema,
  BenchmarkRecordSchema,
  computeBenchmarkFreshUntil,
  isPublicSourceUrl,
} from "@/lib/domain/benchmarks";

describe("benchmark provenance validation", () => {
  it("accepts valid benchmark records", () => {
    const parsed = BenchmarkRecordSchema.parse({
      kind: "kpi",
      title: "Net interest margin",
      summary: "Track NIM by segment with monthly drift monitoring.",
      source_type: "open_report",
      source_url: "https://www.mckinsey.com/industries/financial-services/our-insights",
      publisher: "McKinsey",
      license_class: "citation_required",
      confidence: 0.7,
      ttl_days: 365,
    });
    expect(parsed.title).toContain("interest");
  });

  it("enforces public-source allowlist", () => {
    expect(isPublicSourceUrl("https://docs.databricks.com/en/")).toBe(true);
    expect(isPublicSourceUrl("https://internal.example.local/doc")).toBe(false);
  });

  it("computes freshness window", () => {
    const freshUntil = computeBenchmarkFreshUntil(new Date("2026-01-01T00:00:00Z"), 30);
    expect(freshUntil.toISOString()).toContain("2026-01-31");
  });

  it("validates benchmark packs", () => {
    const parsed = BenchmarkPackSchema.parse({
      pack_id: "banking-baseline",
      industry: "banking",
      version: "2026.03",
      records: [
        {
          kind: "advisory_theme",
          title: "Boardroom defensibility",
          summary: "Tie each recommendation to measurable value and accountable sponsors.",
          source_type: "open_report",
          source_url: "https://www.mckinsey.com/",
          publisher: "McKinsey",
          license_class: "citation_required",
          confidence: 0.65,
          ttl_days: 365,
        },
      ],
    });
    expect(parsed.records).toHaveLength(1);
  });
});

describe("benchmark seed pack files", () => {
  const BENCHMARK_DIR = join(process.cwd(), "data", "benchmark");
  const files = readdirSync(BENCHMARK_DIR).filter((f) => f.endsWith(".json"));
  const baselineFiles = files.filter((f) => !f.endsWith("-master.json"));
  const masterFiles = files.filter((f) => f.endsWith("-master.json"));

  it("has at least one benchmark file", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of baselineFiles) {
    describe(file, () => {
      const raw = JSON.parse(readFileSync(join(BENCHMARK_DIR, file), "utf-8"));

      it("passes BenchmarkPackSchema validation", () => {
        expect(() => BenchmarkPackSchema.parse(raw)).not.toThrow();
      });

      it("has exactly 8 records", () => {
        expect(raw.records).toHaveLength(8);
      });

      it("has pack_id matching {industry}-baseline", () => {
        expect(raw.pack_id).toBe(`${raw.industry}-baseline`);
      });

      it("has correct record kind distribution (2 of each)", () => {
        const counts: Record<string, number> = {};
        for (const r of raw.records) {
          counts[r.kind] = (counts[r.kind] || 0) + 1;
        }
        expect(counts["kpi"]).toBe(2);
        expect(counts["benchmark_principle"]).toBe(2);
        expect(counts["advisory_theme"]).toBe(2);
        expect(counts["platform_best_practice"]).toBe(2);
      });

      it("has all record industry fields matching pack industry", () => {
        for (const r of raw.records) {
          if (r.industry) {
            expect(r.industry).toBe(raw.industry);
          }
        }
      });

      it("has all source_urls from the public allowlist", () => {
        for (const r of raw.records) {
          expect(isPublicSourceUrl(r.source_url)).toBe(true);
        }
      });
    });
  }

  for (const file of masterFiles) {
    describe(file, () => {
      const raw = JSON.parse(readFileSync(join(BENCHMARK_DIR, file), "utf-8"));

      it("has valid $schema marker", () => {
        // Master Repository v2 seed bumped the marker to `-v2`; accept either
        // so legacy packs and freshly regenerated packs both validate.
        expect(["master-repository-benchmarks", "master-repository-benchmarks-v2"]).toContain(
          raw.$schema,
        );
      });

      it("has at least one record", () => {
        expect(raw.records.length).toBeGreaterThan(0);
      });

      it("has all record industry fields matching pack industry", () => {
        for (const r of raw.records) {
          if (r.industry) {
            expect(r.industry).toBe(raw.industry);
          }
        }
      });

      it("has all records with required fields", () => {
        for (const r of raw.records) {
          expect(r.kind).toBeTruthy();
          expect(r.title).toBeTruthy();
          expect(r.summary).toBeTruthy();
          expect(r.source_url).toBeTruthy();
          expect(typeof r.confidence).toBe("number");
        }
      });
    });
  }
});
