import { describe, expect, it } from "vitest";
import {
  fingerprintSerializedDashboard,
  normalizeSerializedDashboard,
} from "@/lib/dashboard/live-artifact";

describe("live dashboard artifact fingerprints", () => {
  it("ignores object keys and documented collection order", () => {
    const left = {
      datasets: [
        { name: "z", displayName: "Z", queryLines: ["SELECT 1 "] },
        { name: "a", displayName: "A", queryLines: ["SELECT 2 "] },
      ],
      pages: [
        { name: "z", displayName: "Z", pageType: "PAGE_TYPE_CANVAS", layoutVersion: "GRID_V1", layout: [] },
        { name: "a", displayName: "A", pageType: "PAGE_TYPE_CANVAS", layoutVersion: "GRID_V1", layout: [] },
      ],
    };
    const right = {
      pages: [...left.pages].reverse(),
      datasets: [...left.datasets]
        .reverse()
        .map((dataset) => ({ ...dataset, queryLines: dataset.queryLines.map((line) => line.trim()) })),
    };

    expect(fingerprintSerializedDashboard(JSON.stringify(left))).toBe(
      fingerprintSerializedDashboard(JSON.stringify(right)),
    );
    expect(normalizeSerializedDashboard(JSON.stringify(left))).toEqual(
      normalizeSerializedDashboard(JSON.stringify(right)),
    );
  });

  it("detects semantic edits and rejects missing artifacts", () => {
    const original = JSON.stringify({ datasets: [], pages: [] });
    const edited = JSON.stringify({
      datasets: [{ name: "new", displayName: "New", queryLines: ["SELECT 1 "] }],
      pages: [],
    });

    expect(fingerprintSerializedDashboard(original)).not.toBe(
      fingerprintSerializedDashboard(edited),
    );
    expect(() => fingerprintSerializedDashboard(undefined)).toThrow("missing");
  });
});
