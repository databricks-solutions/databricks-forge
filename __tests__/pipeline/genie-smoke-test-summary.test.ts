import { describe, expect, it } from "vitest";

import { classifyGenieSmokeTestSummary } from "@/components/pipeline/genie-smoke-test-summary";

describe("classifyGenieSmokeTestSummary", () => {
  it("returns success only when every question produced SQL", () => {
    expect(
      classifyGenieSmokeTestSummary({
        passed: 3,
        clarifications: 0,
        failed: 0,
        total: 3,
      }),
    ).toEqual({
      tone: "success",
      message: "Test complete: 3/3 SQL checks passed",
    });
  });

  it("returns warning for mixed SQL passes and nonpassing outcomes", () => {
    expect(
      classifyGenieSmokeTestSummary({
        passed: 2,
        clarifications: 1,
        failed: 1,
        total: 4,
      }),
    ).toEqual({
      tone: "warning",
      message: "Test complete: 2/4 SQL checks passed; 1 clarification; 1 failed",
    });
  });

  it("returns info for clarification-only completion", () => {
    expect(
      classifyGenieSmokeTestSummary({
        passed: 0,
        clarifications: 2,
        failed: 0,
        total: 2,
      }),
    ).toEqual({
      tone: "info",
      message: "Test complete: 0/2 SQL checks passed; 2 clarifications",
    });
  });

  it("returns error when every result is a hard failure", () => {
    expect(
      classifyGenieSmokeTestSummary({
        passed: 0,
        clarifications: 0,
        failed: 2,
        total: 2,
      }),
    ).toEqual({
      tone: "error",
      message: "Test failed: 0/2 SQL checks passed; 2 failed",
    });
  });
});
