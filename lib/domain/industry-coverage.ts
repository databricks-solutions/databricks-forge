/**
 * Industry coverage computation -- shared between client UI and server API.
 *
 * Pure logic: no React, no hooks, no DOM. Safe for both `"use client"` and
 * server-side imports.
 */

import type { UseCase } from "@/lib/domain/types";
import type {
  IndustryOutcome,
  StrategicPriority,
  ReferenceUseCase,
} from "@/lib/domain/industry-outcomes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PriorityCoverage {
  priority: StrategicPriority;
  objective: string;
  matchedUseCases: UseCase[];
  unmatchedRefUseCases: ReferenceUseCase[];
  coverageRatio: number;
}

export interface GapRefUseCase {
  name: string;
  businessValue?: string;
}

export interface CoverageResult {
  priorities: PriorityCoverage[];
  overallCoverage: number;
  totalRefUseCases: number;
  coveredRefUseCases: number;
  gapCount: number;
  missingDataEntities: Array<{
    entity: string;
    useCaseCount: number;
    refUseCases: GapRefUseCase[];
  }>;
  missingSourceSystems: Array<{
    system: string;
    useCaseCount: number;
    refUseCases: GapRefUseCase[];
  }>;
}

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

export function computeIndustryCoverage(
  industry: IndustryOutcome,
  useCases: UseCase[],
): CoverageResult {
  const priorities: PriorityCoverage[] = [];
  let totalRef = 0;
  let coveredRef = 0;

  const ucNameWords = useCases.map((uc) => ({
    uc,
    words: new Set(
      (uc.name + " " + uc.statement)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    ),
  }));

  const entityRefs = new Map<string, GapRefUseCase[]>();
  const systemRefs = new Map<string, GapRefUseCase[]>();

  for (const objective of industry.objectives) {
    for (const priority of objective.priorities) {
      const matched: UseCase[] = [];
      const unmatched: ReferenceUseCase[] = [];

      for (const refUc of priority.useCases) {
        totalRef++;
        const refWords = new Set(
          (refUc.name + " " + refUc.description)
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, "")
            .split(/\s+/)
            .filter((w) => w.length > 3),
        );

        let bestMatch: UseCase | null = null;
        let bestOverlap = 0;
        for (const { uc, words } of ucNameWords) {
          const overlap = [...refWords].filter((w) => words.has(w)).length;
          const overlapRatio = overlap / Math.max(refWords.size, 1);
          if (overlapRatio > bestOverlap && overlapRatio >= 0.25) {
            bestOverlap = overlapRatio;
            bestMatch = uc;
          }
        }
        if (bestMatch && !matched.includes(bestMatch)) {
          matched.push(bestMatch);
          coveredRef++;
        } else if (!bestMatch) {
          unmatched.push(refUc);
          const ref: GapRefUseCase = {
            name: refUc.name,
            ...(refUc.businessValue ? { businessValue: refUc.businessValue } : {}),
          };
          for (const entity of refUc.typicalDataEntities ?? []) {
            const existing = entityRefs.get(entity) ?? [];
            if (!existing.some((r) => r.name === ref.name)) {
              existing.push(ref);
            }
            entityRefs.set(entity, existing);
          }
          for (const system of refUc.typicalSourceSystems ?? []) {
            const existing = systemRefs.get(system) ?? [];
            if (!existing.some((r) => r.name === ref.name)) {
              existing.push(ref);
            }
            systemRefs.set(system, existing);
          }
        }
      }

      priorities.push({
        priority,
        objective: objective.name,
        matchedUseCases: matched,
        unmatchedRefUseCases: unmatched,
        coverageRatio: priority.useCases.length > 0 ? matched.length / priority.useCases.length : 0,
      });
    }
  }

  const missingDataEntities = [...entityRefs.entries()]
    .map(([entity, refs]) => ({
      entity,
      useCaseCount: refs.length,
      refUseCases: refs,
    }))
    .sort((a, b) => b.useCaseCount - a.useCaseCount);

  const missingSourceSystems = [...systemRefs.entries()]
    .map(([system, refs]) => ({
      system,
      useCaseCount: refs.length,
      refUseCases: refs,
    }))
    .sort((a, b) => b.useCaseCount - a.useCaseCount);

  return {
    priorities,
    overallCoverage: totalRef > 0 ? coveredRef / totalRef : 0,
    totalRefUseCases: totalRef,
    coveredRefUseCases: coveredRef,
    gapCount: totalRef - coveredRef,
    missingDataEntities,
    missingSourceSystems,
  };
}
