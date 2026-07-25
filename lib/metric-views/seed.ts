/**
 * Lightweight measure/dimension builder for standalone metric view generation.
 *
 * Produces minimal seeds from metadata alone (no Genie engine dependency):
 * - Numeric columns -> SUM, AVG, COUNT DISTINCT measures
 * - Date/timestamp columns -> DATE_TRUNC dimensions
 * - String columns -> categorical dimensions
 */

import type { MetadataSnapshot, ColumnInfo } from "@/lib/domain/types";
import type {
  EnrichedSqlSnippetMeasure,
  EnrichedSqlSnippetDimension,
  ColumnEnrichment,
  LightweightSeedResult,
} from "./types";

const NUMERIC_TYPES = new Set([
  "int",
  "integer",
  "bigint",
  "smallint",
  "tinyint",
  "float",
  "double",
  "decimal",
  "numeric",
  "long",
]);

const DATE_TYPES = new Set(["date", "timestamp", "timestamp_ntz", "datetime"]);

const STRING_TYPES = new Set(["string", "varchar", "char", "text"]);

function isNumeric(col: ColumnInfo): boolean {
  const t = (col.dataType ?? "").toLowerCase().split("(")[0].trim();
  return NUMERIC_TYPES.has(t);
}

function isDate(col: ColumnInfo): boolean {
  const t = (col.dataType ?? "").toLowerCase().split("(")[0].trim();
  return DATE_TYPES.has(t);
}

function isString(col: ColumnInfo): boolean {
  const t = (col.dataType ?? "").toLowerCase().split("(")[0].trim();
  return STRING_TYPES.has(t);
}

function toSnakeCase(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

const ID_SUFFIXES = ["_id", "_key", "_pk", "_fk", "_sk", "_uuid"];

function looksLikeId(col: ColumnInfo): boolean {
  const lower = col.columnName.toLowerCase();
  return ID_SUFFIXES.some((s) => lower.endsWith(s));
}

/**
 * Build minimal measures, dimensions, and enrichments from metadata for a
 * set of tables. Designed for standalone metric view generation where the
 * full Genie engine semantic-expressions pass is not available.
 */
export function buildLightweightSeed(
  tableFqns: string[],
  metadata: MetadataSnapshot,
): LightweightSeedResult {
  const measures: EnrichedSqlSnippetMeasure[] = [];
  const dimensions: EnrichedSqlSnippetDimension[] = [];
  const columnEnrichments: ColumnEnrichment[] = [];

  const tableSet = new Set(tableFqns.map((t) => t.toLowerCase()));

  const relevantColumns = metadata.columns.filter((col) =>
    tableSet.has(col.tableFqn.toLowerCase()),
  );

  for (const col of relevantColumns) {
    if (col.comment) {
      columnEnrichments.push({
        tableFqn: col.tableFqn,
        columnName: col.columnName,
        description: col.comment,
        synonyms: [],
        hidden: false,
        entityMatchingCandidate: false,
      });
    }

    if (looksLikeId(col)) continue;

    const colSnake = toSnakeCase(col.columnName);

    if (isNumeric(col)) {
      measures.push({
        name: `total_${colSnake}`,
        sql: `SUM(${col.columnName})`,
        synonyms: [],
        instructions: "",
      });
      measures.push({
        name: `avg_${colSnake}`,
        sql: `AVG(${col.columnName})`,
        synonyms: [],
        instructions: "",
      });
    } else if (isDate(col)) {
      dimensions.push({
        name: `${colSnake}_month`,
        sql: `DATE_TRUNC('MONTH', ${col.columnName})`,
        synonyms: [],
        instructions: "",
        isTimePeriod: true,
      });
      dimensions.push({
        name: `${colSnake}_year`,
        sql: `YEAR(${col.columnName})`,
        synonyms: [],
        instructions: "",
        isTimePeriod: true,
      });
    } else if (isString(col)) {
      dimensions.push({
        name: colSnake,
        sql: col.columnName,
        synonyms: [],
        instructions: "",
        isTimePeriod: false,
      });
    }
  }

  if (tableFqns.length > 0) {
    measures.push({
      name: "row_count",
      sql: "COUNT(1)",
      synonyms: [],
      instructions: "",
    });
  }

  return { measures, dimensions, columnEnrichments };
}
