export type ValidationEvidenceStatus = "passed" | "failed" | "skipped";

export interface ValidationEvidence {
  stage: string;
  status: ValidationEvidenceStatus;
  code: string;
  message: string;
  durationMs?: number;
  artifactRef?: string;
  observedSchema?: Array<{ name: string; dataType: string }>;
  observedRowCount?: number;
}

export const DASHBOARD_VALIDATOR_VERSION = "dashboard-contract-v1";
export const METRIC_VIEW_PROBE_VALIDATOR_VERSION = "metric-view-probes-v1";

/** Keep persistence payloads schema-only even when callers attach extra runtime data. */
export function compactValidationEvidence(
  items: ValidationEvidence[] | undefined,
): ValidationEvidence[] {
  return (items ?? []).map((item) => ({
    stage: item.stage,
    status: item.status,
    code: item.code,
    message: item.message,
    ...(item.durationMs !== undefined && { durationMs: item.durationMs }),
    ...(item.artifactRef !== undefined && { artifactRef: item.artifactRef }),
    ...(item.observedSchema !== undefined && {
      observedSchema: item.observedSchema.map(({ name, dataType }) => ({ name, dataType })),
    }),
    ...(item.observedRowCount !== undefined && { observedRowCount: item.observedRowCount }),
  }));
}

type EvidenceDetails = Omit<ValidationEvidence, "stage" | "status" | "code" | "message">;

function evidence(
  status: ValidationEvidenceStatus,
  stage: string,
  code: string,
  message: string,
  details: EvidenceDetails = {},
): ValidationEvidence {
  return { stage, status, code, message, ...details };
}

export const evidencePassed = (
  stage: string,
  code: string,
  message: string,
  details?: EvidenceDetails,
) => evidence("passed", stage, code, message, details);

export const evidenceFailed = (
  stage: string,
  code: string,
  message: string,
  details?: EvidenceDetails,
) => evidence("failed", stage, code, message, details);

export const evidenceSkipped = (
  stage: string,
  code: string,
  message: string,
  details?: EvidenceDetails,
) => evidence("skipped", stage, code, message, details);
