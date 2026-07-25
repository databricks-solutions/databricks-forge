/**
 * Unit tests for the halve-batch retry helper used by the financial
 * quantification pass.
 *
 * Regression: previously a single failing LLM call for a 25-use-case batch
 * resulted in zero rows in `forge_value_estimates` for the entire batch.
 * After the fix, persistent empty responses cause the helper to split the
 * batch in half and retry, recovering most of the run even if some
 * sub-batches still fail.
 */

import { describe, it, expect, vi } from "vitest";
import { halveBatchRetry } from "@/lib/pipeline/steps/business-value-analysis";

type Item = { id: string };
type Result = { use_case_id: string; value_mid: number };

function items(n: number): Item[] {
  return Array.from({ length: n }, (_, i) => ({ id: `uc-${i + 1}` }));
}

function ok(item: Item): Result {
  return { use_case_id: item.id, value_mid: 100 };
}

describe("halveBatchRetry", () => {
  it("returns all results when the executor succeeds on the full batch", async () => {
    const batch = items(5);
    const executor = vi.fn(async (sub: Item[]) => sub.map(ok));

    const { estimates, missingItemIds } = await halveBatchRetry(batch, executor);

    expect(executor).toHaveBeenCalledTimes(1);
    expect(estimates).toHaveLength(5);
    expect(missingItemIds).toEqual([]);
  });

  it("halves the batch on empty executor result and recovers via the halved retry", async () => {
    const batch = items(8);
    let call = 0;
    const seenSizes: number[] = [];
    const executor = vi.fn(async (sub: Item[]) => {
      call++;
      seenSizes.push(sub.length);
      // Fail the first call (full batch); succeed for both halved sub-batches.
      if (call === 1) return [];
      return sub.map(ok);
    });

    const { estimates, missingItemIds } = await halveBatchRetry(batch, executor);

    expect(seenSizes[0]).toBe(8);
    // After the first failure the helper splits 8 -> [4, 4] and retries.
    expect(seenSizes.slice(1).sort()).toEqual([4, 4]);
    expect(estimates).toHaveLength(8);
    expect(missingItemIds).toEqual([]);
  });

  it("halves twice (depth 2) when the first halving still fails on one side", async () => {
    const batch = items(8);
    const executor = vi.fn(async (sub: Item[], depth: number) => {
      // depth=0 (size 8): fail
      // depth=1 (size 4): fail
      // depth=2 (size 2): succeed
      if (depth < 2) return [];
      return sub.map(ok);
    });

    const { estimates, missingItemIds } = await halveBatchRetry(batch, executor, {
      maxHalvings: 2,
    });

    expect(estimates).toHaveLength(8);
    expect(missingItemIds).toEqual([]);
  });

  it("gives up at maxHalvings depth and reports missing item ids", async () => {
    const batch = items(8);
    const executor = vi.fn(async () => []); // always empty

    const onGiveUp = vi.fn();
    const { estimates, missingItemIds } = await halveBatchRetry(batch, executor, {
      maxHalvings: 1,
      onGiveUp,
    });

    expect(estimates).toEqual([]);
    expect(missingItemIds).toEqual(batch.map((b) => b.id));
    expect(onGiveUp).toHaveBeenCalled();
  });

  it("treats a thrown error the same as an empty result set", async () => {
    const batch = items(4);
    let call = 0;
    const executor = vi.fn(async (sub: Item[]) => {
      call++;
      if (call === 1) throw new Error("boom: empty content");
      return sub.map(ok);
    });

    const { estimates, missingItemIds } = await halveBatchRetry(batch, executor);

    expect(estimates).toHaveLength(4);
    expect(missingItemIds).toEqual([]);
  });

  it("returns partial recovery: keeps the half that succeeds, reports the half that fails", async () => {
    const batch = items(8);
    const executor = vi.fn(async (sub: Item[]) => {
      if (sub.length === 8) return [];
      // After halving to two batches of 4, fail one half and succeed the other.
      // The first half processed has ids uc-1..uc-4.
      if (sub[0]?.id === "uc-1") return sub.map(ok);
      return [];
    });

    const { estimates, missingItemIds } = await halveBatchRetry(batch, executor, {
      maxHalvings: 1,
    });

    expect(estimates.map((r) => r.use_case_id).sort()).toEqual([
      "uc-1",
      "uc-2",
      "uc-3",
      "uc-4",
    ]);
    expect(missingItemIds.sort()).toEqual(["uc-5", "uc-6", "uc-7", "uc-8"]);
  });

  it("invokes onHalving with from/to sizes and depth", async () => {
    const batch = items(8);
    const onHalving = vi.fn();
    let call = 0;
    const executor = vi.fn(async (sub: Item[]) => {
      call++;
      if (call === 1) return []; // full batch fails
      return sub.map(ok);
    });

    await halveBatchRetry(batch, executor, { onHalving });

    expect(onHalving).toHaveBeenCalledTimes(1);
    const arg = onHalving.mock.calls[0][0];
    expect(arg.from).toBe(8);
    expect(arg.to).toEqual([4, 4]);
    expect(arg.depth).toBe(1);
  });
});
