import type { UseCase } from "@/lib/domain/types";
import { computeSchemaCoverage } from "@/lib/domain/scoring";

export interface RunQualityBaseline {
  totalUseCases: number;
  sqlGeneratedRate: number;
  schemaCoveragePct: number;
  avgOverallScore: number;
  lowSpecificityRate: number;
  duplicateNameRate: number;
  groundedUseCaseRate: number;
  consultantReadinessScore: number;
  findings: string[];
}

export interface QualityReleaseGateResult {
  passed: boolean;
  violations: string[];
}

const GENERIC_PATTERNS: RegExp[] = [
  /\bimprove operations\b/i,
  /\banalyze data for insights\b/i,
  /\bdrive better decisions\b/i,
  /\boptimi[sz]e performance\b/i,
  /\benhance efficiency\b/i,
];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function hasSpecificity(uc: UseCase): boolean {
  if ((uc.tablesInvolved?.length ?? 0) === 0) return false;
  if ((uc.statement ?? "").trim().length < 40) return false;
  if ((uc.businessValue ?? "").trim().length < 30) return false;
  return !GENERIC_PATTERNS.some(
    (rx) => rx.test(uc.statement ?? "") || rx.test(uc.businessValue ?? ""),
  );
}

export function computeRunQualityBaseline(
  useCases: UseCase[],
  filteredTables: string[],
): RunQualityBaseline {
  const findings: string[] = [];
  const totalUseCases = useCases.length;

  const sqlGenerated = useCases.filter((uc) => uc.sqlStatus === "generated").length;
  const sqlGeneratedRate = totalUseCases > 0 ? sqlGenerated / totalUseCases : 0;

  const avgOverallScore =
    totalUseCases > 0
      ? useCases.reduce((sum, uc) => sum + (uc.overallScore ?? 0), 0) / totalUseCases
      : 0;

  const covered = useCases.filter((uc) => (uc.tablesInvolved?.length ?? 0) > 0).length;
  const groundedUseCaseRate = totalUseCases > 0 ? covered / totalUseCases : 0;

  const lowSpecificity = useCases.filter((uc) => !hasSpecificity(uc)).length;
  const lowSpecificityRate = totalUseCases > 0 ? lowSpecificity / totalUseCases : 0;

  const nameCounts = new Map<string, number>();
  for (const uc of useCases) {
    const key = (uc.name ?? "").trim().toLowerCase();
    if (!key) continue;
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const duplicateNames = [...nameCounts.values()]
    .filter((c) => c > 1)
    .reduce((a, b) => a + b - 1, 0);
  const duplicateNameRate = totalUseCases > 0 ? duplicateNames / totalUseCases : 0;

  const coverage = computeSchemaCoverage(filteredTables, useCases);
  const schemaCoveragePct = coverage.coveragePct / 100;

  if (lowSpecificityRate > 0.25) {
    findings.push(
      `High low-specificity rate (${Math.round(lowSpecificityRate * 100)}%) suggests generic output risk.`,
    );
  }
  if (schemaCoveragePct < 0.3 && filteredTables.length >= 15) {
    findings.push(
      `Low table coverage (${Math.round(schemaCoveragePct * 100)}%) indicates narrow discovery breadth.`,
    );
  }
  if (sqlGeneratedRate < 0.7) {
    findings.push(
      `SQL generation success is ${Math.round(sqlGeneratedRate * 100)}%, below target.`,
    );
  }
  if (duplicateNameRate > 0.1) {
    findings.push(
      `Duplicate-name rate (${Math.round(duplicateNameRate * 100)}%) indicates dedup weakness.`,
    );
  }

  // Deterministic + model-derived blended quality indicator (0-1)
  const consultantReadinessScore = clamp01(
    avgOverallScore * 0.35 +
      groundedUseCaseRate * 0.2 +
      sqlGeneratedRate * 0.2 +
      schemaCoveragePct * 0.1 +
      (1 - lowSpecificityRate) * 0.1 +
      (1 - duplicateNameRate) * 0.05,
  );

  return {
    totalUseCases,
    sqlGeneratedRate: round3(sqlGeneratedRate),
    schemaCoveragePct: round3(schemaCoveragePct),
    avgOverallScore: round3(avgOverallScore),
    lowSpecificityRate: round3(lowSpecificityRate),
    duplicateNameRate: round3(duplicateNameRate),
    groundedUseCaseRate: round3(groundedUseCaseRate),
    consultantReadinessScore: round3(consultantReadinessScore),
    findings,
  };
}

export function evaluateRunReleaseGate(
  baseline: RunQualityBaseline,
  floors: {
    consultantReadiness: number;
    sqlGeneratedRate: number;
    schemaCoveragePct: number;
    lowSpecificityRateMax: number;
  },
): QualityReleaseGateResult {
  const violations: string[] = [];
  if (baseline.consultantReadinessScore < floors.consultantReadiness) {
    violations.push("consultant_readiness");
  }
  if (baseline.sqlGeneratedRate < floors.sqlGeneratedRate) {
    violations.push("sql_generated_rate");
  }
  if (baseline.schemaCoveragePct < floors.schemaCoveragePct) {
    violations.push("schema_coverage_pct");
  }
  if (baseline.lowSpecificityRate > floors.lowSpecificityRateMax) {
    violations.push("low_specificity_rate");
  }
  return { passed: violations.length === 0, violations };
}
