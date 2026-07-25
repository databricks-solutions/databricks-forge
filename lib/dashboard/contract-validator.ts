import type { ValidationEvidence } from "@/lib/validation/evidence";
import {
  DASHBOARD_VALIDATOR_VERSION,
  evidenceFailed,
  evidencePassed,
} from "@/lib/validation/evidence";
import type { LakeviewPosition, LakeviewWidget, SerializedLakeviewDashboard } from "./types";
import { getWidgetVersion, isSupportedWidgetType } from "./widget-registry";
import { classifyWidgetExpression } from "./expressions";

export type DashboardContractErrorCode =
  | "PAGE_NAME_DUPLICATE"
  | "LAYOUT_VERSION_MISSING"
  | "LAYOUT_VERSION_INVALID"
  | "WIDGET_ID_INVALID"
  | "WIDGET_ID_DUPLICATE"
  | "WIDGET_VERSION_MISMATCH"
  | "DATASET_MISSING"
  | "FIELD_ENCODING_MISMATCH"
  | "FILTER_QUERY_NAME_INVALID"
  | "GRID_BOUNDS"
  | "GRID_OVERLAP"
  | "FRAME_REQUIRED"
  | "COUNTER_DISAGGREGATION"
  | "CHART_SCALE_TYPE"
  | "TEXT_INVALID_SPEC"
  | "PARAM_FILTER_MISMATCH";

export interface DashboardContractError {
  path: string;
  code: DashboardContractErrorCode;
  message: string;
  suggestedFix?: string;
}

export interface DashboardContractResult {
  valid: boolean;
  errors: DashboardContractError[];
  evidence: ValidationEvidence[];
}

const GRID_COLUMNS = 12;
const WIDGET_ID_PATTERN = /^[a-z0-9_-]{1,60}$/;
const ENCODING_KEYS = ["value", "x", "y", "color", "angle", "columns"] as const;
const SCALE_TYPES = new Set(["temporal", "quantitative", "categorical"]);
const FILTER_TYPES = new Set([
  "filter-multi-select",
  "filter-single-select",
  "filter-date-range-picker",
]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectFieldNames(value: unknown, names: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectFieldNames(item, names);
    return;
  }
  if (!isRecord(value)) return;

  if (typeof value.fieldName === "string") names.add(value.fieldName);
  for (const nested of Object.values(value)) collectFieldNames(nested, names);
}

function encodedFieldNames(encodings: unknown): Set<string> {
  const names = new Set<string>();
  if (!isRecord(encodings)) return names;
  for (const key of ENCODING_KEYS) collectFieldNames(encodings[key], names);
  return names;
}

function hasSameFieldNames(actual: Set<string>, expected: Set<string>): boolean {
  return actual.size === expected.size && [...actual].every((fieldName) => expected.has(fieldName));
}

function filterEncodingFieldsByQuery(encodings: unknown): Map<string, Set<string>> {
  const fieldsByQuery = new Map<string, Set<string>>();
  if (!isRecord(encodings) || !Array.isArray(encodings.fields)) return fieldsByQuery;

  for (const field of encodings.fields) {
    if (
      !isRecord(field) ||
      typeof field.queryName !== "string" ||
      typeof field.fieldName !== "string"
    ) {
      continue;
    }
    const fields = fieldsByQuery.get(field.queryName) ?? new Set<string>();
    fields.add(field.fieldName);
    fieldsByQuery.set(field.queryName, fields);
  }

  return fieldsByQuery;
}

function validateQueryEncodingFields(
  widget: LakeviewWidget["widget"],
  path: string,
  addError: (error: DashboardContractError) => void,
): void {
  const spec = widget.spec;
  if (!spec) return;

  const filterFieldsByQuery = FILTER_TYPES.has(spec.widgetType)
    ? filterEncodingFieldsByQuery(spec.encodings)
    : null;
  const encodedFields = filterFieldsByQuery ? null : encodedFieldNames(spec.encodings);

  for (const [queryIndex, query] of (widget.queries ?? []).entries()) {
    const actualFields = new Set(query.query.fields.map((field) => field.name));
    const expectedFields =
      filterFieldsByQuery?.get(query.name) ?? encodedFields ?? new Set<string>();
    if (hasSameFieldNames(actualFields, expectedFields)) continue;

    addError({
      path: `${path}.queries[${queryIndex}].query.fields`,
      code: filterFieldsByQuery ? "PARAM_FILTER_MISMATCH" : "FIELD_ENCODING_MISMATCH",
      message: filterFieldsByQuery
        ? `Filter query "${query.name}" fields must exactly match its encoding fields.`
        : `Query "${query.name}" fields must exactly match the widget encoding fields.`,
      suggestedFix: "Use the same field names in each query and its corresponding widget encoding.",
    });
  }
}

