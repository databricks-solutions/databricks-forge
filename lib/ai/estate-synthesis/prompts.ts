/**
 * Prompt construction + deterministic fallback for the Estate Synthesis
 * executive brief. The brief narrates around the deterministic scores +
 * findings; if the LLM is unavailable we synthesise a grounded fallback so the
 * State of the Nation always renders.
 */

import type { ExecutiveBrief, EstateScores, EstateFinding } from "@/lib/domain/estate-synthesis-types";
import type { EstateSynthesisInput } from "./types";

export function buildBriefPrompt(
  input: EstateSynthesisInput,
  scores: EstateScores,
  findings: EstateFinding[],
): string {
  const topFindings = findings
    .slice(0, 8)
    .map((f) => `- [${f.severity}] ${f.title}: ${f.summary}`)
    .join("\n");

  const domains = [...new Set(input.tables.map((t) => t.dataDomain).filter(Boolean))];

  return `You are a principal data-strategy consultant writing the executive summary of a data-estate diagnostic for a board-level audience. Be specific, quantified, and grounded ONLY in the facts below. Do not invent numbers.

ESTATE: ${input.ucPath}
INDUSTRY: ${input.industryName ?? input.industryId ?? "unspecified"}
TABLES: ${input.tables.length}
DOMAINS: ${domains.length ? domains.join(", ") : "unclassified"}

READINESS SCORES (0-100):
- Overall: ${scores.overall} (${scores.band})
- Governance: ${scores.governance}
- Quality: ${scores.quality}
- Freshness: ${scores.freshness}
- Documentation: ${scores.documentation}
- Analytics maturity: ${scores.analyticsMaturity}
- Cost efficiency: ${scores.cost}

KEY FINDINGS:
${topFindings || "- (no material findings)"}

Return STRICT JSON with this exact shape (no markdown fences):
{
  "estateShape": "2-3 sentences describing the shape and scale of this estate",
  "strengths": "2-3 sentences on the genuine strengths",
  "criticalRisks": "2-3 sentences on the most critical risks",
  "quickWins": "2-3 sentences on quick wins available now",
  "strategicRecommendations": "2-3 sentences on the strategic moves",
  "situationComplicationResolution": {
    "situation": "1-2 sentences",
    "complication": "1-2 sentences",
    "resolution": "1-2 sentences"
  }
}`;
}

/** A grounded, deterministic brief used when the LLM is unavailable. */
export function fallbackBrief(
  input: EstateSynthesisInput,
  scores: EstateScores,
  findings: EstateFinding[],
): ExecutiveBrief {
  const domains = [...new Set(input.tables.map((t) => t.dataDomain).filter(Boolean))];
  const risks = findings.filter((f) => f.severity === "critical" || f.severity === "high");
  const wins = findings.filter((f) => f.severity === "positive" || f.severity === "medium");

  return {
    estateShape: `The estate spans ${input.tables.length} tables across ${domains.length || "an unclassified set of"} domains in ${input.ucPath}. Overall data readiness is ${scores.overall}/100 (${scores.band}).`,
    strengths:
      scores.documentation >= 60 || scores.governance >= 60
        ? `Documentation (${scores.documentation}/100) and governance (${scores.governance}/100) are above the foundational bar, giving a workable base for self-serve analytics.`
        : `Quality (${scores.quality}/100) provides the most reliable foundation to build on while governance and documentation are uplifted.`,
    criticalRisks:
      risks.length > 0
        ? `${risks.length} material risks were identified, led by: ${risks[0].title}.`
        : `No critical risks were identified, though freshness (${scores.freshness}/100) should be monitored.`,
    quickWins:
      wins.length > 0
        ? `Immediate wins include: ${wins.map((w) => w.title).slice(0, 2).join("; ")}.`
        : `Documenting the highest-traffic undocumented tables is the fastest path to measurable uplift.`,
    strategicRecommendations: `Sequence remediation by value: close mission-critical data gaps, lift governance to the 70+ band, then stand up Genie spaces on the query-ready domains.`,
    situationComplicationResolution: {
      situation: `A ${input.tables.length}-table estate has been diagnosed against the ${input.industryName ?? "industry"} reference model.`,
      complication: `Readiness is ${scores.band} at ${scores.overall}/100, with the largest drag from ${weakestPillar(scores)}.`,
      resolution: `A prioritised, engine-backed uplift plan can move the estate up a readiness band within one quarter.`,
    },
    evidence: [],
  };
}

function weakestPillar(scores: EstateScores): string {
  const pillars: Array<[string, number]> = [
    ["governance", scores.governance],
    ["quality", scores.quality],
    ["freshness", scores.freshness],
    ["documentation", scores.documentation],
    ["analytics maturity", scores.analyticsMaturity],
    ["cost efficiency", scores.cost],
  ];
  pillars.sort((a, b) => a[1] - b[1]);
  return pillars[0][0];
}
