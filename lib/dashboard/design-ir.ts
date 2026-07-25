import type { DatasetPurpose, FieldRole, WidgetFieldDesign, WidgetType } from "./types";

export type DashboardDatasetSourceKind = "metric_view" | "semantic_expression" | "table";
export type DashboardFieldType =
  | "numeric"
  | "temporal"
  | "categorical"
  | "binary"
  | "array"
  | "map"
  | "struct"
  | "variant";
export type DashboardVisualizationType = Exclude<WidgetType, `filter-${string}`>;
export type DashboardFilterType = Extract<WidgetType, `filter-${string}`>;

export interface DatasetFieldExpectation {
  name: string;
  roles: FieldRole[];
  compatibleTypes: DashboardFieldType[];
}

export interface DatasetDesignV2 {
  name: string;
  displayName: string;
  purpose: DatasetPurpose;
  sourceKind: DashboardDatasetSourceKind;
  metricViewFqn?: string;
  metricIds: string[];
  dimensionIds: string[];
  sql: string;
  expectedFields: DatasetFieldExpectation[];
}

export interface WidgetDesignV2 {
  type: DashboardVisualizationType;
  title: string;
  datasetName: string;
  fields: WidgetFieldDesign[];
}

export interface FilterBindingDesignV2 {
  datasetName: string;
  fieldName: string;
  expression: string;
}

export interface FilterDesignV2 {
  type: DashboardFilterType;
  title: string;
  field: string;
  bindings: FilterBindingDesignV2[];
}

export interface DashboardPageDesignV2 {
  name: string;
  displayName: string;
  description?: string;
  widgets: WidgetDesignV2[];
  filters: FilterDesignV2[];
}

export interface DashboardDesignV2 {
  version: "2";
  title: string;
  description: string;
  pages: DashboardPageDesignV2[];
  datasets: DatasetDesignV2[];
  globalFilters: FilterDesignV2[];
}

export interface DashboardDesignV2ValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface DashboardDesignV2ValidationResult {
  valid: boolean;
  issues: DashboardDesignV2ValidationIssue[];
}

export class DashboardDesignV2ValidationError extends Error {
  readonly issues: DashboardDesignV2ValidationIssue[];

  constructor(issues: DashboardDesignV2ValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "DashboardDesignV2ValidationError";
    this.issues = issues;
  }
}

