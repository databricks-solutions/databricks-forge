/**
 * Map scanned estate tables onto an industry's Master Repository reference
 * data assets, so the (pure) data-gap engine can compute coverage for an
 * estate scan. One grounded LLM call; deterministic name-overlap fallback.
 */

import { chatCompletion } from "@/lib/dbx/model-serving";
import { resolveEndpoint } from "@/lib/dbx/client";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { logger } from "@/lib/logger";
import type { ReferenceDataAsset } from "@/lib/domain/industry-outcomes/master-repo-types";

export interface ClassifierTable {
  fqn: string;
  dataDomain?: string | null;
  comment?: string | null;
}

export interface ClassifiedAsset {
  fqn: string;
  dataAssetId: string;
  dataAssetName: string;
}

export interface EstateClassifierDeps {
  callLLM?: (prompt: string) => Promise<string>;
}

const MAX_TABLES = 400;

function buildPrompt(tables: ClassifierTable[], assets: ReferenceDataAsset[]): string {
  const assetLines = assets
    .map((a) => `- ${a.id} | ${a.name} (${a.assetFamily}): ${a.description}`)
    .join("\n");
  const tableLines = tables
    .slice(0, MAX_TABLES)
    .map(
      (t) =>
        `- ${t.fqn}${t.dataDomain ? ` [domain=${t.dataDomain}]` : ""}${t.comment ? ` -- ${t.comment.slice(0, 120)}` : ""}`,
    )
    .join("\n");

  return `You are a data architect mapping a customer's physical tables onto a canonical industry reference data-asset model. For each table, choose the SINGLE best-matching reference asset id, or omit the table entirely if none is a reasonable match. Do not invent asset ids.

REFERENCE DATA ASSETS (id | name (family): description):
${assetLines}

CUSTOMER TABLES:
${tableLines}

Return STRICT JSON (no markdown fences):
{ "mappings": [ { "fqn": "<table fqn>", "assetId": "<reference asset id>" } ] }`;
}

/** Deterministic fallback: token overlap between table name and asset name. */
function fallbackClassify(
  tables: ClassifierTable[],
  assets: ReferenceDataAsset[],
): ClassifiedAsset[] {
  const tokenize = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2),
    );
  const assetTokens = assets.map((a) => ({
    asset: a,
    tokens: tokenize(`${a.name} ${a.assetFamily}`),
  }));
  const out: ClassifiedAsset[] = [];
  for (const t of tables) {
    const name = t.fqn.split(".").pop() ?? t.fqn;
    const tTokens = tokenize(name);
    let best: { asset: ReferenceDataAsset; score: number } | null = null;
    for (const { asset, tokens } of assetTokens) {
      let score = 0;
      for (const tok of tTokens) if (tokens.has(tok)) score++;
      if (score > 0 && (!best || score > best.score)) best = { asset, score };
    }
    if (best) out.push({ fqn: t.fqn, dataAssetId: best.asset.id, dataAssetName: best.asset.name });
  }
  return out;
}

export async function classifyEstateTablesToAssets(
  tables: ClassifierTable[],
  assets: ReferenceDataAsset[],
  deps: EstateClassifierDeps = {},
): Promise<ClassifiedAsset[]> {
  if (tables.length === 0 || assets.length === 0) return [];
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const callLLM =
    deps.callLLM ??
    (async (prompt: string) => {
      const r = await chatCompletion({
        endpoint: resolveEndpoint("classification"),
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        maxTokens: 8192,
      });
      return r.content;
    });

  try {
    const raw = await callLLM(buildPrompt(tables, assets));
    const parsed = parseLLMJson(raw, "estate-data-asset-classifier") as {
      mappings?: Array<{ fqn?: string; assetId?: string }>;
    };
    const out: ClassifiedAsset[] = [];
    const seen = new Set<string>();
    for (const m of parsed.mappings ?? []) {
      if (!m.fqn || !m.assetId) continue;
      const asset = assetById.get(m.assetId);
      if (!asset || seen.has(m.fqn)) continue;
      seen.add(m.fqn);
      out.push({ fqn: m.fqn, dataAssetId: asset.id, dataAssetName: asset.name });
    }
    if (out.length > 0) return out;
    return fallbackClassify(tables, assets);
  } catch (err) {
    logger.warn("[estate-classifier] LLM mapping failed; using token fallback", {
      error: err instanceof Error ? err.message : String(err),
    });
    return fallbackClassify(tables, assets);
  }
}
