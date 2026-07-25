import { describe, expect, it } from "vitest";
import { isDashboardValidationDeployable } from "@/lib/dashboard/deployability";
import {
  DASHBOARD_VALIDATOR_VERSION,
  evidencePassed,
  evidenceSkipped,
  type ValidationEvidence,
} from "@/lib/validation/evidence";

const datasetRef = "dataset:sales_kpi";

function completeEvidence(): ValidationEvidence[] {
  return [
    evidencePassed("dataset_static", "SCHEMA_ALLOWLIST_VALID", "Schema allowlist passed.", {
      artifactRef: datasetRef,
    }),
    evidenceSkipped(
      "dataset_static",
      "MISSING_GROUP_BY_LINT_ADVISORY",
      "Static analysis was advisory; mandatory validation decided.",
      { artifactRef: datasetRef },
    ),
    evidencePassed(
      "dataset_static",
      "STATIC_LINT_PASSED",
      "Mandatory validation resolved the advisory.",
      { artifactRef: datasetRef },
    ),
    evidencePassed("dataset_explain", "EXPLAIN_PASSED", "EXPLAIN passed.", {
      artifactRef: datasetRef,
    }),
    evidencePassed("dataset_execution", "SQL_EXECUTION_SUCCEEDED", "Execution passed.", {
      artifactRef: datasetRef,
    }),
    evidencePassed("dataset_result", "RESULT_CONTRACT_VALID", "Result contract passed.", {
      artifactRef: datasetRef,
    }),
    evidencePassed("dashboard_design", "WIDGET_DATASET_REFERENCES_VALID", "References passed."),
    evidencePassed("dashboard_contract", DASHBOARD_VALIDATOR_VERSION, "Dashboard contract passed."),
  ];
}

function provenance(validationEvidence: ValidationEvidence[]) {
  return {
    validationStatus: "valid",
    validatorVersion: DASHBOARD_VALIDATOR_VERSION,
    validatedAt: "2026-07-25T00:00:00.000Z",
    validationEvidence,
  };
}

describe("isDashboardValidationDeployable", () => {
  it("accepts advisory missing-GROUP-BY evidence only when complete static provenance passes", () => {
    expect(isDashboardValidationDeployable(provenance(completeEvidence()))).toBe(true);
  });

  it("rejects advisory missing-GROUP-BY evidence without passed static provenance", () => {
    const incomplete = completeEvidence().filter((entry) => entry.code !== "STATIC_LINT_PASSED");

    expect(isDashboardValidationDeployable(provenance(incomplete))).toBe(false);
  });
});
