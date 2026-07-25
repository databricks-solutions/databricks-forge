import { describe, expect, it, vi } from "vitest";

import { deployAsset, rewriteDdlTarget } from "@/lib/genie/deploy";

const asset = {
  name: "sales_metrics",
  ddl: "CREATE VIEW main.sales.sales_metrics AS SELECT 1",
};

describe("deployAsset identifier validation", () => {
  it.each(["catalog", "catalog.schema.extra"])(
    "requires target schema to be exactly catalog.schema: %s",
    (targetSchema) => {
      expect(() => rewriteDdlTarget(asset.ddl, targetSchema)).toThrow(/exactly catalog\.schema/);
    },
  );

  it("rejects unsafe rewrite identifiers at the shared DDL boundary", () => {
    expect(() => rewriteDdlTarget(asset.ddl, "main.sales", "safe_`; DROP TABLE users; --")).toThrow(
      /invalid characters/,
    );
  });

  it.each([
    ["main.sales; DROP SCHEMA main CASCADE", undefined],
    ["main.sales", "safe_`; DROP TABLE users; --"],
  ])("rejects unsafe target identifiers before executing DDL", async (targetSchema, prefix) => {
    const deploySql = vi.fn();

    await expect(deployAsset(asset, targetSchema, prefix, deploySql)).rejects.toThrow(
      /invalid characters/,
    );
    expect(deploySql).not.toHaveBeenCalled();
  });
});
