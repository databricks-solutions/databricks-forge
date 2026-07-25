import { describe, expect, it } from "vitest";
import {
  DEFAULT_MENU_VISIBILITY,
  normalizeMenuVisibility,
} from "@/lib/settings";
import { TOGGLEABLE_NAV_ITEMS } from "@/components/pipeline/sidebar-nav";

describe("menu visibility defaults", () => {
  it("hides Ask Forge by default", () => {
    expect(DEFAULT_MENU_VISIBILITY["/ask-forge"]).toBe(false);
    expect(normalizeMenuVisibility(undefined)["/ask-forge"]).toBe(false);
    expect(normalizeMenuVisibility({})["/ask-forge"]).toBe(false);
  });

  it("preserves an explicit Ask Forge opt-in", () => {
    expect(normalizeMenuVisibility({ "/ask-forge": true })["/ask-forge"]).toBe(true);
  });

  it("ignores invalid persisted visibility values", () => {
    expect(
      normalizeMenuVisibility({ "/ask-forge": "yes", "/runs": false }),
    ).toEqual({
      "/ask-forge": false,
      "/runs": false,
    });
  });

  it("exposes Ask Forge in Menu visibility settings", () => {
    expect(TOGGLEABLE_NAV_ITEMS).toContainEqual({
      href: "/ask-forge",
      labelKey: "ask_forge",
      sectionKey: "explore",
    });
  });
});
