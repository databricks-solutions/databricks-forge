/**
 * PBI name → UC identifier normalizer.
 *
 * Power BI names can contain spaces, mixed case, and special characters.
 * UC identifiers must be lowercase, underscore-separated, and start with
 * a letter or underscore.
 */

export interface NameMapping {
  original: string;
  normalized: string;
  source: "table" | "column" | "measure";
}

/**
 * Normalize a PBI name to a UC-safe identifier.
 *
 * Examples:
 *   "Total Amount"    → "total_amount"
 *   "DW_Revenues"     → "dw_revenues"
 *   "Order ID"        → "order_id"
 *   "P&L Summary"     → "p_l_summary"
 *   "123_start"       → "_123_start"
 *   ""                → "_unnamed"
 */
export function normalizeIdentifier(name: string): string {
  if (!name.trim()) return "_unnamed";

  let result = name
    .replace(/&/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();

  if (!result) return "_unnamed";
  if (/^[0-9]/.test(result)) result = `_${result}`;

  return result;
}

/**
 * Normalize a table name, ensuring uniqueness within a set.
 */
export function normalizeTableName(name: string, existingNames: Set<string>): string {
  const base = normalizeIdentifier(name);
  let result = base;
  let suffix = 2;
  while (existingNames.has(result)) {
    result = `${base}_${suffix}`;
    suffix++;
  }
  return result;
}

/**
 * Build a complete name mapping for a PBI dataset.
 */
export function buildNameMapping(
  tables: Array<{
    name: string;
    columns: Array<{ name: string }>;
    measures: Array<{ name: string }>;
  }>,
): NameMapping[] {
  const mappings: NameMapping[] = [];
  const usedTableNames = new Set<string>();

  for (const table of tables) {
    const normalizedTable = normalizeTableName(table.name, usedTableNames);
    usedTableNames.add(normalizedTable);
    mappings.push({ original: table.name, normalized: normalizedTable, source: "table" });

    const usedColumnNames = new Set<string>();
    for (const col of table.columns) {
      let normalizedCol = normalizeIdentifier(col.name);
      let suffix = 2;
      const base = normalizedCol;
      while (usedColumnNames.has(normalizedCol)) {
        normalizedCol = `${base}_${suffix}`;
        suffix++;
      }
      usedColumnNames.add(normalizedCol);
      mappings.push({
        original: `${table.name}.${col.name}`,
        normalized: `${normalizedTable}.${normalizedCol}`,
        source: "column",
      });
    }

    for (const m of table.measures) {
      mappings.push({
        original: `${table.name}.[${m.name}]`,
        normalized: normalizeIdentifier(m.name),
        source: "measure",
      });
    }
  }

  return mappings;
}
