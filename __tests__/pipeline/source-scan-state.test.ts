import { describe, it, expect } from "vitest";
import { interpretScanSummary, type ScanSummaryResponse } from "@/lib/pipeline/source-scan-state";

const ready: ScanSummaryResponse = {
  scanId: "s1",
  ucPath: "cat.schema",
  tableCount: 12,
  scanStatus: "complete",
  complete: true,
  hasDetails: true,
};

describe("interpretScanSummary", () => {
  it("maps a complete scan with details to ready + authoritative ucPath", () => {
    const state = interpretScanSummary(200, ready);
    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.ucPath).toBe("cat.schema");
      expect(state.tableCount).toBe(12);
      expect(state.scanId).toBe("s1");
    }
  });

  it("maps 403 to unauthorized (no silent fallback)", () => {
    expect(interpretScanSummary(403, { error: "Forbidden" }).status).toBe("unauthorized");
  });

  it("maps 401 to unauthorized", () => {
    expect(interpretScanSummary(401, { error: "Unauthorized" }).status).toBe("unauthorized");
  });

  it("maps 404 to missing", () => {
    expect(interpretScanSummary(404, { error: "Not found" }).status).toBe("missing");
  });

  it("maps a 200 running/no-detail scan to incomplete", () => {
    expect(
      interpretScanSummary(200, { ...ready, scanStatus: "running", complete: false }).status,
    ).toBe("incomplete");
    expect(interpretScanSummary(200, { ...ready, hasDetails: false }).status).toBe("incomplete");
  });

  it("maps unexpected server errors to error", () => {
    expect(interpretScanSummary(500, { error: "boom" }).status).toBe("error");
  });
});
