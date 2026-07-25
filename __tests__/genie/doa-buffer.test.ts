import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computePatchSignature,
  filterCandidatesByDoa,
  isDoa,
  recordDoa,
  clearAllDoaBuffers,
  loadDoaBuffer,
} from "@/lib/genie/doa-buffer";

vi.mock("@/lib/lakebase/auto-improve", () => {
  return {
    loadDoaSignatures: vi.fn().mockResolvedValue(new Set<string>(["seed-from-db"])),
    recordDoaSignature: vi.fn().mockResolvedValue(undefined),
  };
});

afterEach(() => {
  clearAllDoaBuffers();
});

describe("computePatchSignature", () => {
  it("is stable across object key order", () => {
    const a = computePatchSignature({
      strategy: "instruction_generation",
      targetFieldPath: "instructions.text_instructions[0].content",
      delta: { foo: "bar", nested: { a: 1, b: 2 } },
    });
    const b = computePatchSignature({
      strategy: "instruction_generation",
      targetFieldPath: "instructions.text_instructions[0].content",
      delta: { nested: { b: 2, a: 1 }, foo: "bar" },
    });
    expect(a).toBe(b);
  });

  it("changes when strategy changes", () => {
    const a = computePatchSignature({
      strategy: "instruction_generation",
      targetFieldPath: "p",
      delta: 1,
    });
    const b = computePatchSignature({
      strategy: "trusted_assets",
      targetFieldPath: "p",
      delta: 1,
    });
    expect(a).not.toBe(b);
  });

  it("changes when delta changes", () => {
    const a = computePatchSignature({
      strategy: "s",
      targetFieldPath: "p",
      delta: { x: 1 },
    });
    const b = computePatchSignature({ strategy: "s", targetFieldPath: "p", delta: { x: 2 } });
    expect(a).not.toBe(b);
  });
});

describe("DOA buffer in-memory", () => {
  it("filterCandidatesByDoa drops previously failed signatures", async () => {
    await recordDoa({ sessionId: "s1", signature: "DEAD", strategy: "x" });
    const { kept, dropped } = filterCandidatesByDoa("s1", [
      { signature: "DEAD", payload: 1 },
      { signature: "ALIVE", payload: 2 },
    ]);
    expect(kept.map((k) => k.signature)).toEqual(["ALIVE"]);
    expect(dropped.map((k) => k.signature)).toEqual(["DEAD"]);
  });

  it("isDoa returns true after recordDoa", async () => {
    await recordDoa({ sessionId: "s1", signature: "X" });
    expect(isDoa("s1", "X")).toBe(true);
    expect(isDoa("s2", "X")).toBe(false);
  });
});

describe("loadDoaBuffer", () => {
  it("hydrates from Lakebase via the mock", async () => {
    const set = await loadDoaBuffer("session-from-db");
    expect(set.has("seed-from-db")).toBe(true);
  });
});
