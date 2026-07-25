import { describe, it, expect } from "vitest";
import { classifyEstateTablesToAssets } from "@/lib/engines/data-gap-analysis/estate-classifier";
import type { ReferenceDataAsset } from "@/lib/domain/industry-outcomes/master-repo-types";

const assets: ReferenceDataAsset[] = [
  {
    id: "customer_master",
    name: "Customer Master",
    assetFamily: "Customer",
    description: "Golden customer record",
  } as ReferenceDataAsset,
  {
    id: "transactions",
    name: "Sales Transactions",
    assetFamily: "Sales",
    description: "Line-item sales",
  } as ReferenceDataAsset,
];

describe("classifyEstateTablesToAssets", () => {
  it("returns [] when there are no tables or no assets", async () => {
    expect(await classifyEstateTablesToAssets([], assets)).toEqual([]);
    expect(await classifyEstateTablesToAssets([{ fqn: "a.b.c" }], [])).toEqual([]);
  });

  it("maps tables via the injected LLM and ignores unknown asset ids", async () => {
    const out = await classifyEstateTablesToAssets(
      [{ fqn: "main.sales.customer" }, { fqn: "main.sales.orders" }],
      assets,
      {
        callLLM: async () =>
          JSON.stringify({
            mappings: [
              { fqn: "main.sales.customer", assetId: "customer_master" },
              { fqn: "main.sales.orders", assetId: "does_not_exist" },
            ],
          }),
      },
    );
    expect(out).toEqual([
      {
        fqn: "main.sales.customer",
        dataAssetId: "customer_master",
        dataAssetName: "Customer Master",
      },
    ]);
  });

  it("dedupes repeated fqns from the LLM", async () => {
    const out = await classifyEstateTablesToAssets([{ fqn: "main.sales.customer" }], assets, {
      callLLM: async () =>
        JSON.stringify({
          mappings: [
            { fqn: "main.sales.customer", assetId: "customer_master" },
            { fqn: "main.sales.customer", assetId: "transactions" },
          ],
        }),
    });
    expect(out).toHaveLength(1);
    expect(out[0].dataAssetId).toBe("customer_master");
  });

  it("falls back to token overlap when the LLM yields nothing", async () => {
    const out = await classifyEstateTablesToAssets([{ fqn: "main.sales.customer_dim" }], assets, {
      callLLM: async () => JSON.stringify({ mappings: [] }),
    });
    expect(out).toEqual([
      {
        fqn: "main.sales.customer_dim",
        dataAssetId: "customer_master",
        dataAssetName: "Customer Master",
      },
    ]);
  });

  it("falls back to token overlap when the LLM throws", async () => {
    const out = await classifyEstateTablesToAssets([{ fqn: "main.sales.transactions" }], assets, {
      callLLM: async () => {
        throw new Error("model down");
      },
    });
    expect(out[0].dataAssetId).toBe("transactions");
  });

  it("omits tables with no token overlap in the fallback", async () => {
    const out = await classifyEstateTablesToAssets([{ fqn: "main.sales.zzz_unrelated" }], assets, {
      callLLM: async () => "not json at all",
    });
    expect(out).toEqual([]);
  });
});
