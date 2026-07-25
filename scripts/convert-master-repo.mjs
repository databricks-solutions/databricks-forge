#!/usr/bin/env node
/**
 * convert-master-repo.mjs
 *
 * Parses the Master Repository XLSX and generates:
 *   1. Enriched industry outcome TypeScript modules (lib/domain/industry-outcomes/<id>.ts)
 *   2. Benchmark JSON packs (data/benchmark/<id>.json)
 *
 * Usage:
 *   npm run sync-master-repo -- --input ~/Downloads/Master\ Repository.xlsx
 *   node scripts/convert-master-repo.mjs --input path/to/file.xlsx [--dry-run]
 */

import pkg from "exceljs";
const { Workbook } = pkg;
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUTCOMES_DIR = resolve(ROOT, "lib/domain/industry-outcomes");
const BENCHMARK_DIR = resolve(ROOT, "data/benchmark");

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const inputIdx = args.indexOf("--input");
const inputPath = inputIdx !== -1 ? args[inputIdx + 1] : null;
const dryRun = args.includes("--dry-run");

if (!inputPath) {
  console.error("Usage: node scripts/convert-master-repo.mjs --input <path-to-xlsx> [--dry-run]");
  process.exit(1);
}

const resolvedInput = resolve(inputPath);
if (!existsSync(resolvedInput)) {
  console.error(`File not found: ${resolvedInput}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Industry ID mapping (XLSX name -> Forge module id + export name)
// ---------------------------------------------------------------------------

const INDUSTRY_MAP = {
  "Media, Entertainment, & Advertising": {
    id: "media-advertising",
    exportName: "MEDIA_ADVERTISING",
    name: "Media, Entertainment & Advertising",
  },
  Communications: {
    id: "communications",
    exportName: "COMMUNICATIONS",
    name: "Communications & Telecom",
  },
  Manufacturing: { id: "manufacturing", exportName: "MANUFACTURING", name: "Manufacturing" },
  "Energy & Utilities": {
    id: "energy-utilities",
    exportName: "ENERGY_UTILITIES",
    name: "Energy & Utilities",
  },
  // v2 canonical ids: each Master Repo industry maps directly to its own
  // dedicated outcome map module after the May 2026 registry consolidation.
  Retail: { id: "retail", exportName: "RETAIL", name: "Retail" },
  "Consumer Goods": {
    id: "consumer-goods",
    exportName: "CONSUMER_GOODS",
    name: "Consumer Goods",
  },
  "Life Sciences": {
    id: "life-sciences",
    exportName: "LIFE_SCIENCES",
    name: "Life Sciences",
  },
  Healthcare: { id: "healthcare", exportName: "HEALTHCARE", name: "Healthcare" },
  "Banking & Payments": { id: "banking", exportName: "BANKING", name: "Banking & Payments" },
  "Capital Markets": {
    id: "capital-markets",
    exportName: "CAPITAL_MARKETS",
    name: "Capital Markets",
  },
  Insurance: { id: "insurance", exportName: "INSURANCE", name: "Insurance" },
  "Recreational Gaming": { id: "games", exportName: "GAMES", name: "Recreational Gaming" },
  "Real Money Gaming [Digital]": {
    id: "real-money-gaming",
    exportName: "REAL_MONEY_GAMING",
    name: "Real Money Gaming (Digital)",
  },
  "Casinos & Resorts": {
    id: "casinos-resorts",
    exportName: "CASINOS_RESORTS",
    name: "Casinos & Resorts",
  },
  "Digital Natives/Born in the Cloud": {
    id: "digital-natives",
    exportName: "DIGITAL_NATIVES",
    name: "Digital Natives",
  },
};

// ---------------------------------------------------------------------------
// Cell value helpers
// ---------------------------------------------------------------------------

function cellStr(cell) {
  const v = cell?.value;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && "richText" in v)
    return v.richText
      .map((r) => r.text)
      .join("")
      .trim();
  if (typeof v === "object" && "result" in v)
    return v.result != null ? String(v.result).trim() : "";
  return String(v).trim();
}

function cellNum(cell) {
  const v = cell?.value;
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "object" && "result" in v && typeof v.result === "number") return v.result;
  const n = Number(cellStr(cell));
  return isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------
// Parse benchmark source string: "Publisher | Title | Date | URL [Tag]"
// ---------------------------------------------------------------------------

function parseBenchmarkSource(raw) {
  if (!raw) return { publisher: "", title: "", url: "" };
  const parts = raw.split("|").map((s) => s.trim());
  const publisher = parts[0] || "";
  const title = parts[1] || "";
  let url = "";
  for (const p of parts) {
    const urlMatch = p.match(/(https?:\/\/[^\s\[\]]+)/);
    if (urlMatch) {
      url = urlMatch[1];
      break;
    }
  }
  return { publisher, title, url };
}

// ---------------------------------------------------------------------------
// Main parsing logic
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Reading: ${resolvedInput}`);
  const wb = new Workbook();
  await wb.xlsx.readFile(resolvedInput);

  // ---- Parse Use Case Summaries ----
  const ucWs = wb.getWorksheet("Use Case Summaries");
  if (!ucWs) throw new Error("Sheet 'Use Case Summaries' not found");

  const useCases = [];
  ucWs.eachRow({ includeEmpty: false }, (row, num) => {
    if (num <= 1) return;
    const industry = cellStr(row.getCell(1));
    if (!industry || !INDUSTRY_MAP[industry]) return;
    useCases.push({
      xlsxIndustry: industry,
      industryId: INDUSTRY_MAP[industry].id,
      name: cellStr(row.getCell(2)),
      summary: cellStr(row.getCell(3)),
      rationale: cellStr(row.getCell(4)),
      modelType: cellStr(row.getCell(5)),
      kpiTarget: cellStr(row.getCell(6)),
      benchmarkImpact: cellNum(row.getCell(7)),
      benchmarkSourceRaw: cellStr(row.getCell(8)),
      strategicImperative: cellStr(row.getCell(9)),
      strategicPillar: cellStr(row.getCell(10)),
    });
  });
  console.log(`  Parsed ${useCases.length} use cases from Use Case Summaries`);

  // ---- Parse Data Assets ----
  const daWs = wb.getWorksheet("Data Assets");
  if (!daWs) throw new Error("Sheet 'Data Assets' not found");

  const dataAssets = [];
  daWs.eachRow({ includeEmpty: false }, (row, num) => {
    if (num <= 1) return;
    const assetId = cellStr(row.getCell(1));
    const industry = cellStr(row.getCell(2));
    if (!assetId || !industry || !INDUSTRY_MAP[industry]) return;
    dataAssets.push({
      xlsxIndustry: industry,
      industryId: INDUSTRY_MAP[industry].id,
      id: assetId,
      name: cellStr(row.getCell(3)),
      description: cellStr(row.getCell(4)),
      systemLocation: cellStr(row.getCell(5)),
      easeOfAccess: cellStr(row.getCell(6)),
      assetFamily: cellStr(row.getCell(7)),
    });
  });
  console.log(`  Parsed ${dataAssets.length} data assets from Data Assets`);

  // ---- Parse Use Case to Data Asset Mapping ----
  const mapWs = wb.getWorksheet("Use Case to Data Asset Mapping");
  if (!mapWs) throw new Error("Sheet 'Use Case to Data Asset Mapping' not found");

  const mappings = new Map(); // key: "industryId::useCaseName" -> { MC: [ids], VA: [ids] }
  mapWs.eachRow({ includeEmpty: false }, (row, num) => {
    if (num <= 1) return;
    const industry = cellStr(row.getCell(1));
    const ucName = cellStr(row.getCell(2));
    if (!industry || !ucName || !INDUSTRY_MAP[industry]) return;
    const key = `${INDUSTRY_MAP[industry].id}::${ucName}`;
    const mc = [];
    const va = [];
    for (let col = 3; col <= 32; col++) {
      const val = cellStr(row.getCell(col)).toUpperCase();
      const assetId = `A${String(col - 2).padStart(2, "0")}`;
      if (val === "MC") mc.push(assetId);
      else if (val === "VA") va.push(assetId);
    }
    mappings.set(key, { mc, va });
  });
  console.log(`  Parsed ${mappings.size} use case-to-data-asset mappings`);

  // ---- Parse Ease of Data Access ----
  const easeWs = wb.getWorksheet("Ease of Data Access Analysis");
  const easeMap = new Map(); // key: "industryId::assetId" -> { lakeflow, ucFed, lakebridge }
  if (easeWs) {
    easeWs.eachRow({ includeEmpty: false }, (row, num) => {
      if (num <= 2) return;
      const industry = cellStr(row.getCell(2));
      if (!industry || !INDUSTRY_MAP[industry]) return;
      const lakeflow = cellStr(row.getCell(6));
      const ucFed = cellStr(row.getCell(7));
      const lakebridge = cellStr(row.getCell(8));
      // Match by industry + position in sheet
      const masterId = cellStr(row.getCell(1));
      const assetId = masterId.split(" ").pop() || "";
      if (assetId) {
        easeMap.set(`${INDUSTRY_MAP[industry].id}::${assetId}`, { lakeflow, ucFed, lakebridge });
      }
    });
    console.log(`  Parsed ${easeMap.size} ease-of-access entries`);
  }

  // ---- Group by Forge industry ID ----
  const byIndustry = new Map();

  for (const uc of useCases) {
    if (!byIndustry.has(uc.industryId)) {
      byIndustry.set(uc.industryId, { useCases: [], dataAssets: [], xlsxIndustries: new Set() });
    }
    const entry = byIndustry.get(uc.industryId);
    entry.xlsxIndustries.add(uc.xlsxIndustry);
    const bmSrc = parseBenchmarkSource(uc.benchmarkSourceRaw);
    const mapKey = `${uc.industryId}::${uc.name}`;
    const assetMapping = mappings.get(mapKey) || { mc: [], va: [] };
    const allAssets = [...assetMapping.mc, ...assetMapping.va];
    const criticality = {};
    for (const a of assetMapping.mc) criticality[a] = "MC";
    for (const a of assetMapping.va) criticality[a] = "VA";

    entry.useCases.push({
      name: uc.name,
      description: uc.summary,
      rationale: uc.rationale,
      modelType: uc.modelType,
      kpiTarget: uc.kpiTarget,
      benchmarkImpact:
        uc.benchmarkImpact != null
          ? `${uc.benchmarkImpact > 0 ? "+" : ""}${uc.benchmarkImpact}%`
          : undefined,
      benchmarkSource: bmSrc.publisher
        ? `${bmSrc.publisher}${bmSrc.title ? ` -- ${bmSrc.title}` : ""}`
        : undefined,
      benchmarkUrl: bmSrc.url || undefined,
      strategicImperative: uc.strategicImperative || undefined,
      strategicPillar: uc.strategicPillar || undefined,
      dataAssetIds: allAssets.length > 0 ? allAssets : undefined,
      dataAssetCriticality: Object.keys(criticality).length > 0 ? criticality : undefined,
    });
  }

  for (const da of dataAssets) {
    if (!byIndustry.has(da.industryId)) {
      byIndustry.set(da.industryId, { useCases: [], dataAssets: [], xlsxIndustries: new Set() });
    }
    const entry = byIndustry.get(da.industryId);
    entry.xlsxIndustries.add(da.xlsxIndustry);
    const easeKey = `${da.industryId}::${da.id}`;
    const ease = easeMap.get(easeKey);
    // Avoid duplicate data assets (e.g. Retail + Consumer Goods both -> rcg)
    if (!entry.dataAssets.find((d) => d.id === da.id && d.xlsxIndustry === da.xlsxIndustry)) {
      entry.dataAssets.push({
        ...da,
        lakeflowConnect: ease?.lakeflow || "Low",
        ucFederation: ease?.ucFed || "Low",
        lakebridgeMigrate: ease?.lakebridge || "Low",
      });
    }
  }

  // ---- Generate output ----
  console.log(`\nGenerating output for ${byIndustry.size} industries:`);

  if (!existsSync(BENCHMARK_DIR)) mkdirSync(BENCHMARK_DIR, { recursive: true });

  const summary = [];

  for (const [industryId, data] of byIndustry) {
    const mapEntry = Object.values(INDUSTRY_MAP).find((m) => m.id === industryId);
    if (!mapEntry) continue;

    console.log(
      `  ${mapEntry.name} (${industryId}): ${data.useCases.length} use cases, ${data.dataAssets.length} data assets`,
    );
    summary.push({
      id: industryId,
      name: mapEntry.name,
      useCases: data.useCases.length,
      dataAssets: data.dataAssets.length,
    });

    // -- Generate enrichment data file (separate from handcrafted outcome module) --
    const enrichmentPath = resolve(OUTCOMES_DIR, `${industryId}.enrichment.ts`);
    const tsContent = generateEnrichmentModule(mapEntry, data);
    if (dryRun) {
      console.log(`    [dry-run] Would write: ${enrichmentPath}`);
    } else {
      writeFileSync(enrichmentPath, tsContent, "utf-8");
      console.log(`    Wrote: ${enrichmentPath}`);
    }

    // -- Generate benchmark JSON pack --
    const benchmarkPath = resolve(BENCHMARK_DIR, `${industryId}-master.json`);
    const benchmarks = generateBenchmarks(industryId, mapEntry.name, data.useCases);
    if (dryRun) {
      console.log(`    [dry-run] Would write: ${benchmarkPath}`);
    } else {
      writeFileSync(benchmarkPath, JSON.stringify(benchmarks, null, 2), "utf-8");
      console.log(`    Wrote: ${benchmarkPath}`);
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Industries: ${summary.length}`);
  console.log(`Total use cases: ${summary.reduce((s, i) => s + i.useCases, 0)}`);
  console.log(`Total data assets: ${summary.reduce((s, i) => s + i.dataAssets, 0)}`);
  for (const s of summary) {
    console.log(`  ${s.name}: ${s.useCases} use cases, ${s.dataAssets} data assets`);
  }
}

// ---------------------------------------------------------------------------
// Generate enrichment TypeScript module
// ---------------------------------------------------------------------------

function generateEnrichmentModule(mapEntry, data) {
  const lines = [];
  lines.push(`/**`);
  lines.push(` * ${mapEntry.name} -- Master Repository Enrichment Data`);
  lines.push(` *`);
  lines.push(` * Auto-generated by scripts/convert-master-repo.mjs`);
  lines.push(` * DO NOT EDIT -- re-run npm run sync-master-repo to update.`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`import type { MasterRepoUseCase, ReferenceDataAsset } from "./master-repo-types";`);
  lines.push(``);

  // Use cases
  lines.push(
    `export const ${mapEntry.exportName}_USE_CASES: MasterRepoUseCase[] = ${JSON.stringify(data.useCases, null, 2)};`,
  );
  lines.push(``);

  // Data assets
  const cleanAssets = data.dataAssets.map((da) => ({
    id: da.id,
    name: da.name,
    description: da.description,
    systemLocation: da.systemLocation,
    assetFamily: da.assetFamily,
    easeOfAccess: da.easeOfAccess,
    lakeflowConnect: da.lakeflowConnect,
    ucFederation: da.ucFederation,
    lakebridgeMigrate: da.lakebridgeMigrate,
  }));
  lines.push(
    `export const ${mapEntry.exportName}_DATA_ASSETS: ReferenceDataAsset[] = ${JSON.stringify(cleanAssets, null, 2)};`,
  );
  lines.push(``);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Generate benchmark JSON pack
// ---------------------------------------------------------------------------

const CONFIDENCE_MAP = { low: 0.4, medium: 0.6, high: 0.8 };

function generateBenchmarks(industryId, industryName, useCases) {
  const records = [];
  const seen = new Set();

  for (const uc of useCases) {
    if (!uc.benchmarkImpact || !uc.benchmarkSource) continue;
    const key = `${uc.name}::${uc.kpiTarget}`;
    if (seen.has(key)) continue;
    seen.add(key);

    records.push({
      kind: "kpi",
      title: `${uc.name} -- ${uc.kpiTarget}`,
      summary: `${uc.kpiTarget}: ${uc.benchmarkImpact} improvement. ${uc.description}`,
      source_type: "open_report",
      source_url:
        uc.benchmarkUrl || "https://www.mckinsey.com/capabilities/quantumblack/our-insights",
      publisher: uc.benchmarkSource,
      published_at: "2024-06-01T00:00:00Z",
      industry: industryId,
      region: "global",
      metric_definition: uc.kpiTarget,
      methodology_note: `Master Repository benchmark for ${industryName}.`,
      license_class: "citation_required",
      confidence: CONFIDENCE_MAP.medium,
      ttl_days: 365,
      tags: ["master-repo", "kpi", industryId],
      provenance: {
        source_class: "master_repository",
        notes: `Sourced from Master Repository XLSX -- ${uc.benchmarkSource}.`,
      },
    });
  }

  return {
    $schema: "master-repository-benchmarks",
    industry: industryId,
    industryName,
    generatedAt: new Date().toISOString(),
    records,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