function hasValidTextWidgetSpec(value: unknown): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.lines) &&
    value.lines.length > 0 &&
    value.lines.every((line) => typeof line === "string") &&
    value.lines.some((line) => (line as string).trim().length > 0)
  );
}

function rectanglesOverlap(left: LakeviewPosition, right: LakeviewPosition): boolean {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  );
}

function hasValidPosition(position: LakeviewPosition): boolean {
  return (
    Number.isInteger(position.x) &&
    Number.isInteger(position.y) &&
    Number.isInteger(position.width) &&
    Number.isInteger(position.height) &&
    position.x >= 0 &&
    position.y >= 0 &&
    position.width > 0 &&
    position.height > 0 &&
    position.x + position.width <= GRID_COLUMNS
  );
}

function validateScaleTypes(
  encodings: unknown,
  path: string,
  addError: (error: DashboardContractError) => void,
): void {
  if (!isRecord(encodings)) return;

  for (const key of ["x", "y", "color", "angle"] as const) {
    const encoding = encodings[key];
    if (!isRecord(encoding) || !isRecord(encoding.scale)) continue;
    const scaleType = encoding.scale.type;
    const roleMismatch =
      (key === "color" && scaleType !== "categorical") ||
      (key === "angle" && scaleType !== "quantitative");
    if (typeof scaleType !== "string" || !SCALE_TYPES.has(scaleType) || roleMismatch) {
      addError({
        path: `${path}.encodings.${key}.scale.type`,
        code: "CHART_SCALE_TYPE",
        message: `Encoding "${key}" has an invalid scale type.`,
        suggestedFix:
          key === "color"
            ? 'Use scale type "categorical".'
            : key === "angle"
              ? 'Use scale type "quantitative".'
              : "Use a supported Lakeview scale type.",
      });
    }
  }
}

function validateTemporalExpressionScale(
  widget: LakeviewWidget["widget"],
  path: string,
  addError: (error: DashboardContractError) => void,
): void {
  const encodings = widget.spec?.encodings;
  if (!isRecord(encodings)) return;
  const xEncoding = encodings.x;
  if (
    !isRecord(xEncoding) ||
    typeof xEncoding.fieldName !== "string" ||
    !isRecord(xEncoding.scale) ||
    typeof xEncoding.scale.type !== "string"
  ) {
    return;
  }
  const xField = (widget.queries ?? [])
    .flatMap((query) => query.query.fields)
    .find((field) => field.name === xEncoding.fieldName);
  if (classifyWidgetExpression(xField?.expression ?? "")?.kind !== "date_trunc") return;
  if (xEncoding.scale.type === "temporal" || !SCALE_TYPES.has(xEncoding.scale.type)) return;

  addError({
    path: `${path}.encodings.x.scale.type`,
    code: "CHART_SCALE_TYPE",
    message: "DATE_TRUNC x-axis expressions require a temporal scale.",
    suggestedFix: 'Set the x-axis scale type to "temporal".',
  });
}

