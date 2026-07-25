/**
 * Lakeview Dashboard Assembler — converts DashboardDesignV2
 * into the serialized Lakeview dashboard JSON format.
 *
 * Applies the 12-column GRID_V1 layout rules, correct widget versions, and
 * proper field name matching deterministically (no LLM needed here).
 */

import type {
  SerializedLakeviewDashboard,
  LakeviewDataset,
  LakeviewPage,
  LakeviewWidget,
  LakeviewPosition,
  LakeviewWidgetQuery,
  LakeviewWidgetField,
  LakeviewWidgetSpec,
  DashboardRecommendation,
  LakeviewFilterEncoding,
} from "./types";
import type {
  DashboardDesignV2,
  DashboardPageDesignV2,
  FilterDesignV2,
  WidgetDesignV2,
} from "./design-ir";
import { getWidgetVersion } from "./widget-registry";
import { classifyWidgetExpression } from "./expressions";

const GRID_WIDTH = 12;

function widgetVersion(widgetType: string): number {
  const version = getWidgetVersion(widgetType);
  if (version === null) {
    throw new Error(`Unsupported Lakeview widget type "${widgetType}"`);
  }
  return version;
}

function sanitiseWidgetName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function buildTextWidget(text: string, y: number): LakeviewWidget {
  return {
    widget: {
      name: sanitiseWidgetName(`text-${y}`),
      multilineTextboxSpec: { lines: [text] },
    },
    position: { x: 0, y, width: GRID_WIDTH, height: 1 },
  };
}

function buildCounterWidget(
  design: WidgetDesignV2,
  position: LakeviewPosition,
  disaggregated: boolean,
): LakeviewWidget {
  const valueField = design.fields.find((f) => f.role === "value") ?? design.fields[0];
  if (!valueField) {
    throw new Error(`Counter widget "${design.title}" has no value field`);
  }

  // When filters reference this counter's dataset, use disaggregated: false
  // so the filter can slice the source rows before rendering the counter.
  const fieldName = valueField.name;

  const field: LakeviewWidgetField = {
    name: fieldName,
    expression: valueField.expression,
  };

  const query: LakeviewWidgetQuery = {
    name: "main_query",
    query: {
      datasetName: design.datasetName,
      fields: [field],
      disaggregated,
    },
  };

  const spec: LakeviewWidgetSpec = {
    version: widgetVersion("counter"),
    widgetType: "counter",
    encodings: {
      value: { fieldName, displayName: design.title },
    },
    frame: { showTitle: true, title: design.title },
  };

  return {
    widget: {
      name: sanitiseWidgetName(design.title),
      queries: [query],
      spec,
    },
    position,
  };
}

function buildChartWidget(design: WidgetDesignV2, position: LakeviewPosition): LakeviewWidget {
  const fields: LakeviewWidgetField[] = design.fields.map((f) => ({
    name: f.name,
    expression: f.expression,
  }));

  const query: LakeviewWidgetQuery = {
    name: "main_query",
    query: {
      datasetName: design.datasetName,
      fields,
      disaggregated: true,
    },
  };

  const xField = design.fields.find((f) => f.role === "x");
  const yField = design.fields.find((f) => f.role === "y");
  const colorField = design.fields.find((f) => f.role === "color");

  const xScaleType =
    xField && classifyWidgetExpression(xField.expression)?.kind === "date_trunc"
      ? "temporal"
      : "categorical";

  const encodings: Record<string, unknown> = {};

  if (design.type === "pie") {
    const angleField = yField ?? design.fields[0];
    const catField = colorField ?? xField ?? design.fields[1];
    encodings.angle = {
      fieldName: angleField?.name ?? "value",
      scale: { type: "quantitative" },
      displayName: angleField?.name ?? "Value",
    };
    encodings.color = {
      fieldName: catField?.name ?? "category",
      scale: { type: "categorical" },
      displayName: catField?.name ?? "Category",
    };
  } else {
    if (xField) {
      encodings.x = {
        fieldName: xField.name,
        scale: { type: xScaleType as "temporal" | "quantitative" | "categorical" },
        displayName: xField.name,
      };
    }
    if (yField) {
      encodings.y = {
        fieldName: yField.name,
        scale: { type: "quantitative" },
        displayName: yField.name,
      };
    }
    if (colorField) {
      encodings.color = {
        fieldName: colorField.name,
        scale: { type: "categorical" },
        displayName: colorField.name,
      };
    }
  }

  const spec: LakeviewWidgetSpec = {
    version: widgetVersion(design.type),
    widgetType: design.type,
    encodings: encodings as unknown as LakeviewWidgetSpec["encodings"],
    frame: { showTitle: true, title: design.title },
  };

  return {
    widget: {
      name: sanitiseWidgetName(design.title),
      queries: [query],
      spec,
    },
    position,
  };
}

