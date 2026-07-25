import { describe, it, expect } from "vitest";
import {
  BRAND,
  PPTX,
  EXCEL,
  PDF,
  today,
  formatCompactCurrency,
  scoreColor,
} from "@/lib/export/brand";

describe("brand constants", () => {
  it("PPTX constants are hex without #", () => {
    expect(PPTX.DB_DARK).toMatch(/^[0-9A-Fa-f]{6}$/);
    expect(PPTX.DB_RED).toMatch(/^[0-9A-Fa-f]{6}$/);
    expect(PPTX.WHITE).toBe("FFFFFF");
  });

  it("EXCEL constants are ARGB format (8 hex chars)", () => {
    expect(EXCEL.DATABRICKS_BLUE).toMatch(/^FF[0-9A-Fa-f]{6}$/);
    expect(EXCEL.WHITE).toBe("FFFFFFFF");
    expect(EXCEL.BORDER_COLOR).toMatch(/^FF/);
  });

  it("PDF constants are hex with #", () => {
    expect(PDF.DB_DARK).toBe("#1B3139");
    expect(PDF.DB_RED).toBe("#FF3621");
    expect(PDF.WHITE).toBe("#FFFFFF");
  });

  it("all formats derive from same BRAND base", () => {
    expect(PPTX.DB_DARK).toBe(BRAND.dark);
    expect(EXCEL.DATABRICKS_BLUE).toBe(`FF${BRAND.blue}`);
    expect(PDF.DB_DARK).toBe(`#${BRAND.dark}`);
  });
});

describe("today", () => {
  it("returns ISO date string", () => {
    const d = today();
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("formatCompactCurrency", () => {
  it("formats millions", () => {
    expect(formatCompactCurrency(1_500_000)).toBe("$1.5M");
    expect(formatCompactCurrency(10_000_000)).toBe("$10.0M");
  });

  it("formats thousands", () => {
    expect(formatCompactCurrency(250_000)).toBe("$250K");
    expect(formatCompactCurrency(50_000)).toBe("$50K");
  });

  it("formats small values", () => {
    expect(formatCompactCurrency(500)).toBe("$500");
    expect(formatCompactCurrency(0)).toBe("$0");
  });
});

describe("scoreColor", () => {
  it("returns green for high scores", () => {
    expect(scoreColor(0.8)).toBe(PPTX.SCORE_GREEN);
    expect(scoreColor(0.8, "pdf")).toBe(PDF.SCORE_GREEN);
  });

  it("returns amber for medium scores", () => {
    expect(scoreColor(0.5)).toBe(PPTX.SCORE_AMBER);
  });

  it("returns red for low scores", () => {
    expect(scoreColor(0.2)).toBe(PPTX.DB_RED);
    expect(scoreColor(0.2, "pdf")).toBe(PDF.DB_RED);
  });
});
