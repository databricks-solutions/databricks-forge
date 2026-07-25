/**
 * Shared pptxgenjs helpers for all PPTX export generators.
 *
 * Extracted from lib/export/pptx.ts to enable reuse across:
 *   - Run PPTX (pptx.ts)
 *   - Portfolio PPTX (portfolio-pptx.ts)
 *   - Executive Briefing (executive-briefing.ts)
 *   - Workshop PPTX (workshop-pptx.ts)
 */

import PptxGenJS from "pptxgenjs";
import fs from "fs";
import path from "path";
import { PPTX, today } from "./brand";

// ---------------------------------------------------------------------------
// Logo (cached)
// ---------------------------------------------------------------------------

let _logoBase64: string | null = null;

export function getLogoBase64(): string | null {
  if (_logoBase64 !== null) return _logoBase64;
  try {
    const svgPath = path.join(process.cwd(), "public", "databricks-icon.svg");
    const svgContent = fs.readFileSync(svgPath, "utf-8");
    _logoBase64 = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString("base64")}`;
    return _logoBase64;
  } catch {
    _logoBase64 = "";
    return null;
  }
}

// ---------------------------------------------------------------------------
// Slide helpers
// ---------------------------------------------------------------------------

export function addFooter(slide: PptxGenJS.Slide, variant: "light" | "dark" = "light"): void {
  const logo = getLogoBase64();
  if (logo) {
    slide.addImage({ data: logo, x: PPTX.CONTENT_MARGIN, y: 6.98, w: 0.25, h: 0.26 });
  }
  slide.addText(`Databricks Forge  |  ${today()}`, {
    x: PPTX.CONTENT_MARGIN + 0.35,
    y: 7.0,
    w: PPTX.CONTENT_W - 0.35,
    fontSize: 10,
    color: variant === "dark" ? PPTX.TEXT_LIGHT : PPTX.FOOTER_COLOR,
    align: "right",
  });
}

export function addAccentBar(
  slide: PptxGenJS.Slide,
  color: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  slide.addShape("rect", { x, y, w, h, fill: { color } });
}

export function addRedSeparator(slide: PptxGenJS.Slide, x: number, y: number, w: number): void {
  slide.addShape("rect", { x, y, w, h: 0.04, fill: { color: PPTX.DB_RED } });
}

export function addBrandShapes(slide: PptxGenJS.Slide): void {
  slide.addShape("ellipse", {
    x: 11.3,
    y: -0.3,
    w: 2.5,
    h: 2.5,
    fill: { color: PPTX.WHITE, transparency: 92 },
  });
  slide.addShape("ellipse", {
    x: -0.5,
    y: 5.8,
    w: 2.0,
    h: 2.0,
    fill: { color: PPTX.WHITE, transparency: 92 },
  });
  slide.addShape("ellipse", {
    x: 12.0,
    y: 6.5,
    w: 0.6,
    h: 0.6,
    fill: { color: PPTX.DB_RED, transparency: 50 },
  });
}

export function headerCell(text: string): PptxGenJS.TableCell {
  return {
    text,
    options: {
      bold: true,
      color: PPTX.WHITE,
      fill: { color: PPTX.DB_DARK },
      fontSize: 14,
      align: "left",
      valign: "middle",
    },
  };
}

export function bodyCell(
  text: string,
  opts?: Partial<PptxGenJS.TextPropsOptions>,
): PptxGenJS.TableCell {
  return {
    text,
    options: {
      fontSize: 12,
      color: PPTX.TEXT_COLOR,
      valign: "middle",
      ...opts,
    },
  };
}

// ---------------------------------------------------------------------------
// Common slide layouts
// ---------------------------------------------------------------------------

export function addTitleSlide(
  pptx: PptxGenJS,
  title: string,
  subtitle: string,
  context: string,
): void {
  const slide = pptx.addSlide();
  slide.background = { color: PPTX.DB_DARK };
  addBrandShapes(slide);

  const logo = getLogoBase64();
  if (logo) {
    slide.addImage({ data: logo, x: 0.6, y: 0.5, w: 0.55, h: 0.58 });
  }

  addRedSeparator(slide, 1.5, 1.3, 3.5);

  slide.addText("Databricks Forge", {
    x: 1.5,
    y: 1.6,
    w: 10,
    fontSize: 44,
    bold: true,
    color: PPTX.WHITE,
    fontFace: "Calibri",
  });

  slide.addText(title, {
    x: 1.5,
    y: 2.6,
    w: 10,
    fontSize: 24,
    color: PPTX.TEXT_LIGHT,
    fontFace: "Calibri",
  });

  addRedSeparator(slide, 1.5, 3.6, 2.5);

  slide.addText(context, {
    x: 1.5,
    y: 3.9,
    w: 10,
    fontSize: 32,
    bold: true,
    color: PPTX.DB_RED,
    fontFace: "Calibri",
  });

  slide.addText(subtitle, {
    x: 1.5,
    y: 5.2,
    w: 10,
    fontSize: 20,
    color: PPTX.TEXT_LIGHT,
    fontFace: "Calibri",
  });

  addFooter(slide, "dark");
}

export function addSectionSlide(
  pptx: PptxGenJS,
  heading: string,
  subtext?: string,
): PptxGenJS.Slide {
  const slide = pptx.addSlide();
  addAccentBar(slide, PPTX.DB_RED, 0, 0.8, 0.1, 3.0);

  slide.addText(heading, {
    x: PPTX.CONTENT_MARGIN,
    y: 0.3,
    w: PPTX.CONTENT_W,
    fontSize: 36,
    bold: true,
    color: PPTX.DB_DARK,
    fontFace: "Calibri",
  });

  addRedSeparator(slide, PPTX.CONTENT_MARGIN, 0.95, 4);

  if (subtext) {
    slide.addText(subtext, {
      x: PPTX.CONTENT_MARGIN,
      y: 1.1,
      w: PPTX.CONTENT_W,
      fontSize: 14,
      color: PPTX.MID_GRAY,
      fontFace: "Calibri",
    });
  }

  addFooter(slide);
  return slide;
}
