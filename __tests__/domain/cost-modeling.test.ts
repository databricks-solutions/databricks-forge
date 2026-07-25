import { describe, it, expect } from "vitest";
import {
  estimateCost,
  calculateRoi,
  getEffortLabel,
  getEffortOrder,
  estimateLOEFromModelType,
  estimateDataAccessFeasibility,
} from "@/lib/domain/cost-modeling";

describe("estimateCost", () => {
  it("returns correct cost range for XS effort", () => {
    const cost = estimateCost("xs");
    expect(cost.label).toBe("Extra Small");
    expect(cost.costUsd.low).toBeLessThan(cost.costUsd.mid);
    expect(cost.costUsd.mid).toBeLessThan(cost.costUsd.high);
    expect(cost.costUsd.low).toBeGreaterThan(0);
  });

  it("returns correct cost range for XL effort", () => {
    const cost = estimateCost("xl");
    expect(cost.label).toBe("Extra Large");
    expect(cost.costUsd.mid).toBeGreaterThan(100000);
  });

  it("cost scales with effort size", () => {
    const xs = estimateCost("xs");
    const s = estimateCost("s");
    const m = estimateCost("m");
    const l = estimateCost("l");
    const xl = estimateCost("xl");
    expect(xs.costUsd.mid).toBeLessThan(s.costUsd.mid);
    expect(s.costUsd.mid).toBeLessThan(m.costUsd.mid);
    expect(m.costUsd.mid).toBeLessThan(l.costUsd.mid);
    expect(l.costUsd.mid).toBeLessThan(xl.costUsd.mid);
  });

  it("includes duration weeks", () => {
    const cost = estimateCost("m");
    expect(cost.durationWeeks.low).toBeLessThan(cost.durationWeeks.mid);
    expect(cost.durationWeeks.mid).toBeLessThan(cost.durationWeeks.high);
  });
});

describe("calculateRoi", () => {
  it("computes positive ROI for high-value quick win", () => {
    const roi = calculateRoi(500_000, "xs");
    expect(roi.netRoi).toBeGreaterThan(0);
    expect(roi.roiPercent).toBeGreaterThan(100);
    expect(roi.paybackMonths).toBeLessThan(12);
  });

  it("computes lower ROI for expensive initiative", () => {
    const roi = calculateRoi(100_000, "xl");
    expect(roi.netRoi).toBeLessThan(0);
    expect(roi.roiPercent).toBeLessThan(0);
  });

  it("handles zero value gracefully", () => {
    const roi = calculateRoi(0, "m");
    expect(roi.netRoi).toBeLessThan(0);
    expect(roi.paybackMonths).toBeNull();
  });
});

describe("getEffortLabel", () => {
  it("returns human-readable labels", () => {
    expect(getEffortLabel("xs")).toBe("Extra Small");
    expect(getEffortLabel("m")).toBe("Medium");
    expect(getEffortLabel("xl")).toBe("Extra Large");
  });

  it("returns dash for null", () => {
    expect(getEffortLabel(null)).toBe("—");
  });
});

describe("getEffortOrder", () => {
  it("orders correctly", () => {
    expect(getEffortOrder("xs")).toBeLessThan(getEffortOrder("s"));
    expect(getEffortOrder("s")).toBeLessThan(getEffortOrder("m"));
    expect(getEffortOrder("l")).toBeLessThan(getEffortOrder("xl"));
  });
});

describe("estimateLOEFromModelType", () => {
  it("Basic-ML + low data => Small effort", () => {
    const result = estimateLOEFromModelType("Basic-ML", 0);
    expect(result).not.toBeNull();
    expect(result!.effort).toBe("s");
    expect(result!.loeLevel).toBe("Low");
    expect(result!.dataCriticality).toBe("low");
  });

  it("Basic-ML + medium data => Medium effort", () => {
    const result = estimateLOEFromModelType("Basic-ML", 2);
    expect(result!.effort).toBe("m");
    expect(result!.loeLevel).toBe("Medium");
    expect(result!.dataCriticality).toBe("medium");
  });

  it("Basic-ML + high data => Large effort", () => {
    const result = estimateLOEFromModelType("Basic-ML", 5);
    expect(result!.effort).toBe("l");
    expect(result!.loeLevel).toBe("High");
    expect(result!.dataCriticality).toBe("high");
  });

  it("Advanced GenAI + low data => Medium effort", () => {
    const result = estimateLOEFromModelType("Advanced — GenAI", 1);
    expect(result!.effort).toBe("m");
    expect(result!.loeLevel).toBe("Medium");
  });

  it("Advanced GenAI + medium data => Large effort", () => {
    const result = estimateLOEFromModelType("Advanced — GenAI", 3);
    expect(result!.effort).toBe("l");
    expect(result!.loeLevel).toBe("High");
  });

  it("Expert AI Agents always returns High/Large for any data level", () => {
    const low = estimateLOEFromModelType("Expert — AI Agents", 0);
    const med = estimateLOEFromModelType("Expert — AI Agents", 2);
    const high = estimateLOEFromModelType("Expert — AI Agents", 6);
    expect(low!.effort).toBe("l");
    expect(med!.effort).toBe("l");
    expect(high!.effort).toBe("l");
  });

  it("handles alias strings (case-insensitive)", () => {
    expect(estimateLOEFromModelType("genai", 0)!.effort).toBe("m");
    expect(estimateLOEFromModelType("basic ml", 0)!.effort).toBe("s");
    expect(estimateLOEFromModelType("traditional ai", 2)!.effort).toBe("m");
  });

  it("returns null for unrecognized model type", () => {
    expect(estimateLOEFromModelType("quantum-computing", 3)).toBeNull();
    expect(estimateLOEFromModelType("", 0)).toBeNull();
  });

  it("MC count boundaries: 0-1 low, 2-3 medium, 4+ high", () => {
    const mt = "Intermediate — Traditional AI";
    expect(estimateLOEFromModelType(mt, 0)!.dataCriticality).toBe("low");
    expect(estimateLOEFromModelType(mt, 1)!.dataCriticality).toBe("low");
    expect(estimateLOEFromModelType(mt, 2)!.dataCriticality).toBe("medium");
    expect(estimateLOEFromModelType(mt, 3)!.dataCriticality).toBe("medium");
    expect(estimateLOEFromModelType(mt, 4)!.dataCriticality).toBe("high");
    expect(estimateLOEFromModelType(mt, 10)!.dataCriticality).toBe("high");
  });
});

describe("estimateDataAccessFeasibility", () => {
  it("returns null for empty asset list", () => {
    expect(estimateDataAccessFeasibility("banking", [])).toBeNull();
  });

  it("returns null for unknown industry", () => {
    expect(estimateDataAccessFeasibility("nonexistent", ["A01"])).toBeNull();
  });

  it("returns a score between 0 and 1 for known industry", () => {
    const result = estimateDataAccessFeasibility("banking", ["A01", "A02", "A03"]);
    if (result) {
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(result.totalRatings).toBeGreaterThan(0);
      expect(result.highRatings).toBeLessThanOrEqual(result.totalRatings);
    }
  });

  it("ignores asset IDs not found in the enrichment data", () => {
    const result = estimateDataAccessFeasibility("banking", ["A01", "ZZZ_FAKE"]);
    if (result) {
      expect(result.totalRatings).toBe(3);
    }
  });
});
