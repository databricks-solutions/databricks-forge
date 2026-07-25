import {
  METRIC_VIEW_PROBE_VALIDATOR_VERSION,
  type ValidationEvidence,
} from "@/lib/validation/evidence";

export interface MetricViewValidationProvenance {
  validationStatus: string;
  validatorVersion?: string | null;
  validatedAt?: string | null;
  validationEvidence?: ValidationEvidence[] | null;
}

const REQUIRED_PASSED_EVIDENCE = [
  ["metric_view_static", "METRIC_VIEW_STATIC_VALIDATION_PASSED"],
  ["metric_view_create", "TEMP_METRIC_VIEW_CREATED"],
  ["metric_view_probe", "ATOMIC_MEASURE_PROBE_PASSED"],
  ["metric_view_cleanup", "TEMP_METRIC_VIEW_DROPPED"],
] as const;

/** True only for fresh Release 1 full-lifecycle validation provenance. */
export function isMetricViewValidationDeployable(
  provenance: MetricViewValidationProvenance,
): boolean {
  if (provenance.validationStatus !== "valid") return false;
  if (provenance.validatorVersion !== METRIC_VIEW_PROBE_VALIDATOR_VERSION) return false;
  if (!provenance.validatedAt || !Number.isFinite(Date.parse(provenance.validatedAt))) {
    return false;
  }

  const evidence = provenance.validationEvidence ?? [];
  if (evidence.some((entry) => entry.status !== "passed")) return false;

  return REQUIRED_PASSED_EVIDENCE.every(([stage, code]) =>
    evidence.some(
      (entry) => entry.stage === stage && entry.code === code && entry.status === "passed",
    ),
  );
}