function validateFilterBindings(
  widget: LakeviewWidget["widget"],
  path: string,
  addError: (error: DashboardContractError) => void,
): void {
  const spec = widget.spec;
  if (!spec || !FILTER_TYPES.has(spec.widgetType) || !isRecord(spec.encodings)) return;

  const fields = spec.encodings.fields;
  if (!Array.isArray(fields)) return;
  const queriesByName = new Map((widget.queries ?? []).map((query) => [query.name, query]));

  fields.forEach((field, fieldIndex) => {
    if (!isRecord(field)) return;
    const queryName = field.queryName;
    const fieldName = field.fieldName;
    const fieldPath = `${path}.spec.encodings.fields[${fieldIndex}]`;
    if (typeof queryName !== "string" || !queriesByName.has(queryName)) {
      addError({
        path: `${fieldPath}.queryName`,
        code: "FILTER_QUERY_NAME_INVALID",
        message: `Filter query "${String(queryName)}" does not exist on the widget.`,
        suggestedFix: "Bind the filter encoding to an existing widget query name.",
      });
      return;
    }

    const queryFields = new Set(
      queriesByName.get(queryName)!.query.fields.map((item) => item.name),
    );
    if (typeof fieldName !== "string" || !queryFields.has(fieldName)) {
      addError({
        path: `${fieldPath}.fieldName`,
        code: "PARAM_FILTER_MISMATCH",
        message: `Filter field "${String(fieldName)}" is not exposed by query "${queryName}".`,
        suggestedFix: "Use the same field name in the filter encoding and its bound query.",
      });
    }
  });
}

