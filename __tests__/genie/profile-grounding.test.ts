import { describe, it, expect } from "vitest";
import {
  buildProfileGroundingBlock,
  snapshotsFromSampleCache,
} from "@/lib/genie/profile-grounding";
import type { SampleDataCache } from "@/lib/genie/types";

describe("buildProfileGroundingBlock", () => {
  it("returns empty for no snapshots", () => {
    expect(buildProfileGroundingBlock([])).toBe("");
  });

  it("formats snapshots into a labeled block", () => {
    const block = buildProfileGroundingBlock([
      { tableFqn: "c.s.t", columnName: "status", values: ["active", "pending"] },
      { tableFqn: "c.s.t", columnName: "country", values: ["US", "UK"] },
    ]);
    expect(block).toContain("### Profile-Grounded Values");
    expect(block).toContain("c.s.t.status: ['active', 'pending']");
    expect(block).toContain("c.s.t.country: ['US', 'UK']");
  });

  it("respects maxColumns", () => {
    const snapshots = Array.from({ length: 10 }, (_, i) => ({
      tableFqn: "c.s.t",
      columnName: `col_${i}`,
      values: ["a"],
    }));
    const block = buildProfileGroundingBlock(snapshots, { maxColumns: 3 });
    const lines = block.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(3);
  });

  it("escapes single quotes in values", () => {
    const block = buildProfileGroundingBlock([
      { tableFqn: "c.s.t", columnName: "label", values: ["it's"] },
    ]);
    expect(block).toContain("it''s");
  });

  it("truncates oversized values with ellipsis", () => {
    const longVal = "x".repeat(100);
    const block = buildProfileGroundingBlock(
      [{ tableFqn: "c.s.t", columnName: "txt", values: [longVal] }],
      { maxValueChars: 20 },
    );
    expect(block).toMatch(/x{19}…/);
  });
});

describe("snapshotsFromSampleCache", () => {
  it("extracts unique non-null values per column", () => {
    const cache: SampleDataCache = new Map();
    cache.set("c.s.t", {
      columns: ["a", "b"],
      columnTypes: ["STRING", "STRING"],
      rows: [
        ["x", "1"],
        ["y", "1"],
        ["x", "2"],
        [null, null],
      ],
    });
    const snaps = snapshotsFromSampleCache(cache);
    expect(snaps).toHaveLength(2);
    const a = snaps.find((s) => s.columnName === "a")!;
    const b = snaps.find((s) => s.columnName === "b")!;
    expect(a.values).toEqual(["x", "y"]);
    expect(b.values).toEqual(["1", "2"]);
  });

  it("filters by (tableFqn, columnName) pairs when provided", () => {
    const cache: SampleDataCache = new Map();
    cache.set("c.s.t", {
      columns: ["a", "b"],
      columnTypes: ["STRING", "STRING"],
      rows: [["x", "y"]],
    });
    const filtered = snapshotsFromSampleCache(cache, [
      { tableFqn: "c.s.t", columnName: "a" },
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].columnName).toBe("a");
  });
});
