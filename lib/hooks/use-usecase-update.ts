"use client";

import { useCallback } from "react";
import type { UseCase } from "@/lib/domain/types";

export function useUseCaseUpdate(
  runId: string,
  useCases: UseCase[],
  setUseCases: React.Dispatch<React.SetStateAction<UseCase[]>>,
) {
  return useCallback(
    async (updated: UseCase): Promise<{ ok: boolean; error?: string }> => {
      try {
        const original = useCases.find((uc) => uc.id === updated.id);
        const payload: Record<string, unknown> = {};

        if (updated.name !== original?.name) payload.name = updated.name;
        if (updated.statement !== original?.statement) payload.statement = updated.statement;
        if (JSON.stringify(updated.tablesInvolved) !== JSON.stringify(original?.tablesInvolved)) {
          payload.tablesInvolved = updated.tablesInvolved;
        }

        const scoresChanged =
          updated.userPriorityScore !== original?.userPriorityScore ||
          updated.userFeasibilityScore !== original?.userFeasibilityScore ||
          updated.userImpactScore !== original?.userImpactScore ||
          updated.userOverallScore !== original?.userOverallScore;

        if (scoresChanged) {
          const isScoreReset =
            updated.userPriorityScore === null &&
            updated.userFeasibilityScore === null &&
            updated.userImpactScore === null &&
            updated.userOverallScore === null;
          if (isScoreReset) payload.resetScores = true;
          else {
            payload.userPriorityScore = updated.userPriorityScore;
            payload.userFeasibilityScore = updated.userFeasibilityScore;
            payload.userImpactScore = updated.userImpactScore;
            payload.userOverallScore = updated.userOverallScore;
          }
        }

        if (Object.keys(payload).length === 0) {
          setUseCases((prev) => prev.map((uc) => (uc.id === updated.id ? updated : uc)));
          return { ok: true };
        }

        const res = await fetch(`/api/runs/${runId}/usecases/${updated.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return { ok: false, error: data?.error || `HTTP ${res.status}` };
        }
        setUseCases((prev) => prev.map((uc) => (uc.id === updated.id ? updated : uc)));
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Network error",
        };
      }
    },
    [runId, useCases, setUseCases],
  );
}
