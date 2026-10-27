import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockRequireUser,
  mockIsPortfolioAdmin,
  mockDeleteAllData,
  mockDeleteUserData,
  mockRunMigrations,
  mockGetOutcomeMap,
  mockDeleteOutcomeMap,
  mockUpdateOutcomeMap,
  mockGetDemoSession,
  mockGetDemoSessionTables,
  mockDeleteDemoSession,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn<(...args: unknown[]) => unknown>(),
  mockIsPortfolioAdmin: vi.fn<(...args: unknown[]) => unknown>(),
  mockDeleteAllData: vi.fn(async () => undefined),
  mockDeleteUserData: vi.fn(async () => undefined),
  mockRunMigrations: vi.fn(async () => undefined),
  mockGetOutcomeMap: vi.fn<(...args: unknown[]) => unknown>(),
  mockDeleteOutcomeMap: vi.fn<(...args: unknown[]) => unknown>(),
  mockUpdateOutcomeMap: vi.fn<(...args: unknown[]) => unknown>(),
  mockGetDemoSession: vi.fn<(...args: unknown[]) => unknown>(),
  mockGetDemoSessionTables: vi.fn<(...args: unknown[]) => unknown>(),
  mockDeleteDemoSession: vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => {
  const fn = () => undefined;
  const log = { info: fn, warn: fn, debug: fn, error: fn, child: () => log, timed: fn };
  return { logger: log, createScopedLogger: () => log, apiLogger: () => log };
});
vi.mock("@/lib/lakebase/schema", () => ({
  ensureMigrated: vi.fn(async () => undefined),
  runMigrations: mockRunMigrations,
}));
vi.mock("@/lib/lakebase/reset", () => ({
  deleteAllData: mockDeleteAllData,
  deleteUserData: mockDeleteUserData,
}));
vi.mock("@/lib/lakebase/activity-log", () => ({
  logActivity: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth/route-user", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth/route-user")>("@/lib/auth/route-user");
  return {
    ...actual,
    requireUser: (...args: unknown[]) => mockRequireUser(...args),
  };
});
vi.mock("@/lib/lakebase/portfolio-admins", () => ({
  isPortfolioAdmin: (...args: unknown[]) => mockIsPortfolioAdmin(...args),
}));
vi.mock("@/lib/lakebase/outcome-maps", () => ({
  getOutcomeMap: (...args: unknown[]) => mockGetOutcomeMap(...args),
  deleteOutcomeMap: (...args: unknown[]) => mockDeleteOutcomeMap(...args),
  updateOutcomeMap: (...args: unknown[]) => mockUpdateOutcomeMap(...args),
}));
vi.mock("@/lib/lakebase/demo-sessions", () => ({
  getDemoSession: (...args: unknown[]) => mockGetDemoSession(...args),
  getDemoSessionTables: (...args: unknown[]) => mockGetDemoSessionTables(...args),
  deleteDemoSession: (...args: unknown[]) => mockDeleteDemoSession(...args),
}));
vi.mock("@/lib/embeddings/store", () => ({
  deleteEmbeddingsBySource: vi.fn(async () => undefined),
}));

import { DELETE as deleteDataRoute } from "@/app/api/data/route";
import { POST as migrateRoute } from "@/app/api/migrate/route";
import {
  DELETE as deleteOutcomeMapRoute,
  PATCH as patchOutcomeMapRoute,
} from "@/app/api/outcome-maps/[id]/route";
import {
  cleanupDemoSession,
  isSafeDemoSchemaName,
  isTableInSessionScope,
} from "@/lib/demo/cleanup";

