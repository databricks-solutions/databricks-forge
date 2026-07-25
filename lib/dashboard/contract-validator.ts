import type { ValidationEvidence } from "@/lib/validation/evidence";
import {
  DASHBOARD_VALIDATOR_VERSION,
  evidenceFailed,
  evidencePassed,
} from "@/lib/validation/evidence";
import type { LakeviewPosition, LakeviewWidget, SerializedLakeviewDashboard } from "./types";
import { getWidgetVersion, isSupportedWidgetType } from "./widget-registry";
import { classifyWidgetExpression } from "./expressions";

export type DashboardContractValidationMode =
  | { mode: "forge-assembled" }
  | { mode: "imported-lakeview" };

export type DashboardContractErrorCode =
  | "DASHBOARD_INVALID"
  | "DASHBOARD_DATASETS_INVALID"
  | "DASHBOARD_PAGES_INVALID"
  | "DATASET_INVALID"
  | "PAGE_INVALID"
  | "PAGE_LAYOUT_INVALID"
  | "LAYOUT_ITEM_INVALID"
  | "WIDGET_INVALID"
  | "QUERY_INVALID"
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
type DashboardContractMode = DashboardContractValidationMode["mode"];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function queryFields(query: unknown): UnknownRecord[] {
  if (!isRecord(query) || !isRecord(query.query) || !Array.isArray(query.query.fields)) return [];
  return query.query.fields.filter(isRecord);
}

function queryParameters(query: unknown): UnknownRecord[] {
  if (!isRecord(query) || !isRecord(query.query) || !Array.isArray(query.query.parameters)) {
    return [];
  }
  return query.query.parameters.filter(isRecord);
}

