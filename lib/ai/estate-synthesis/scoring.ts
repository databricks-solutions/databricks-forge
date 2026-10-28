/**
 * Pure scoring + finding-derivation for the Estate Synthesis engine.
 *
 * No LLM, no DB, no network -- fully deterministic and unit-testable. The
 * engine wires these around the (optional) LLM executive-brief pass.
 */

import type {
  EstateScores,
  EstateFinding,
  EstateValueAtRisk,
  Evidence,
} from "@/lib/domain/estate-synthesis-types";
import { readinessBandForScore } from "@/lib/domain/estate-synthesis-types";
import type { EstateSynthesisInput, SynthTable } from "./types";

/** Tables modified within this many days count as "fresh". */
export const FRESHNESS_WINDOW_DAYS = 90;

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return clamp((numerator / denominator) * 100);
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function isFresh(iso: string | null, now: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return now - t <= FRESHNESS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/** Documentation coverage (0-100): tables with a comment or generated description. */
export function documentationScore(tables: SynthTable[]): number {
  return pct(
    tables.filter((t) => (t.comment && t.comment.trim()) || t.generatedDescription).length,
    tables.length,
  );
}

/** Governance score (0-100): mean of per-table LLM governance scores. */
export function governanceScore(tables: SynthTable[]): number {
  const scored = tables.filter((t) => t.governanceScore != null).map((t) => t.governanceScore!);
  return clamp(avg(scored));
}

/** Quality score (0-100): mean of rule-based health scores. */
export function qualityScore(tables: SynthTable[]): number {
  const scored = tables.filter((t) => t.healthScore != null).map((t) => t.healthScore!);
  return clamp(avg(scored));
}

/** Freshness score (0-100): share of tables written within the freshness window. */
export function freshnessScore(tables: SynthTable[], now = Date.now()): number {
  const withDate = tables.filter((t) => t.lastWriteAt);
  if (withDate.length === 0) return 0;
  return pct(withDate.filter((t) => isFresh(t.lastWriteAt, now)).length, withDate.length);
}

/**
 * Compute the six consultant sub-scores + the weighted overall + band.
 * Weights: governance 25, quality 20, freshness 15, documentation 15,
 * analytics maturity 15, cost 10.
 */
export function computeEstateScores(input: EstateSynthesisInput, now = Date.now()): EstateScores {
  const governance = governanceScore(input.tables);
  const quality = qualityScore(input.tables);
  const freshness = freshnessScore(input.tables, now);
  const documentation = documentationScore(input.tables);
  const analyticsMaturity = clamp(input.analyticsMaturityScore ?? 0);
  // Cost score: higher is better (less waste). When unmodeled, fall back to a
  // neutral-leaning proxy from quality (operational hygiene correlates).
  const cost =
    input.costWasteUsd != null
      ? clamp(
          100 - Math.min((input.costWasteUsd / Math.max(input.tables.length, 1) / 50) * 100, 100),
        )
      : clamp(quality * 0.8 + 20);

  const overall = clamp(
    governance * 0.25 +
      quality * 0.2 +
      freshness * 0.15 +
      documentation * 0.15 +
      analyticsMaturity * 0.15 +
      cost * 0.1,
  );

  return {
    governance,
    quality,
    freshness,
    documentation,
    analyticsMaturity,
    cost,
    overall,
    band: readinessBandForScore(overall),
  };
}

/** Compute portfolio-deduplicated value-at-risk from the data-gap signal. */
export function computeValueAtRisk(input: EstateSynthesisInput): EstateValueAtRisk | null {
  if (!input.dataGap) return null;
  return {
    low: input.dataGap.valueAtRiskLow,
    mid: input.dataGap.valueAtRiskMid,
    high: input.dataGap.valueAtRiskHigh,
    currency: "USD",
  };
}

function ev(tier: Evidence["tier"], fields: Partial<Evidence>): Evidence {
  return { tier, ...fields };
}

/**
 * Derive findings deterministically from the world model + cross-engine signals.
 * Each finding carries tiered evidence and a next-best-action. The LLM brief
 * later narrates around these; findings themselves are reproducible.
 */
export function buildFindings(input: EstateSynthesisInput, scores: EstateScores): EstateFinding[] {
  const findings: EstateFinding[] = [];
  const { scanId, tables } = input;
  const total = tables.length;

  // --- Documentation gap ---
  if (scores.documentation < 60 && total > 0) {
    const undocumented = tables.filter(
      (t) => !((t.comment && t.comment.trim()) || t.generatedDescription),
    );
    findings.push({
      id: "documentation_gap",
      kind: "documentation_gap",
      severity: scores.documentation < 30 ? "critical" : "high",
      title: `${undocumented.length} of ${total} tables are undocumented`,
      summary: `Documentation coverage is ${scores.documentation}%. Undocumented assets are invisible to Genie and to new joiners, throttling self-serve analytics.`,
      evidence: [
        ev("benchmark", {
          claim: "Leading estates document 80%+ of tables.",
          benchmarkRange: "80-95%",
          benchmarkLabel: "Documentation coverage (leading)",
        }),
        ev("inferred", {
          claim: `${undocumented.length} tables lack any comment or generated description.`,
          rationale: "Counted directly from the scanned table metadata.",
        }),
      ],
      action: {
        engine: "comments",
        label: "Document with AI Comments",
        href: "/environment/comments",
        params: { scanId },
      },
    });
  }

  // --- Governance risk ---
  const lowGov = tables.filter((t) => t.governanceScore != null && t.governanceScore < 70);
  if (lowGov.length > 0) {
    const worst = [...lowGov].sort(
      (a, b) => (a.governanceScore ?? 0) - (b.governanceScore ?? 0),
    )[0];
    findings.push({
      id: "governance_risk",
      kind: "governance_risk",
      severity: scores.governance < 40 ? "critical" : scores.governance < 60 ? "high" : "medium",
      title: `${lowGov.length} tables fall below the governance bar`,
      summary: `Average governance score is ${scores.governance}/100. Gaps in ownership, classification, and documentation expose the estate to compliance and access risk.`,
      evidence: [
        ev("sourced", {
          claim: `Lowest-scoring table: ${worst.fqn} (${worst.governanceScore}/100).`,
          quote: worst.fqn,
          sourceTitle: "Governance pass",
          sourceUrl: `/environment/table/${encodeURIComponent(worst.fqn)}`,
        }),
        ev("benchmark", {
          claim: "Target governance score for regulated estates.",
          benchmarkRange: "70-90",
          benchmarkLabel: "Governance score (target)",
        }),
      ],
      action: {
        engine: "waf",
        label: "Run Well-Architected Assessment",
        href: "/assessment",
        params: { scanId },
      },
    });
  }

  // --- Fragmentation / Redundancy ---
  const redundancies = input.insights.filter((i) => i.insightType === "redundancy");
  if (redundancies.length > 0) {
    let pairLabel = "overlapping table pairs";
    try {
      const first = JSON.parse(redundancies[0].payloadJson) as {
        tableA?: string;
        tableB?: string;
        similarityPercent?: number;
      };
      if (first.tableA && first.tableB) {
        pairLabel = `${first.tableA} ↔ ${first.tableB}${first.similarityPercent ? ` (${first.similarityPercent}% overlap)` : ""}`;
      }
    } catch {
      /* ignore malformed payload */
    }
    findings.push({
      id: "fragmentation",
      kind: "fragmentation",
      severity: redundancies.length >= 10 ? "high" : "medium",
      title: `${redundancies.length} redundant or overlapping table pair${redundancies.length === 1 ? "" : "s"} detected`,
      summary: `Schema overlap across ${redundancies.length} table pair${redundancies.length === 1 ? "" : "s"} increases storage cost and creates conflicting definitions for downstream BI and Genie users.`,
      evidence: [
        ev("sourced", {
          claim: `Representative overlap: ${pairLabel}.`,
          quote: pairLabel,
          sourceTitle: "Redundancy intelligence pass",
          sourceUrl: `/environment?scan=${encodeURIComponent(scanId)}`,
        }),
      ],
      action: {
        engine: "opportunities",
        label: "Review fragmentation",
        href: `/environment?scan=${encodeURIComponent(scanId)}`,
        params: { scanId },
      },
    });
  }

  // --- Well-Architected / Analytics Maturity gap ---
  const hasLowWaf = input.waf != null && input.waf.overallScore < 70;
  const hasLowMaturity =
    input.analyticsMaturityScore != null && input.analyticsMaturityScore < 65;
  if (hasLowWaf || hasLowMaturity) {
    const wafScore = hasLowWaf ? clamp(input.waf!.overallScore) : null;
    const maturity = hasLowMaturity ? scores.analyticsMaturity : null;
    const effectiveScore =
      wafScore != null && maturity != null
        ? Math.min(wafScore, maturity)
        : (wafScore ?? maturity ?? 0);
    const title =
      wafScore != null && maturity == null
        ? `Well-Architected posture is ${wafScore}/100`
        : maturity != null && wafScore == null
          ? `Analytics & platform maturity is ${maturity}/100`
          : `Well-Architected (${wafScore}/100) & analytics maturity (${maturity}/100) lag target`;
    const summary =
      wafScore != null && maturity == null
        ? `Workspace Well-Architected assessment score (${wafScore}/100) is below the 70/100 target bar, indicating platform and governance remediation opportunities.`
        : `Semantic and BI layer coverage (${maturity ?? wafScore}/100) lags behind the underlying data foundation, limiting governed self-serve adoption.`;

    findings.push({
      id: "well_architected_gap",
      kind: "well_architected_gap",
      severity: effectiveScore < 40 ? "high" : "medium",
      title,
      summary,
      evidence: [
        ev("benchmark", {
          claim: "Target analytics & Lakehouse maturity for self-serve estates.",
          benchmarkRange: "70-85",
          benchmarkLabel: "Analytics maturity (target)",
        }),
      ],
      action: {
        engine: "waf",
        label: "Run Well-Architected Assessment",
        href: "/assessment",
        params: { scanId },
      },
    });
  }

  // --- Freshness risk ---
  if (scores.freshness < 60 && total > 0) {
    const stale = tables.filter((t) => t.lastWriteAt && !isFreshWithin(t.lastWriteAt));
    findings.push({
      id: "freshness_risk",
      kind: "freshness_risk",
      severity: scores.freshness < 35 ? "high" : "medium",
      title: `${stale.length} tables look stale`,
      summary: `Only ${scores.freshness}% of tables with a known write timestamp were updated in the last ${FRESHNESS_WINDOW_DAYS} days. Stale tables erode trust in downstream dashboards.`,
      evidence: [
        ev("inferred", {
          claim: `${stale.length} tables have no write activity within the freshness window.`,
          rationale: "Derived from Delta history last-write timestamps.",
        }),
      ],
      action: {
        engine: "business-value",
        label: "Prioritise remediation",
        href: `/environment?scan=${encodeURIComponent(scanId)}`,
        params: { scanId },
      },
    });
  }

  // --- Query-ready domains (data products) ---
  const dataProducts = input.insights.filter((i) => i.insightType === "data_product");
  if (dataProducts.length > 0) {
    const productNames: string[] = [];
    for (const dp of dataProducts.slice(0, 5)) {
      try {
        const parsed = JSON.parse(dp.payloadJson) as { name?: string };
        if (parsed.name) productNames.push(parsed.name);
      } catch {
        /* ignore */
      }
    }
    const dpEvidence: Evidence[] = [
      ev("inferred", {
        claim: `${dataProducts.length} data products surfaced by the intelligence layer.`,
        rationale: "Counted from data_product insights.",
      }),
    ];
    if (productNames.length > 0) {
      dpEvidence.unshift(
        ev("sourced", {
          claim: `Query-ready data products: ${productNames.join(", ")}.`,
          quote: productNames.join(", "),
          sourceTitle: "Data Product pass",
          sourceUrl: `/environment?scan=${encodeURIComponent(scanId)}`,
        }),
      );
    }
    findings.push({
      id: "query_ready_domain",
      kind: "query_ready_domain",
      severity: "positive",
      title: `${dataProducts.length} query-ready data products identified`,
      summary: `These curated domains are documented and well-tiered enough to stand up a Genie space for self-serve Q&A today.`,
      evidence: dpEvidence,
      action: {
        engine: "genie",
        label: "Stand up a Genie space",
        href: "/genie/create/schema",
        params: { scanId },
      },
    });
  }

  // --- Coverage gap + opportunity (from data-gap) ---
  if (input.dataGap && input.dataGap.missingAssets > 0) {
    const var_ = input.dataGap;
    findings.push({
      id: "coverage_gap",
      kind: "coverage_gap",
      severity: var_.mcMissing > 0 ? "high" : "medium",
      title: `${var_.missingAssets} reference data assets are missing`,
      summary: `Against the ${var_.industryName} reference model, ${var_.missingAssets} assets (${var_.mcMissing} mission-critical) are absent — blocking high-value use cases.`,
      evidence: [
        ev("benchmark", {
          claim: `Industry reference model: ${var_.industryName}.`,
          benchmarkLabel: "Master Repository v2",
        }),
        ev("inferred", {
          claim: `Estimated value at risk: $${Math.round(var_.valueAtRiskMid).toLocaleString()}.`,
          rationale: "From the data-gap economic value-at-risk model.",
        }),
      ],
      action: {
        engine: "data-gap",
        label: "Close the data gaps",
        href: `/environment?scan=${encodeURIComponent(scanId)}&tab=data-gap`,
        params: { scanId },
      },
    });
    findings.push({
      id: "opportunity",
      kind: "opportunity",
      severity: "high",
      title: "Generate the prioritised opportunity backlog",
      summary: `The estate is mapped to ${var_.industryName}. Run discovery to turn the reference model into a scored, SQL-ready use-case backlog grounded in this estate.`,
      evidence: [
        ev("benchmark", {
          claim: "Industry-mapped opportunity generation.",
          benchmarkLabel: var_.industryName,
        }),
      ],
      action: {
        engine: "opportunities",
        label: "Generate opportunities",
        href: `/configure?fromScan=${encodeURIComponent(scanId)}`,
        params: { scanId },
      },
    });
  }

  return findings;
}

function isFreshWithin(iso: string, now = Date.now()): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return now - t <= FRESHNESS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}
