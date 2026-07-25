/**
 * Shared ExcelJS styling utilities for all Excel export generators.
 *
 * Extracted from lib/export/excel.ts to enable reuse across:
 *   - Run Excel (excel.ts)
 *   - Portfolio Excel (portfolio-excel.ts)
 *   - Environment Excel (environment-excel.ts)
 *   - Data Gap v2 Excel (data-gap-excel.ts)
 *   - Comparison Excel (comparison-excel.ts)
 */

import type ExcelJS from "exceljs";
import { EXCEL } from "./brand";

export function thinBorder(): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = {
    style: "thin",
    color: { argb: EXCEL.BORDER_COLOR },
  };
  return { top: side, bottom: side, left: side, right: side };
}

export function styleHeaderRow(sheet: ExcelJS.Worksheet): void {
  const headerRow = sheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: EXCEL.WHITE }, size: 11 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: EXCEL.DATABRICKS_BLUE },
    };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = thinBorder();
  });
}

export function styleDataRows(sheet: ExcelJS.Worksheet, startRow: number, endRow: number): void {
  for (let r = startRow; r <= endRow; r++) {
    const row = sheet.getRow(r);
    row.eachCell((cell) => {
      cell.border = thinBorder();
      cell.alignment = { ...cell.alignment, vertical: "top", wrapText: true };
      if (r % 2 === 0) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: EXCEL.LIGHT_GRAY_BG },
        };
      }
    });
  }
}

export function styleScoreCell(cell: ExcelJS.Cell, value: number): void {
  cell.numFmt = "0%";
  if (value >= 0.7) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL.GREEN_FILL } };
    cell.font = { bold: true, color: { argb: EXCEL.GREEN_FONT }, size: 10 };
  } else if (value >= 0.4) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL.AMBER_FILL } };
    cell.font = { bold: true, color: { argb: EXCEL.AMBER_FONT }, size: 10 };
  } else {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL.RED_FILL } };
    cell.font = { bold: true, color: { argb: EXCEL.RED_FONT }, size: 10 };
  }
  cell.alignment = { horizontal: "center", vertical: "middle" };
}
