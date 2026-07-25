import type { SqlExecutor } from "@/lib/ports/sql-executor";
import { evidenceFailed, evidencePassed } from "@/lib/validation/evidence";
import type { DatasetPurpose } from "./types";
import type { DatasetResultContract, DatasetResultExpectation } from "./result-contract";
import { validateDatasetResult } from "./result-contract";
import {
  formatSqlExecutorDiagnostic,
  safeSqlExecutorDiagnostic,
  type SafeSqlExecutorDiagnostic,
} from "./executor-diagnostic";

export type DatasetExecutionResult = DatasetResultContract & {
  repairDiagnostic?: SafeSqlExecutorDiagnostic;
};

interface SqlShape {
  safeToRewrite: boolean;
  hasTopLevelLimit: boolean;
  hasTopLevelOffset: boolean;
  hasTopLevelPipe: boolean;
}

function inspectSqlShape(sql: string): SqlShape {
  let depth = 0;
  let state: "normal" | "single" | "double" | "backtick" | "line-comment" | "block-comment" =
    "normal";
  let word = "";
  const topLevelWords: string[] = [];
  let hasTopLevelPipe = false;

  const finishWord = () => {
    if (word && depth === 0) topLevelWords.push(word.toLowerCase());
    word = "";
  };

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (state === "line-comment") {
      if (char === "\n") state = "normal";
      continue;
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        state = "normal";
        index += 1;
      }
      continue;
    }
    if (state !== "normal") {
      const delimiter = state === "single" ? "'" : state === "double" ? '"' : "`";
      if (char === delimiter) {
        if (next === delimiter) {
          index += 1;
        } else {
          state = "normal";
        }
      }
      continue;
    }

    if (char === "-" && next === "-") {
      finishWord();
      state = "line-comment";
      index += 1;
    } else if (char === "/" && next === "*") {
      finishWord();
      state = "block-comment";
      index += 1;
    } else if (char === "'" || char === '"' || char === "`") {
      finishWord();
      state = char === "'" ? "single" : char === '"' ? "double" : "backtick";
    } else if (char === "(") {
      finishWord();
      depth += 1;
    } else if (char === ")") {
      finishWord();
      depth -= 1;
      if (depth < 0) {
        return {
          safeToRewrite: false,
          hasTopLevelLimit: false,
          hasTopLevelOffset: false,
          hasTopLevelPipe: false,
        };
      }
    } else if (char === "|" && next === ">") {
      finishWord();
      if (depth === 0) hasTopLevelPipe = true;
      index += 1;
    } else if (/[A-Za-z0-9_]/.test(char)) {
      word += char;
    } else {
      finishWord();
    }
  }
  finishWord();

  const closedState = state === "normal" || state === "line-comment";
  const startsAsQuery = topLevelWords[0] === "select" || topLevelWords[0] === "with";
  return {
    safeToRewrite: closedState && depth === 0 && startsAsQuery,
    hasTopLevelLimit: topLevelWords.includes("limit"),
    hasTopLevelOffset: topLevelWords.includes("offset"),
    hasTopLevelPipe,
  };
}

export function maybeApplyBoundLimit(
  sql: string,
  purpose: DatasetPurpose,
  boundLimit = 1000,
): string {
  if (purpose !== "detail" || !Number.isSafeInteger(boundLimit) || boundLimit <= 0) return sql;

  const trimmedEnd = sql.trimEnd();
  const hasTerminator = trimmedEnd.endsWith(";");
  const statement = hasTerminator ? trimmedEnd.slice(0, -1).trimEnd() : trimmedEnd;
  if (statement.includes(";")) return sql;

  const shape = inspectSqlShape(statement);
  if (
    !shape.safeToRewrite ||
    shape.hasTopLevelLimit ||
    shape.hasTopLevelOffset ||
    shape.hasTopLevelPipe
  ) {
    return sql;
  }

  const suffix = hasTerminator ? ";" : "";
  return `${statement}\nLIMIT ${boundLimit}${suffix}`;
}

export async function executeAndValidateDataset(options: {
  sql: string;
  datasetName: string;
  purpose: DatasetPurpose;
  expectation: DatasetResultExpectation;
  sqlExecutor: SqlExecutor;
  boundLimit?: number;
}): Promise<DatasetExecutionResult> {
  const { datasetName, purpose, expectation, sqlExecutor } = options;
  if (expectation.datasetName !== datasetName || expectation.purpose !== purpose) {
    return {
      datasetName,
      ok: false,
      evidence: [
        evidenceFailed(
          "dataset_execution",
          "EXPECTATION_MISMATCH",
          `Dataset "${datasetName}" execution options do not match its result expectation.`,
        ),
      ],
      observedSchema: [],
      observedRowCount: 0,
    };
  }

  const executableSql = maybeApplyBoundLimit(options.sql, purpose, options.boundLimit ?? 1000);
  const startedAt = performance.now();

  try {
    const result = await sqlExecutor.execute(executableSql);
    const durationMs = performance.now() - startedAt;
    const contract = validateDatasetResult(expectation, result);
    const executionEvidence = evidencePassed(
      "dataset_execution",
      "SQL_EXECUTION_SUCCEEDED",
      `Dataset "${datasetName}" executed successfully.`,
      {
        durationMs,
        observedSchema: contract.observedSchema,
        observedRowCount: contract.observedRowCount,
      },
    );
    return {
      ...contract,
      evidence: [executionEvidence, ...contract.evidence.map((item) => ({ ...item, durationMs }))],
    };
  } catch (error) {
    const durationMs = performance.now() - startedAt;
    const diagnostic = safeSqlExecutorDiagnostic(error);
    return {
      datasetName,
      ok: false,
      evidence: [
        evidenceFailed(
          "dataset_execution",
          "SQL_EXECUTION_FAILED",
          `Dataset "${datasetName}" execution failed: ${formatSqlExecutorDiagnostic(diagnostic)}`,
          { durationMs },
        ),
      ],
      observedSchema: [],
      observedRowCount: 0,
      repairDiagnostic: diagnostic,
    };
  }
}
