import { describe, expect, it } from "vitest";
import { validateSerializedDashboard } from "@/lib/dashboard/contract-validator";
import type { LakeviewWidgetSpec, SerializedLakeviewDashboard } from "@/lib/dashboard/types";

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

describe("validateSerializedDashboard", () => {
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
