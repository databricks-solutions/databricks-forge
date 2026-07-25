/**
 * Power BI data type → Databricks Spark SQL type mapping.
 *
 * PBI types come from the XMLA/TOM model (Int64, Double, String, etc.).
 * Spark SQL types target Delta table DDL.
 */

const PBI_TO_SPARK: Record<string, string> = {
  int64: "BIGINT",
  int32: "INT",
  int16: "SMALLINT",
  double: "DOUBLE",
  single: "FLOAT",
  decimal: "DECIMAL(38, 10)",
  currency: "DECIMAL(19, 4)",
  string: "STRING",
  boolean: "BOOLEAN",
  datetime: "TIMESTAMP",
  datetimeoffset: "TIMESTAMP",
  date: "DATE",
  time: "STRING",
  binary: "BINARY",
  variant: "STRING",
  unknown: "STRING",
};

export function mapPbiTypeToSpark(pbiType: string): string {
  return PBI_TO_SPARK[pbiType.toLowerCase()] ?? "STRING";
}

/**
 * Returns all known PBI types for reference/display.
 */
export function getAllTypeMappings(): Array<{ pbi: string; spark: string }> {
  return Object.entries(PBI_TO_SPARK).map(([pbi, spark]) => ({ pbi, spark }));
}
