import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeScopeDb } from "../helpers/fake-scope-db";

const db = new FakeScopeDb();

vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T,>(fn: (prisma: unknown) => Promise<T>) => fn(db.client),
}));

import { addProgramScope, addProgramScopes } from "@/lib/lakebase/estate-programs";

beforeEach(() => {
  db.scopes = [];
  db.scans = [];
  db.failNextTxWithSerialization = 0;
});

describe("addProgramScope persists estate-context scope fields", () => {
  it("writes inclusionPatterns / workspaceId / teamLabel on single insert", async () => {
    const id = await addProgramScope("p1", {
      label: "Upstream",
      ucMetadata: "cat.up",
      inclusionPatterns: "fact_*",
      workspaceId: "ws-1",
      teamLabel: "Data Platform",
    });
    const row = db.get(id)!;
    expect(row.inclusionPatterns).toBe("fact_*");
    expect(row.workspaceId).toBe("ws-1");
    expect(row.teamLabel).toBe("Data Platform");
  });

  it("writes the fields on bulk insert too", async () => {
    const count = await addProgramScopes("p1", [
      { label: "a", ucMetadata: "cat.a", inclusionPatterns: "dim_*", workspaceId: "ws-a", teamLabel: "A" },
      { label: "b", ucMetadata: "cat.b" },
    ]);
    expect(count).toBe(2);
    const a = db.scopes.find((s) => s.ucMetadata === "cat.a")!;
    expect(a.inclusionPatterns).toBe("dim_*");
    expect(a.workspaceId).toBe("ws-a");
    expect(a.teamLabel).toBe("A");
    const b = db.scopes.find((s) => s.ucMetadata === "cat.b")!;
    expect(b.inclusionPatterns).toBeNull();
    expect(b.workspaceId).toBeNull();
    expect(b.teamLabel).toBeNull();
  });
});
