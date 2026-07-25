import type {
  DashboardDesignV2,
  DashboardFieldType,
  DatasetFieldExpectation,
  FilterDesignV2,
  WidgetDesignV2,
} from "./design-ir";
import type { DashboardDesign, DatasetPurpose, FieldRole, WidgetDesign, WidgetType } from "./types";
import { classifyWidgetExpression } from "./expressions";

const VISUALIZATION_TYPES = new Set<WidgetType>(["counter", "bar", "line", "pie", "table"]);
const FILTER_TYPES = new Set<WidgetType>([
  "filter-multi-select",
  "filter-single-select",
  "filter-date-range-picker",
]);

export interface LegacyDashboardDesignAdapterIssue {
  code:
    | "LEGACY_WIDGET_TYPE_UNSUPPORTED"
    | "LEGACY_FILTER_FIELD_MISMATCH"
    | "LEGACY_FILTER_FIELD_MISSING"
    | "LEGACY_FILTER_FIELD_AMBIGUOUS"
    | "LEGACY_FILTER_EXPRESSION_EMPTY";
  path: string;
  message: string;
}

export class LegacyDashboardDesignAdapterError extends Error {
  readonly issues: LegacyDashboardDesignAdapterIssue[];

  constructor(issues: LegacyDashboardDesignAdapterIssue[]) {
    super(issues.map((issue) => issue.message).join("; "));
    this.name = "LegacyDashboardDesignAdapterError";
    this.issues = issues;
  }
}

function compatibleTypes(
  role: FieldRole,
  purpose: DatasetPurpose,
  widgetType: WidgetType,
): DashboardFieldType[] {
  if (role === "value" || role === "y") return ["numeric"];
  if (role === "x" && purpose === "trend") return ["temporal"];
  if (role === "filter") {
    return widgetType === "filter-date-range-picker" ? ["temporal"] : ["categorical"];
  }
  if (role === "x" || role === "color") return ["categorical"];
  return ["numeric", "temporal", "categorical", "binary", "array", "map", "struct", "variant"];
}

function filterFromWidget(
  widget: WidgetDesign,
  widgetIndex: number,
  issues: LegacyDashboardDesignAdapterIssue[],
): FilterDesignV2 | null {
  let fieldIndex = -1;
  if (widget.filterField !== undefined) {
    fieldIndex = widget.fields.findIndex((field) => field.name === widget.filterField);
    if (fieldIndex === -1) {
      issues.push({
        code: "LEGACY_FILTER_FIELD_MISMATCH",
        path: `widgets[${widgetIndex}].filterField`,
        message: `Legacy filter "${widget.title}" references unknown filterField "${widget.filterField}"`,
      });
      return null;
    }
  } else {
    const filterRoleIndexes = widget.fields
      .map((field, index) => ({ field, index }))
      .filter(({ field }) => field.role === "filter")
      .map(({ index }) => index);
    if (filterRoleIndexes.length === 0) {
      issues.push({
        code: "LEGACY_FILTER_FIELD_MISSING",
        path: `widgets[${widgetIndex}].fields`,
        message: `Legacy filter "${widget.title}" has no filter-role field`,
      });
      return null;
    }
    if (filterRoleIndexes.length > 1) {
      issues.push({
        code: "LEGACY_FILTER_FIELD_AMBIGUOUS",
        path: `widgets[${widgetIndex}].fields`,
        message: `Legacy filter "${widget.title}" has multiple filter-role fields`,
      });
      return null;
    }
    fieldIndex = filterRoleIndexes[0];
  }

  const filterField = widget.fields[fieldIndex];
  if (!filterField.expression.trim()) {
    issues.push({
      code: "LEGACY_FILTER_EXPRESSION_EMPTY",
      path: `widgets[${widgetIndex}].fields[${fieldIndex}].expression`,
      message: `Legacy filter "${widget.title}" has an empty filter expression`,
    });
    return null;
  }

  return {
    type: widget.type as FilterDesignV2["type"],
    title: widget.title,
    field: filterField.name,
    bindings: [
      {
        datasetName: widget.datasetName,
        fieldName: filterField.name,
        expression: filterField.expression,
      },
    ],
  };
}

function expectedFieldsForDataset(
  datasetName: string,
  purpose: DatasetPurpose,
  widgets: WidgetDesign[],
): DatasetFieldExpectation[] {
  const byName = new Map<string, DatasetFieldExpectation>();
  for (const widget of widgets) {
    if (widget.datasetName !== datasetName) continue;
    for (const field of widget.fields) {
      const expectedName =
        classifyWidgetExpression(field.expression)?.sourceIdentifier ?? field.name;
      const current = byName.get(expectedName);
      const types = compatibleTypes(field.role, purpose, widget.type);
      if (!current) {
        byName.set(expectedName, {
          name: expectedName,
          roles: [field.role],
          compatibleTypes: types,
        });
        continue;
      }
      if (!current.roles.includes(field.role)) current.roles.push(field.role);
      for (const type of types) {
        if (!current.compatibleTypes.includes(type)) current.compatibleTypes.push(type);
      }
    }
  }
  return [...byName.values()];
}

export function adaptLegacyDashboardDesign(legacy: DashboardDesign): DashboardDesignV2 {
  const issues: LegacyDashboardDesignAdapterIssue[] = [];
  for (const [index, widget] of legacy.widgets.entries()) {
    if (!VISUALIZATION_TYPES.has(widget.type) && !FILTER_TYPES.has(widget.type)) {
      issues.push({
        code: "LEGACY_WIDGET_TYPE_UNSUPPORTED",
        path: `widgets[${index}]`,
        message: `Unsupported legacy widget type "${String(widget.type)}" at widgets[${index}]`,
      });
    }
  }
  const widgets = legacy.widgets.filter((widget) =>
    VISUALIZATION_TYPES.has(widget.type),
  ) as WidgetDesignV2[];
  const globalFilters = legacy.widgets
    .map((widget, index) =>
      FILTER_TYPES.has(widget.type) ? filterFromWidget(widget, index, issues) : null,
    )
    .filter((filter): filter is FilterDesignV2 => filter !== null);
  if (issues.length > 0) throw new LegacyDashboardDesignAdapterError(issues);

  return {
    version: "2",
    title: legacy.title,
    description: legacy.description,
    pages: [
      {
        name: "overview",
        displayName: legacy.title,
        widgets,
        filters: [],
      },
    ],
    datasets: legacy.datasets.map((dataset) => ({
      name: dataset.name,
      displayName: dataset.displayName,
      purpose: dataset.purpose,
      sourceKind: "table",
      metricIds: dataset.measureIds ?? [],
      dimensionIds: dataset.dimensionIds ?? [],
      sql: dataset.sql,
      expectedFields: expectedFieldsForDataset(dataset.name, dataset.purpose, legacy.widgets),
    })),
    globalFilters,
  };
}
