import { describe, expect, it } from "vitest";
import { validateSerializedDashboard } from "@/lib/dashboard/contract-validator";
import type { LakeviewWidgetSpec, SerializedLakeviewDashboard } from "@/lib/dashboard/types";
import { buildWafDashboardJson } from "@/lib/engines/waf-assessment/dashboard/builder";

function makeValidDashboard(): SerializedLakeviewDashboard {
  return {
    datasets: [{ name: "sales", displayName: "Sales", queryLines: ["SELECT 1 AS total"] }],
    pages: [
      {
        name: "overview",
        displayName: "Overview",
        pageType: "PAGE_TYPE_CANVAS",
        layoutVersion: "GRID_V1",
        layout: [
          {
            widget: {
              name: "total-sales",
              queries: [
                {
                  name: "main_query",
                  query: {
                    datasetName: "sales",
                    fields: [{ name: "total", expression: "`total`" }],
                    disaggregated: true,
                  },
                },
              ],
              spec: {
                version: 2,
                widgetType: "counter",
                encodings: {
                  value: { fieldName: "total", displayName: "Total" },
                },
                frame: { showTitle: true, title: "Total Sales" },
              },
            },
            position: { x: 0, y: 0, width: 3, height: 2 },
          },
        ],
      },
    ],
  };
}

function cloneDashboard(): SerializedLakeviewDashboard {
  return structuredClone(makeValidDashboard());
}

function errorCodes(dashboard: SerializedLakeviewDashboard): string[] {
  return validateSerializedDashboard(dashboard).errors.map((error) => error.code);
}

function validateMalformedImported(dashboard: unknown) {
  let result: ReturnType<typeof validateSerializedDashboard> | undefined;
  expect(() => {
    result = validateSerializedDashboard(dashboard as SerializedLakeviewDashboard, {
      mode: "imported-lakeview",
    });
  }).not.toThrow();
  expect(result).toBeDefined();
  return result!;
}

