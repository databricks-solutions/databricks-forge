/**
 * V2 Portfolio synthesis engine.
 *
 * Turns the cross-owner `PortfolioOverview` + the org's canonical entities into
 * three CDO deliverables:
 *   1. Cross-estate fragmentation (the same entity modelled in multiple estates),
 *   2. Federated, industry-mapped opportunities across the combined estate,
 *   3. An org operating-model uplift plan (owners, phasing, dollars).
 *
 * Deterministic and grounded — the dollar figures come from
 * `lib/domain/cost-modeling.ts`, not the model. Entity clustering optionally
 * uses an injected embedder (`deps.embed`); everything degrades to a
 * name-normalisation fallback so a portfolio render never blocks on the model.
 */

import { estimateCost } from "@/lib/domain/cost-modeling";
import {
  resolveEntityClusters,
  type EntityCluster,
  type EntityResolutionDeps,
} from "./entity-resolution";
import type {
  PortfolioSynthesisInput,
  PortfolioSynthesisResult,
  FederatedOpportunity,
  UpliftAction,
} from "./types";

export type PortfolioSynthesisDeps = EntityResolutionDeps;

const READINESS_RISK_THRESHOLD = 50;

function buildOpportunities(
  input: PortfolioSynthesisInput,
  fragmented: EntityCluster[],
): FederatedOpportunity[] {
  const out: FederatedOpportunity[] = [];
  const { overview } = input;

  // 1. Fragmentation consolidation — one opportunity per multi-estate entity.
  for (const c of fragmented.slice(0, 10)) {
    // Value proxy: consolidation saves duplicated build/run effort; scale with
    // the number of estates and table footprint.
    const valueUsd = Math.round(estimateCost("m").costUsd.mid * (c.estates.length - 1) * 0.75);
    out.push({
      id: `frag:${c.label.toLowerCase().replace(/\s+/g, "-")}`,
      title: `Consolidate "${c.label}" across ${c.estates.length} estates`,
      summary: `${c.estates.join(", ")} each model "${c.label}" independently (${c.totalTables} tables total). A single golden definition removes duplication and conflicting metrics.`,
      estates: c.estates,
      severity: c.estates.length >= 3 ? "high" : "medium",
      valueUsd,
    });
  }

  // 2. Low-readiness estates — a remediation opportunity per laggard.
  const laggards = overview.estates
    .filter((e) => e.readiness > 0 && e.readiness < READINESS_RISK_THRESHOLD)
    .sort((a, b) => a.readiness - b.readiness)
    .slice(0, 5);
  for (const e of laggards) {
    out.push({
      id: `lag:${e.estateId}`,
      title: `Lift "${e.name}" out of the red (readiness ${e.readiness})`,
      summary: `${e.name} is below the portfolio readiness floor. Targeted governance + documentation work unlocks self-serve and de-risks the estate.`,
      estates: [e.name],
      severity: e.readiness < 30 ? "critical" : "high",
      valueUsd: e.valueAtRiskMid,
    });
  }

  return out.sort((a, b) => b.valueUsd - a.valueUsd);
}

function buildUpliftPlan(
  input: PortfolioSynthesisInput,
  fragmented: EntityCluster[],
): UpliftAction[] {
  const { overview } = input;
  const actions: UpliftAction[] = [];

  // Phase 1 — quick wins: documentation on the worst-documented estate.
  const worstDoc = overview.estates
    .filter((e) => e.scores && e.scores.documentation > 0)
    .sort((a, b) => a.scores!.documentation - b.scores!.documentation)[0];
  if (worstDoc) {
    const cost = estimateCost("s");
    actions.push({
      id: "uplift-doc",
      phase: 1,
      title: `Documentation sprint for "${worstDoc.name}"`,
      rationale: `"${worstDoc.name}" has the lowest documentation coverage (${worstDoc.scores!.documentation}/100). AI Comments closes this fast and makes the estate Genie-ready.`,
      owner: worstDoc.name,
      effort: "s",
      costUsd: cost.costUsd.mid,
      valueUsd: estimateCost("m").costUsd.mid,
    });
  }

  // Phase 2 — consolidate the top fragmented entity under a central owner.
  if (fragmented.length > 0) {
    const top = fragmented[0];
    const cost = estimateCost("l");
    actions.push({
      id: "uplift-consolidate",
      phase: 2,
      title: `Establish a golden "${top.label}" definition`,
      rationale: `"${top.label}" is built ${top.estates.length} ways across ${top.totalTables} tables. A central data product with clear ownership ends the divergence.`,
      owner: "Central Data Office",
      effort: "l",
      costUsd: cost.costUsd.mid,
      valueUsd: Math.round(cost.costUsd.mid * 1.5),
    });
  }

  // Phase 3 — stand up org-wide governance operating model.
  const cost = estimateCost("xl");
  actions.push({
    id: "uplift-operating-model",
    phase: 3,
    title: "Roll out a federated governance operating model",
    rationale: `Across ${overview.totals.estates} estates the average readiness is ${overview.totals.avgReadiness}/100. A federated model (central standards, local ownership) compounds the gains above.`,
    owner: "Central Data Office",
    effort: "xl",
    costUsd: cost.costUsd.mid,
    valueUsd: overview.totals.totalValueAtRisk,
  });

  return actions;
}

export async function runPortfolioSynthesis(
  input: PortfolioSynthesisInput,
  deps: PortfolioSynthesisDeps = {},
): Promise<PortfolioSynthesisResult> {
  const clusters = await resolveEntityClusters(input.entities, deps);
  const fragmented = clusters.filter((c) => c.fragmented);

  const opportunities = buildOpportunities(input, fragmented);
  const upliftPlan = buildUpliftPlan(input, fragmented);

  const headline =
    fragmented.length > 0
      ? `${fragmented.length} business ${fragmented.length === 1 ? "entity is" : "entities are"} modelled across multiple estates; consolidating them is the portfolio's highest-leverage move.`
      : `No cross-estate fragmentation detected across ${input.overview.totals.estates} estates — focus on lifting the ${input.overview.estates.filter((e) => e.readiness < READINESS_RISK_THRESHOLD).length} below-floor estates.`;

  return {
    fragmentation: fragmented,
    opportunities,
    upliftPlan,
    headline,
    generatedAt: new Date().toISOString(),
  };
}
