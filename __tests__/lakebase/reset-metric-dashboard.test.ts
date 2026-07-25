import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  metricDeleteMany: vi.fn(async () => ({ count: 1 })),
  transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
}));

vi.mock("@/lib/pipeline/engine", () => ({ cancelAllPipelines: vi.fn(async () => 0) }));
vi.mock("@/lib/demo/cleanup", () => ({ cleanupDemoSession: vi.fn() }));
vi.mock("@/lib/ports/defaults/databricks-sql-executor", () => ({
  databricksSqlExecutor: {},
}));
vi.mock("@/lib/demo/config", () => ({ invalidateDemoModeCache: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T>(callback: (prisma: unknown) => Promise<T>) => {
    const delegate = new Proxy(
      {},
      {
        get: () => vi.fn(async () => ({ count: 0 })),
      },
    );
    const prisma = new Proxy(
      {
        $transaction: mocks.transaction,
        $executeRawUnsafe: vi.fn(async () => 0),
        forgeDemoSession: {
          findMany: vi.fn(async () => []),
          deleteMany: vi.fn(async () => ({ count: 0 })),
        },
        forgeMetricViewProposal: { deleteMany: mocks.metricDeleteMany },
      },
      {
        get(target, property) {
          if (property in target) return target[property as keyof typeof target];
          return delegate;
        },
      },
    );
    return callback(prisma);
  },
}));

import { deleteAllData } from "@/lib/lakebase/reset";

describe("factory reset metric/dashboard lifecycle", () => {
  it("explicitly deletes standalone metric-view proposals", async () => {
    await deleteAllData();

    expect(mocks.metricDeleteMany).toHaveBeenCalledTimes(1);
  });
});
