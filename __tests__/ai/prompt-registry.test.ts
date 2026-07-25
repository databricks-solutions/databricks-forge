import { afterEach, describe, expect, it, vi } from "vitest";

const findFirstMock = vi.fn();
const updateManyMock = vi.fn().mockResolvedValue({ count: 1 });

vi.mock("@/lib/prisma", () => ({
  withPrisma: vi.fn(async (fn: (p: unknown) => unknown) =>
    fn({
      forgePromptVersion: {
        findFirst: findFirstMock,
        updateMany: updateManyMock,
      },
    }),
  ),
}));

import {
  registerDefaultPrompt,
  getPrompt,
  interpolatePrompt,
  setActiveVersion,
  clearAllDefaults,
  clearActiveCache,
} from "@/lib/ai/prompt-registry";

afterEach(() => {
  clearAllDefaults();
  clearActiveCache();
  findFirstMock.mockReset();
  updateManyMock.mockClear();
});

describe("prompt registry", () => {
  it("returns the in-code default when Lakebase has no active row", async () => {
    findFirstMock.mockResolvedValue(null);
    registerDefaultPrompt("genie.passes.test", 1, "Hello {{name}}");
    const resolved = await getPrompt("genie.passes.test");
    expect(resolved.source).toBe("in-code");
    expect(interpolatePrompt(resolved, { name: "Forge" })).toBe("Hello Forge");
  });

  it("uses the Lakebase template when one is active", async () => {
    registerDefaultPrompt("k", 1, "Default {{x}}");
    findFirstMock.mockResolvedValue({ template: "Override {{x}}", version: 5 });
    const resolved = await getPrompt("k");
    expect(resolved.source).toBe("lakebase");
    expect(resolved.version).toBe(5);
    expect(interpolatePrompt(resolved, { x: 42 })).toBe("Override 42");
  });

  it("falls back to in-code when Lakebase template is missing variables", async () => {
    registerDefaultPrompt("k2", 1, "Default {{x}} {{y}}");
    findFirstMock.mockResolvedValue({
      template: "Override {{missing}}",
      version: 2,
    });
    const resolved = await getPrompt("k2");
    expect(interpolatePrompt(resolved, { x: "1", y: "2" })).toBe("Default 1 2");
  });

  it("throws when no in-code default and no Lakebase row exists", async () => {
    findFirstMock.mockResolvedValue(null);
    await expect(getPrompt("never.registered")).rejects.toThrow(/no in-code default/);
  });

  it("setActiveVersion calls updateMany twice (off + on)", async () => {
    registerDefaultPrompt("k3", 1, "x");
    await setActiveVersion("k3", 3);
    expect(updateManyMock).toHaveBeenCalledTimes(2);
  });
});
