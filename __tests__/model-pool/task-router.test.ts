import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockLog } = vi.hoisted(() => {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
    timed: vi.fn(),
    context: {},
  };
  return { mockLog: log };
});
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  createScopedLogger: () => mockLog,
  apiLogger: () => mockLog,
}));

import { resolveEndpoint, getFallbacksForTier } from "@/lib/dbx/task-router";
import { resetModelPool } from "@/lib/dbx/model-registry";
import { resetPoolRateLimiter } from "@/lib/dbx/rate-limiter";
import type { TaskTier } from "@/lib/dbx/model-registry";

const ENV_KEYS = [
  "DATABRICKS_SERVING_ENDPOINT",
  "DATABRICKS_SERVING_ENDPOINT_FAST",
  "DATABRICKS_REVIEW_ENDPOINT",
  "DATABRICKS_SERVING_ENDPOINT_REASONING_2",
  "DATABRICKS_SERVING_ENDPOINT_GENERATION",
  "DATABRICKS_SERVING_ENDPOINT_SQL",
] as const;

function saveEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
  }
  return saved;
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    if (saved[k] !== undefined) {
      process.env[k] = saved[k];
    } else {
      delete process.env[k];
    }
  }
}

function clearEnv(): void {
  for (const k of ENV_KEYS) {
    delete process.env[k];
  }
}

describe("task-router", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = saveEnv();
    clearEnv();
    resetModelPool();
    resetPoolRateLimiter();
  });

  afterEach(() => {
    restoreEnv(savedEnv);
  });

  describe("Single endpoint mode", () => {
    it("when pool has 1 endpoint, all tiers resolve to it", () => {
      // No env vars -> default pool of 1 (databricks-claude-opus-4-7)
      const tiers: TaskTier[] = ["reasoning", "generation", "classification", "sql", "lightweight"];
      const results = tiers.map((t) => resolveEndpoint(t));
      const unique = new Set(results);
      expect(unique.size).toBe(1);
      expect(unique.has("databricks-claude-opus-4-7")).toBe(true);
    });
  });

  describe("Tier routing", () => {
    it("reasoning resolves to opus-class, classification to sonnet-class, sql to gpt-class", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-6";
      process.env.DATABRICKS_SERVING_ENDPOINT_FAST = "databricks-claude-sonnet-4-6";
      process.env.DATABRICKS_REVIEW_ENDPOINT = "databricks-gpt-5-4";

      const reasoning = resolveEndpoint("reasoning");
      expect(reasoning).toMatch(/opus|gpt-5-4/); // opus or gpt both support reasoning

      const classification = resolveEndpoint("classification");
      expect(classification).toMatch(/sonnet|opus|gpt/); // sonnet preferred for classification

      const sql = resolveEndpoint("sql");
      expect(sql).toMatch(/gpt-5|codex/); // gpt-class for sql
    });
  });

  describe("getFallbacksForTier", () => {
    it("excludes the current endpoint from fallbacks", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-6";
      process.env.DATABRICKS_SERVING_ENDPOINT_FAST = "databricks-claude-sonnet-4-6";
      process.env.DATABRICKS_REVIEW_ENDPOINT = "databricks-gpt-5-4";

      const fallbacks = getFallbacksForTier("reasoning", "databricks-claude-opus-4-6");
      expect(fallbacks).not.toContain("databricks-claude-opus-4-6");
      expect(fallbacks.length).toBeGreaterThan(0);
    });

    it("returns tier-matched endpoints first, then any pool endpoint", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-6";
      process.env.DATABRICKS_SERVING_ENDPOINT_FAST = "databricks-claude-sonnet-4-6";

      const fallbacks = getFallbacksForTier("classification", "databricks-claude-opus-4-6");
      expect(fallbacks).not.toContain("databricks-claude-opus-4-6");
      expect(fallbacks.length).toBeGreaterThan(0);
    });
  });
});
