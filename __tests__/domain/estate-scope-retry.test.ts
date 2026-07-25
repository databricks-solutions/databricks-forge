import { describe, expect, it, vi } from "vitest";
import { retryEstateScope } from "@/lib/domain/estate-scope-retry";

describe("retryEstateScope", () => {
  it("posts the selected scope and accepts a 202 response", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ status: "retried", scopeId: "s1" }), { status: 202 }),
      );

    await expect(retryEstateScope("p1", "s1", fetcher)).resolves.toEqual({
      ok: true,
      scopeId: "s1",
    });
    expect(fetcher).toHaveBeenCalledWith("/api/estate-programs/p1/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scopeId: "s1" }),
    });
  });

  it.each([
    [409, "active_work"],
    [422, "max_attempts"],
  ] as const)("preserves the precise %s rejection reason", async (status, reason) => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: "rejected", reason }), { status }));

    await expect(retryEstateScope("p1", "s1", fetcher)).resolves.toEqual({
      ok: false,
      status,
      reason,
    });
  });
});
