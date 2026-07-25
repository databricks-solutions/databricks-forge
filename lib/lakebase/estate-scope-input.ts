/**
 * Pure normalization + validation for an incoming Estate Program scope payload.
 *
 * Kept separate from the API route and the CRUD layer so it can be unit-tested
 * without HTTP or Prisma. Applies:
 *   - the shared safe-pattern validator to inclusion patterns
 *   - lineage-depth bounds ([1, 10], matching the Prisma default + depthConfig)
 *   - provenance string length caps (workspaceId / teamLabel)
 *   - a strict lineage-direction enum
 */

import { validateExclusionPattern, parsePatternsString } from "@/lib/domain/scope-selection";
import type { ScopeInput } from "@/lib/lakebase/estate-programs";

export interface NormalizeScopeResult {
  ok: boolean;
  scope?: ScopeInput;
  error?: string;
}

/** Max characters for free-text provenance strings persisted on a scope. */
export const MAX_PROVENANCE_LEN = 200;
/** Lineage-walk depth bounds (mirrors the depthConfig Zod schema). */
export const MIN_LINEAGE_DEPTH = 1;
export const MAX_LINEAGE_DEPTH = 10;

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function normalizeScopeInput(raw: unknown): NormalizeScopeResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Scope must be an object" };
  }
  const o = raw as Record<string, unknown>;

  if (typeof o.ucMetadata !== "string" || !o.ucMetadata.trim()) {
    return { ok: false, error: "A ucMetadata scope string is required" };
  }

  const inclusionPatterns = optionalString(o.inclusionPatterns);
  if (inclusionPatterns) {
    for (const pattern of parsePatternsString(inclusionPatterns)) {
      const err = validateExclusionPattern(pattern);
      if (err) return { ok: false, error: `Invalid inclusion pattern "${pattern}": ${err}` };
    }
  }

  const exclusionPatterns = optionalString(o.exclusionPatterns);
  if (exclusionPatterns) {
    for (const pattern of parsePatternsString(exclusionPatterns)) {
      const err = validateExclusionPattern(pattern);
      if (err) return { ok: false, error: `Invalid exclusion pattern "${pattern}": ${err}` };
    }
  }

  const workspaceId = optionalString(o.workspaceId);
  if (workspaceId && workspaceId.length > MAX_PROVENANCE_LEN) {
    return { ok: false, error: `workspaceId exceeds ${MAX_PROVENANCE_LEN} characters` };
  }
  const teamLabel = optionalString(o.teamLabel);
  if (teamLabel && teamLabel.length > MAX_PROVENANCE_LEN) {
    return { ok: false, error: `teamLabel exceeds ${MAX_PROVENANCE_LEN} characters` };
  }

  let lineageDepth: number | undefined;
  if (typeof o.lineageDepth === "number" && Number.isFinite(o.lineageDepth)) {
    lineageDepth = Math.min(
      MAX_LINEAGE_DEPTH,
      Math.max(MIN_LINEAGE_DEPTH, Math.round(o.lineageDepth)),
    );
  }

  const lineageDirection =
    o.lineageDirection === "upstream" ||
    o.lineageDirection === "both" ||
    o.lineageDirection === "downstream"
      ? o.lineageDirection
      : undefined;

  const scope: ScopeInput = {
    label: typeof o.label === "string" && o.label.trim() ? o.label : o.ucMetadata,
    ucMetadata: o.ucMetadata,
    excludedScope: typeof o.excludedScope === "string" ? o.excludedScope : null,
    exclusionPatterns,
    inclusionPatterns,
    assetDiscoveryEnabled: o.assetDiscoveryEnabled === true,
    lineageDepth,
    lineageEnabled: typeof o.lineageEnabled === "boolean" ? o.lineageEnabled : undefined,
    lineageDirection,
    workspaceId,
    teamLabel,
    sequence: typeof o.sequence === "number" ? o.sequence : undefined,
  };

  return { ok: true, scope };
}