function buildTableWidget(design: WidgetDesignV2, position: LakeviewPosition): LakeviewWidget {
  const fields: LakeviewWidgetField[] = design.fields.map((f) => ({
    name: f.name,
    expression: f.expression,
  }));

  const query: LakeviewWidgetQuery = {
    name: "main_query",
    query: {
      datasetName: design.datasetName,
      fields,
      disaggregated: true,
    },
  };

  const spec: LakeviewWidgetSpec = {
    version: widgetVersion("table"),
    widgetType: "table",
    encodings: {
      columns: design.fields.map((f) => ({
        fieldName: f.name,
        displayName: f.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      })),
    } as LakeviewWidgetSpec["encodings"],
    frame: { showTitle: true, title: design.title },
  };

  return {
    widget: {
      name: sanitiseWidgetName(design.title),
      queries: [query],
      spec,
    },
    position,
  };
}

export function isFilterType(type: string): boolean {
  return (
    type === "filter-multi-select" ||
    type === "filter-single-select" ||
    type === "filter-date-range-picker"
  );
}

export function isCounterQueryDisaggregated(
  datasetName: string,
  filters: FilterDesignV2[],
): boolean {
  return !filters.some((filter) =>
    filter.bindings.some((binding) => binding.datasetName === datasetName),
  );
}

function buildFilterWidget(design: FilterDesignV2, position: LakeviewPosition): LakeviewWidget {
  if (design.bindings.length === 0) {
    throw new Error(`Filter "${design.title}" has no dataset bindings`);
  }

  const queryNames = design.bindings.map(
    (binding) => `ds_${binding.datasetName}_${sanitiseWidgetName(binding.fieldName)}`,
  );
  const queries: LakeviewWidgetQuery[] = design.bindings.map((binding, index) => ({
    name: queryNames[index],
    query: {
      datasetName: binding.datasetName,
      fields: [{ name: binding.fieldName, expression: binding.expression }],
      disaggregated: false,
    },
  }));

  const encodings: LakeviewFilterEncoding = {
    fields: design.bindings.map((binding, index) => ({
      fieldName: binding.fieldName,
      displayName: design.title,
      queryName: queryNames[index],
    })),
  };

  const spec: LakeviewWidgetSpec = {
    version: widgetVersion(design.type),
    widgetType: design.type,
    encodings: encodings as LakeviewWidgetSpec["encodings"],
    frame: { showTitle: true, title: design.title },
  };

  return {
    widget: {
      name: sanitiseWidgetName(design.title),
      queries,
      spec,
    },
    position,
  };
}

function buildGlobalFiltersPage(filterDesigns: FilterDesignV2[]): LakeviewPage {
  const layout: LakeviewWidget[] = [];

  for (const [index, design] of filterDesigns.entries()) {
    layout.push(
      buildFilterWidget(design, {
        x: (index % 3) * 4,
        y: Math.floor(index / 3) * 2,
        width: 4,
        height: 2,
      }),
    );
  }

  return {
    name: "filters",
    displayName: "Filters",
    pageType: "PAGE_TYPE_GLOBAL_FILTERS",
    layoutVersion: "GRID_V1",
    layout,
  };
}

