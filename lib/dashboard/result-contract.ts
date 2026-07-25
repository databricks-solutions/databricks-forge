import type { SqlResult } from "@/lib/ports/sql-executor";
import type { ValidationEvidence } from "@/lib/validation/evidence";
import { evidenceFailed, evidencePassed } from "@/lib/validation/evidence";
import type { DatasetPurpose, FieldRole } from "./types";

export interface ExpectedColumn {
  name: string;
  role: FieldRole | "alias";
  compatibleTypes: string[];
}

export interface DatasetResultExpectation {
  datasetName: string;
  purpose: DatasetPurpose;
  expectedColumns: ExpectedColumn[];
  requireSingleRow?: boolean;
  maxRowCount?: number;
}

export interface DatasetResultContract {
  datasetName: string;
  ok: boolean;
  evidence: ValidationEvidence[];
  observedSchema: Array<{ name: string; dataType: string }>;
  observedRowCount: number;
}

const NUMERIC_TYPES = new Set([
  "bigint",
  "byteint",
  "decimal",
  "double",
  "float",
  "int",
  "integer",
  "long",
  "numeric",
  "real",
  "short",
  "smallint",
  "tinyint",
]);
const TEMPORAL_TYPES = new Set(["date", "interval", "timestamp", "timestamp_ltz", "timestamp_ntz"]);
const CATEGORICAL_TYPES = new Set(["boolean", "char", "string", "varchar"]);

function baseType(dataType: string): string {
  return dataType
    .trim()
    .toLowerCase()
    .replace(/\s*\(.*/, "");
}

function compatibilityClass(dataType: string): string {
  const normalized = baseType(dataType);
  if (NUMERIC_TYPES.has(normalized)) return "numeric";
  if (TEMPORAL_TYPES.has(normalized)) return "temporal";
  if (CATEGORICAL_TYPES.has(normalized)) return "categorical";
  return normalized;
}

function isCompatible(actualType: string, compatibleTypes: string[]): boolean {
  const actualBaseType = baseType(actualType);
  const actualClass = compatibilityClass(actualType);
  return compatibleTypes.some((expectedType) => {
    const expectedBaseType = baseType(expectedType);
    return expectedBaseType === actualBaseType || expectedBaseType === actualClass;
  });
}

export function validateDatasetResult(
  expectation: DatasetResultExpectation,
  result: SqlResult,
): DatasetResultContract {
  const observedSchema = result.columns.map((column) => ({
    name: column.name,
    dataType: column.typeName,
  }));
  const evidence: ValidationEvidence[] = [];
  const normalizedColumnNames = result.columns.map((column) => column.name.trim().toLowerCase());
  const seenColumnNames = new Set<string>();
  const duplicateColumnNames = new Set<string>();
  for (const normalizedName of normalizedColumnNames) {
    if (seenColumnNames.has(normalizedName)) duplicateColumnNames.add(normalizedName);
    seenColumnNames.add(normalizedName);
  }
  for (const duplicateName of duplicateColumnNames) {
    evidence.push(
      evidenceFailed(
        "dataset_result",
        "ALIAS_DUPLICATE",
        `Dataset "${expectation.datasetName}" returned duplicate normalized alias "${duplicateName}".`,
        { observedSchema, observedRowCount: result.totalRowCount },
      ),
    );
  }
  if (evidence.length > 0) {
    return {
      datasetName: expectation.datasetName,
      ok: false,
      evidence,
      observedSchema,
      observedRowCount: result.totalRowCount,
    };
  }
  const columnsByName = new Map(
    result.columns.map((column, index) => [normalizedColumnNames[index], column]),
  );

  for (const expectedColumn of expectation.expectedColumns) {
    const observedColumn = columnsByName.get(expectedColumn.name.trim().toLowerCase());
    if (!observedColumn) {
      evidence.push(
        evidenceFailed(
          "dataset_result",
          "ALIAS_MISSING",
          `Dataset "${expectation.datasetName}" did not return alias "${expectedColumn.name}".`,
          { observedSchema, observedRowCount: result.totalRowCount },
        ),
      );
      continue;
    }
    if (!isCompatible(observedColumn.typeName, expectedColumn.compatibleTypes)) {
      evidence.push(
        evidenceFailed(
          "dataset_result",
          "TYPE_INCOMPATIBLE",
          `Alias "${expectedColumn.name}" returned incompatible type "${observedColumn.typeName}".`,
          { observedSchema, observedRowCount: result.totalRowCount },
        ),
      );
    }
  }

  const rowCountMetadataValid =
    Number.isSafeInteger(result.totalRowCount) && result.totalRowCount >= 0;
  const rowCountInvalid =
    !rowCountMetadataValid ||
    (expectation.requireSingleRow === true && result.totalRowCount !== 1) ||
    (expectation.maxRowCount !== undefined && result.totalRowCount > expectation.maxRowCount);
  if (rowCountInvalid) {
    evidence.push(
      evidenceFailed(
        "dataset_result",
        "ROW_COUNT_INVALID",
        rowCountMetadataValid
          ? `Dataset "${expectation.datasetName}" returned ${result.totalRowCount} row(s), outside its contract.`
          : `Dataset "${expectation.datasetName}" returned invalid totalRowCount metadata; expected a non-negative safe integer.`,
        { observedSchema, observedRowCount: result.totalRowCount },
      ),
    );
  }

  const ok = evidence.length === 0;
  if (ok) {
    evidence.push(
      evidencePassed(
        "dataset_result",
        "RESULT_CONTRACT_VALID",
        `Dataset "${expectation.datasetName}" satisfies its result contract.`,
        { observedSchema, observedRowCount: result.totalRowCount },
      ),
    );
  }

  return {
    datasetName: expectation.datasetName,
    ok,
    evidence,
    observedSchema,
    observedRowCount: result.totalRowCount,
  };
}
