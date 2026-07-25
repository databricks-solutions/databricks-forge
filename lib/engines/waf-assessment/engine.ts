/**
 * WAF Assessment engine — pillar query runner.
 *
 * Loads the four pillar SQL files (governance, reliability, cost,
 * performance), executes them against the user's Databricks SQL Warehouse,
 * and returns one `WafControlResult` per row.
 *
 * Each pillar query returns columns:
 *   waf_id, principle, score_percentage, threshold_percentage, threshold_met
 * (Some pillars also include `description` / `implemented` — we ignore those.)
 */

import { promises as fs } from "fs";
import path from "path";
import { executeSQL } from "@/lib/dbx/sql";
import { logger } from "@/lib/logger";
import type { WafControlResult, WafPillar } from "./types";
import { WAF_PILLARS_WITH_QUERIES } from "./types";

type WafPillarWithQuery = (typeof WAF_PILLARS_WITH_QUERIES)[number];

const QUERY_FILES: Record<WafPillarWithQuery, string> = {
  governance: "governance.sql",
  interoperability_usability: "interoperability-usability.sql",
  operational_excellence: "operational-excellence.sql",
  security_compliance_privacy: "security-compliance-privacy.sql",
  reliability: "reliability.sql",
  cost_optimisation: "cost-optimisation.sql",
  performance_efficiency: "performance-efficiency.sql",
};

const QUERY_DIR = path.join(process.cwd(), "lib/engines/waf-assessment/queries");

const sqlCache = new Map<WafPillarWithQuery, string>();

async function loadPillarSql(pillar: WafPillarWithQuery): Promise<string> {
  const cached = sqlCache.get(pillar);
  if (cached) return cached;
  const sql = await fs.readFile(path.join(QUERY_DIR, QUERY_FILES[pillar]), "utf-8");
  sqlCache.set(pillar, sql);
  return sql;
}

function colIndex(columns: { name: string }[], name: string): number {
  return columns.findIndex((c) => c.name.toLowerCase() === name.toLowerCase());
}

function parseFloatSafe(v: string | null | undefined): number {
  if (v == null) return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** Run a single pillar query and return per-control results. */
export async function runPillar(pillar: WafPillarWithQuery): Promise<WafControlResult[]> {
  const sql = await loadPillarSql(pillar);
  const result = await executeSQL(sql);

  const idxId = colIndex(result.columns, "waf_id");
  const idxScore = colIndex(result.columns, "score_percentage");
  const idxThreshold = colIndex(result.columns, "threshold_percentage");
  const idxMet = colIndex(result.columns, "threshold_met");

  if (idxId === -1 || idxScore === -1 || idxThreshold === -1 || idxMet === -1) {
    throw new Error(
      `WAF pillar '${pillar}' query returned unexpected columns: ${result.columns.map((c) => c.name).join(", ")}`,
    );
  }

  return result.rows.map((row) => ({
    wafId: String(row[idxId] ?? "").trim(),
    pillar,
    scorePercentage: parseFloatSafe(row[idxScore]),
    thresholdPercentage: parseFloatSafe(row[idxThreshold]),
    thresholdMet: String(row[idxMet] ?? "").toLowerCase() === "met",
  }));
}

/** Run all four pillars in parallel. Errors in one pillar do not block others. */
export async function runAllPillars(): Promise<{
  results: WafControlResult[];
  errors: Array<{ pillar: WafPillar; message: string }>;
}> {
  const settled = await Promise.allSettled(WAF_PILLARS_WITH_QUERIES.map((p) => runPillar(p)));
  const results: WafControlResult[] = [];
  const errors: Array<{ pillar: WafPillar; message: string }> = [];

  settled.forEach((s, i) => {
    const pillar = WAF_PILLARS_WITH_QUERIES[i];
    if (s.status === "fulfilled") {
      results.push(...s.value);
    } else {
      const message = s.reason instanceof Error ? s.reason.message : String(s.reason);
      logger.warn(`[waf-assessment] pillar ${pillar} failed`, { error: message });
      errors.push({ pillar, message });
    }
  });

  return { results, errors };
}
