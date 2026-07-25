import type { ConsultingScorecard, UseCase } from "@/lib/domain/types";

export type { ConsultingScorecard };

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function hasNumericSignal(text: string): boolean {
  return /\b\d+(\.\d+)?(%|x|k|m|b)?\b/i.test(text);
}

function noveltyScore(name: string): number {
  const lower = name.toLowerCase();
  if (/\b(insights?|optimization|improvement|analysis)\b/.test(lower)) return 0.35;
  return 0.8;
}

export function scoreUseCaseConsultingQuality(uc: UseCase): ConsultingScorecard {
  const strategicAlignment = clamp01(uc.priorityScore);
  const implementationFeasibility = clamp01(uc.feasibilityScore);
  const measurableValue = clamp01(
    (uc.businessValue.length >= 50 ? 0.5 : 0.2) + (hasNumericSignal(uc.businessValue) ? 0.5 : 0),
  );
  const evidenceStrength = clamp01(
    (uc.tablesInvolved.length > 0 ? 0.5 : 0) +
      (uc.statement.includes(".") || uc.statement.includes("_") ? 0.3 : 0) +
      (uc.statement.length >= 50 ? 0.2 : 0),
  );
  const novelty = noveltyScore(uc.name);
  const boardroomDefensibility = clamp01(
    (uc.statement.length >= 60 ? 0.35 : 0.15) +
      (uc.solution.length >= 80 ? 0.35 : 0.15) +
      (uc.beneficiary.length > 2 && uc.sponsor.length > 2 ? 0.3 : 0.1),
  );

  const blendedScore = clamp01(
    uc.overallScore * 0.65 +
      strategicAlignment * 0.1 +
      measurableValue * 0.1 +
      implementationFeasibility * 0.05 +
      evidenceStrength * 0.05 +
      novelty * 0.03 +
      boardroomDefensibility * 0.02,
  );

  return {
    strategicAlignment,
    measurableValue,
    implementationFeasibility,
    evidenceStrength,
    novelty,
    boardroomDefensibility,
    blendedScore,
  };
}
