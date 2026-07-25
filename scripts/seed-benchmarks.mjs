#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const ALLOWLIST = [
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
  "bcg.com",
  "gartner.com",
  "accenture.com",
  "bain.com",
  "capgemini.com",
  "pwc.com",
  "ey.com",
  "kpmg.com",
  "idc.com",
  "forrester.com",
  "statista.com",
  "grandviewresearch.com",
  "fortunebusinessinsights.com",
  "precedenceresearch.com",
  "marketsandmarkets.com",
];

function isAllowed(sourceUrl) {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    return ALLOWLIST.some((a) => host === a || host.endsWith(`.${a}`));
  } catch {
    return false;
  }
}

const STALE_THRESHOLD_MS = 365 * 86_400_000;

function computeLifecycleStatus(publishedAt) {
  if (!publishedAt) return "draft";
  const age = Date.now() - new Date(publishedAt).getTime();
  return age > STALE_THRESHOLD_MS ? "draft" : "published";
}

function buildGeneratedIndustryRecords(industry) {
  const titleIndustry = industry.replace(/-/g, " ");
  return [
    {
      kind: "kpi",
      title: `${titleIndustry} value realization speed`,
      summary: `Track time-to-impact for ${titleIndustry} analytics initiatives and decision workflows.`,
      source_type: "open_report",
      source_url: "https://www.mckinsey.com/capabilities/quantumblack/our-insights",
      publisher: "McKinsey",
      published_at: "2024-01-01T00:00:00Z",
      industry,
      region: "global",
      metric_definition: "Median days from use-case launch to measurable business impact.",
      methodology_note: "Use consistent run-go-live and first-impact timestamps.",
      license_class: "citation_required",
      confidence: 0.62,
      ttl_days: 365,
      tags: ["generated-baseline", "kpi"],
      provenance: {
        source_class: "generated_baseline",
        notes: "Auto-generated baseline from outcome-map coverage. Replace with curated records.",
      },
    },
    {
      kind: "benchmark_principle",
      title: `${titleIndustry} measurable outcomes`,
      summary: `Prioritize initiatives in ${titleIndustry} with explicit measurable outcomes, owners, and operational signals.`,
      source_type: "databricks_doc",
      source_url: "https://docs.databricks.com/",
      publisher: "Databricks",
      published_at: "2025-01-01T00:00:00Z",
      industry,
      region: "global",
      license_class: "public_domain",
      confidence: 0.75,
      ttl_days: 730,
      tags: ["generated-baseline", "principle"],
      provenance: {
        source_class: "generated_baseline",
        notes: "Auto-generated baseline from outcome-map coverage. Replace with curated records.",
      },
    },
    {
      kind: "advisory_theme",
      title: `${titleIndustry} board-ready narrative`,
      summary: `Frame ${titleIndustry} recommendations with board-level business value, risk posture, and accountable sponsorship.`,
      source_type: "open_report",
      source_url: "https://www.oecd.org/",
      publisher: "OECD",
      published_at: "2024-01-01T00:00:00Z",
      industry,
      region: "global",
      license_class: "public_domain",
      confidence: 0.58,
      ttl_days: 365,
      tags: ["generated-baseline", "advisory"],
      provenance: {
        source_class: "generated_baseline",
        notes: "Auto-generated baseline from outcome-map coverage. Replace with curated records.",
      },
    },
    {
      kind: "platform_best_practice",
      title: `${titleIndustry} grounded source ordering`,
      summary:
        "Treat customer metadata as source-of-truth and use benchmark priors as advisory context only.",
      source_type: "databricks_doc",
      source_url: "https://docs.databricks.com/en/data-governance/unity-catalog/",
      publisher: "Databricks",
      published_at: "2025-01-01T00:00:00Z",
      industry,
      region: "global",
      license_class: "public_domain",
      confidence: 0.9,
      ttl_days: 730,
      tags: ["generated-baseline", "platform"],
      provenance: {
        source_class: "generated_baseline",
        notes: "Auto-generated baseline from outcome-map coverage. Replace with curated records.",
      },
    },
  ];
}

