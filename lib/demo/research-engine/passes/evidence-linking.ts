/**
 * Pass H: Evidence Linking
 *
 * Walks every Evidence object emitted by upstream passes (exec brief,
 * company profile, killer moments, persona talk tracks) and, for any
 * `tier: "sourced"` evidence that is missing a verbatim `quote`, runs a
 * pgvector retrieval against the per-session `company_research`
 * embeddings to attach a grounded quote + real sourceUrl/sourceTitle.
 *
 * If no match is found above the similarity threshold, the evidence is
 * downgraded to `tier: "inferred"` with an explanatory rationale. This
 * means every surfaced evidence chip is either grounded in a real source
 * or explicitly labelled as reasoning.
 *
 * The attach step is pure vector retrieval -- no LLM call -- so this pass
 * is essentially free to run and safe to fan out in parallel with
 * persona-talk-track.
 */

import { retrieveContext } from "@/lib/embeddings/retriever";
import type { Logger } from "@/lib/ports/logger";
import type {
  Evidence,
  ExecutiveBrief,
  PersonaTalkTrack,
  ResearchEngineResult,
} from "../types";

// Raised from 0.55 -- combined with enforceSourcePriority=true we'd rather
// downgrade a claim to "inferred" than attach it to a mediocre, stale
// passage. The retriever's freshness multiplier penalises old chunks, so
// a higher floor pushes us toward recent matches or explicit inference.
const MIN_SCORE = 0.58;
const TOP_K = 3;
const MAX_QUOTE_LENGTH = 320;

export interface EvidenceLinkingInput {
  customerName: string;
  industryId: string;
  sessionId?: string;
  executiveBrief?: ExecutiveBrief | null;
  companyProfile?: ResearchEngineResult["companyProfile"];
  demoNarrative?: ResearchEngineResult["demoNarrative"];
  personaTalkTracks?: PersonaTalkTrack[] | null;
}

export interface EvidenceLinkingOutput {
  executiveBrief?: ExecutiveBrief | null;
  companyProfile?: ResearchEngineResult["companyProfile"];
  demoNarrative?: ResearchEngineResult["demoNarrative"];
  personaTalkTracks?: PersonaTalkTrack[] | null;
  stats: { attempted: number; attached: number; downgraded: number };
}

/** Build a retrieval query for an evidence claim. */
function buildQuery(ev: Evidence, customerName: string): string {
  const parts: string[] = [];
  if (ev.claim) parts.push(ev.claim);
  if (ev.quote) parts.push(ev.quote);
  if (ev.sourceTitle) parts.push(ev.sourceTitle);
  if (parts.length === 0) parts.push(customerName);
  return parts.join(" -- ").slice(0, 400);
}

/** Try to attach a real quote. Returns the (possibly rewritten) evidence. */
async function tryAttachQuote(
  ev: Evidence,
  customerName: string,
): Promise<{ evidence: Evidence; attached: boolean; downgraded: boolean }> {
  // Only process sourced-tier evidence that's missing a quote.
  if (ev.tier !== "sourced") return { evidence: ev, attached: false, downgraded: false };
  if (ev.quote && ev.quote.trim().length >= 20 && ev.sourceUrl) {
    return { evidence: ev, attached: true, downgraded: false };
  }

  const query = buildQuery(ev, customerName);
  try {
    const chunks = await retrieveContext(query, {
      kinds: ["company_research"],
      topK: TOP_K,
      minScore: MIN_SCORE,
      metadataFilter: { customerName },
      // Activate the retriever's freshness multiplier + provenance weights
      // for company_research. Without this, a 2016 annual report can win
      // on pure cosine similarity even when a 2024 report is indexed.
      enforceSourcePriority: true,
    });

    if (chunks.length > 0) {
      const top = chunks[0];
      const md = (top.metadata ?? {}) as Record<string, unknown>;
      const sourceTitle =
        (typeof md.sourceTitle === "string" && md.sourceTitle) ||
        ev.sourceTitle ||
        "Source";
      const sourceUrl =
        (typeof md.sourceUrl === "string" && md.sourceUrl) ||
        ev.sourceUrl ||
        "";
      const sourcePublishedAt =
        typeof md.publishedAt === "string" ? md.publishedAt : ev.sourcePublishedAt;
      const sourcePublishedYear =
        typeof md.publishedYear === "number"
          ? (md.publishedYear as number)
          : ev.sourcePublishedYear;
      const quote = top.content.slice(0, MAX_QUOTE_LENGTH).trim();
      return {
        evidence: {
          ...ev,
          tier: "sourced",
          quote,
          sourceTitle,
          sourceUrl,
          ...(sourcePublishedAt ? { sourcePublishedAt } : {}),
          ...(typeof sourcePublishedYear === "number" ? { sourcePublishedYear } : {}),
        },
        attached: true,
        downgraded: false,
      };
    }
  } catch {
    // Retrieval failed -- fall through to downgrade.
  }

  // No match found -- downgrade to inferred with rationale.
  return {
    evidence: {
      tier: "inferred",
      claim: ev.claim,
      rationale:
        ev.rationale ||
        "No matching source passage found above the confidence threshold. Treating as analyst inference.",
    },
    attached: false,
    downgraded: true,
  };
}

