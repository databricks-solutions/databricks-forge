/**
 * Shared Databricks brand constants for all export generators.
 *
 * ARGB format (prefixed with FF) for ExcelJS, hex without # for pptxgenjs,
 * hex with # for PDFKit. Each format variant is exported separately.
 */

// ---------------------------------------------------------------------------
// App identity
// ---------------------------------------------------------------------------

export const APP_NAME = "Forge";
export const APP_NAME_FULL = "Databricks Forge";

// ---------------------------------------------------------------------------
// Base brand palette (raw hex without prefix)
// ---------------------------------------------------------------------------

export const BRAND = {
  dark: "1B3139",
  red: "FF3621",
  textColor: "2D3E50",
  textLight: "BECBD2",
  warmWhite: "FAFAFA",
  white: "FFFFFF",
  footer: "8899A6",
  border: "D1D5DB",
  midGray: "5E6E7D",
  scoreGreen: "2EA44F",
  scoreAmber: "E8912D",
  blue: "003366",
  lightGrayBg: "F9FAFB",
  textDark: "333333",
  greenFill: "E8F5E9",
  greenFont: "2E7D32",
  amberFill: "FFF3E0",
  amberFont: "E65100",
  redFill: "FFEBEE",
  redFont: "C62828",
} as const;

// ---------------------------------------------------------------------------
// PPTX (hex without # — pptxgenjs format)
// ---------------------------------------------------------------------------

export const PPTX = {
  DB_DARK: BRAND.dark,
  DB_RED: BRAND.red,
  TEXT_COLOR: BRAND.textColor,
  TEXT_LIGHT: BRAND.textLight,
  WARM_WHITE: BRAND.warmWhite,
  WHITE: BRAND.white,
  FOOTER_COLOR: BRAND.footer,
  BORDER_COLOR: BRAND.border,
  MID_GRAY: BRAND.midGray,
  SCORE_GREEN: BRAND.scoreGreen,
  SCORE_AMBER: BRAND.scoreAmber,
  SLIDE_W: 13.33,
  CONTENT_MARGIN: 0.6,
  get CONTENT_W() {
    return this.SLIDE_W - this.CONTENT_MARGIN * 2;
  },
} as const;

// ---------------------------------------------------------------------------
// Excel (ARGB format — ExcelJS)
// ---------------------------------------------------------------------------

export const EXCEL = {
  DATABRICKS_BLUE: `FF${BRAND.blue}`,
  WHITE: `FF${BRAND.white}`,
  LIGHT_GRAY_BG: `FF${BRAND.lightGrayBg}`,
  TEXT_DARK: `FF${BRAND.textDark}`,
  BORDER_COLOR: `FF${BRAND.border}`,
  GREEN_FILL: `FF${BRAND.greenFill}`,
  GREEN_FONT: `FF${BRAND.greenFont}`,
  AMBER_FILL: `FF${BRAND.amberFill}`,
  AMBER_FONT: `FF${BRAND.amberFont}`,
  RED_FILL: `FF${BRAND.redFill}`,
  RED_FONT: `FF${BRAND.redFont}`,
} as const;

// ---------------------------------------------------------------------------
// PDF (hex with # — PDFKit format)
// ---------------------------------------------------------------------------

export const PDF = {
  DB_DARK: `#${BRAND.dark}`,
  DB_RED: `#${BRAND.red}`,
  TEXT_COLOR: `#${BRAND.textColor}`,
  TEXT_LIGHT: `#${BRAND.textLight}`,
  WARM_WHITE: `#${BRAND.warmWhite}`,
  WHITE: `#${BRAND.white}`,
  FOOTER_COLOR: `#${BRAND.footer}`,
  BORDER_COLOR: `#${BRAND.border}`,
  MID_GRAY: `#${BRAND.midGray}`,
  SCORE_GREEN: `#${BRAND.scoreGreen}`,
  SCORE_AMBER: `#${BRAND.scoreAmber}`,
} as const;

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

export function today(): string {
  return new Date().toISOString().split("T")[0];
}

export function formatCompactCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function scoreColor(value: number, format: "pptx" | "pdf" = "pptx"): string {
  const green = format === "pdf" ? PDF.SCORE_GREEN : PPTX.SCORE_GREEN;
  const amber = format === "pdf" ? PDF.SCORE_AMBER : PPTX.SCORE_AMBER;
  const red = format === "pdf" ? PDF.DB_RED : PPTX.DB_RED;
  return value >= 0.7 ? green : value >= 0.4 ? amber : red;
}
