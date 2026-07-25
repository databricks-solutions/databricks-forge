import type { ValidationEvidence } from "@/lib/validation/evidence";
import type { DashboardValidationFailure } from "./types";

export class DashboardValidationError extends Error {
  readonly evidence: ValidationEvidence[];
  readonly validationFailures: DashboardValidationFailure[];

  constructor(
    message: string,
    validationFailures: DashboardValidationFailure[],
    evidence: ValidationEvidence[] = validationFailures.flatMap((failure) => failure.evidence),
  ) {
    super(message);
    this.name = "DashboardValidationError";
    this.validationFailures = validationFailures;
    this.evidence = evidence;
  }
}
