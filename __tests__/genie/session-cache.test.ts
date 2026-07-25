import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueMock = vi.fn();
const upsertMock = vi.fn();
const deleteManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  withPrisma: (fn: (p: unknown) => unknown) =>
    fn({
      forgeAgentSession: {
        findUnique: findUniqueMock,
        upsert: upsertMock,
        deleteMany: deleteManyMock,
      },
    }),
}));

import {
  getSession,
  putSession,
  deleteSession,
  clearL1,
} from "@/lib/genie/session-cache";

beforeEach(() => {
  clearL1();
  findUniqueMock.mockReset();
  upsertMock.mockReset();
  deleteManyMock.mockReset();
  upsertMock.mockResolvedValue(undefined);
  deleteManyMock.mockResolvedValue({ count: 0 });
});

afterEach(() => clearL1());

describe("session-cache", () => {
  it("returns null when no entry exists", async () => {
    findUniqueMock.mockResolvedValue(null);
    expect(await getSession("missing")).toBeNull();
  });

  it("hydrates L1 from L2 on first read", async () => {
    findUniqueMock.mockResolvedValue({
      payload: JSON.stringify({ step: 3 }),
      expiresAt: new Date(Date.now() + 60_000),
      ownerEmail: "a@b",
    });
    const out = await getSession<{ step: number }>("k1");
    expect(out).toEqual({ step: 3 });

    // Second read shouldn't hit L2
    findUniqueMock.mockClear();
    expect(await getSession<{ step: number }>("k1")).toEqual({ step: 3 });
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("respects expiration in L2", async () => {
    findUniqueMock.mockResolvedValue({
      payload: JSON.stringify({}),
      expiresAt: new Date(Date.now() - 1000),
      ownerEmail: null,
    });
    expect(await getSession("expired")).toBeNull();
  });

  it("putSession writes both layers", async () => {
    await putSession("k2", { v: 1 }, { ttlMs: 5_000, ownerEmail: "x@y" });
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(await getSession("k2", { l1Only: true })).toEqual({ v: 1 });
  });

  it("putSession with persist=false skips L2", async () => {
    await putSession("k3", { v: 7 }, { persist: false });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("deleteSession clears both layers", async () => {
    await putSession("k4", "x", { persist: false });
    await deleteSession("k4");
    expect(await getSession("k4", { l1Only: true })).toBeNull();
    expect(deleteManyMock).toHaveBeenCalledTimes(1);
  });
});
