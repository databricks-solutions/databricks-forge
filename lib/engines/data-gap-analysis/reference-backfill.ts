/**
 * Lazy LLM backfill of `ForgeUseCase.referenceUseCaseName`.
 *
 * Use cases generated before the `reference_use_case_name` field shipped
 * have a null value for the column, which forces the Data Gap engine to
 * fall back to the fuzzy `findReferenceMatch` ladder. On real-world prompts
 * the fuzzy ladder misses on the majority of customer titles (the prompt
 * deliberately steers the LLM toward customer-specific phrasing), so those
 * runs surface $0 value-at-risk and `0/N Assets Present` on the Data Gap
 * card -- the headline bug this whole feature exists to fix.
 *
 * Strategy: when the Data Gap route is asked to compute a result and any
 * use case in the run is still missing its reference link, we fire a SINGLE
 * batched LLM call to the lightweight pool endpoint asking it to map every
 * customer UC name onto its closest master-repo match. The result is
 * persisted by `updateUseCaseReferenceLinks`, the in-memory UC list is
 * mutated in place, and the rest of `compute()` proceeds as if the field
 * had been populated by the original generation pass.
 *
 * Properties:
 *   - Idempotent: short-circuits when every UC already has a link.
 *   - Cheap: one prompt per run, lightweight endpoint, JSON mode.
 *   - Best-effort: failures are swallowed and logged; the engine falls
 *     through to the existing fuzzy matcher on the legacy rows.
 *   - Cache-aware: writes a fresh `referenceUseCaseResolvedAt` timestamp
 *     so `isDataGapCacheStale` can detect "backfill landed after the
 *     cache" and discard stale `valueAtRiskMid === 0` rows.
 */

import { chatCompletion, extractContentText } from "@/lib/dbx/model-serving";
import { resolveEndpoint } from "@/lib/dbx/client";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { logger } from "@/lib/logger";
import { updateUseCaseReferenceLinks } from "@/lib/lakebase/usecases";
import type { UseCase } from "@/lib/domain/types";
import type { MasterRepoEnrichment } from "@/lib/domain/industry-outcomes/master-repo-types";

const BACKFILL_MAX_TOKENS = 4_000;

/**
 * Shape of each item the LLM is asked to emit.
 *
 * `useCaseId` is required so we can patch the right row in the DB. The
 * value of `referenceUseCaseName` MUST be either `null` or a verbatim copy
 * of a master-repo UC title (we validate against the allow-list before
 * persisting).
 */
interface ReferenceLink {
  useCaseId: string;
  referenceUseCaseName: string | null;
}

/**
 * One-shot LLM call that maps customer UC names to their closest master-repo
 * counterparts. Returns the validated array; values that don't match a
 * known master-repo title are coerced to `null`.
 *
 * Exposed for unit testing.
 */