describe("PR-02 security admin & cleanup guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("DELETE /api/data (factory reset vs user-scoped reset)", () => {
    it("rejects non-admin callers attempting workspace-wide delete-all-data with 403", async () => {
      mockRequireUser.mockResolvedValue({ email: "member@company.com", oboToken: "tok" });
      mockIsPortfolioAdmin.mockResolvedValue(false);

      const req = new NextRequest("http://localhost/api/data", {
        method: "DELETE",
        headers: { "x-confirm-delete": "delete-all-data" },
      });

      const resp = await deleteDataRoute(req);
      expect(resp.status).toBe(403);
      expect(mockDeleteAllData).not.toHaveBeenCalled();
    });

    it("allows org-admin callers to execute delete-all-data", async () => {
      mockRequireUser.mockResolvedValue({ email: "admin@company.com", oboToken: "tok" });
      mockIsPortfolioAdmin.mockResolvedValue(true);

      const req = new NextRequest("http://localhost/api/data", {
        method: "DELETE",
        headers: { "x-confirm-delete": "delete-all-data" },
      });

      const resp = await deleteDataRoute(req);
      expect(resp.status).toBe(200);
      expect(mockDeleteAllData).toHaveBeenCalledTimes(1);
    });

    it("allows standard users to delete only their own data with x-confirm-delete: delete-my-data", async () => {
      mockRequireUser.mockResolvedValue({ email: "alice@company.com", oboToken: "tok" });

      const req = new NextRequest("http://localhost/api/data", {
        method: "DELETE",
        headers: { "x-confirm-delete": "delete-my-data" },
      });

      const resp = await deleteDataRoute(req);
      expect(resp.status).toBe(200);
      expect(mockDeleteUserData).toHaveBeenCalledWith("alice@company.com");
      expect(mockDeleteAllData).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/migrate", () => {
    it("blocks non-admin users with 403", async () => {
      mockRequireUser.mockResolvedValue({ email: "member@company.com", oboToken: "tok" });
      mockIsPortfolioAdmin.mockResolvedValue(false);

      const req = new NextRequest("http://localhost/api/migrate", { method: "POST" });
      const resp = await migrateRoute(req);
      expect(resp.status).toBe(403);
      expect(mockRunMigrations).not.toHaveBeenCalled();
    });
  });

  describe("/api/outcome-maps/[id] ownership & admin guard", () => {
    it("prevents User B from deleting or patching User A's custom outcome map", async () => {
      mockRequireUser.mockResolvedValue({ email: "bob@company.com", oboToken: "tok" });
      mockIsPortfolioAdmin.mockResolvedValue(false);
      mockGetOutcomeMap.mockResolvedValue({
        id: "map-1",
        industryId: "custom-ind",
        name: "Custom",
        createdBy: "alice@company.com",
      });

      const delReq = new NextRequest("http://localhost/api/outcome-maps/map-1", {
        method: "DELETE",
      });
      const delResp = await deleteOutcomeMapRoute(delReq, {
        params: Promise.resolve({ id: "map-1" }),
      });
      expect(delResp.status).toBe(403);
      expect(mockDeleteOutcomeMap).not.toHaveBeenCalled();

      const patchReq = new NextRequest("http://localhost/api/outcome-maps/map-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Hijacked" }),
      });
      const patchResp = await patchOutcomeMapRoute(patchReq, {
        params: Promise.resolve({ id: "map-1" }),
      });
      expect(patchResp.status).toBe(403);
      expect(mockUpdateOutcomeMap).not.toHaveBeenCalled();
    });

    it("allows the creator to delete their own custom outcome map", async () => {
      mockRequireUser.mockResolvedValue({ email: "alice@company.com", oboToken: "tok" });
      mockIsPortfolioAdmin.mockResolvedValue(false);
      mockGetOutcomeMap.mockResolvedValue({
        id: "map-1",
        industryId: "custom-ind",
        name: "Custom",
        createdBy: "alice@company.com",
      });
      mockDeleteOutcomeMap.mockResolvedValue(true);

      const delReq = new NextRequest("http://localhost/api/outcome-maps/map-1", {
        method: "DELETE",
      });
      const delResp = await deleteOutcomeMapRoute(delReq, {
        params: Promise.resolve({ id: "map-1" }),
      });
      expect(delResp.status).toBe(200);
      expect(mockDeleteOutcomeMap).toHaveBeenCalledWith("map-1");
    });
  });

  describe("cleanupDemoSession scope guards", () => {
    it("identifies safe demo schema names and rejects production/shared schemas", () => {
      expect(isSafeDemoSchemaName("forge_demo_acme")).toBe(true);
      expect(isSafeDemoSchemaName("anz_commercial_fraud_demo")).toBe(true);
      expect(isSafeDemoSchemaName("demo_retail")).toBe(true);
      expect(isSafeDemoSchemaName("default")).toBe(false);
      expect(isSafeDemoSchemaName("production")).toBe(false);
      expect(isSafeDemoSchemaName("gold")).toBe(false);
      expect(isSafeDemoSchemaName("customer_analytics")).toBe(false);
    });

    it("refuses to drop tables outside session catalog.schema or drop non-demo schemas", async () => {
      mockGetDemoSession.mockResolvedValue({
        id: "sess-1",
        customerName: "Acme",
        catalogName: "main",
        schemaName: "production",
      });
      mockGetDemoSessionTables.mockResolvedValue([
        "main.production.demo_tbl",
        "other_cat.other_sch.critical_tbl",
      ]);

      const executedSql: string[] = [];
      const fakeSql = {
        execute: vi.fn(async (sql: string) => {
          executedSql.push(sql);
          return { columns: [], rows: [], totalRowCount: 0, truncated: false };
        }),
        executeMapped: vi.fn(async () => []),
        executeScalar: vi.fn(async () => null),
      };

      const res = await cleanupDemoSession("sess-1", fakeSql);
      expect(res.tablesDropped).toBe(1);
      expect(res.tablesFailed).toEqual(["other_cat.other_sch.critical_tbl"]);
      expect(res.schemaDropped).toBe(false);
      expect(executedSql).toEqual(["DROP TABLE IF EXISTS main.production.demo_tbl"]);
    });

    it("checks table FQN scope accurately", () => {
      expect(isTableInSessionScope("`main`.`acme_demo`.`orders`", "main", "acme_demo")).toBe(true);
      expect(isTableInSessionScope("main.other_schema.orders", "main", "acme_demo")).toBe(false);
    });
  });
});
