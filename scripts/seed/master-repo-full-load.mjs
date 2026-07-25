#!/usr/bin/env node
/**
 * master-repo-full-load.mjs
 *
 * One-time seed loader for the Master Repository v2 XLSX. Emits:
 *   1. 15 canonical enrichment modules (lib/domain/industry-outcomes/<id>.enrichment.ts)
 *      with all new fields populated:
 *        - economicPatternName / economicImpactCategory / economicFormula
 *          / economicFormulaDescription / economicPatternRationale
 *        - totalLoeEstimate / mcAccessDifficulty / vaAccessDifficulty
 *        - bespoke / accessRationale / systemKind on each ReferenceDataAsset
 *   2. 15 benchmark JSON packs under data/benchmark/<id>-master.json
 *   3. A summary report printed to stdout.
 *
 * Industry ids align with the v2 split (15 distinct industries, no collisions):
 *
 *   media-advertising, communications, manufacturing, energy-utilities,
 *   retail, consumer-goods, life-sciences, healthcare, banking,
 *   capital-markets, insurance, games, casinos-resorts, real-money-gaming,
 *   digital-natives.
 *
 * Usage:
 *   node scripts/seed/master-repo-full-load.mjs --input <path-to-xlsx> [--dry-run]
 *   npm run seed:master-repo -- --input ~/Downloads/Master\ Repository.xlsx
 *
 * This script is intentionally one-shot; the user has indicated they do not
 * want a recurring importer. Commit the generated *.enrichment.ts files and
 * *-master.json packs, then leave this script in tree for future re-runs if
 * the Master Repo XLSX changes.
 */

import pkg from "exceljs";
const { Workbook } = pkg;
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUTCOMES_DIR = resolve(ROOT, "lib/domain/industry-outcomes");
const BENCHMARK_DIR = resolve(ROOT, "data/benchmark");

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const inputIdx = args.indexOf("--input");
const inputPath = inputIdx !== -1 ? args[inputIdx + 1] : null;
const dryRun = args.includes("--dry-run");

if (!inputPath) {
  console.error("Usage: node scripts/seed/master-repo-full-load.mjs --input <path-to-xlsx> [--dry-run]");
  process.exit(1);
}