export async function mapUseCasesToMasterRepo(
  useCases: ReadonlyArray<Pick<UseCase, "id" | "name" | "statement" | "businessValue">>,
  enrichment: MasterRepoEnrichment,
): Promise<ReferenceLink[]> {
  if (useCases.length === 0) return [];
  if (enrichment.useCases.length === 0) return [];

  const allowed = new Map<string, string>(
    enrichment.useCases.map((uc) => [uc.name.toLowerCase().trim(), uc.name] as const),
  );

  const referenceList = enrichment.useCases
    .map((uc, i) => `${i + 1}. ${uc.name}${uc.description ? ` -- ${uc.description.split("\n")[0]}` : ""}`)
    .join("\n");
  const customerList = useCases
    .map(
      (uc) =>
        `- id: ${uc.id}\n  name: ${uc.name}\n  statement: ${truncate(uc.statement, 240)}\n  business_value: ${truncate(uc.businessValue, 240)}`,
    )
    .join("\n");

  const systemMessage =
    "You are a data product strategist mapping customer-specific use cases onto an industry reference catalogue. You return only valid JSON. You never invent reference titles.";
  const userMessage = `Match every customer use case below to the SINGLE closest matching INDUSTRY REFERENCE USE CASE, or null when no reference applies.

### INDUSTRY REFERENCE USE CASES (verbatim titles -- you MUST copy character-for-character)
${referenceList}

### CUSTOMER USE CASES
${customerList}

### OUTPUT
Return a JSON object with this exact shape:
{
  "links": [
    { "use_case_id": "<id>", "reference_use_case_name": "<verbatim reference title OR null>" }
  ]
}

Rules:
- Include every customer use case exactly once, keyed by its id.
- "reference_use_case_name" MUST be one of the reference titles above, copied verbatim (same capitalisation and punctuation), OR null.
- Prefer the best plausible match even if imperfect; only set null when there is genuinely no relevant reference.
- Return ONLY the JSON object. No prose, no markdown.`;

  const endpoint = resolveEndpoint("lightweight");

  let raw: string;
  try {
    const resp = await chatCompletion({
      endpoint,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userMessage },
      ],
      temperature: 0,
      maxTokens: BACKFILL_MAX_TOKENS,
      responseFormat: "json_object",
    });
    raw = resp.content ?? extractContentText(resp);
  } catch (err) {
    logger.warn("[reference-backfill] LLM call failed", {
      endpoint,
      ucCount: useCases.length,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  let parsed: unknown;
  try {
    parsed = parseLLMJson(raw, "reference-backfill");
  } catch (err) {
    logger.warn("[reference-backfill] failed to parse LLM JSON", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const items = extractLinkArray(parsed);
  const validIds = new Set(useCases.map((u) => u.id));
  const out: ReferenceLink[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const id =
      typeof obj.use_case_id === "string"
        ? obj.use_case_id
        : typeof obj.useCaseId === "string"
          ? obj.useCaseId
          : null;
    if (!id || !validIds.has(id)) continue;
    const rawName = obj.reference_use_case_name ?? obj.referenceUseCaseName;
    let name: string | null;
    if (rawName == null) {
      name = null;
    } else if (typeof rawName === "string") {
      const trimmed = rawName.trim();
      if (trimmed.length === 0 || /^(null|none|n\/a)$/i.test(trimmed)) {
        name = null;
      } else {
        name = allowed.get(trimmed.toLowerCase()) ?? null;
      }
    } else {
      name = null;
    }
    out.push({ useCaseId: id, referenceUseCaseName: name });
  }
  return out;
}

function extractLinkArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.links)) return obj.links;
    if (Array.isArray(obj.results)) return obj.results;
    if (Array.isArray(obj.use_cases)) return obj.use_cases;
  }
  return [];
}

function truncate(s: string | null | undefined, max: number): string {
  if (!s) return "";
  const trimmed = s.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * Top-level backfill helper invoked from the Data Gap route.
 *
 * Returns the (possibly updated) use case list so the caller can read
 * `referenceUseCaseName` straight off the rows. When no UC needs backfill,
 * returns the input array unchanged.
 *
 * Failure modes:
 *   - LLM call fails -> logs a warning, returns the input unchanged.
 *   - LLM returns nothing useful -> logs a warning, returns the input
 *     unchanged.
 *   - Persistence fails -> logs an error, returns the input unchanged
 *     (the in-memory list will not reflect the partial update).
 */
export async function backfillReferenceUseCaseNames(input: {
  runId: string;
  useCases: UseCase[];
  enrichment: MasterRepoEnrichment;
}): Promise<UseCase[]> {
  const { runId, useCases, enrichment } = input;
  const needsBackfill = useCases.filter((uc) => uc.referenceUseCaseName == null);
  if (needsBackfill.length === 0) return useCases;
  if (needsBackfill.length === 0 || enrichment.useCases.length === 0) return useCases;

  logger.info("[reference-backfill] starting", {
    runId,
    missing: needsBackfill.length,
    total: useCases.length,
  });

  let links: ReferenceLink[];
  try {
    links = await mapUseCasesToMasterRepo(needsBackfill, enrichment);
  } catch (err) {
    logger.warn("[reference-backfill] mapUseCasesToMasterRepo threw", {
      runId,
      error: err instanceof Error ? err.message : String(err),
    });
    return useCases;
  }
  if (links.length === 0) {
    logger.info("[reference-backfill] LLM returned no links", { runId });
    return useCases;
  }

  try {
    await updateUseCaseReferenceLinks(links);
  } catch (err) {
    logger.error("[reference-backfill] persistence failed", {
      runId,
      links: links.length,
      error: err instanceof Error ? err.message : String(err),
    });
    return useCases;
  }

  const linkById = new Map(links.map((l) => [l.useCaseId, l.referenceUseCaseName] as const));
  const nowIso = new Date().toISOString();
  const out = useCases.map((uc) =>
    linkById.has(uc.id)
      ? {
          ...uc,
          referenceUseCaseName: linkById.get(uc.id) ?? null,
          referenceUseCaseResolvedAt: nowIso,
        }
      : uc,
  );

  const filled = links.filter((l) => l.referenceUseCaseName != null).length;
  logger.info("[reference-backfill] done", {
    runId,
    filled,
    nulled: links.length - filled,
  });
  return out;
}
