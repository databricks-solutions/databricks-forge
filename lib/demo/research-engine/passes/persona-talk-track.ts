/**
 * Pass G: Persona Talk Track
 *
 * Single generation-tier LLM call that emits all 5 personas (CEO, COO,
 * CIO/CTO, Head of Digital, Risk/Compliance) with company- and
 * killer-moment-specific provocativeOpening, whatToSay, three objections
 * + responses + proof, 5-question discovery ladder, close signal, and
 * persona-level evidence.
 *
 * Runs in Phase-5 parallel fan-out alongside evidence-linking after
 * demo-narrative completes.
 */

import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { resolveResearchEndpoint } from "../resolve-endpoint";
import type { TaskTier } from "@/lib/dbx/model-registry";
import type { LLMClient } from "@/lib/ports/llm-client";
import type { Logger } from "@/lib/ports/logger";
import type {
  CompanyStrategicProfile,
  ExecutiveBrief,
  IndustryLandscapeAnalysis,
  KeyQuote,
  KillerMoment,
  PersonaTalkTrack,
} from "../types";
import { PERSONA_TALK_TRACK_PROMPT } from "../prompts";

interface PersonaTalkTrackOutput {
  personaTalkTracks?: PersonaTalkTrack[];
}

const CANONICAL_ORDER: Array<{ id: string; label: string }> = [
  { id: "ceo", label: "CEO" },
  { id: "coo", label: "COO" },
  { id: "cio-cto", label: "CIO / CTO" },
  { id: "head-digital", label: "Head of Digital" },
  { id: "risk-compliance", label: "Risk / Compliance" },
];

export async function runPersonaTalkTrack(
  customerName: string,
  industryName: string,
  opts: {
    llm: LLMClient;
    logger: Logger;
    signal?: AbortSignal;
    modelTier?: TaskTier;
    executiveBrief: ExecutiveBrief | null;
    companyProfile: CompanyStrategicProfile | null;
    industryLandscape: IndustryLandscapeAnalysis | null;
    killerMoments: KillerMoment[];
    keyQuotes?: KeyQuote[];
  },
): Promise<PersonaTalkTrack[]> {
  const {
    llm,
    logger: log,
    signal,
    modelTier,
    executiveBrief,
    companyProfile,
    industryLandscape,
    killerMoments,
    keyQuotes,
  } = opts;

  const execBriefJson = executiveBrief
    ? JSON.stringify(executiveBrief, null, 2).slice(0, 5_000)
    : "null";
  const companyProfileJson = companyProfile
    ? JSON.stringify(companyProfile, null, 2).slice(0, 6_000)
    : "null";
  const industryLandscapeJson = industryLandscape
    ? JSON.stringify(industryLandscape, null, 2).slice(0, 4_000)
    : "null";
  const killerMomentsJson = JSON.stringify(killerMoments.slice(0, 5), null, 2).slice(0, 6_000);
  const keyQuotesJson = keyQuotes && keyQuotes.length > 0
    ? JSON.stringify(keyQuotes.slice(0, 15), null, 2).slice(0, 6_000)
    : "[]  // No pre-extracted quotes available.";

  const prompt = PERSONA_TALK_TRACK_PROMPT
    .replace("{customer_name}", customerName)
    .replace("{industry_name}", industryName)
    .replace("{executive_brief_json}", execBriefJson)
    .replace("{company_profile_json}", companyProfileJson)
    .replace("{industry_landscape_json}", industryLandscapeJson)
    .replace("{killer_moments_json}", killerMomentsJson)
    .replace("{key_quotes_json}", keyQuotesJson);

  const endpoint = resolveResearchEndpoint(modelTier ?? "generation");

  const response = await llm.chat({
    endpoint,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
    maxTokens: 12_288,
    responseFormat: "json_object",
    signal,
  });

  const parsed = parseLLMJson(response.content, "persona-talk-track") as PersonaTalkTrackOutput;
  const raw = Array.isArray(parsed?.personaTalkTracks) ? parsed.personaTalkTracks : [];

  // Re-order to the canonical 5 personas so the UI renders consistently.
  const byId = new Map<string, PersonaTalkTrack>();
  for (const track of raw) {
    if (track && typeof track.personaId === "string") {
      byId.set(track.personaId, track);
    }
  }
  const tracks: PersonaTalkTrack[] = [];
  for (const { id, label } of CANONICAL_ORDER) {
    const t = byId.get(id);
    if (t) {
      tracks.push({ ...t, label: t.label || label });
    }
  }

  log.info("persona-talk-track complete", {
    returned: raw.length,
    matched: tracks.length,
  });
  return tracks;
}