export function validateSerializedDashboard(
  dashboard: SerializedLakeviewDashboard,
): DashboardContractResult {
  const errors: DashboardContractError[] = [];
  const addError = (error: DashboardContractError) => errors.push(error);
  const datasetNames = new Set(dashboard.datasets.map((dataset) => dataset.name));
  const pageNames = new Set<string>();
  const widgetNames = new Set<string>();
  const filteredDatasetNames = new Set(
    dashboard.pages.flatMap((page) =>
      page.layout.flatMap((item) =>
        item.widget.spec && FILTER_TYPES.has(item.widget.spec.widgetType)
          ? (item.widget.queries ?? []).map((query) => query.query.datasetName)
          : [],
      ),
    ),
  );

  dashboard.pages.forEach((page, pageIndex) => {
    const pagePath = `pages[${pageIndex}]`;
    if (pageNames.has(page.name)) {
      addError({
        path: `${pagePath}.name`,
        code: "PAGE_NAME_DUPLICATE",
        message: `Page name "${page.name}" is duplicated.`,
        suggestedFix: "Assign a unique name to every page.",
      });
    }
    pageNames.add(page.name);

    const layoutVersion = (page as unknown as { layoutVersion?: unknown }).layoutVersion;
    if (layoutVersion === undefined || layoutVersion === null || layoutVersion === "") {
      addError({
        path: `${pagePath}.layoutVersion`,
        code: "LAYOUT_VERSION_MISSING",
        message: 'Dashboard pages require layoutVersion "GRID_V1".',
        suggestedFix: 'Set layoutVersion to "GRID_V1".',
      });
    } else if (layoutVersion !== "GRID_V1") {
      addError({
        path: `${pagePath}.layoutVersion`,
        code: "LAYOUT_VERSION_INVALID",
        message: `Unsupported layout version "${String(layoutVersion)}".`,
        suggestedFix: 'Set layoutVersion to "GRID_V1".',
      });
    }

    page.layout.forEach((layoutItem, widgetIndex) => {
      const widgetPath = `${pagePath}.layout[${widgetIndex}].widget`;
      const widget = layoutItem.widget;
      if (!WIDGET_ID_PATTERN.test(widget.name)) {
        addError({
          path: `${widgetPath}.name`,
          code: "WIDGET_ID_INVALID",
          message: `Widget identifier "${widget.name}" is invalid.`,
          suggestedFix: "Use 1-60 lowercase letters, digits, underscores, or hyphens.",
        });
      }
      if (widgetNames.has(widget.name)) {
        addError({
          path: `${widgetPath}.name`,
          code: "WIDGET_ID_DUPLICATE",
          message: `Widget identifier "${widget.name}" is duplicated.`,
          suggestedFix: "Assign a unique identifier to every widget.",
        });
      }
      widgetNames.add(widget.name);

      if (!hasValidPosition(layoutItem.position)) {
        addError({
          path: `${pagePath}.layout[${widgetIndex}].position`,
          code: "GRID_BOUNDS",
          message: "Widget position must fit within the 12-column GRID_V1 layout.",
          suggestedFix: "Use non-negative integer coordinates and keep x + width at or below 12.",
        });
      }

      const isTextWidget = widget.multilineTextboxSpec !== undefined;
      if (
        isTextWidget &&
        (widget.spec !== undefined || !hasValidTextWidgetSpec(widget.multilineTextboxSpec))
      ) {
        addError({
          path: `${widgetPath}.multilineTextboxSpec`,
          code: "TEXT_INVALID_SPEC",
          message: "Text widgets require non-empty text lines and must not contain a spec.",
          suggestedFix: "Provide non-empty multilineTextboxSpec lines and remove spec.",
        });
      }

      if (!isTextWidget) {
        const spec = widget.spec;
        const expectedVersion = spec ? getWidgetVersion(spec.widgetType) : null;
        if (
          !spec ||
          !isSupportedWidgetType(spec.widgetType) ||
          expectedVersion === null ||
          spec.version !== expectedVersion
        ) {
          addError({
            path: `${widgetPath}.spec`,
            code: "WIDGET_VERSION_MISMATCH",
            message: spec
              ? `Widget "${spec.widgetType}" must use registered version ${String(expectedVersion)}.`
              : "Non-text widgets require a registered widget spec.",
            suggestedFix: "Use the widget type and version from WIDGET_REGISTRY.",
          });
        }

        if (
          spec &&
          (!isRecord(spec.frame) ||
            typeof spec.frame.showTitle !== "boolean" ||
            typeof spec.frame.title !== "string" ||
            spec.frame.title.trim().length === 0)
        ) {
          addError({
            path: `${widgetPath}.spec.frame`,
            code: "FRAME_REQUIRED",
            message: "Non-text widget specs require showTitle and a non-empty frame title.",
            suggestedFix: "Set frame.showTitle to a boolean and provide a non-empty frame.title.",
          });
        }

        for (const [queryIndex, query] of (widget.queries ?? []).entries()) {
          if (!datasetNames.has(query.query.datasetName)) {
            addError({
              path: `${widgetPath}.queries[${queryIndex}].query.datasetName`,
              code: "DATASET_MISSING",
              message: `Dataset "${query.query.datasetName}" does not exist.`,
              suggestedFix: "Reference a dataset declared in dashboard.datasets.",
            });
          }
          if (
            spec?.widgetType === "counter" &&
            query.query.disaggregated === filteredDatasetNames.has(query.query.datasetName)
          ) {
            addError({
              path: `${widgetPath}.queries[${queryIndex}].query.disaggregated`,
              code: "COUNTER_DISAGGREGATION",
              message: filteredDatasetNames.has(query.query.datasetName)
                ? "Counters on filtered datasets must remain aggregated."
                : "Counters on unfiltered datasets must use a disaggregated query.",
              suggestedFix: `Set disaggregated to ${String(
                !filteredDatasetNames.has(query.query.datasetName),
              )}.`,
            });
          }
        }

        if (spec) {
          validateQueryEncodingFields(widget, widgetPath, addError);
          validateScaleTypes(spec.encodings, `${widgetPath}.spec`, addError);
          validateTemporalExpressionScale(widget, `${widgetPath}.spec`, addError);
        }
        validateFilterBindings(widget, widgetPath, addError);
      }
    });

    for (let left = 0; left < page.layout.length; left += 1) {
      for (let right = left + 1; right < page.layout.length; right += 1) {
        if (rectanglesOverlap(page.layout[left].position, page.layout[right].position)) {
          addError({
            path: `${pagePath}.layout[${right}].position`,
            code: "GRID_OVERLAP",
            message: `Widgets "${page.layout[left].widget.name}" and "${page.layout[right].widget.name}" overlap.`,
            suggestedFix: "Move or resize widgets so their x and y intervals do not overlap.",
          });
        }
      }
    }
  });

  const valid = errors.length === 0;
  const evidence = [
    valid
      ? evidencePassed(
          "dashboard_contract",
          DASHBOARD_VALIDATOR_VERSION,
          "Serialized dashboard satisfies the dashboard contract.",
        )
      : evidenceFailed(
          "dashboard_contract",
          DASHBOARD_VALIDATOR_VERSION,
          `Serialized dashboard failed contract validation with ${errors.length} error(s).`,
        ),
  ];

  return { valid, errors, evidence };
}