function buildCanvasPage(
  pageDesign: DashboardPageDesignV2,
  rootDescription: string,
  globalFilters: FilterDesignV2[],
  isFirstPage: boolean,
): LakeviewPage {
  const counters = pageDesign.widgets.filter((widget) => widget.type === "counter");
  const charts = pageDesign.widgets.filter(
    (widget) => widget.type === "bar" || widget.type === "line" || widget.type === "pie",
  );
  const tables = pageDesign.widgets.filter((widget) => widget.type === "table");
  const activeFilters = [...globalFilters, ...pageDesign.filters];
  const layout: LakeviewWidget[] = [];
  let currentY = 0;

  layout.push(buildTextWidget(`## ${pageDesign.displayName}`, currentY));
  currentY += 1;

  const description = (pageDesign.description ?? (isFirstPage ? rootDescription : "")).trim();
  if (description) {
    layout.push(buildTextWidget(description, currentY));
    currentY += 1;
  }

  for (const [index, filter] of pageDesign.filters.entries()) {
    layout.push(
      buildFilterWidget(filter, {
        x: (index % 3) * 4,
        y: currentY + Math.floor(index / 3) * 2,
        width: 4,
        height: 2,
      }),
    );
  }
  if (pageDesign.filters.length > 0) {
    currentY += Math.ceil(pageDesign.filters.length / 3) * 2;
  }

  if (counters.length > 0) {
    const counterRows = [];
    for (let i = 0; i < counters.length; i += 3) {
      counterRows.push(counters.slice(i, i + 3));
    }

    for (const row of counterRows) {
      const counterWidth = Math.floor(GRID_WIDTH / Math.min(row.length, 3));
      let x = 0;
      for (const counter of row) {
        const width = x + counterWidth > GRID_WIDTH ? GRID_WIDTH - x : counterWidth;
        layout.push(
          buildCounterWidget(
            counter,
            { x, y: currentY, width, height: 3 },
            isCounterQueryDisaggregated(counter.datasetName, activeFilters),
          ),
        );
        x += width;
      }
      currentY += 3;
    }
  }

  if (charts.length > 0) {
    layout.push(buildTextWidget("### Trends & Analysis", currentY));
    currentY += 1;

    for (let i = 0; i < charts.length; i += 2) {
      const pair = charts.slice(i, i + 2);
      if (pair.length === 2) {
        layout.push(buildChartWidget(pair[0], { x: 0, y: currentY, width: 6, height: 5 }));
        layout.push(buildChartWidget(pair[1], { x: 6, y: currentY, width: 6, height: 5 }));
      } else {
        layout.push(buildChartWidget(pair[0], { x: 0, y: currentY, width: GRID_WIDTH, height: 5 }));
      }
      currentY += 5;
    }
  }

  if (tables.length > 0) {
    layout.push(buildTextWidget("### Details", currentY));
    currentY += 1;

    for (const table of tables) {
      layout.push(buildTableWidget(table, { x: 0, y: currentY, width: GRID_WIDTH, height: 6 }));
      currentY += 6;
    }
  }

  return {
    name: pageDesign.name,
    displayName: pageDesign.displayName,
    pageType: "PAGE_TYPE_CANVAS",
    layoutVersion: "GRID_V1",
    layout,
  };
}

/**
 * Lay out a V2 dashboard design on the Release 1 12-column GRID_V1 contract.
 */
export function assembleLakeviewDashboard(design: DashboardDesignV2): SerializedLakeviewDashboard {
  const datasets: LakeviewDataset[] = design.datasets.map((dataset) => ({
    name: dataset.name,
    displayName: dataset.displayName,
    queryLines: dataset.sql.split("\n").map((line) => line + " "),
  }));
  const pages = design.pages.map((page, index) =>
    buildCanvasPage(page, design.description, design.globalFilters, index === 0),
  );

  if (design.globalFilters.length > 0) {
    pages.push(buildGlobalFiltersPage(design.globalFilters));
  }

  return { datasets, pages };
}

/**
 * Build a DashboardRecommendation from DashboardDesignV2 + assembled dashboard.
 */
export function buildDashboardRecommendation(
  design: DashboardDesignV2,
  serializedDashboard: SerializedLakeviewDashboard,
  domain: string,
  subdomains: string[],
  businessName: string,
  useCaseIds: string[],
): DashboardRecommendation {
  const title = `${businessName} - ${domain} Dashboard`;
  const descParts: string[] = [`AI/BI dashboard for the ${domain} domain of ${businessName}.`];
  if (subdomains.length > 0) {
    descParts.push(`Covers: ${subdomains.join(", ")}.`);
  }
  const widgetCount = design.pages.reduce(
    (count, page) => count + page.widgets.length + page.filters.length,
    design.globalFilters.length,
  );
  descParts.push(`${design.datasets.length} datasets, ${widgetCount} visualisations.`);

  return {
    domain,
    subdomains,
    title,
    description: descParts.join(" "),
    datasetCount: design.datasets.length,
    widgetCount,
    useCaseIds,
    serializedDashboard: JSON.stringify(serializedDashboard),
    dashboardDesign: design,
    designVersion: "2",
    datasetSourceKind: "table",
  };
}