function parameterNames(parameters: UnknownRecord[], key: "name" | "keyword"): Set<string> {
  const names = new Set<string>();
  for (const parameter of parameters) {
    if (typeof parameter[key] === "string") names.add(parameter[key]);
  }
  return names;
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
    const actualFields = new Set(
      queryFields(query)
        .map((field) => field.name)
        .filter((name): name is string => typeof name === "string"),
    );
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

function validateImportedQueryParameters(
  widget: LakeviewWidget["widget"],
  path: string,
  datasetParameters: Map<string, Set<string>>,
  addError: (error: DashboardContractError) => void,
): void {
  for (const [queryIndex, query] of (widget.queries ?? []).entries()) {
    const parameters = queryParameters(query);
    if (parameters.length === 0) continue;
    const declaredNames = datasetParameters.get(query.query.datasetName) ?? new Set<string>();

    parameters.forEach((parameter, parameterIndex) => {
      const keyword = parameter.keyword;
      if (typeof keyword === "string" && declaredNames.has(keyword)) return;
      addError({
        path: `${path}.queries[${queryIndex}].query.parameters[${parameterIndex}]`,
        code: "PARAM_FILTER_MISMATCH",
        message: `Query parameter keyword "${String(keyword)}" is not declared by dataset "${query.query.datasetName}".`,
        suggestedFix: "Bind query parameters to a parameter declared on the referenced dataset.",
      });
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

function hasValidPosition(position: unknown): position is LakeviewPosition {
  if (!isRecord(position)) return false;
  const { x, y, width, height } = position;
  return (
    typeof x === "number" &&
    typeof y === "number" &&
    typeof width === "number" &&
    typeof height === "number" &&
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    x >= 0 &&
    y >= 0 &&
    width > 0 &&
    height > 0 &&
    x + width <= GRID_COLUMNS
  );
}

function isImportedParameterFilter(widget: UnknownRecord): boolean {
  const spec = widget.spec;
  if (
    !isRecord(spec) ||
    typeof spec.widgetType !== "string" ||
    !FILTER_TYPES.has(spec.widgetType) ||
    !isRecord(spec.encodings) ||
    !Array.isArray(spec.encodings.fields) ||
    spec.encodings.fields.length === 0 ||
    !spec.encodings.fields.every(
      (field) =>
        isRecord(field) &&
        typeof field.parameterName === "string" &&
        typeof field.queryName === "string",
    ) ||
    !Array.isArray(widget.queries) ||
    widget.queries.length === 0
  ) {
    return false;
  }

  const queries = widget.queries.filter(
    (query): query is UnknownRecord =>
      isRecord(query) &&
      typeof query.name === "string" &&
      isRecord(query.query) &&
      query.query.fields === undefined &&
      Array.isArray(query.query.parameters) &&
      query.query.parameters.length > 0,
  );
  if (queries.length !== widget.queries.length) return false;

  const queriesByName = new Map(queries.map((query) => [query.name as string, query]));
  return spec.encodings.fields.every((field) => {
    if (
      !isRecord(field) ||
      typeof field.queryName !== "string" ||
      typeof field.parameterName !== "string"
    ) {
      return false;
    }
    const query = queriesByName.get(field.queryName);
    return (
      query !== undefined && parameterNames(queryParameters(query), "name").has(field.parameterName)
    );
  });
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
    .flatMap((query) => queryFields(query))
    .find((field) => field.name === xEncoding.fieldName);
  const expression = typeof xField?.expression === "string" ? xField.expression : "";
  if (classifyWidgetExpression(expression)?.kind !== "date_trunc") return;
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
  mode: DashboardContractMode,
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

    const boundQuery = queriesByName.get(queryName)!;
    const boundQueryFields = new Set(
      queryFields(boundQuery)
        .map((item) => item.name)
        .filter((name): name is string => typeof name === "string"),
    );
    const parameterName = field.parameterName;
    if (mode === "imported-lakeview" && typeof parameterName === "string") {
      const boundParameters = parameterNames(queryParameters(boundQuery), "name");
      if (boundParameters.has(parameterName)) return;
      addError({
        path: `${fieldPath}.parameterName`,
        code: "PARAM_FILTER_MISMATCH",
        message: `Filter parameter "${parameterName}" is not exposed by query "${queryName}".`,
        suggestedFix: "Use the same parameter name in the filter encoding and its bound query.",
      });
      return;
    }
    if (typeof fieldName !== "string" || !boundQueryFields.has(fieldName)) {
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
  validation: DashboardContractValidationMode = { mode: "forge-assembled" },
): DashboardContractResult {
  const errors: DashboardContractError[] = [];
  const addError = (error: DashboardContractError) => errors.push(error);
  const root = isRecord(dashboard) ? dashboard : null;
  if (!root) {
    addError({
      path: "$",
      code: "DASHBOARD_INVALID",
      message: "Serialized dashboard must be an object.",
      suggestedFix: "Provide a serialized Lakeview dashboard object.",
    });
  }

  const datasetValues = root?.datasets;
  if (!Array.isArray(datasetValues)) {
    addError({
      path: "datasets",
      code: "DASHBOARD_DATASETS_INVALID",
      message: "Serialized dashboard datasets must be an array.",
      suggestedFix: "Provide a datasets array, even when it is empty.",
    });
  }
  const datasets = Array.isArray(datasetValues) ? datasetValues : [];
  const datasetNames = new Set<string>();
  const datasetParameters = new Map<string, Set<string>>();
  datasets.forEach((dataset, datasetIndex) => {
    if (!isRecord(dataset) || typeof dataset.name !== "string") {
      addError({
        path: `datasets[${datasetIndex}]`,
        code: "DATASET_INVALID",
        message: "Dashboard datasets require a string name.",
        suggestedFix: "Provide a valid Lakeview dataset object with a string name.",
      });
      return;
    }
    datasetNames.add(dataset.name);
    datasetParameters.set(
      dataset.name,
      parameterNames(
        Array.isArray(dataset.parameters) ? dataset.parameters.filter(isRecord) : [],
        "keyword",
      ),
    );
  });

  const pageValues = root?.pages;
  if (!Array.isArray(pageValues)) {
    addError({
      path: "pages",
      code: "DASHBOARD_PAGES_INVALID",
      message: "Serialized dashboard pages must be an array.",
      suggestedFix: "Provide a pages array, even when it is empty.",
    });
  }
  const pages = Array.isArray(pageValues) ? pageValues : [];
  const pageNames = new Set<string>();
  const widgetNames = new Set<string>();
  const filteredDatasetNames = new Set<string>();
  for (const page of pages) {
    if (!isRecord(page) || !Array.isArray(page.layout)) continue;
    for (const item of page.layout) {
      if (!isRecord(item) || !isRecord(item.widget) || !isRecord(item.widget.spec)) continue;
      if (
        typeof item.widget.spec.widgetType !== "string" ||
        !FILTER_TYPES.has(item.widget.spec.widgetType) ||
        !Array.isArray(item.widget.queries)
      ) {
        continue;
      }
      for (const query of item.widget.queries) {
        if (
          isRecord(query) &&
          isRecord(query.query) &&
          typeof query.query.datasetName === "string"
        ) {
          filteredDatasetNames.add(query.query.datasetName);
        }
      }
    }
  }

  pages.forEach((pageValue, pageIndex) => {
    const pagePath = `pages[${pageIndex}]`;
    if (!isRecord(pageValue)) {
      addError({
        path: pagePath,
        code: "PAGE_INVALID",
        message: "Dashboard pages must be objects.",
        suggestedFix: "Provide a valid Lakeview page object.",
      });
      return;
    }
    const page = pageValue;
    if (typeof page.name !== "string") {
      addError({
        path: `${pagePath}.name`,
        code: "PAGE_INVALID",
        message: "Dashboard pages require a string name.",
        suggestedFix: "Provide a unique string page name.",
      });
    } else if (pageNames.has(page.name)) {
      addError({
        path: `${pagePath}.name`,
        code: "PAGE_NAME_DUPLICATE",
        message: `Page name "${page.name}" is duplicated.`,
        suggestedFix: "Assign a unique name to every page.",
      });
    } else {
      pageNames.add(page.name);
    }

    const layoutVersion: unknown = page.layoutVersion;
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

    if (!Array.isArray(page.layout)) {
      addError({
        path: `${pagePath}.layout`,
        code: "PAGE_LAYOUT_INVALID",
        message: "Dashboard page layout must be an array.",
        suggestedFix: "Provide a layout array, even when it is empty.",
      });
      return;
    }

    const overlapCandidates: Array<{
      widgetIndex: number;
      position: LakeviewPosition;
      widgetName: string;
    }> = [];
    page.layout.forEach((layoutValue, widgetIndex) => {
      const widgetPath = `${pagePath}.layout[${widgetIndex}].widget`;
      if (!isRecord(layoutValue)) {
        addError({
          path: `${pagePath}.layout[${widgetIndex}]`,
          code: "LAYOUT_ITEM_INVALID",
          message: "Dashboard layout items must be objects.",
          suggestedFix: "Provide a widget and position for every layout item.",
        });
        return;
      }
      const layoutItem = layoutValue;
      if (!isRecord(layoutItem.widget)) {
        addError({
          path: widgetPath,
          code: "WIDGET_INVALID",
          message: "Dashboard layout items require a widget object.",
          suggestedFix: "Provide a valid Lakeview widget object.",
        });
        return;
      }
      const widget = layoutItem.widget;
      const widgetName = typeof widget.name === "string" ? widget.name : String(widget.name);
      if (typeof widget.name !== "string" || !WIDGET_ID_PATTERN.test(widget.name)) {
        addError({
          path: `${widgetPath}.name`,
          code: "WIDGET_ID_INVALID",
          message: `Widget identifier "${widgetName}" is invalid.`,
          suggestedFix: "Use 1-60 lowercase letters, digits, underscores, or hyphens.",
        });
      }
      if (typeof widget.name === "string" && widgetNames.has(widget.name)) {
        addError({
          path: `${widgetPath}.name`,
          code: "WIDGET_ID_DUPLICATE",
          message: `Widget identifier "${widget.name}" is duplicated.`,
          suggestedFix: "Assign a unique identifier to every widget.",
        });
      }
      if (typeof widget.name === "string") widgetNames.add(widget.name);

      if (!hasValidPosition(layoutItem.position)) {
        addError({
          path: `${pagePath}.layout[${widgetIndex}].position`,
          code: "GRID_BOUNDS",
          message: "Widget position must fit within the 12-column GRID_V1 layout.",
          suggestedFix: "Use non-negative integer coordinates and keep x + width at or below 12.",
        });
      } else {
        overlapCandidates.push({
          widgetIndex,
          position: layoutItem.position,
          widgetName,
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
        const spec = isRecord(widget.spec) ? widget.spec : null;
        const expectedVersion =
          spec && typeof spec.widgetType === "string" ? getWidgetVersion(spec.widgetType) : null;
        if (
          !spec ||
          typeof spec.widgetType !== "string" ||
          !isSupportedWidgetType(spec.widgetType) ||
          expectedVersion === null ||
          spec.version !== expectedVersion
        ) {
          addError({
            path: `${widgetPath}.spec`,
            code: "WIDGET_VERSION_MISMATCH",
            message:
              spec && typeof spec.widgetType === "string"
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

        const queryValues =
          widget.queries === undefined ? [] : Array.isArray(widget.queries) ? widget.queries : null;
        if (queryValues === null) {
          addError({
            path: `${widgetPath}.queries`,
            code: "QUERY_INVALID",
            message: "Widget queries must be an array.",
            suggestedFix: "Provide a valid array of Lakeview widget queries.",
          });
        }
        const validQueries: UnknownRecord[] = [];
        for (const [queryIndex, queryValue] of (queryValues ?? []).entries()) {
          if (!isRecord(queryValue) || !isRecord(queryValue.query)) {
            addError({
              path: `${widgetPath}.queries[${queryIndex}].query`,
              code: "QUERY_INVALID",
              message: "Widget queries require a query object.",
              suggestedFix: "Provide a datasetName and a fields or parameters binding.",
            });
            continue;
          }
          const query = queryValue;
          const queryBody = query.query;
          validQueries.push(query);
          if (
            typeof queryBody.datasetName !== "string" ||
            !datasetNames.has(queryBody.datasetName)
          ) {
            addError({
              path: `${widgetPath}.queries[${queryIndex}].query.datasetName`,
              code: "DATASET_MISSING",
              message: `Dataset "${String(queryBody.datasetName)}" does not exist.`,
              suggestedFix: "Reference a dataset declared in dashboard.datasets.",
            });
          }
          if (
            validation.mode === "forge-assembled" &&
            spec?.widgetType === "counter" &&
            queryBody.disaggregated === filteredDatasetNames.has(String(queryBody.datasetName))
          ) {
            addError({
              path: `${widgetPath}.queries[${queryIndex}].query.disaggregated`,
              code: "COUNTER_DISAGGREGATION",
              message: filteredDatasetNames.has(String(queryBody.datasetName))
                ? "Counters on filtered datasets must remain aggregated."
                : "Counters on unfiltered datasets must use a disaggregated query.",
              suggestedFix: `Set disaggregated to ${String(
                !filteredDatasetNames.has(String(queryBody.datasetName)),
              )}.`,
            });
          }
        }

        const validatedWidget = {
          ...widget,
          queries: validQueries,
        } as unknown as LakeviewWidget["widget"];
        const importedParameterFilter =
          validation.mode === "imported-lakeview" && isImportedParameterFilter(widget);
        if (spec) {
          if (importedParameterFilter) {
            validateImportedQueryParameters(
              validatedWidget,
              widgetPath,
              datasetParameters,
              addError,
            );
          } else {
            validateQueryEncodingFields(validatedWidget, widgetPath, addError);
          }
          validateScaleTypes(spec.encodings, `${widgetPath}.spec`, addError);
          validateTemporalExpressionScale(validatedWidget, `${widgetPath}.spec`, addError);
        }
        validateFilterBindings(
          validatedWidget,
          widgetPath,
          importedParameterFilter ? "imported-lakeview" : "forge-assembled",
          addError,
        );
      }
    });

    for (let left = 0; left < overlapCandidates.length; left += 1) {
      for (let right = left + 1; right < overlapCandidates.length; right += 1) {
        if (
          rectanglesOverlap(overlapCandidates[left].position, overlapCandidates[right].position)
        ) {
          addError({
            path: `${pagePath}.layout[${overlapCandidates[right].widgetIndex}].position`,
            code: "GRID_OVERLAP",
            message: `Widgets "${overlapCandidates[left].widgetName}" and "${overlapCandidates[right].widgetName}" overlap.`,
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
