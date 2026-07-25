import { DASHBOARD_VALIDATOR_VERSION, type ValidationEvidence } from "@/lib/validation/evidence";

export interface DashboardValidationProvenance {
  validationStatus?: string | null;
  validatorVersion?: string | null;
  validatedAt?: string | null;
  validationEvidence?: ValidationEvidence[] | null;
}

const REQUIRED_DATASET_EVIDENCE = [
  ["dataset_static", "SCHEMA_ALLOWLIST_VALID"],
  ["dataset_static", "STATIC_LINT_PASSED"],
  ["dataset_explain", "EXPLAIN_PASSED"],
  ["dataset_execution", "SQL_EXECUTION_SUCCEEDED"],
  ["dataset_result", "RESULT_CONTRACT_VALID"],
] as const;

const REQUIRED_DASHBOARD_EVIDENCE = [
  ["dashboard_design", "WIDGET_DATASET_REFERENCES_VALID"],
  ["dashboard_contract", DASHBOARD_VALIDATOR_VERSION],
] as const;

function hasPassedEvidence(
  evidence: ValidationEvidence[],
  stage: string,
  code: string,
  artifactRef?: string,
): boolean {
  return evidence.some(
    (entry) =>
      entry.stage === stage &&
      entry.code === code &&
      entry.status === "passed" &&
      (artifactRef === undefined || entry.artifactRef === artifactRef),
  );
}

/** True only for current, complete Release 1 dashboard validation provenance. */
export function isDashboardValidationDeployable(
  provenance: DashboardValidationProvenance,
): boolean {
  if (provenance.validationStatus !== "valid") return false;
  if (provenance.validatorVersion !== DASHBOARD_VALIDATOR_VERSION) return false;
  if (!provenance.validatedAt || !Number.isFinite(Date.parse(provenance.validatedAt))) {
    return false;
  }

  const evidence = provenance.validationEvidence ?? [];
  if (
    evidence.some(
      (entry) =>
        entry.status === "failed" &&
        entry.stage !== "dashboard_read_back" &&
        entry.stage !== "dashboard_publication",
    )
  ) {
    return false;
  }
  if (
    !REQUIRED_DASHBOARD_EVIDENCE.every(([stage, code]) => hasPassedEvidence(evidence, stage, code))
  ) {
    return false;
  }

  const datasetRefs = new Set(
    evidence
      .map((entry) => entry.artifactRef)
      .filter((ref): ref is string => ref?.startsWith("dataset:") === true),
  );
  if (datasetRefs.size === 0) return false;

  return [...datasetRefs].every((artifactRef) =>
    REQUIRED_DATASET_EVIDENCE.every(([stage, code]) =>
      hasPassedEvidence(evidence, stage, code, artifactRef),
    ),
  );
}
