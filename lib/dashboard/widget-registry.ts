export type SupportedWidgetType =
  | "counter"
  | "table"
  | "bar"
  | "line"
  | "pie"
  | "filter-multi-select"
  | "filter-single-select"
  | "filter-date-range-picker";

export interface WidgetCapability {
  widgetType: SupportedWidgetType;
  version: number;
  requiresSpec: true;
}

export const WIDGET_REGISTRY: Readonly<Record<SupportedWidgetType, WidgetCapability>> = {
  counter: { widgetType: "counter", version: 2, requiresSpec: true },
  table: { widgetType: "table", version: 2, requiresSpec: true },
  bar: { widgetType: "bar", version: 3, requiresSpec: true },
  line: { widgetType: "line", version: 3, requiresSpec: true },
  pie: { widgetType: "pie", version: 3, requiresSpec: true },
  "filter-multi-select": {
    widgetType: "filter-multi-select",
    version: 2,
    requiresSpec: true,
  },
  "filter-single-select": {
    widgetType: "filter-single-select",
    version: 2,
    requiresSpec: true,
  },
  "filter-date-range-picker": {
    widgetType: "filter-date-range-picker",
    version: 2,
    requiresSpec: true,
  },
};

export function getWidgetVersion(widgetType: string): number | null {
  return WIDGET_REGISTRY[widgetType as SupportedWidgetType]?.version ?? null;
}

export function isSupportedWidgetType(widgetType: string): widgetType is SupportedWidgetType {
  return Object.hasOwn(WIDGET_REGISTRY, widgetType);
}
