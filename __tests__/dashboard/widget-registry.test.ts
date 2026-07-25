import { describe, expect, it } from "vitest";
import { getWidgetVersion, isSupportedWidgetType } from "@/lib/dashboard/widget-registry";

describe("dashboard widget registry", () => {
  it.each([
    ["counter", 2],
    ["table", 2],
    ["bar", 3],
    ["line", 3],
    ["pie", 3],
    ["filter-multi-select", 2],
  ])("registers %s at version %i", (type, version) => {
    expect(getWidgetVersion(type)).toBe(version);
    expect(isSupportedWidgetType(type)).toBe(true);
  });

  it("rejects unknown widget types", () => {
    expect(getWidgetVersion("heatmap")).toBeNull();
  });

  it("rejects inherited object properties", () => {
    expect(isSupportedWidgetType("toString")).toBe(false);
  });
});
