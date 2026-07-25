import { describe, it, expect } from "vitest";
import { generateEstateBoardPackPdf, type BoardPackData } from "@/lib/export/estate-board-pack-pdf";

const base: BoardPackData = {
  programName: "Acme Energy",
  industryName: "Oil & Gas (Integrated / NOC)",
  totalTables: 1234,
  totalSizeLabel: "12 TB",
  domainCount: 6,
  entityCount: 18,
  scanCount: 4,
  readinessScore: 62,
  readinessBand: "needs_work",
  assets: { models: 3, functions: 27, genieSpaces: 2, dashboards: 11, metricViews: 5 },
  tier: { bronze: 400, silver: 500, gold: 300, system: 14, unknown: 20 },
  coverage: {
    tablesWithCommentPct: 55,
    tablesWithOwnerPct: 40,
    tablesWithTierPct: 80,
    tablesWithDomainPct: 90,
  },
  topDomains: [
    { domain: "Subsurface & Wells", tableCount: 320, entityCount: 5 },
    { domain: "LNG & Shipping", tableCount: 210, entityCount: 3 },
  ],
  narrative: ["Line one.", "Line two."],
  pathForward: ["Do the thing.", "Then the other thing."],
};

describe("generateEstateBoardPackPdf", () => {
  it("produces a non-trivial PDF buffer", async () => {
    const buf = await generateEstateBoardPackPdf(base);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
    // PDF magic header.
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("handles an empty/zero estate without throwing", async () => {
    const empty: BoardPackData = {
      ...base,
      totalTables: 0,
      assets: { models: 0, functions: 0, genieSpaces: 0, dashboards: 0, metricViews: 0 },
      topDomains: [],
      readinessScore: null,
      readinessBand: null,
    };
    const buf = await generateEstateBoardPackPdf(empty);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