async function processArray(
  arr: Evidence[] | undefined,
  customerName: string,
  stats: { attempted: number; attached: number; downgraded: number },
): Promise<Evidence[] | undefined> {
  if (!arr || arr.length === 0) return arr;
  const out: Evidence[] = [];
  for (const ev of arr) {
    if (ev?.tier !== "sourced") {
      out.push(ev);
      continue;
    }
    stats.attempted++;
    const { evidence, attached, downgraded } = await tryAttachQuote(ev, customerName);
    if (attached) stats.attached++;
    if (downgraded) stats.downgraded++;
    out.push(evidence);
  }
  return out;
}

async function processSingle(
  ev: Evidence | undefined,
  customerName: string,
  stats: { attempted: number; attached: number; downgraded: number },
): Promise<Evidence | undefined> {
  if (!ev) return ev;
  if (ev.tier !== "sourced") return ev;
  stats.attempted++;
  const { evidence, attached, downgraded } = await tryAttachQuote(ev, customerName);
  if (attached) stats.attached++;
  if (downgraded) stats.downgraded++;
  return evidence;
}

export async function runEvidenceLinking(
  input: EvidenceLinkingInput,
  logger: Logger,
): Promise<EvidenceLinkingOutput> {
  const { customerName } = input;
  const stats = { attempted: 0, attached: 0, downgraded: 0 };

  // --- Executive Brief ---
  let executiveBrief = input.executiveBrief ?? null;
  if (executiveBrief && Array.isArray(executiveBrief.evidence)) {
    const linked = await processArray(executiveBrief.evidence, customerName, stats);
    executiveBrief = { ...executiveBrief, evidence: linked ?? [] };
  }

  // --- Company Profile (priorities + gaps) ---
  let companyProfile = input.companyProfile ?? null;
  if (companyProfile) {
    const statedPriorities = await Promise.all(
      (companyProfile.statedPriorities ?? []).map(async (p) => ({
        ...p,
        evidence: await processSingle(p.evidence, customerName, stats),
      })),
    );
    const inferredPriorities = await Promise.all(
      (companyProfile.inferredPriorities ?? []).map(async (p) => ({
        ...p,
        evidenceObj: await processSingle(p.evidenceObj, customerName, stats),
      })),
    );
    const strategicGaps = await Promise.all(
      (companyProfile.strategicGaps ?? []).map(async (g) => ({
        ...g,
        evidence: await processSingle(g.evidence, customerName, stats),
      })),
    );
    companyProfile = {
      ...companyProfile,
      statedPriorities,
      inferredPriorities,
      strategicGaps,
    };
  }

  // --- Demo Narrative (killer moments) ---
  let demoNarrative = input.demoNarrative ?? null;
  if (demoNarrative && Array.isArray(demoNarrative.killerMoments)) {
    const moments = await Promise.all(
      demoNarrative.killerMoments.map(async (m) => ({
        ...m,
        evidence: await processArray(m.evidence, customerName, stats),
      })),
    );
    demoNarrative = { ...demoNarrative, killerMoments: moments };
  }

  // --- Persona Talk Tracks ---
  let personaTalkTracks = input.personaTalkTracks ?? null;
  if (personaTalkTracks && personaTalkTracks.length > 0) {
    personaTalkTracks = await Promise.all(
      personaTalkTracks.map(async (t) => {
        const threeObjections = await Promise.all(
          (t.threeObjections ?? []).map(async (o) => ({
            ...o,
            proofToUse: (await processSingle(o.proofToUse, customerName, stats)) ?? o.proofToUse,
          })),
        );
        const evidence = (await processArray(t.evidence, customerName, stats)) ?? [];
        return { ...t, threeObjections, evidence };
      }),
    );
  }

  logger.info("evidence-linking complete", stats);
  return { executiveBrief, companyProfile, demoNarrative, personaTalkTracks, stats };
}
