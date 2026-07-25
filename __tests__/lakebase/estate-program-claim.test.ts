import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeScopeDb } from "../helpers/fake-scope-db";

// Task 4 changed the claim contract: it now runs inside a Serializable
// transaction, claims ONLY `planned` scopes (never `failed`), and refuses to
// enqueue a second scope while one is queued/running. These tests exercise the
// real function against an in-memory DB with those semantics.
const db = new FakeScopeDb();

vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T>(fn: (prisma: unknown) => Promise<T>) => fn(db.client),
}));

import { claimNextPlannedScope } from "@/lib/lakebase/estate-programs";

beforeEach(() => {
  db.scopes = [];
  db.scans = [];
  db.failNextTxWithSerialization = 0;
});

describe("claimNextPlannedScope (atomic, planned-only)", () => {
  it("claims a planned scope and stamps the scanId", async () => {
    db.seedScope({ id: "scope-1", programId: "p1", sequence: 0, status: "planned" });
    const result = await claimNextPlannedScope("p1", "scan-1");
    expect(result).toMatchObject({ id: "scope-1", status: "queued", scanId: "scan-1" });
    expect(db.get("scope-1")!.status).toBe("queued");
  });

  it("returns null when no PLANNED scope exists (a lone failed scope is not claimable)", async () => {
    db.seedScope({ id: "f", programId: "p1", sequence: 0, status: "failed", attemptCount: 1 });
    expect(await claimNextPlannedScope("p1", "scan-1")).toBeNull();
    expect(db.get("f")!.status).toBe("failed");
  });

  it("returns null when a scope is already queued/running (no double-enqueue)", async () => {
    db.seedScope({ id: "run", programId: "p1", sequence: 0, status: "running", scanId: "x" });
    db.seedScope({ id: "planned", programId: "p1", sequence: 1, status: "planned" });
    expect(await claimNextPlannedScope("p1", "scan-1")).toBeNull();
    expect(db.get("planned")!.status).toBe("planned");
  });
});
