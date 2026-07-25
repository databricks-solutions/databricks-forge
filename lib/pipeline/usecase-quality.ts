import type { UseCase } from "@/lib/domain/types";

const GENERIC_PATTERNS: RegExp[] = [
  /\bimprove operations\b/i,
  /\banaly[sz]e data for insights\b/i,
  /\bdata-driven decisions\b/i,
  /\benhance efficiency\b/i,
  /\boptimi[sz]e business\b/i,
];

export interface UseCaseValidationResult {
  valid: boolean;
  reasons: string[];
}

function hasSpecificityText(text: string, minLen: number): boolean {
  if (text.trim().length < minLen) return false;
  return !GENERIC_PATTERNS.some((rx) => rx.test(text));
}

export function validateUseCaseDeterministic(
  uc: UseCase,
  validTableSet: Set<string>,
): UseCaseValidationResult {
  const reasons: string[] = [];

  const normalizedTables = uc.tablesInvolved
    .map((t) => t.replace(/`/g, "").trim())
    .filter(Boolean)
    .filter((t) => validTableSet.has(t));

  if (normalizedTables.length === 0) {
    reasons.push("No grounded table references.");
  }
  if (!hasSpecificityText(uc.statement ?? "", 40)) {
    reasons.push("Statement is too generic or too short.");
  }
  if (!hasSpecificityText(uc.businessValue ?? "", 30)) {
    reasons.push("Business value is too generic or too short.");
  }
  if ((uc.analyticsTechnique ?? "").trim().length < 3) {
    reasons.push("Missing analytics technique.");
  }
  if ((uc.beneficiary ?? "").trim().length < 2) {
    reasons.push("Missing beneficiary.");
  }
  if ((uc.sponsor ?? "").trim().length < 2) {
    reasons.push("Missing sponsor.");
  }

  return { valid: reasons.length === 0, reasons };
}

export function applyDeterministicQualityFilter(
  useCases: UseCase[],
  validTables: string[],
): { accepted: UseCase[]; rejected: Array<{ useCase: UseCase; reasons: string[] }> } {
  const validSet = new Set(validTables.map((t) => t.replace(/`/g, "")));
  const accepted: UseCase[] = [];
  const rejected: Array<{ useCase: UseCase; reasons: string[] }> = [];

  for (const uc of useCases) {
    const result = validateUseCaseDeterministic(uc, validSet);
    if (result.valid) accepted.push(uc);
    else rejected.push({ useCase: uc, reasons: result.reasons });
  }
  return { accepted, rejected };
}