describe("validateSerializedDashboard", () => {
  it.each([
    ["absent datasets", { pages: [] }, "datasets", "DASHBOARD_DATASETS_INVALID"],
    ["non-array datasets", { datasets: {}, pages: [] }, "datasets", "DASHBOARD_DATASETS_INVALID"],
    ["absent pages", { datasets: [] }, "pages", "DASHBOARD_PAGES_INVALID"],
    ["non-array pages", { datasets: [], pages: {} }, "pages", "DASHBOARD_PAGES_INVALID"],
  ])("returns structured errors for %s", (_name, dashboard, path, code) => {
    const result = validateMalformedImported(dashboard);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ path, code }));
  });

  it("returns a structured error when an imported page has no layout", () => {
    const result = validateMalformedImported({
      datasets: [],
      pages: [{ name: "overview", layoutVersion: "GRID_V1" }],
    });

    expect(result.errors).toContainEqual(
      expect.objectContaining({ path: "pages[0].layout", code: "PAGE_LAYOUT_INVALID" }),
    );
  });

  it("returns a structured error when an imported layout item has no position", () => {
    const dashboard = cloneDashboard() as unknown as {
      pages: Array<{ layout: Array<{ position?: unknown }> }>;
    };
    delete dashboard.pages[0].layout[0].position;

    const result = validateMalformedImported(dashboard);

    expect(result.errors).toContainEqual(
      expect.objectContaining({ path: "pages[0].layout[0].position", code: "GRID_BOUNDS" }),
    );
  });

  it("returns a structured error when an imported query has no query body", () => {
    const dashboard = cloneDashboard() as unknown as {
      pages: Array<{ layout: Array<{ widget: { queries: Array<{ query?: unknown }> } }> }>;
    };
    delete dashboard.pages[0].layout[0].widget.queries[0].query;

    const result = validateMalformedImported(dashboard);

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: "pages[0].layout[0].widget.queries[0].query",
        code: "QUERY_INVALID",
      }),
    );
  });

  it("validates the imported WAF dashboard parameter bindings without throwing", async () => {
    const dashboard = JSON.parse(await buildWafDashboardJson()) as SerializedLakeviewDashboard;

    expect(() =>
      validateSerializedDashboard(dashboard, { mode: "imported-lakeview" }),
    ).not.toThrow();
    expect(validateSerializedDashboard(dashboard, { mode: "imported-lakeview" })).toMatchObject({
      valid: true,
      errors: [],
    });
  });

  it("returns a structured error for an imported query parameter with no dataset binding", async () => {
    const dashboard = JSON.parse(await buildWafDashboardJson()) as SerializedLakeviewDashboard;
    const globalFilter = dashboard.pages.find((page) => page.name === "global_filters")!;
    const query = globalFilter.layout[0].widget.queries![0].query as unknown as {
      parameters: Array<{ name: string; keyword: string }>;
    };
    query.parameters[0].keyword = "missing_parameter";

    const result = validateSerializedDashboard(dashboard, { mode: "imported-lakeview" });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "PARAM_FILTER_MISMATCH",
        path: expect.stringContaining(".query.parameters[0]"),
      }),
    );
  });

  it("keeps field-to-encoding validation for imported visualization queries", () => {
    const dashboard = cloneDashboard();
    const encodings = dashboard.pages[0].layout[0].widget.spec!.encodings as {
      value: { fieldName: string };
    };
    encodings.value.fieldName = "missing";

    const result = validateSerializedDashboard(dashboard, { mode: "imported-lakeview" });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "FIELD_ENCODING_MISMATCH" }),
    );
  });

  it("rejects imported hybrid filter queries with both fields and parameters", () => {
    const dashboard = cloneDashboard();
    const dataset = dashboard.datasets[0] as unknown as {
      parameters: Array<{ keyword: string }>;
    };
    dataset.parameters = [{ keyword: "date_range" }];
    const widget = dashboard.pages[0].layout[0].widget;
    widget.spec = {
      version: 2,
      widgetType: "filter-date-range-picker",
      encodings: {
        fields: [{ parameterName: "date_range", queryName: "main_query" }],
      } as unknown as LakeviewWidgetSpec["encodings"],
      frame: { showTitle: true, title: "Date Range" },
    };
    (
      widget.queries![0].query as unknown as {
        parameters: Array<{ name: string; keyword: string }>;
      }
    ).parameters = [{ name: "date_range", keyword: "date_range" }];
    widget.queries![0].query.disaggregated = false;

    const result = validateSerializedDashboard(dashboard, { mode: "imported-lakeview" });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "PARAM_FILTER_MISMATCH" }),
    );
  });

  it("rejects missing and extra unencoded fields on imported ordinary filters", () => {
    const missingField = cloneDashboard();
    const missingWidget = missingField.pages[0].layout[0].widget;
    missingWidget.spec = {
      version: 2,
      widgetType: "filter-single-select",
      encodings: {
        fields: [{ fieldName: "missing", displayName: "Missing", queryName: "main_query" }],
      },
      frame: { showTitle: true, title: "Filter" },
    };
    missingWidget.queries![0].query.disaggregated = false;

    const extraField = cloneDashboard();
    const extraWidget = extraField.pages[0].layout[0].widget;
    extraWidget.spec = {
      version: 2,
      widgetType: "filter-single-select",
      encodings: {
        fields: [{ fieldName: "total", displayName: "Total", queryName: "main_query" }],
      },
      frame: { showTitle: true, title: "Filter" },
    };
    extraWidget.queries![0].query.fields.push({
      name: "unencoded",
      expression: "`unencoded`",
    });
    extraWidget.queries![0].query.disaggregated = false;

    for (const dashboard of [missingField, extraField]) {
      const result = validateSerializedDashboard(dashboard, { mode: "imported-lakeview" });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: "PARAM_FILTER_MISMATCH" }),
      );
    }
  });

  it("rejects the AI/BI associativity artifact on imported filters in both modes", () => {
    // `COUNT_IF(`associative_filter_predicate_group`)` is an AI/BI editor-internal
    // expression. `associative_filter_predicate_group` is not a real dataset
    // column, so re-executing an exported dashboard that carries it fails with
    // UNRESOLVED_COLUMN. It is rejected as an unencoded extra field rather than
    // tolerated, and the rejection is NOT relaxed for imported dashboards.
    for (const mode of ["forge-assembled", "imported-lakeview"] as const) {
      const dashboard = cloneDashboard();
      const widget = dashboard.pages[0].layout[0].widget;
      widget.spec = {
        version: 2,
        widgetType: "filter-multi-select",
        encodings: {
          fields: [{ fieldName: "total", displayName: "Total", queryName: "main_query" }],
        },
        frame: { showTitle: true, title: "Total" },
      };
      widget.queries![0].query.fields.push({
        name: "total_associativity",
        expression: "COUNT_IF(`associative_filter_predicate_group`)",
      });
      widget.queries![0].query.disaggregated = false;

      const result = validateSerializedDashboard(dashboard, { mode });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: "PARAM_FILTER_MISMATCH" }),
      );
    }
  });

  it("keeps the shipped WAF template free of AI/BI export artifacts", async () => {
    const raw = await buildWafDashboardJson();

    // The exported template originally carried an associativity field and an
    // invisible `lines: [""]` separator widget. Both are export artifacts, not
    // deployable Lakeview content, so the template itself is corrected rather
    // than the validator being weakened to accept them.
    expect(raw).not.toContain("associative_filter_predicate_group");
    expect(raw).not.toContain("_associativity");

    const dashboard = JSON.parse(raw) as SerializedLakeviewDashboard;
    const textLines = dashboard.pages.flatMap((page) =>
      page.layout.flatMap((item) => item.widget.multilineTextboxSpec?.lines ?? []),
    );
    expect(textLines.length).toBeGreaterThan(0);
    for (const lines of dashboard.pages.flatMap((page) =>
      page.layout.flatMap((item) =>
        item.widget.multilineTextboxSpec ? [item.widget.multilineTextboxSpec.lines] : [],
      ),
    )) {
      expect(lines.some((line) => line.trim().length > 0)).toBe(true);
    }
    expect(validateSerializedDashboard(dashboard, { mode: "imported-lakeview" }).valid).toBe(true);
  });

  it("accepts a valid GRID_V1 dashboard", () => {
    const result = validateSerializedDashboard(makeValidDashboard());

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({
      stage: "dashboard_contract",
      status: "passed",
    });
  });

  it("requires GRID_V1 on every page", () => {
    const dashboard = cloneDashboard();
    delete (dashboard.pages[0] as Partial<(typeof dashboard.pages)[number]>).layoutVersion;

    expect(errorCodes(dashboard)).toContain("LAYOUT_VERSION_MISSING");
  });

  it("rejects widgets outside the 12-column grid", () => {
    const dashboard = cloneDashboard();
    dashboard.pages[0].layout[0].position = { x: 10, y: 0, width: 3, height: 2 };

    expect(errorCodes(dashboard)).toContain("GRID_BOUNDS");
  });

  it("rejects overlapping widget rectangles", () => {
    const dashboard = cloneDashboard();
    const duplicate = structuredClone(dashboard.pages[0].layout[0]);
    duplicate.widget.name = "second-counter";
    dashboard.pages[0].layout.push(duplicate);

    expect(errorCodes(dashboard)).toContain("GRID_OVERLAP");
  });

  it("rejects query references to absent datasets", () => {
    const dashboard = cloneDashboard();
    dashboard.pages[0].layout[0].widget.queries![0].query.datasetName = "missing";

    expect(errorCodes(dashboard)).toContain("DATASET_MISSING");
  });

  it("rejects encoded fields that are absent from query fields", () => {
    const dashboard = cloneDashboard();
    const encodings = dashboard.pages[0].layout[0].widget.spec!.encodings as {
      value: { fieldName: string; displayName: string };
    };
    encodings.value.fieldName = "missing";

    expect(errorCodes(dashboard)).toContain("FIELD_ENCODING_MISMATCH");
  });

  it.each(["date_trunc", "DaTe_TrUnC"])(
    "rejects a non-temporal x-axis for supported %s expressions",
    (functionName) => {
      const dashboard = cloneDashboard();
      const widget = dashboard.pages[0].layout[0].widget;
      widget.queries![0].query.fields[0].expression = `${functionName}("MONTH", \`total\`)`;
      widget.spec = {
        version: 3,
        widgetType: "line",
        encodings: {
          x: {
            fieldName: "total",
            scale: { type: "categorical" },
            displayName: "Month",
          },
        } as LakeviewWidgetSpec["encodings"],
        frame: { showTitle: true, title: "Monthly Trend" },
      };

      expect(errorCodes(dashboard)).toContain("CHART_SCALE_TYPE");
    },
  );

  it("rejects filter encoding query names absent from widget queries", () => {
    const dashboard = cloneDashboard();
    const widget = dashboard.pages[0].layout[0].widget;
    widget.spec = {
      version: 2,
      widgetType: "filter-multi-select",
      encodings: {
        fields: [{ fieldName: "total", displayName: "Total", queryName: "missing_query" }],
      },
      frame: { showTitle: true, title: "Total" },
    };
    widget.queries![0].query.disaggregated = false;

    expect(errorCodes(dashboard)).toContain("FILTER_QUERY_NAME_INVALID");
  });

  it("rejects widget versions that do not match the registry", () => {
    const dashboard = cloneDashboard();
    dashboard.pages[0].layout[0].widget.spec!.version = 3;

    expect(errorCodes(dashboard)).toContain("WIDGET_VERSION_MISMATCH");
  });

  it("allows an explicitly hidden but titled frame for visualization widgets", () => {
    const hiddenTitle = cloneDashboard();
    hiddenTitle.pages[0].layout[0].widget.spec!.frame.showTitle = false;
    expect(errorCodes(hiddenTitle)).not.toContain("FRAME_REQUIRED");
  });

  it("requires showTitle and a non-empty title for visualization widgets", () => {
    const missingShowTitle = cloneDashboard();
    delete (missingShowTitle.pages[0].layout[0].widget.spec!.frame as { showTitle?: boolean })
      .showTitle;
    expect(errorCodes(missingShowTitle)).toContain("FRAME_REQUIRED");

    const nonBooleanShowTitle = cloneDashboard();
    (
      nonBooleanShowTitle.pages[0].layout[0].widget.spec!.frame as unknown as {
        showTitle: string;
      }
    ).showTitle = "false";
    expect(errorCodes(nonBooleanShowTitle)).toContain("FRAME_REQUIRED");

    const emptyTitle = cloneDashboard();
    emptyTitle.pages[0].layout[0].widget.spec!.frame.title = "   ";
    expect(errorCodes(emptyTitle)).toContain("FRAME_REQUIRED");
  });

  it("rejects malformed text widget shapes", () => {
    const dashboard = cloneDashboard();
    dashboard.pages[0].layout[0].widget = {
      name: "summary",
      multilineTextboxSpec: { lines: [] },
    };

    expect(errorCodes(dashboard)).toContain("TEXT_INVALID_SPEC");
  });

  it("allows blank lines when a text widget has non-empty content", () => {
    const dashboard = cloneDashboard();
    dashboard.pages[0].layout[0].widget = {
      name: "summary",
      multilineTextboxSpec: { lines: ["Summary", "", "   ", "Details"] },
    };

    expect(errorCodes(dashboard)).not.toContain("TEXT_INVALID_SPEC");
  });

  it("requires every query to expose exactly the encoded fields", () => {
    const extraField = cloneDashboard();
    extraField.pages[0].layout[0].widget.queries![0].query.fields.push({
      name: "extra",
      expression: "`extra`",
    });
    expect(errorCodes(extraField)).toContain("FIELD_ENCODING_MISMATCH");

    const mismatchedSecondQuery = cloneDashboard();
    mismatchedSecondQuery.pages[0].layout[0].widget.queries!.push({
      name: "secondary_query",
      query: {
        datasetName: "sales",
        fields: [{ name: "other", expression: "`other`" }],
        disaggregated: true,
      },
    });
    expect(errorCodes(mismatchedSecondQuery)).toContain("FIELD_ENCODING_MISMATCH");
  });

  it("requires filter query fields to match their queryName binding", () => {
    const dashboard = cloneDashboard();
    const widget = dashboard.pages[0].layout[0].widget;
    widget.spec = {
      version: 2,
      widgetType: "filter-single-select",
      encodings: {
        fields: [{ fieldName: "missing", displayName: "Missing", queryName: "main_query" }],
      },
      frame: { showTitle: true, title: "Filter" },
    };
    widget.queries![0].query.disaggregated = false;

    expect(errorCodes(dashboard)).toContain("PARAM_FILTER_MISMATCH");
  });

  it("rejects invalid chart scale roles", () => {
    const dashboard = cloneDashboard();
    dashboard.pages[0].layout[0].widget.spec = {
      version: 3,
      widgetType: "bar",
      encodings: {
        x: {
          fieldName: "total",
          displayName: "Total",
          scale: { type: "categorical" },
        },
        y: {
          fieldName: "total",
          displayName: "Total",
          scale: { type: "quantitative" },
        },
        color: {
          fieldName: "total",
          displayName: "Total",
          scale: { type: "quantitative" },
        },
      } as unknown as LakeviewWidgetSpec["encodings"],
      frame: { showTitle: true, title: "Bar" },
    };

    expect(errorCodes(dashboard)).toContain("CHART_SCALE_TYPE");
  });

  it("rejects duplicate page names and invalid or duplicate widget names", () => {
    const dashboard = cloneDashboard();
    dashboard.pages.push(structuredClone(dashboard.pages[0]));
    dashboard.pages[0].layout[0].widget.name = "Invalid widget name";
    const duplicate = structuredClone(dashboard.pages[0].layout[0]);
    duplicate.widget.name = "Invalid widget name";
    duplicate.position = { x: 3, y: 0, width: 3, height: 2 };
    dashboard.pages[0].layout.push(duplicate);

    const errors = errorCodes(dashboard);
    expect(errors).toContain("PAGE_NAME_DUPLICATE");
    expect(errors).toContain("WIDGET_ID_INVALID");
    expect(errors).toContain("WIDGET_ID_DUPLICATE");
  });

  it("allows widgets that only touch grid edges", () => {
    const dashboard = cloneDashboard();
    const adjacent = structuredClone(dashboard.pages[0].layout[0]);
    adjacent.widget.name = "adjacent-counter";
    adjacent.position = { x: 3, y: 0, width: 3, height: 2 };
    dashboard.pages[0].layout.push(adjacent);

    expect(errorCodes(dashboard)).not.toContain("GRID_OVERLAP");
  });

  it("requires counters on filtered datasets to remain aggregated", () => {
    const dashboard = cloneDashboard();
    dashboard.pages[0].layout.push({
      widget: {
        name: "sales-filter",
        queries: [
          {
            name: "filter_query",
            query: {
              datasetName: "sales",
              fields: [{ name: "total", expression: "`total`" }],
              disaggregated: false,
            },
          },
        ],
        spec: {
          version: 2,
          widgetType: "filter-single-select",
          encodings: {
            fields: [{ fieldName: "total", displayName: "Total", queryName: "filter_query" }],
          },
          frame: { showTitle: true, title: "Total" },
        },
      },
      position: { x: 3, y: 0, width: 3, height: 2 },
    });

    expect(errorCodes(dashboard)).toContain("COUNTER_DISAGGREGATION");
  });
});
