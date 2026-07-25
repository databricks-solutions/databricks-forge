/**
 * WAF controls catalog — load + seed.
 *
 * The catalog is shipped as a CSV under `data/waf-controls-catalog.csv`
 * (sourced from Databricks-WAF-Light-Tooling). On first boot, controls
 * are upserted into the `forge_waf_controls` Lakebase table, where
 * they're then queryable via Prisma.
 *
 * Each control optionally carries a `fixActionEngine` mapping that
 * lets the UI offer a one-click "Fix with Forge" link to an existing
 * Forge engine (Comment Engine, Estate Scan, etc.).
 */

import { promises as fs } from "fs";
import path from "path";
import { withPrisma } from "@/lib/prisma";
import { parseCsv } from "./csv";
import type { WafEvaluationType, WafPillar } from "./types";

const CATALOG_PATH = path.join(process.cwd(), "lib/engines/waf-assessment/data/waf-controls-catalog.csv");

/**
 * Fix-action map: tells the UI which Forge engine (or doc) can remediate a control.
 *
 * Two flavors:
 *   - Internal engines (`comment-engine`, `estate-scan`, ...) deep-link to a
 *     Forge surface that addresses the gap directly.
 *   - `docs` is a fallback that links to the canonical Databricks doc when the
 *     remediation is admin- or workload-level (Photon, autoscaling, runtimes…)
 *     and not something Forge can automate today. The UI labels these
 *     differently ("Open docs" vs. "Fix with Forge") so the user knows what
 *     to expect on the other side.
 */
const FIX_ACTIONS: Record<string, { engine: string; params?: Record<string, unknown> }> = {
  // Governance — Forge engines
  "DG-01-03": { engine: "estate-scan", params: { reason: "lineage" } },
  "DG-01-04": { engine: "comment-engine", params: { mode: "tables-and-columns" } },
  "DG-01-05": { engine: "estate-scan", params: { reason: "tags" } },
  "DG-02-01": { engine: "estate-scan", params: { reason: "access-control" } },
  "DG-03-02": { engine: "estate-scan", params: { reason: "quality" } },
  "DG-03-03": { engine: "estate-scan", params: { reason: "format" } },
  // Governance — admin / external docs
  "DG-02-02": {
    engine: "docs",
    params: { href: "https://docs.databricks.com/aws/en/admin/system-tables/audit-logs" },
  },
  "DG-02-03": {
    engine: "docs",
    params: { href: "https://docs.databricks.com/aws/en/admin/system-tables/" },
  },

  // Reliability
  "R-01-01": { engine: "estate-scan", params: { reason: "format" } },
  "R-01-03": { engine: "estate-scan", params: { reason: "dlt-expectations" } },
  "R-02-04": { engine: "estate-scan", params: { reason: "constraints" } },
  "R-01-05": {
    engine: "docs",
    params: { href: "https://docs.databricks.com/aws/en/machine-learning/model-serving/" },
  },
  "R-01-06": {
    engine: "docs",
    params: { href: "https://docs.databricks.com/aws/en/admin/sql/serverless" },
  },
  "R-03-01": {
    engine: "docs",
    params: { href: "https://docs.databricks.com/aws/en/compute/configure" },
  },
  "R-03-02": {
    engine: "docs",
    params: { href: "https://docs.databricks.com/aws/en/compute/sql-warehouse/warehouse-behavior" },
  },

  // Performance Efficiency
  "PE-01-01": {
    engine: "docs",
    params: { href: "https://docs.databricks.com/aws/en/admin/sql/serverless" },
  },
  "PE-01-02": {
    engine: "docs",
    params: { href: "https://docs.databricks.com/aws/en/machine-learning/model-serving/" },
  },
  "PE-02-02": {
    engine: "docs",
    params: { href: "https://docs.databricks.com/aws/en/compute/configure" },
  },
  "PE-02-04": {
    engine: "docs",
    params: { href: "https://docs.databricks.com/aws/en/compute/configure" },
  },
  "PE-02-05": { engine: "ask-forge", params: { persona: "tech" } },
  "PE-02-06": { engine: "estate-scan", params: { reason: "photon" } },
  "PE-02-07": {
    engine: "docs",
    params: { href: "https://docs.databricks.com/aws/en/compute/clusters-manage#cluster-policy" },
  },

  // Cost Optimization
  "CO-01-01": { engine: "estate-scan", params: { reason: "managed-tables" } },
  "CO-01-03": {
    engine: "docs",
    params: { href: "https://docs.databricks.com/aws/en/compute/sql-warehouse/warehouse-types" },
  },
  "CO-01-04": { engine: "estate-scan", params: { reason: "runtime-versions" } },
  "CO-01-06": {
    engine: "docs",
    params: { href: "https://docs.databricks.com/aws/en/admin/sql/serverless" },
  },
  "CO-01-09": { engine: "estate-scan", params: { reason: "photon" } },
  "CO-02-03": { engine: "ask-forge", params: { persona: "tech" } },
  "CO-03-01": { engine: "ask-forge", params: { persona: "tech" } },
  "CO-03-02": { engine: "estate-scan", params: { reason: "tagging-cost-attribution" } },
};

