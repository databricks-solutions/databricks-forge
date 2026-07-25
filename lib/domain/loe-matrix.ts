/**
 * Master Repository LOE (Level of Effort) Matrix.
 *
 * Canonical 4x3 lookup from the master repository's "LOE Matrix" sheet:
 *
 *                                   Aggregate Data Access Difficulty
 *                                   Low    Medium    High
 *   Basic-ML                        Low    Medium    High
 *   Intermediate -- Traditional AI  Low    Medium    High
 *   Advanced -- GenAI               Medium High      High
 *   Expert -- AI Agents             High   High      High
 *
 * Replaces the MC-count-based heuristic previously hardcoded in
 * `lib/domain/cost-modeling.ts`. The MC-count derivation is kept as a
 * compatibility wrapper for use cases that do not yet have an explicit
 * `mcAccessDifficulty` populated from the master repo seed.
 */

import type { EffortEstimate } from "@/lib/domain/types";

export type LOELevel = "Low" | "Medium" | "High";

export type AccessDifficulty = "Low" | "Medium" | "High";

export type ModelType =
  | "Basic-ML"
  | "Intermediate -- Traditional AI"
  | "Advanced -- GenAI"
  | "Expert -- AI Agents";

export const LOE_MATRIX: Record<ModelType, Record<AccessDifficulty, LOELevel>> = {
  "Basic-ML": { Low: "Low", Medium: "Medium", High: "High" },
  "Intermediate -- Traditional AI": { Low: "Low", Medium: "Medium", High: "High" },
  "Advanced -- GenAI": { Low: "Medium", Medium: "High", High: "High" },
  "Expert -- AI Agents": { Low: "High", Medium: "High", High: "High" },
};

export const LOE_TO_EFFORT: Record<LOELevel, EffortEstimate> = {
  Low: "s",
  Medium: "m",
  High: "l",
};

/**
 * Aliases used to normalize the various spellings of model type strings that
 * appear in the master repository (em-dash vs hyphen, plain hyphens, etc.).
 */
const MODEL_TYPE_ALIASES: Record<string, ModelType> = {
  "basic-ml": "Basic-ML",
  "basic ml": "Basic-ML",
  basicml: "Basic-ML",
  intermediate: "Intermediate -- Traditional AI",
  "intermediate -- traditional ai": "Intermediate -- Traditional AI",
  "intermediate - traditional ai": "Intermediate -- Traditional AI",
  "intermediate \u2014 traditional ai": "Intermediate -- Traditional AI",
  "intermediate \u2013 traditional ai": "Intermediate -- Traditional AI",
  "traditional ai": "Intermediate -- Traditional AI",
  advanced: "Advanced -- GenAI",
  "advanced -- genai": "Advanced -- GenAI",
  "advanced - genai": "Advanced -- GenAI",
  "advanced \u2014 genai": "Advanced -- GenAI",
  "advanced \u2013 genai": "Advanced -- GenAI",
  genai: "Advanced -- GenAI",
  expert: "Expert -- AI Agents",
  "expert -- ai agents": "Expert -- AI Agents",
  "expert - ai agents": "Expert -- AI Agents",
  "expert \u2014 ai agents": "Expert -- AI Agents",
  "expert \u2013 ai agents": "Expert -- AI Agents",
  "ai agents": "Expert -- AI Agents",
};

export function normalizeModelType(raw: string): ModelType | null {
  if (raw in LOE_MATRIX) return raw as ModelType;
  return MODEL_TYPE_ALIASES[raw.toLowerCase().trim()] ?? null;
}

/**
 * Resolve an LOE level from explicit model type + access difficulty inputs,
 * using the canonical Master Repository matrix.
 *
 * Returns `null` when the model type cannot be normalized.
 */
export function resolveLoeLevel(
  modelType: string,
  accessDifficulty: AccessDifficulty,
): LOELevel | null {
  const m = normalizeModelType(modelType);
  if (!m) return null;
  return LOE_MATRIX[m][accessDifficulty];
}

/**
 * Map an MC asset count to an AccessDifficulty bucket. This is the legacy
 * heuristic used before the master repo provided explicit per-use-case
 * `mcAccessDifficulty`. Kept for use cases that have not yet been re-seeded
 * with the new field.
 */
export function deriveAccessDifficultyFromMcCount(mcCount: number): AccessDifficulty {
  if (mcCount <= 1) return "Low";
  if (mcCount <= 3) return "Medium";
  return "High";
}

/**
 * Resolve an LOE level using either an explicit access difficulty (preferred,
 * from the master repo) or a derived bucket from MC asset count (fallback).
 */
export function resolveLoeLevelWithFallback(
  modelType: string,
  opts: { mcAccessDifficulty?: AccessDifficulty; mcCount?: number },
): LOELevel | null {
  const difficulty =
    opts.mcAccessDifficulty ?? deriveAccessDifficultyFromMcCount(opts.mcCount ?? 0);
  return resolveLoeLevel(modelType, difficulty);
}