const PURPOSES = new Set<DatasetPurpose>(["kpi", "trend", "breakdown", "detail"]);
const SOURCE_KINDS = new Set<DashboardDatasetSourceKind>([
  "metric_view",
  "semantic_expression",
  "table",
]);
const FIELD_ROLES = new Set<FieldRole>(["x", "y", "value", "color", "column", "filter"]);
const FIELD_TYPES = new Set<DashboardFieldType>([
  "numeric",
  "temporal",
  "categorical",
  "binary",
  "array",
  "map",
  "struct",
  "variant",
]);
const VISUALIZATION_TYPES = new Set<DashboardVisualizationType>([
  "counter",
  "bar",
  "line",
  "pie",
  "table",
]);
const FILTER_TYPES = new Set<DashboardFilterType>([
  "filter-multi-select",
  "filter-single-select",
  "filter-date-range-picker",
]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function issue(
  issues: DashboardDesignV2ValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function validateStringArray(
  value: unknown,
  path: string,
  code: string,
  issues: DashboardDesignV2ValidationIssue[],
): void {
  if (!Array.isArray(value) || value.some((item) => !isNonEmptyString(item))) {
    issue(issues, code, path, "must be an array of non-empty strings");
  }
}

function validateFields(
  value: unknown,
  path: string,
  issues: DashboardDesignV2ValidationIssue[],
): void {
  if (!Array.isArray(value)) {
    issue(issues, "V2_WIDGET_FIELDS_INVALID", path, "must be an array");
    return;
  }
  value.forEach((field, index) => {
    const fieldPath = `${path}[${index}]`;
    if (!isRecord(field)) {
      issue(issues, "V2_WIDGET_FIELD_INVALID", fieldPath, "must be an object");
      return;
    }
    if (!isNonEmptyString(field.name)) {
      issue(issues, "V2_WIDGET_FIELD_NAME_INVALID", `${fieldPath}.name`, "must be non-empty");
    }
    if (!isNonEmptyString(field.expression)) {
      issue(
        issues,
        "V2_WIDGET_FIELD_EXPRESSION_INVALID",
        `${fieldPath}.expression`,
        "must be non-empty",
      );
    }
    if (!FIELD_ROLES.has(field.role as FieldRole)) {
      issue(issues, "V2_WIDGET_FIELD_ROLE_INVALID", `${fieldPath}.role`, "is unsupported");
    }
  });
}

function validateFilter(
  value: unknown,
  path: string,
  issues: DashboardDesignV2ValidationIssue[],
): void {
  if (!isRecord(value)) {
    issue(issues, "V2_FILTER_INVALID", path, "must be an object");
    return;
  }
  if (!FILTER_TYPES.has(value.type as DashboardFilterType)) {
    issue(issues, "V2_FILTER_TYPE_UNSUPPORTED", `${path}.type`, "is unsupported");
  }
  if (!isNonEmptyString(value.title)) {
    issue(issues, "V2_FILTER_TITLE_INVALID", `${path}.title`, "must be non-empty");
  }
  if (!isNonEmptyString(value.field)) {
    issue(issues, "V2_FILTER_FIELD_INVALID", `${path}.field`, "must be non-empty");
  }
  if (!Array.isArray(value.bindings) || value.bindings.length === 0) {
    issue(issues, "V2_FILTER_BINDINGS_INVALID", `${path}.bindings`, "must be non-empty");
    return;
  }
  value.bindings.forEach((binding, index) => {
    const bindingPath = `${path}.bindings[${index}]`;
    if (!isRecord(binding)) {
      issue(issues, "V2_FILTER_BINDING_INVALID", bindingPath, "must be an object");
      return;
    }
    if (!isNonEmptyString(binding.datasetName)) {
      issue(
        issues,
        "V2_FILTER_BINDING_DATASET_INVALID",
        `${bindingPath}.datasetName`,
        "must be non-empty",
      );
    }
    if (!isNonEmptyString(binding.fieldName)) {
      issue(
        issues,
        "V2_FILTER_BINDING_FIELD_INVALID",
        `${bindingPath}.fieldName`,
        "must be non-empty",
      );
    }
    if (!isNonEmptyString(binding.expression)) {
      issue(
        issues,
        "V2_FILTER_BINDING_EXPRESSION_INVALID",
        `${bindingPath}.expression`,
        "must be non-empty",
      );
    }
  });
}

export function validateDashboardDesignV2(value: unknown): DashboardDesignV2ValidationResult {
  const issues: DashboardDesignV2ValidationIssue[] = [];
  if (!isRecord(value)) {
    return {
      valid: false,
      issues: [{ code: "V2_DESIGN_INVALID", path: "$", message: "must be an object" }],
    };
  }
  if (value.version !== "2") {
    issue(issues, "V2_VERSION_INVALID", "version", 'must equal "2"');
  }
  if (!isNonEmptyString(value.title)) {
    issue(issues, "V2_TITLE_INVALID", "title", "must be non-empty");
  }
  if (typeof value.description !== "string") {
    issue(issues, "V2_DESCRIPTION_INVALID", "description", "must be a string");
  }

  if (!Array.isArray(value.datasets)) {
    issue(issues, "V2_DATASETS_INVALID", "datasets", "must be an array");
  } else {
    value.datasets.forEach((dataset, index) => {
      const path = `datasets[${index}]`;
      if (!isRecord(dataset)) {
        issue(issues, "V2_DATASET_INVALID", path, "must be an object");
        return;
      }
      for (const key of ["name", "displayName", "sql"] as const) {
        if (!isNonEmptyString(dataset[key])) {
          issue(
            issues,
            `V2_DATASET_${key.toUpperCase()}_INVALID`,
            `${path}.${key}`,
            "must be non-empty",
          );
        }
      }
      if (!PURPOSES.has(dataset.purpose as DatasetPurpose)) {
        issue(issues, "V2_DATASET_PURPOSE_INVALID", `${path}.purpose`, "is unsupported");
      }
      if (!SOURCE_KINDS.has(dataset.sourceKind as DashboardDatasetSourceKind)) {
        issue(issues, "V2_DATASET_SOURCE_KIND_INVALID", `${path}.sourceKind`, "is unsupported");
      }
      if (dataset.sourceKind === "metric_view" && !isNonEmptyString(dataset.metricViewFqn)) {
        issue(
          issues,
          "V2_METRIC_VIEW_FQN_REQUIRED",
          `${path}.metricViewFqn`,
          "is required for metric-view datasets",
        );
      }
      if (dataset.sourceKind !== "metric_view" && dataset.metricViewFqn !== undefined) {
        issue(
          issues,
          "V2_METRIC_VIEW_FQN_FORBIDDEN",
          `${path}.metricViewFqn`,
          "is only valid for metric-view datasets",
        );
      }
      validateStringArray(dataset.metricIds, `${path}.metricIds`, "V2_METRIC_IDS_INVALID", issues);
      validateStringArray(
        dataset.dimensionIds,
        `${path}.dimensionIds`,
        "V2_DIMENSION_IDS_INVALID",
        issues,
      );
      if (!Array.isArray(dataset.expectedFields)) {
        issue(issues, "V2_EXPECTED_FIELDS_INVALID", `${path}.expectedFields`, "must be an array");
      } else {
        dataset.expectedFields.forEach((field, fieldIndex) => {
          const fieldPath = `${path}.expectedFields[${fieldIndex}]`;
          if (!isRecord(field)) {
            issue(issues, "V2_EXPECTED_FIELD_INVALID", fieldPath, "must be an object");
            return;
          }
          if (!isNonEmptyString(field.name)) {
            issue(
              issues,
              "V2_EXPECTED_FIELD_NAME_INVALID",
              `${fieldPath}.name`,
              "must be non-empty",
            );
          }
          if (
            !Array.isArray(field.roles) ||
            field.roles.length === 0 ||
            field.roles.some((role) => !FIELD_ROLES.has(role as FieldRole))
          ) {
            issue(issues, "V2_EXPECTED_FIELD_ROLES_INVALID", `${fieldPath}.roles`, "is invalid");
          }
          if (
            !Array.isArray(field.compatibleTypes) ||
            field.compatibleTypes.length === 0 ||
            field.compatibleTypes.some((type) => !FIELD_TYPES.has(type as DashboardFieldType))
          ) {
            issue(
              issues,
              "V2_EXPECTED_FIELD_TYPES_INVALID",
              `${fieldPath}.compatibleTypes`,
              "is invalid",
            );
          }
        });
      }
    });
  }

  if (!Array.isArray(value.pages)) {
    issue(issues, "V2_PAGES_INVALID", "pages", "must be an array");
  } else {
    value.pages.forEach((page, index) => {
      const path = `pages[${index}]`;
      if (!isRecord(page)) {
        issue(issues, "V2_PAGE_INVALID", path, "must be an object");
        return;
      }
      if (!isNonEmptyString(page.name)) {
        issue(issues, "V2_PAGE_NAME_INVALID", `${path}.name`, "must be non-empty");
      }
      if (!isNonEmptyString(page.displayName)) {
        issue(issues, "V2_PAGE_DISPLAY_NAME_INVALID", `${path}.displayName`, "must be non-empty");
      }
      if (page.description !== undefined && typeof page.description !== "string") {
        issue(issues, "V2_PAGE_DESCRIPTION_INVALID", `${path}.description`, "must be a string");
      }
      if (!Array.isArray(page.widgets)) {
        issue(issues, "V2_WIDGETS_INVALID", `${path}.widgets`, "must be an array");
      } else {
        page.widgets.forEach((widget, widgetIndex) => {
          const widgetPath = `${path}.widgets[${widgetIndex}]`;
          if (!isRecord(widget)) {
            issue(issues, "V2_WIDGET_INVALID", widgetPath, "must be an object");
            return;
          }
          if (!VISUALIZATION_TYPES.has(widget.type as DashboardVisualizationType)) {
            issue(issues, "V2_WIDGET_TYPE_UNSUPPORTED", `${widgetPath}.type`, "is unsupported");
          }
          if (!isNonEmptyString(widget.title)) {
            issue(issues, "V2_WIDGET_TITLE_INVALID", `${widgetPath}.title`, "must be non-empty");
          }
          if (!isNonEmptyString(widget.datasetName)) {
            issue(
              issues,
              "V2_WIDGET_DATASET_INVALID",
              `${widgetPath}.datasetName`,
              "must be non-empty",
            );
          }
          validateFields(widget.fields, `${widgetPath}.fields`, issues);
        });
      }
      if (!Array.isArray(page.filters)) {
        issue(issues, "V2_FILTERS_INVALID", `${path}.filters`, "must be an array");
      } else {
        page.filters.forEach((filter, filterIndex) =>
          validateFilter(filter, `${path}.filters[${filterIndex}]`, issues),
        );
      }
    });
  }

  if (!Array.isArray(value.globalFilters)) {
    issue(issues, "V2_GLOBAL_FILTERS_INVALID", "globalFilters", "must be an array");
  } else {
    value.globalFilters.forEach((filter, index) =>
      validateFilter(filter, `globalFilters[${index}]`, issues),
    );
  }

  return { valid: issues.length === 0, issues };
}

export function requireDashboardDesignV2(value: unknown): DashboardDesignV2 {
  const result = validateDashboardDesignV2(value);
  if (!result.valid) throw new DashboardDesignV2ValidationError(result.issues);
  return value as DashboardDesignV2;
}

export function isDashboardDesignV2(value: unknown): value is DashboardDesignV2 {
  return validateDashboardDesignV2(value).valid;
}