/** Map raw `pillar_name` from the CSV to our internal pillar key. */
function pillarKeyFromName(name: string): WafPillar {
  const lower = name.toLowerCase();
  if (lower.includes("interoperab")) return "interoperability_usability";
  if (lower.includes("operational")) return "operational_excellence";
  if (lower.includes("security") || lower.includes("compliance") || lower.includes("privacy"))
    return "security_compliance_privacy";
  if (lower.includes("reliab")) return "reliability";
  if (lower.includes("cost")) return "cost_optimisation";
  if (lower.includes("performance")) return "performance_efficiency";
  return "governance";
}

function evaluationTypeFromRaw(raw: string | undefined): WafEvaluationType {
  return (raw ?? "").trim().toLowerCase() === "qualitative" ? "qualitative" : "automatic";
}

interface RawControl {
  waf_id: string;
  pillar_name: string;
  principle: string;
  best_practice: string;
  capabilities: string;
  details: string;
  query_table_name: string;
  threshold_percentage: string;
  metric_definition: string;
  recommendation_if_not_met: string;
  evaluation_type: string;
}

/** Read + parse the bundled CSV — returns rows in order, no DB calls. */
export async function loadControlsFromCsv() {
  const raw = await fs.readFile(CATALOG_PATH, "utf-8");
  const rows = parseCsv(raw) as unknown as RawControl[];
  return rows
    .filter((r) => r.waf_id && r.waf_id.trim().length > 0)
    .map((r) => {
      const wafId = r.waf_id.trim();
      const pillar = pillarKeyFromName(r.pillar_name ?? "");
      const fix = FIX_ACTIONS[wafId];
      const evaluationType = evaluationTypeFromRaw(r.evaluation_type);
      const rawThreshold = (r.threshold_percentage ?? "").trim();
      const thresholdPercentage =
        evaluationType === "qualitative" || rawThreshold === ""
          ? null
          : Number.isFinite(parseFloat(rawThreshold))
            ? parseFloat(rawThreshold)
            : null;
      return {
        wafId,
        pillar,
        pillarName: r.pillar_name?.trim() ?? "",
        principle: r.principle?.trim() ?? "",
        bestPractice: r.best_practice?.trim() ?? "",
        capabilities: r.capabilities?.trim() || null,
        details: r.details?.trim() || null,
        thresholdPercentage,
        metricDefinition: r.metric_definition?.trim() || null,
        recommendationIfNotMet: r.recommendation_if_not_met?.trim() || null,
        fixActionEngine: fix?.engine ?? null,
        fixActionParamsJson: fix?.params ? JSON.stringify(fix.params) : null,
        evaluationType,
      };
    });
}

/** Upsert the bundled catalog into Lakebase. Safe to call repeatedly. */
export async function ensureCatalogSeeded(): Promise<{ inserted: number; updated: number }> {
  const controls = await loadControlsFromCsv();
  return withPrisma(async (prisma) => {
    let inserted = 0;
    let updated = 0;
    for (const c of controls) {
      const existing = await prisma.forgeWafControl.findUnique({ where: { wafId: c.wafId } });
      if (existing) {
        await prisma.forgeWafControl.update({ where: { wafId: c.wafId }, data: c });
        updated++;
      } else {
        await prisma.forgeWafControl.create({ data: c });
        inserted++;
      }
    }
    return { inserted, updated };
  });
}
