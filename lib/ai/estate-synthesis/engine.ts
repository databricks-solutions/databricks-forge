/**
 * Estate Synthesis engine — turns a persisted scan (the world model) plus
 * cross-engine signals into a consultant-grade State of the Nation.
 *
 * Architecture (mirrors the Business Value engine's graceful-degradation
 * pattern): deterministic scoring + finding derivation (pure) wrapped around a
 * single LLM executive-brief pass. Every step is individually skippable; the
 * synthesis ALWAYS returns a result so a scan is never blocked on synthesis.
 */

import { chatCompletion } from "@/lib/dbx/model-serving";
import { resolveEndpoint } from "@/lib/dbx/client";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { logger } from "@/lib/logger";
import type { EstateSynthesisInput, EstateSynthesisDeps, EstateSynthesisResult } from "./types";
import type { ExecutiveBrief } from "@/lib/domain/estate-synthesis-types";
import { computeEstateScores, buildFindings, computeValueAtRisk } from "./scoring";
import { buildBriefPrompt, fallbackBrief } from "./prompts";

const TEMPERATURE = 0.3;

async function defaultCallLLM(prompt: string): Promise<string> {
  const response = await chatCompletion({
    endpoint: resolveEndpoint("reasoning"),
    messages: [{ role: "user", content: prompt }],
    temperature: TEMPERATURE,
    maxTokens: 4096,
  });
  return response.content;
}

/**
 * Run the estate synthesis. Pure scoring runs first (never fails); the LLM
 * brief is best-effort with a grounded deterministic fallback.
 */
export async function runEstateSynthesis(
  input: EstateSynthesisInput,
  deps: EstateSynthesisDeps = {},
): Promise<EstateSynthesisResult> {
  const log = deps.log ?? logger;
  const callLLM = deps.callLLM ?? defaultCallLLM;
  const passResults: EstateSynthesisResult["passResults"] = {};

  // --- Deterministic passes (always succeed) ---
  const scores = computeEstateScores(input);
  passResults.scoring = "success";
  const findings = buildFindings(input, scores);
  passResults.findings = "success";
  const valueAtRisk = computeValueAtRisk(input);

  // --- LLM executive brief (best-effort) ---
  let brief: ExecutiveBrief;
  try {
    const raw = await callLLM(buildBriefPrompt(input, scores, findings));
    const parsed = parseLLMJson(raw, "estate-synthesis:brief") as Partial<ExecutiveBrief>;
    brief = mergeBrief(parsed, fallbackBrief(input, scores, findings));
    passResults.executiveBrief = "success";
  } catch (err) {
    log.warn("[estate-synthesis] Executive brief LLM pass failed; using fallback", {
      scanId: input.scanId,
      error: err instanceof Error ? err.message : String(err),
    });
    brief = fallbackBrief(input, scores, findings);
    passResults.executiveBrief = "failed";
  }

  // --- Evidence tiering: attach the strongest finding evidence to the brief ---
  const primaryEvidence = findings
    .flatMap((f) => f.evidence)
    .filter((e) => e.tier === "sourced" || e.tier === "benchmark");
  const inferredEvidence = findings
    .flatMap((f) => f.evidence)
    .filter((e) => e.tier === "inferred");
  brief.evidence = [...primaryEvidence, ...inferredEvidence].slice(0, 8);
  passResults.evidenceTiering = "success";

  log.info("[estate-synthesis] Synthesis complete", {
    scanId: input.scanId,
    overall: scores.overall,
    band: scores.band,
    findings: findings.length,
  });

  return { brief, findings, scores, valueAtRisk, passResults };
}

/** Merge an LLM brief with the deterministic fallback (LLM wins per field). */
function mergeBrief(llm: Partial<ExecutiveBrief>, fb: ExecutiveBrief): ExecutiveBrief {
  return {
    estateShape: nonEmpty(llm.estateShape) ?? fb.estateShape,
    strengths: nonEmpty(llm.strengths) ?? fb.strengths,
    criticalRisks: nonEmpty(llm.criticalRisks) ?? fb.criticalRisks,
    quickWins: nonEmpty(llm.quickWins) ?? fb.quickWins,
    strategicRecommendations: nonEmpty(llm.strategicRecommendations) ?? fb.strategicRecommendations,
    situationComplicationResolution: {
      situation:
        nonEmpty(llm.situationComplicationResolution?.situation) ??
        fb.situationComplicationResolution.situation,
      complication:
        nonEmpty(llm.situationComplicationResolution?.complication) ??
        fb.situationComplicationResolution.complication,
      resolution:
        nonEmpty(llm.situationComplicationResolution?.resolution) ??
        fb.situationComplicationResolution.resolution,
    },
    evidence: fb.evidence,
  };
}

function nonEmpty(s: string | undefined | null): string | null {
  return s && s.trim().length > 0 ? s.trim() : null;
}