function parseIndustryFilter(raw) {
  return new Set(
    String(raw || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const root = process.cwd();
  const dataDir = path.join(root, "data", "benchmark");
  const files = (await fs.readdir(dataDir).catch(() => []))
    .filter((f) => f.endsWith(".json"))
    .sort();

  const seedAllIndustries =
    String(process.env.FORGE_SEED_BENCHMARKS_ALL_INDUSTRIES || "").toLowerCase() === "true";
  const selectedIndustries = parseIndustryFilter(process.env.FORGE_SEED_BENCHMARK_INDUSTRIES);
  const outcomeIndustryDir = path.join(root, "lib", "domain", "industry-outcomes");
  const outcomeIndustryIds = seedAllIndustries
    ? (await fs.readdir(outcomeIndustryDir).catch(() => []))
        .filter((f) => f.endsWith(".ts") && f !== "index.ts")
        .map((f) => f.replace(/\.ts$/, ""))
        .sort()
    : [];

  const records = [];
  for (const file of files) {
    const full = path.join(dataDir, file);
    const raw = JSON.parse(await fs.readFile(full, "utf8"));
    if (!Array.isArray(raw.records)) continue;
    for (const rec of raw.records) {
      records.push(rec);
    }
  }

  const filteredCuratedRecords =
    selectedIndustries.size > 0
      ? records.filter((r) => selectedIndustries.has(String(r.industry || "").trim()))
      : records;

  const allRecords = [...filteredCuratedRecords];

  if (allRecords.length === 0 && !seedAllIndustries) {
    throw new Error(`No benchmark records found in ${dataDir}`);
  }

  if (seedAllIndustries) {
    const industriesWithRecords = new Set(
      allRecords.map((r) => String(r.industry || "").trim()).filter(Boolean),
    );
    for (const industry of outcomeIndustryIds) {
      if (selectedIndustries.size > 0 && !selectedIndustries.has(industry)) continue;
      if (industriesWithRecords.has(industry)) continue;
      for (const rec of buildGeneratedIndustryRecords(industry)) {
        allRecords.push(rec);
      }
    }
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let inserted = 0;
  let updated = 0;
  let draftCount = 0;
  let publishedCount = 0;

  try {
    for (const rec of allRecords) {
      if (!isAllowed(rec.source_url)) {
        console.warn(`Skipping disallowed source URL: ${rec.source_url}`);
        continue;
      }
      const status = computeLifecycleStatus(rec.published_at);
      const result = await client.query(
        `
        INSERT INTO forge_benchmark_records (
          benchmark_id,
          kind,
          title,
          summary,
          source_type,
          source_url,
          publisher,
          published_at,
          industry,
          region,
          metric_definition,
          methodology_note,
          license_class,
          confidence,
          ttl_days,
          lifecycle_status,
          provenance_json,
          tags_json,
          created_at,
          updated_at
        ) VALUES (
          gen_random_uuid(),
          $1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10, $11, $12, $13, $14,
          $17,
          $15::jsonb,
          $16::jsonb,
          NOW(), NOW()
        )
        ON CONFLICT (kind, title, source_url)
        DO UPDATE SET
          summary = EXCLUDED.summary,
          source_type = EXCLUDED.source_type,
          publisher = EXCLUDED.publisher,
          published_at = EXCLUDED.published_at,
          industry = EXCLUDED.industry,
          region = EXCLUDED.region,
          metric_definition = EXCLUDED.metric_definition,
          methodology_note = EXCLUDED.methodology_note,
          license_class = EXCLUDED.license_class,
          confidence = EXCLUDED.confidence,
          ttl_days = EXCLUDED.ttl_days,
          lifecycle_status = $17,
          provenance_json = EXCLUDED.provenance_json,
          tags_json = EXCLUDED.tags_json,
          updated_at = NOW()
        RETURNING xmax = 0 AS inserted
        `,
        [
          rec.kind,
          rec.title,
          rec.summary,
          rec.source_type,
          rec.source_url,
          rec.publisher,
          rec.published_at ?? null,
          rec.industry ?? null,
          rec.region ?? null,
          rec.metric_definition ?? null,
          rec.methodology_note ?? null,
          rec.license_class,
          rec.confidence,
          rec.ttl_days,
          JSON.stringify(rec.provenance ?? {}),
          JSON.stringify(rec.tags ?? []),
          status,
        ],
      );
      if (result.rows[0]?.inserted) inserted += 1;
      else updated += 1;
      if (status === "draft") draftCount += 1;
      else publishedCount += 1;
    }
  } finally {
    await client.end();
  }

  console.log(
    `Benchmark seed complete. Records processed: ${allRecords.length}, Inserted: ${inserted}, Updated: ${updated}, Published: ${publishedCount}, Draft (stale): ${draftCount}, allIndustries=${seedAllIndustries}, industryFilter=${selectedIndustries.size > 0 ? Array.from(selectedIndustries).join(",") : "none"}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
