import type { SqlExecutor } from "@/lib/ports/sql-executor";
import {
  evidenceFailed,
  evidencePassed,
  evidenceSkipped,
  type ValidationEvidence,
} from "@/lib/validation/evidence";
import { validateFqn, validateIdentifier } from "@/lib/validation";
import { quoteIdent } from "@/lib/genie/schema-allowlist";
import { parse as parseYaml } from "yaml";
import { parseMetricViewDdlEnvelope } from "./ddl-envelope";

export type ProbeKind =
  | "atomic_measure"
  | "categorical_group"
  | "temporal_group"
  | "complex_measure"
  | "joined_dimension";

export type ProbeDimensionClass = "categorical" | "date_like" | "calendar_integer";

export interface MetricViewProbeSpec {
  kind: ProbeKind;
  sql: string;
  expectedColumns: string[];
  expectedDimensionClass?: ProbeDimensionClass;
}

export interface TempMetricViewHandle {
  tempFqn: string;
  catalog: string;
  schema: string;
  tempName: string;
}

interface ProbeDimension {
  name: string;
  kind: "categorical" | "temporal";
  temporalType?: Extract<ProbeDimensionClass, "date_like" | "calendar_integer">;
  joined?: boolean;
}

interface ProbeMeasure {
  name: string;
  complex?: boolean;
}

export interface MetricViewProbeInputs {
  dimensions: ProbeDimension[];
  measures: ProbeMeasure[];
  hasJoins: boolean;
}

interface TempMetricViewCreateError extends Error {
  handle: TempMetricViewHandle;
}

const EXECUTE_TIMEOUT = {
  waitTimeout: "30s",
  submitTimeoutMs: 35_000,
} as const;

const PERMISSION_PATTERNS = [
  /\bpermission[\s_-]*denied\b/i,
  /\binsufficient[\s_-]*privileges?\b/i,
  /\baccess\s+denied\b/i,
  /\bdoes\s+not\s+have\s+(?:the\s+)?create(?:\s+view)?\b/i,
  /\bnot\s+authorized\b/i,
  /\bunauthorized\b/i,
];

