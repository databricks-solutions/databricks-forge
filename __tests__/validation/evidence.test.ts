import { describe, expect, it } from "vitest";
import {
  DASHBOARD_VALIDATOR_VERSION,
  evidenceFailed,
  evidencePassed,
  evidenceSkipped,
} from "@/lib/validation/evidence";

describe("validation evidence", () => {
  it("creates compact passed evidence", () => {
    expect(
      evidencePassed("dashboard_contract", "GRID_VALID", "Grid is valid", {
        durationMs: 4,
        observedRowCount: 1,
      }),
    ).toEqual({
      stage: "dashboard_contract",
      status: "passed",
      code: "GRID_VALID",
      message: "Grid is valid",
      durationMs: 4,
      observedRowCount: 1,
    });
  });

  it("creates failed and skipped evidence", () => {
    expect(evidenceFailed("dataset_execution", "QUERY_FAILED", "bad SQL").status).toBe("failed");
    expect(evidenceSkipped("metric_probe", "NO_TEMP_PERMISSION", "cannot create").status).toBe(
      "skipped",
    );
    expect(DASHBOARD_VALIDATOR_VERSION).toBe("dashboard-contract-v1");
  });
});
