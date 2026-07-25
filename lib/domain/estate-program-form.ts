import { normalizeScopeInput } from "@/lib/lakebase/estate-scope-input";
import type { ScopeInput } from "@/lib/lakebase/estate-programs";
import { normalizeEstateProgramInput } from "@/lib/domain/estate-program-input";

export interface EstateProgramFormValues {
  name: string;
  description: string;
  industryId: string;
  subVertical: string;
  orgContext: string;
}

export interface EstateProgramCreatePayload {
  name: string;
  description: string;
  industryId: string | null;
  subVertical: string | null;
  orgContext: string | null;
}

/** Build and validate the optional advanced fields used by the create form. */
export function buildEstateProgramCreatePayload(
  values: EstateProgramFormValues,
): EstateProgramCreatePayload {
  const normalized = normalizeEstateProgramInput(values, { mode: "create" });
  if (!normalized.success) {
    throw new Error(normalized.error);
  }
  return normalized.data as EstateProgramCreatePayload;
}

export interface EstateScopeAdvancedValues {
  inclusionPatterns: string;
  workspaceId: string;
  teamLabel: string;
}

export type EstateScopeFormResult =
  | { ok: true; scopes: ScopeInput[] }
  | { ok: false; scopes: []; error: string };

/**
 * Apply one concise set of optional advanced values to every currently
 * selected UC scope and run the same validation as the API.
 */
export function buildEstateScopeCreateInputs(
  selectedSources: string[],
  advanced: EstateScopeAdvancedValues,
): EstateScopeFormResult {
  const scopes: ScopeInput[] = [];
  for (const ucMetadata of selectedSources.map((value) => value.trim()).filter(Boolean)) {
    const normalized = normalizeScopeInput({
      label: ucMetadata,
      ucMetadata,
      inclusionPatterns: advanced.inclusionPatterns,
      workspaceId: advanced.workspaceId,
      teamLabel: advanced.teamLabel,
    });
    if (!normalized.ok || !normalized.scope) {
      return {
        ok: false,
        scopes: [],
        error: normalized.error ?? "Invalid scope options",
      };
    }
    scopes.push({
      label: normalized.scope.label,
      ucMetadata: normalized.scope.ucMetadata,
      ...(normalized.scope.inclusionPatterns
        ? { inclusionPatterns: normalized.scope.inclusionPatterns }
        : {}),
      ...(normalized.scope.workspaceId ? { workspaceId: normalized.scope.workspaceId } : {}),
      ...(normalized.scope.teamLabel ? { teamLabel: normalized.scope.teamLabel } : {}),
    });
  }
  return { ok: true, scopes };
}