const NUMERIC_TYPE_RE =
  /^(?:BYTE|SHORT|LONG|TINYINT|SMALLINT|INT|INTEGER|BIGINT|FLOAT|DOUBLE|REAL|DECIMAL|NUMERIC)(?:\b|\()/i;
const INTEGER_TYPE_RE = /^(?:BYTE|SHORT|LONG|TINYINT|SMALLINT|INT|INTEGER|BIGINT)\b/i;
const TEMPORAL_TYPE_RE = /^(?:DATE|TIMESTAMP(?:_NTZ|_LTZ)?)(?:\b|\()/i;
const CATEGORICAL_TYPE_RE =
  /^(?:STRING|CHAR|VARCHAR|BOOLEAN|BYTE|SHORT|LONG|TINYINT|SMALLINT|INT|INTEGER|BIGINT|FLOAT|DOUBLE|REAL|DECIMAL|NUMERIC|DATE|TIMESTAMP(?:_NTZ|_LTZ)?)(?:\b|\()/i;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPermissionError(error: unknown): boolean {
  const message = errorMessage(error);
  return PERMISSION_PATTERNS.some((pattern) => pattern.test(message));
}

function validateMetricIdentifier(name: string, label: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 255 || /[`;\r\n]/.test(trimmed)) {
    throw new Error(`${label} contains an unsafe identifier`);
  }

  if (trimmed.includes(" ")) {
    for (const part of trimmed.split(/\s+/)) {
      validateIdentifier(part, label);
    }
  } else {
    validateIdentifier(trimmed, label);
  }
  return trimmed;
}

function quotedMetricReference(name: string, label: string): string {
  return `\`${validateMetricIdentifier(name, label)}\``;
}

function executableFqn(fqn: string): string {
  return validateFqn(fqn, "temporary metric view")
    .split(".")
    .map(quoteIdent)
    .join(".");
}

function quotedUcIdentifier(name: string, label: string): string {
  return `\`${validateIdentifier(name, label)}\``;
}

function measureProjection(name: string): string {
  const safeName = validateMetricIdentifier(name, "metric measure");
  return `MEASURE(${quotedMetricReference(safeName, "metric measure")}) AS ${quoteIdent(safeName)}`;
}

function groupedProbe(
  kind: Extract<ProbeKind, "categorical_group" | "temporal_group" | "joined_dimension">,
  tempFqn: string,
  dimension: ProbeDimension,
  measure: ProbeMeasure,
): MetricViewProbeSpec {
  const dimensionName = validateMetricIdentifier(dimension.name, "metric dimension");
  const measureName = validateMetricIdentifier(measure.name, "metric measure");
  return {
    kind,
    sql: [
      `SELECT ${quotedMetricReference(dimensionName, "metric dimension")}, ${measureProjection(measureName)}`,
      `FROM ${tempFqn}`,
      "GROUP BY ALL",
      "LIMIT 10",
    ].join("\n"),
    expectedColumns: [dimensionName, measureName],
    expectedDimensionClass:
      dimension.kind === "temporal" ? (dimension.temporalType ?? "date_like") : "categorical",
  };
}

interface CurrentYamlEntry {
  name?: unknown;
  expr?: unknown;
  window?: unknown;
}

interface CurrentMetricViewYaml {
  joins?: unknown;
  dimensions?: unknown;
  measures?: unknown;
}

function currentYamlEntries(value: unknown): CurrentYamlEntry[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is CurrentYamlEntry => Boolean(entry && typeof entry === "object"))
    : [];
}

function temporalType(
  name: string,
  expression: string,
): Extract<ProbeDimensionClass, "date_like" | "calendar_integer"> | undefined {
  if (/\b(?:YEAR|QUARTER|MONTH|WEEK|DAY)\s*\(/i.test(expression)) {
    return "calendar_integer";
  }
  if (
    /\b(?:DATE_TRUNC|TIMESTAMP_TRUNC|TO_DATE|TO_TIMESTAMP)\s*\(/i.test(expression) ||
    /\bCAST\s*\([\s\S]*?\bAS\s+(?:DATE|TIMESTAMP(?:_NTZ|_LTZ)?)\b/i.test(expression) ||
    /(?:^|_)(?:date|time|day|week|month|quarter|year)(?:_|$)/i.test(name)
  ) {
    return "date_like";
  }
  return undefined;
}

function referencesJoinedAlias(expression: string): boolean {
  const aliasPattern = /(?:^|[^\w`])(?:`([^`]+)`|([a-zA-Z_][\w-]*))\s*\./g;
  let match: RegExpExecArray | null;
  while ((match = aliasPattern.exec(expression)) !== null) {
    const alias = (match[1] ?? match[2]).toLowerCase();
    if (alias !== "source") return true;
  }
  return false;
}

export function extractMetricViewProbeInputs(yaml: string): MetricViewProbeInputs {
  let parsed: CurrentMetricViewYaml;
  try {
    const value = parseYaml(yaml);
    parsed = value && typeof value === "object" ? (value as CurrentMetricViewYaml) : {};
  } catch {
    parsed = {};
  }
  const dimensions = currentYamlEntries(parsed.dimensions).map((entry) => {
    const name = String(entry.name ?? "");
    const expression = String(entry.expr ?? "");
    const detectedTemporalType = temporalType(name, expression);
    return {
      name,
      kind: detectedTemporalType ? ("temporal" as const) : ("categorical" as const),
      joined: referencesJoinedAlias(expression),
      ...(detectedTemporalType ? { temporalType: detectedTemporalType } : {}),
    };
  });
  const measures = currentYamlEntries(parsed.measures).map((entry) => {
    const expression = String(entry.expr ?? "");
    return {
      name: String(entry.name ?? ""),
      complex:
        /\/|\bFILTER\s*\(|\bMEASURE\s*\(/i.test(expression) || entry.window !== undefined,
    };
  });

  return {
    dimensions,
    measures,
    hasJoins: Array.isArray(parsed.joins) && parsed.joins.length > 0,
  };
}

export function buildMetricViewProbes(input: {
  tempFqn: string;
  dimensions: ProbeDimension[];
  measures: ProbeMeasure[];
  hasJoins: boolean;
}): MetricViewProbeSpec[] {
  if (input.measures.length === 0) return [];

  const tempFqn = executableFqn(input.tempFqn);
  const atomicMeasure = input.measures.find((measure) => !measure.complex) ?? input.measures[0];
  const atomicName = validateMetricIdentifier(atomicMeasure.name, "metric measure");
  const probes: MetricViewProbeSpec[] = [
    {
      kind: "atomic_measure",
      sql: [`SELECT ${measureProjection(atomicName)}`, `FROM ${tempFqn}`].join("\n"),
      expectedColumns: [atomicName],
    },
  ];

  const categorical =
    input.dimensions.find((dimension) => dimension.kind === "categorical" && !dimension.joined) ??
    input.dimensions.find((dimension) => dimension.kind === "categorical");
  if (categorical) {
    probes.push(groupedProbe("categorical_group", tempFqn, categorical, atomicMeasure));
  }

  const temporal = input.dimensions.find((dimension) => dimension.kind === "temporal");
  if (temporal) {
    probes.push(groupedProbe("temporal_group", tempFqn, temporal, atomicMeasure));
  }

  const complexMeasure = input.measures.find((measure) => measure.complex);
  if (complexMeasure) {
    const complexName = validateMetricIdentifier(complexMeasure.name, "metric measure");
    probes.push({
      kind: "complex_measure",
      sql: [`SELECT ${measureProjection(complexName)}`, `FROM ${tempFqn}`].join("\n"),
      expectedColumns: [complexName],
    });
  }

  const joinedDimension = input.hasJoins
    ? input.dimensions.find((dimension) => dimension.joined)
    : undefined;
  if (joinedDimension) {
    probes.push(groupedProbe("joined_dimension", tempFqn, joinedDimension, atomicMeasure));
  }

  return probes;
}

function probeCode(kind: ProbeKind, suffix: string): string {
  return `${kind.toUpperCase()}_PROBE_${suffix}`;
}

export async function runMetricViewProbes(
  probes: MetricViewProbeSpec[],
  sqlExecutor: SqlExecutor,
): Promise<{ ok: boolean; evidence: ValidationEvidence[] }> {
  const evidence: ValidationEvidence[] = [];

  for (const probe of probes) {
    const startedAt = performance.now();
    try {
      const result = await sqlExecutor.execute(probe.sql, undefined, undefined, EXECUTE_TIMEOUT);
      const durationMs = performance.now() - startedAt;
      const columnsByName = new Map(
        result.columns.map((column) => [column.name.toLowerCase(), column]),
      );
      const missingColumns = probe.expectedColumns.filter(
        (column) => !columnsByName.has(column.toLowerCase()),
      );
      const measureName = probe.expectedColumns.at(-1);
      const measureColumn = measureName ? columnsByName.get(measureName.toLowerCase()) : undefined;
      const measureTypeValid = measureColumn ? NUMERIC_TYPE_RE.test(measureColumn.typeName) : false;
      const dimensionName = probe.expectedColumns.length > 1 ? probe.expectedColumns[0] : undefined;
      const dimensionColumn = dimensionName
        ? columnsByName.get(dimensionName.toLowerCase())
        : undefined;
      const dimensionTypeValid = !dimensionColumn
        ? true
        : probe.expectedDimensionClass === "date_like"
          ? TEMPORAL_TYPE_RE.test(dimensionColumn.typeName)
          : probe.expectedDimensionClass === "calendar_integer"
            ? INTEGER_TYPE_RE.test(dimensionColumn.typeName)
            : CATEGORICAL_TYPE_RE.test(dimensionColumn.typeName);
      const observedSchema = result.columns.map((column) => ({
        name: column.name,
        dataType: column.typeName,
      }));

      if (missingColumns.length > 0 || !measureTypeValid || !dimensionTypeValid) {
        const reason =
          missingColumns.length > 0
            ? `missing expected columns: ${missingColumns.join(", ")}`
            : !dimensionTypeValid
              ? `${probe.expectedDimensionClass ?? "categorical"} dimension column "${dimensionName}" has incompatible type ${dimensionColumn?.typeName ?? "unknown"}`
              : `measure column "${measureName}" has non-numeric type ${measureColumn?.typeName ?? "unknown"}`;
        evidence.push(
          evidenceFailed(
            "metric_view_probe",
            probeCode(probe.kind, "SCHEMA_MISMATCH"),
            `Metric view ${probe.kind} probe returned an incompatible schema (${reason}).`,
            {
              durationMs,
              observedSchema,
              observedRowCount: result.totalRowCount,
            },
          ),
        );
      } else {
        evidence.push(
          evidencePassed(
            "metric_view_probe",
            probeCode(probe.kind, "PASSED"),
            `Metric view ${probe.kind} probe executed with the expected schema.`,
            {
              durationMs,
              observedSchema,
              observedRowCount: result.totalRowCount,
            },
          ),
        );
      }
    } catch (error) {
      evidence.push(
        evidenceFailed(
          "metric_view_probe",
          probeCode(probe.kind, "EXECUTION_FAILED"),
          `Metric view ${probe.kind} probe failed: ${errorMessage(error)}`,
          { durationMs: performance.now() - startedAt },
        ),
      );
    }
  }

  return {
    ok: probes.length > 0 && evidence.every((entry) => entry.status === "passed"),
    evidence,
  };
}

function prepareTempMetricView(ddl: string, resourcePrefix: string): {
  handle: TempMetricViewHandle;
  tempDdl: string;
} {
  const envelope = parseMetricViewDdlEnvelope(ddl);
  const originalFqn = envelope.targetFqn;
  const [catalog, schema] = originalFqn.split(".");
  const prefix = validateIdentifier(resourcePrefix || "forge_", "temporary resource prefix");
  const tempName = `__${prefix}validate_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  validateIdentifier(tempName, "temporary metric view name");
  const quotedTempFqn = [catalog, schema, tempName]
    .map((part) => quotedUcIdentifier(part, "temporary metric view identifier"))
    .join(".");
  const handle = {
    tempFqn: `${catalog}.${schema}.${tempName}`,
    catalog,
    schema,
    tempName,
  };
  const tempDdl =
    ddl.slice(0, envelope.targetStart) + quotedTempFqn + ddl.slice(envelope.targetEnd);
  return { handle, tempDdl };
}

export async function createTempMetricView(
  ddl: string,
  resourcePrefix: string,
  sqlExecutor: SqlExecutor,
): Promise<TempMetricViewHandle> {
  const { handle, tempDdl } = prepareTempMetricView(ddl, resourcePrefix);
  try {
    await sqlExecutor.execute(tempDdl, undefined, undefined, EXECUTE_TIMEOUT);
    return handle;
  } catch (error) {
    const wrapped = new Error(errorMessage(error)) as TempMetricViewCreateError;
    wrapped.name = "TempMetricViewCreateError";
    wrapped.handle = handle;
    throw wrapped;
  }
}

export async function dropTempMetricView(
  handle: TempMetricViewHandle,
  sqlExecutor: SqlExecutor,
): Promise<void> {
  const fqn = [handle.catalog, handle.schema, handle.tempName]
    .map((part) => quotedUcIdentifier(part, "temporary metric view identifier"))
    .join(".");
  await sqlExecutor.execute(
    `DROP VIEW IF EXISTS ${fqn}`,
    undefined,
    undefined,
    EXECUTE_TIMEOUT,
  );
}

export async function dryRunMetricViewDdlWithProbes(input: {
  ddl: string;
  resourcePrefix?: string;
  dimensions: ProbeDimension[];
  measures: ProbeMeasure[];
  hasJoins: boolean;
  sqlExecutor: SqlExecutor;
}): Promise<{ ok: boolean; unverified: boolean; evidence: ValidationEvidence[] }> {
  const evidence: ValidationEvidence[] = [];
  let handle: TempMetricViewHandle | undefined;
  let probesOk = false;
  let unverified = false;
  const createStartedAt = performance.now();

  try {
    handle = await createTempMetricView(
      input.ddl,
      input.resourcePrefix ?? "forge_",
      input.sqlExecutor,
    );
    evidence.push(
      evidencePassed(
        "metric_view_create",
        "TEMP_METRIC_VIEW_CREATED",
        "Temporary metric view created successfully.",
        {
          durationMs: performance.now() - createStartedAt,
          artifactRef: handle.tempFqn,
        },
      ),
    );

    const probes = buildMetricViewProbes({
      tempFqn: handle.tempFqn,
      dimensions: input.dimensions,
      measures: input.measures,
      hasJoins: input.hasJoins,
    });
    const probeResult = await runMetricViewProbes(probes, input.sqlExecutor);
    probesOk = probeResult.ok;
    evidence.push(...probeResult.evidence);
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "TempMetricViewCreateError" &&
      "handle" in error
    ) {
      handle = (error as TempMetricViewCreateError).handle;
    }
    unverified = isPermissionError(error);
    evidence.push(
      unverified
        ? evidenceSkipped(
            "metric_view_create",
            "TEMP_METRIC_VIEW_PERMISSION_UNVERIFIED",
            `Temporary metric view creation could not be verified because CREATE VIEW permission is missing: ${errorMessage(error)}`,
            {
              durationMs: performance.now() - createStartedAt,
              artifactRef: handle?.tempFqn,
            },
          )
        : evidenceFailed(
            "metric_view_create",
            "TEMP_METRIC_VIEW_CREATE_FAILED",
            `Temporary metric view creation failed: ${errorMessage(error)}`,
            {
              durationMs: performance.now() - createStartedAt,
              artifactRef: handle?.tempFqn,
            },
          ),
    );
  } finally {
    if (handle) {
      const cleanupStartedAt = performance.now();
      try {
        await dropTempMetricView(handle, input.sqlExecutor);
        evidence.push(
          evidencePassed(
            "metric_view_cleanup",
            "TEMP_METRIC_VIEW_DROPPED",
            "Temporary metric view dropped successfully.",
            {
              durationMs: performance.now() - cleanupStartedAt,
              artifactRef: handle.tempFqn,
            },
          ),
        );
      } catch (error) {
        evidence.push(
          evidenceFailed(
            "metric_view_cleanup",
            "TEMP_METRIC_VIEW_CLEANUP_FAILED",
            `Temporary metric view cleanup failed: ${errorMessage(error)}`,
            {
              durationMs: performance.now() - cleanupStartedAt,
              artifactRef: handle.tempFqn,
            },
          ),
        );
      }
    }
  }

  return {
    ok: probesOk && evidence.every((entry) => entry.status === "passed"),
    unverified,
    evidence,
  };
}