const resolvedInput = resolve(inputPath);
if (!existsSync(resolvedInput)) {
  console.error(`File not found: ${resolvedInput}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Industry mapping (XLSX name -> Forge canonical v2 id) -- 15 distinct ids
// ---------------------------------------------------------------------------

const INDUSTRY_MAP = {
  "Media, Entertainment, & Advertising": { id: "media-advertising", exportName: "MEDIA_ADVERTISING", name: "Media, Entertainment & Advertising" },
  Communications: { id: "communications", exportName: "COMMUNICATIONS", name: "Communications & Telecom" },
  Manufacturing: { id: "manufacturing", exportName: "MANUFACTURING", name: "Manufacturing" },
  "Energy & Utilities": { id: "energy-utilities", exportName: "ENERGY_UTILITIES", name: "Energy & Utilities" },
  Retail: { id: "retail", exportName: "RETAIL", name: "Retail" },
  "Consumer Goods": { id: "consumer-goods", exportName: "CONSUMER_GOODS", name: "Consumer Goods" },
  "Life Sciences": { id: "life-sciences", exportName: "LIFE_SCIENCES", name: "Life Sciences" },
  Healthcare: { id: "healthcare", exportName: "HEALTHCARE", name: "Healthcare" },
  "Banking & Payments": { id: "banking", exportName: "BANKING", name: "Banking & Payments" },
  "Capital Markets": { id: "capital-markets", exportName: "CAPITAL_MARKETS", name: "Capital Markets" },
  Insurance: { id: "insurance", exportName: "INSURANCE", name: "Insurance" },
  "Recreational Gaming": { id: "games", exportName: "GAMES", name: "Recreational Gaming" },
  "Casinos & Resorts": { id: "casinos-resorts", exportName: "CASINOS_RESORTS", name: "Casinos & Resorts" },
  "Real Money Gaming [Digital]": { id: "real-money-gaming", exportName: "REAL_MONEY_GAMING", name: "Real Money Gaming (Digital)" },
  "Digital Natives/Born in the Cloud": { id: "digital-natives", exportName: "DIGITAL_NATIVES", name: "Digital Natives" },
};

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------

function cellStr(cell) {
  const v = cell?.value;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("").trim();
    if ("result" in v) return v.result != null ? String(v.result).trim() : "";
    if ("text" in v) return String(v.text).trim();
    if ("hyperlink" in v) return String(v.text || v.hyperlink).trim();
  }
  return String(v).trim();
}

function cellNum(cell) {
  const v = cell?.value;
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "object" && "result" in v && typeof v.result === "number") return v.result;
  const n = Number(cellStr(cell));
  return Number.isNaN(n) ? null : n;
}

function parseBenchmarkSource(raw) {
  if (!raw) return { publisher: "", title: "", url: "" };
  const parts = raw.split("|").map((s) => s.trim());
  const publisher = parts[0] || "";
  const title = parts[1] || "";
  let url = "";
  for (const p of parts) {
    const m = p.match(/(https?:\/\/[^\s\[\]]+)/);
    if (m) {
      url = m[1];
      break;
    }
  }
  return { publisher, title, url };
}

function normalizeAccessDifficulty(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return undefined;
  if (v === "low") return "Low";
  if (v === "medium" || v === "med") return "Medium";
  if (v === "high") return "High";
  return undefined;
}

function normalizeLoeLevel(raw) {
  return normalizeAccessDifficulty(raw);
}

function normalizeHighLow(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "high") return "High";
  if (v === "low") return "Low";
  return undefined;
}

function normalizeImpactCategory(raw) {
  const v = String(raw || "").trim();
  if (!v) return undefined;
  // The master repo uses these exact 5 labels (verified via dump_xlsx)
  const allowed = ["Cost", "Revenue", "Productivity / Capacity", "Risk / Loss Avoidance", "Cash / Working Capital"];
  if (allowed.includes(v)) return v;
  // Normalize spacing variations
  const collapsed = v.replace(/\s+/g, " ").trim();
  const hit = allowed.find((a) => a.toLowerCase() === collapsed.toLowerCase());
  return hit;
}

// Canonical pattern names from lib/domain/economic-patterns.ts. Used to
// validate the XLSX values; if no exact match, keep the XLSX value but warn.
const CANONICAL_PATTERN_NAMES = new Set([
  "Cost Takeout (Labor / Opex Reduction)",
  "Price Realization (Yield / Rate Optimization)",
  "Productivity Capacity (Time-to-Decision / Ticket Deflection)",
  "Revenue Uplift (Conversion / Attach / Cross-sell)",
  "Capex Avoidance (Infrastructure / Tool Consolidation)",
  "Loss Avoidance (Fraud / Shrink / Leakage / Errors)",
  "Churn Reduction (Retention / LTV Protection)",
  "Risk Avoidance (Compliance / Penalties / Outage Impact)",
  "Waste Reduction (Spoilage / Returns / Write-downs)",
  "Working Capital Improvement (Inventory / AR / AP Efficiency)",
]);

function normalizePatternName(raw) {
  const v = String(raw || "").trim();
  if (!v) return undefined;
  if (CANONICAL_PATTERN_NAMES.has(v)) return v;
  // Try case-insensitive match
  const lower = v.toLowerCase();
  for (const p of CANONICAL_PATTERN_NAMES) {
    if (p.toLowerCase() === lower) return p;
  }
  return v; // fall through; LSP will warn but value is preserved
}

// Inline copy of classifySystemLocation heuristics from
// lib/domain/tech-to-system.ts (kept in sync manually; one-time seed).
function classifySystemLocation(location) {
  if (!location) return null;
  const tests = [
    ["CDP", /\bcdp\b/i],
    ["Identity Graph / Clean Room", /identity graph|clean ?room/i],
    ["Lakehouse", /lakehouse|unity catalog/i],
    ["Data Warehouse", /data ?warehouse|\bdwh\b|redshift|snowflake|bigquery|synapse|teradata/i],
    ["Data Lake", /data ?lake|\bs3\b|adls|\bgcs\b/i],
    ["Data Catalog", /data ?catalog|metastore/i],
    ["Order Management", /\boms\b|order management/i],
    ["Billing", /billing|cc&b/i],
    ["ERP", /\berp\b/i],
    ["CRM", /\bcrm\b/i],
    ["HRIS", /hris|\bhcm\b/i],
    ["ITSM", /itsm|service ?now/i],
    ["ESP", /\besp\b|journey orchestration/i],
    ["Ad Server / DSP / SSP", /ad ?server|\bdsp\b|\bssp\b|ssai/i],
    ["Feature Store / Vector DB", /feature ?store|vector ?db/i],
    ["BI / Analytics", /\bbi\b|research\/bi|analytics/i],
    ["Experimentation", /experimentation|feature ?flag/i],
    ["Observability", /observability|monitoring/i],
    ["SIEM / Security", /siem|soar/i],
    ["MES", /\bmes\b/i],
    ["SCADA / Historian", /scada|historian|\bpi\b/i],
    ["CMMS / EAM", /cmms|\beam\b/i],
    ["QMS / LIMS", /qms|lims|\beln\b/i],
    ["PLM / PDM", /\bplm\b|\bpdm\b/i],
    ["DAM", /\bdam\b/i],
    ["MAM", /\bmam\b/i],
    ["CMS", /\bcms\b/i],
    ["ECM", /\becm\b|sharepoint/i],
    ["EDMS", /edms/i],
    ["Doc Store", /doc ?store|confluence|wiki/i],
  ];
  for (const [kind, re] of tests) {
    if (re.test(location)) return kind;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Reading: ${resolvedInput}`);
  const wb = new Workbook();
  await wb.xlsx.readFile(resolvedInput);

  // 1. Use Case + Data Asset Repositor (primary - carries all v2 fields inline)
  const repoWs = wb.getWorksheet("Use Case + Data Asset Repositor");
  if (!repoWs) throw new Error("Sheet 'Use Case + Data Asset Repositor' not found");

  // Build use-case index keyed by industry+name. Use Case Summaries provides
  // strategic imperative/pillar and is keyed on the same names. Economic
  // Patterns provides the per-pattern rationale prose.
  const repoUseCases = []; // { xlsxIndustry, industryId, name, ...allFields }
  repoWs.eachRow({ includeEmpty: false }, (row, num) => {
    if (num <= 1) return;
    const industry = cellStr(row.getCell(1));
    if (!industry || !INDUSTRY_MAP[industry]) return;
    const name = cellStr(row.getCell(2));
    if (!name) return;
    repoUseCases.push({
      xlsxIndustry: industry,
      industryId: INDUSTRY_MAP[industry].id,
      name,
      summary: cellStr(row.getCell(3)),
      totalLoeEstimate: normalizeLoeLevel(cellStr(row.getCell(4))),
      rationale: cellStr(row.getCell(5)),
      modelType: cellStr(row.getCell(6)),
      mcAccessDifficulty: normalizeAccessDifficulty(cellStr(row.getCell(9))),
      vaAccessDifficulty: normalizeAccessDifficulty(cellStr(row.getCell(13))),
      kpiTarget: cellStr(row.getCell(15)),
      benchmarkImpact: cellNum(row.getCell(16)),
      benchmarkSourceRaw: cellStr(row.getCell(17)),
      economicPatternName: normalizePatternName(cellStr(row.getCell(18))),
      economicFormulaDescription: cellStr(row.getCell(19)),
      economicImpactCategory: normalizeImpactCategory(cellStr(row.getCell(20))),
      economicFormula: cellStr(row.getCell(21)),
    });
  });
  console.log(`  Parsed ${repoUseCases.length} use cases from Use Case + Data Asset Repositor`);

  // 2. Use Case Summaries (strategic imperative / pillar)
  const sumWs = wb.getWorksheet("Use Case Summaries");
  const sumIndex = new Map(); // industry::useCase -> { strategicImperative, strategicPillar }
  if (sumWs) {
    sumWs.eachRow({ includeEmpty: false }, (row, num) => {
      if (num <= 1) return;
      const industry = cellStr(row.getCell(2));
      const name = cellStr(row.getCell(3));
      if (!industry || !INDUSTRY_MAP[industry] || !name) return;
      sumIndex.set(`${INDUSTRY_MAP[industry].id}::${name}`, {
        strategicImperative: cellStr(row.getCell(10)),
        strategicPillar: cellStr(row.getCell(11)),
      });
    });
    console.log(`  Parsed ${sumIndex.size} strategic imperative/pillar entries`);
  }

  // 3. Economic Patterns - rationale prose per (industry, useCase)
  const epWs = wb.getWorksheet("Economic Patterns");
  const patternRationale = new Map(); // industry::useCase -> rationale
  if (epWs) {
    epWs.eachRow({ includeEmpty: false }, (row, num) => {
      if (num <= 1) return;
      // Col 1 industry may use a different label ("Media/Entertainment/Advertising");
      // Col 12 is the canonical industry name. Use that when present.
      const canonicalIndustry = cellStr(row.getCell(12)) || cellStr(row.getCell(1));
      const canonicalUseCase = cellStr(row.getCell(13)) || cellStr(row.getCell(2));
      const rationale = cellStr(row.getCell(4));
      if (!canonicalIndustry || !canonicalUseCase || !rationale) return;
      if (!INDUSTRY_MAP[canonicalIndustry]) return;
      patternRationale.set(`${INDUSTRY_MAP[canonicalIndustry].id}::${canonicalUseCase}`, rationale);
    });
    console.log(`  Parsed ${patternRationale.size} economic pattern rationales`);
  }

  // 4. Data Assets
  const daWs = wb.getWorksheet("Data Assets");
  if (!daWs) throw new Error("Sheet 'Data Assets' not found");
  const repoDataAssets = [];
  daWs.eachRow({ includeEmpty: false }, (row, num) => {
    if (num <= 1) return;
    const assetId = cellStr(row.getCell(1));
    const industry = cellStr(row.getCell(2));
    if (!assetId || !industry || !INDUSTRY_MAP[industry]) return;
    repoDataAssets.push({
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
  console.log(`  Parsed ${repoDataAssets.length} reference data assets`);

  // 5. Use Case to Data Asset Mapping (MC / VA matrix)
  const mapWs = wb.getWorksheet("Use Case to Data Asset Mapping");
  const ucAssetMap = new Map(); // industry::useCase -> { mc:[], va:[] }
  if (mapWs) {
    mapWs.eachRow({ includeEmpty: false }, (row, num) => {
      if (num <= 1) return;
      const industry = cellStr(row.getCell(1));
      const ucName = cellStr(row.getCell(2));
      if (!industry || !ucName || !INDUSTRY_MAP[industry]) return;
      const mc = [];
      const va = [];
      // Columns 5..34 = A01..A30 (col 3 = MC summary, col 4 = VA summary)
      for (let col = 5; col <= 34; col++) {
        const val = cellStr(row.getCell(col)).toUpperCase();
        const assetId = `A${String(col - 4).padStart(2, "0")}`;
        if (val === "MC") mc.push(assetId);
        else if (val === "VA") va.push(assetId);
      }
      ucAssetMap.set(`${INDUSTRY_MAP[industry].id}::${ucName}`, { mc, va });
    });
    console.log(`  Parsed ${ucAssetMap.size} use case-to-data-asset mappings`);
  }

  // 6. Ease of Data Access Analysis - all 5 fields including bespoke + rationale
  const easeWs = wb.getWorksheet("Ease of Data Access Analysis");
  const easeMap = new Map(); // industryId::assetId -> { lakeflow, ucFed, lakebridge, bespoke, rationale }
  if (easeWs) {
    easeWs.eachRow({ includeEmpty: false }, (row, num) => {
      if (num <= 2) return;
      const industry = cellStr(row.getCell(2));
      if (!industry || !INDUSTRY_MAP[industry]) return;
      const masterId = cellStr(row.getCell(1));
      const assetId = masterId.split(" ").pop() || "";
      if (!assetId) return;
      easeMap.set(`${INDUSTRY_MAP[industry].id}::${assetId}`, {
        lakeflow: normalizeHighLow(cellStr(row.getCell(6))) || "Low",
        ucFed: normalizeHighLow(cellStr(row.getCell(7))) || "Low",
        lakebridge: normalizeHighLow(cellStr(row.getCell(8))) || "Low",
        bespoke: normalizeHighLow(cellStr(row.getCell(9))),
        rationale: cellStr(row.getCell(10)),
      });
    });
    console.log(`  Parsed ${easeMap.size} ease-of-access entries`);
  }

  // ---- Assemble per-industry output ----------------------------------------
  const byIndustry = new Map();
  for (const cfg of Object.values(INDUSTRY_MAP)) {
    byIndustry.set(cfg.id, { useCases: [], dataAssets: [], cfg });
  }

  for (const uc of repoUseCases) {
    const entry = byIndustry.get(uc.industryId);
    if (!entry) continue;
    const key = `${uc.industryId}::${uc.name}`;
    const am = ucAssetMap.get(key) || { mc: [], va: [] };
    const allAssetIds = [...am.mc, ...am.va];
    const crit = {};
    for (const id of am.mc) crit[id] = "MC";
    for (const id of am.va) crit[id] = "VA";
    const bm = parseBenchmarkSource(uc.benchmarkSourceRaw);
    const rationale = patternRationale.get(key);
    const sum = sumIndex.get(key);

    const usecaseObj = {
      name: uc.name,
      description: uc.summary,
    };
    if (uc.rationale) usecaseObj.rationale = uc.rationale;
    if (uc.modelType) usecaseObj.modelType = uc.modelType;
    if (uc.kpiTarget) usecaseObj.kpiTarget = uc.kpiTarget;
    if (uc.benchmarkImpact != null) {
      usecaseObj.benchmarkImpact = `${uc.benchmarkImpact > 0 ? "+" : ""}${uc.benchmarkImpact}%`;
    }
    if (bm.publisher) {
      usecaseObj.benchmarkSource = `${bm.publisher}${bm.title ? ` -- ${bm.title}` : ""}`;
    }
    if (bm.url) usecaseObj.benchmarkUrl = bm.url;
    if (sum?.strategicImperative) usecaseObj.strategicImperative = sum.strategicImperative;
    if (sum?.strategicPillar) usecaseObj.strategicPillar = sum.strategicPillar;
    if (allAssetIds.length) usecaseObj.dataAssetIds = allAssetIds;
    if (Object.keys(crit).length) usecaseObj.dataAssetCriticality = crit;

    // ---- v2 fields --------------------------------------------------------
    if (uc.totalLoeEstimate) usecaseObj.totalLoeEstimate = uc.totalLoeEstimate;
    if (uc.mcAccessDifficulty) usecaseObj.mcAccessDifficulty = uc.mcAccessDifficulty;
    if (uc.vaAccessDifficulty) usecaseObj.vaAccessDifficulty = uc.vaAccessDifficulty;
    if (uc.economicPatternName) usecaseObj.economicPatternName = uc.economicPatternName;
    if (uc.economicImpactCategory) usecaseObj.economicImpactCategory = uc.economicImpactCategory;
    if (uc.economicFormula) usecaseObj.economicFormula = uc.economicFormula;
    if (uc.economicFormulaDescription) {
      usecaseObj.economicFormulaDescription = uc.economicFormulaDescription;
    }
    if (rationale) usecaseObj.economicPatternRationale = rationale;

    entry.useCases.push(usecaseObj);
  }

  for (const da of repoDataAssets) {
    const entry = byIndustry.get(da.industryId);
    if (!entry) continue;
    // De-dupe by id within industry
    if (entry.dataAssets.find((d) => d.id === da.id)) continue;
    const ease = easeMap.get(`${da.industryId}::${da.id}`);
    const asset = {
      id: da.id,
      name: da.name,
      description: da.description,
      systemLocation: da.systemLocation,
      assetFamily: da.assetFamily,
      easeOfAccess: da.easeOfAccess,
      lakeflowConnect: ease?.lakeflow || "Low",
      ucFederation: ease?.ucFed || "Low",
      lakebridgeMigrate: ease?.lakebridge || "Low",
    };
    if (ease?.bespoke) asset.bespoke = ease.bespoke;
    if (ease?.rationale) asset.accessRationale = ease.rationale;
    const kind = classifySystemLocation(da.systemLocation);
    if (kind) asset.systemKind = kind;
    entry.dataAssets.push(asset);
  }

  // ---- Emit files ---------------------------------------------------------
  if (!existsSync(BENCHMARK_DIR)) mkdirSync(BENCHMARK_DIR, { recursive: true });

  const summary = [];
  for (const [industryId, data] of byIndustry) {
    const cfg = data.cfg;
    summary.push({ id: industryId, name: cfg.name, useCases: data.useCases.length, dataAssets: data.dataAssets.length });
    console.log(`  ${cfg.name} (${industryId}): ${data.useCases.length} use cases, ${data.dataAssets.length} data assets`);

    const enrichmentPath = resolve(OUTCOMES_DIR, `${industryId}.enrichment.ts`);
    const tsContent = generateEnrichmentModule(cfg, data);
    if (dryRun) console.log(`    [dry-run] Would write: ${enrichmentPath}`);
    else writeFileSync(enrichmentPath, tsContent, "utf-8");

    const benchPath = resolve(BENCHMARK_DIR, `${industryId}-master.json`);
    const bench = generateBenchmarks(industryId, cfg.name, data.useCases);
    if (dryRun) console.log(`    [dry-run] Would write: ${benchPath}`);
    else writeFileSync(benchPath, JSON.stringify(bench, null, 2), "utf-8");
  }

  console.log("\n=== Summary ===");
  console.log(`Industries: ${summary.length}`);
  console.log(`Total use cases: ${summary.reduce((s, i) => s + i.useCases, 0)}`);
  console.log(`Total data assets: ${summary.reduce((s, i) => s + i.dataAssets, 0)}`);
  for (const s of summary) console.log(`  ${s.name}: ${s.useCases} use cases, ${s.dataAssets} data assets`);
}

function generateEnrichmentModule(cfg, data) {
  const lines = [];
  lines.push(`/**`);
  lines.push(` * ${cfg.name} -- Master Repository Enrichment Data (v2)`);
  lines.push(` *`);
  lines.push(` * Auto-generated by scripts/seed/master-repo-full-load.mjs from the`);
  lines.push(` * Master Repository XLSX. Re-run when the XLSX changes.`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`import type { MasterRepoUseCase, ReferenceDataAsset } from "./master-repo-types";`);
  lines.push(``);
  lines.push(
    `export const ${cfg.exportName}_USE_CASES: MasterRepoUseCase[] = ${JSON.stringify(data.useCases, null, 2)};`,
  );
  lines.push(``);
  lines.push(
    `export const ${cfg.exportName}_DATA_ASSETS: ReferenceDataAsset[] = ${JSON.stringify(data.dataAssets, null, 2)};`,
  );
  lines.push(``);
  return lines.join("\n");
}

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
      source_url: uc.benchmarkUrl || "https://www.mckinsey.com/capabilities/quantumblack/our-insights",
      publisher: uc.benchmarkSource,
      published_at: "2024-06-01T00:00:00Z",
      industry: industryId,
      region: "global",
      metric_definition: uc.kpiTarget,
      methodology_note: `Master Repository benchmark for ${industryName}.`,
      license_class: "citation_required",
      confidence: CONFIDENCE_MAP.medium,
      ttl_days: 365,
      tags: ["master-repo", "kpi", industryId, uc.economicImpactCategory || "uncategorized"],
      provenance: { source_class: "master_repository", notes: `Sourced from Master Repository XLSX -- ${uc.benchmarkSource}.` },
      economicPattern: uc.economicPatternName,
      economicFormula: uc.economicFormula,
    });
  }
  return {
    $schema: "master-repository-benchmarks-v2",
    industry: industryId,
    industryName,
    generatedAt: new Date().toISOString(),
    records,
  };
}

main().catch((err) => {
  console.error("Error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
