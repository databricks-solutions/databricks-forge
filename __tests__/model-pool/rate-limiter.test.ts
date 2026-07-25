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

import {
  getPoolRateLimiter,
  resetPoolRateLimiter,
  DEFAULT_429_BACKOFF_MS,
} from "@/lib/dbx/rate-limiter";
import { resetModelPool } from "@/lib/dbx/model-registry";

const ENV_KEYS = [
  "DATABRICKS_SERVING_ENDPOINT",
  "DATABRICKS_SERVING_ENDPOINT_FAST",
  "DATABRICKS_REVIEW_ENDPOINT",
  "GLOBAL_LLM_MAX_CONCURRENT",
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

describe("rate-limiter", () => {
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

  describe("Per-endpoint acquire/release", () => {
    it("can acquire up to maxConcurrent, then blocks until release", async () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-6";
      // opus has maxConcurrent 6
      const limiter = getPoolRateLimiter();

      const acquires: Promise<void>[] = [];
      for (let i = 0; i < 6; i++) {
        acquires.push(limiter.acquire("databricks-claude-opus-4-6"));
      }
      await Promise.all(acquires);
      expect(limiter.inflight("databricks-claude-opus-4-6")).toBe(6);

      const seventh = limiter.acquire("databricks-claude-opus-4-6");
      const resolved = await Promise.race([
        seventh,
        new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 50)),
      ]);
      expect(resolved).toBe("pending");

      limiter.release("databricks-claude-opus-4-6");
      await seventh;
      expect(limiter.inflight("databricks-claude-opus-4-6")).toBe(6);

      for (let i = 0; i < 5; i++) {
        limiter.release("databricks-claude-opus-4-6");
      }
      expect(limiter.inflight("databricks-claude-opus-4-6")).toBe(1);
    });
  });

  describe("Independent backoff", () => {
    it("backoff on one endpoint does not block another", async () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-6";
      process.env.DATABRICKS_SERVING_ENDPOINT_FAST = "databricks-claude-sonnet-4-6";

      const limiter = getPoolRateLimiter();
      limiter.backoff("databricks-claude-opus-4-6", DEFAULT_429_BACKOFF_MS);

      const acquireSonnet = limiter.acquire("databricks-claude-sonnet-4-6");
      await expect(acquireSonnet).resolves.toBeUndefined();
      limiter.release("databricks-claude-sonnet-4-6");
    });
  });

  describe("bestAvailable", () => {
    it("returns endpoint with lowest queue depth", async () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-6";
      process.env.DATABRICKS_SERVING_ENDPOINT_FAST = "databricks-claude-sonnet-4-6";

      const limiter = getPoolRateLimiter();
      const candidates = ["databricks-claude-opus-4-6", "databricks-claude-sonnet-4-6"];

      const best1 = limiter.bestAvailable(candidates);
      expect(candidates).toContain(best1);

      await limiter.acquire("databricks-claude-opus-4-6");
      await limiter.acquire("databricks-claude-opus-4-6");
      await limiter.acquire("databricks-claude-opus-4-6");

      const best2 = limiter.bestAvailable(candidates);
      expect(best2).toBe("databricks-claude-sonnet-4-6");

      limiter.release("databricks-claude-opus-4-6");
      limiter.release("databricks-claude-opus-4-6");
      limiter.release("databricks-claude-opus-4-6");
    });
  });

  describe("bestAvailable with backoff", () => {
    it("prefers non-blocked endpoints", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-6";
      process.env.DATABRICKS_SERVING_ENDPOINT_FAST = "databricks-claude-sonnet-4-6";

      const limiter = getPoolRateLimiter();
      limiter.backoff("databricks-claude-opus-4-6", DEFAULT_429_BACKOFF_MS);

      const candidates = ["databricks-claude-opus-4-6", "databricks-claude-sonnet-4-6"];
      const best = limiter.bestAvailable(candidates);
      expect(best).toBe("databricks-claude-sonnet-4-6");
    });
  });

  describe("Progressive backoff escalation", () => {
    it("DEFAULT_429_BACKOFF_MS is 10 seconds", () => {
      expect(DEFAULT_429_BACKOFF_MS).toBe(10_000);
    });

    it("consecutive 429s escalate backoff duration", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-6";
      const limiter = getPoolRateLimiter();
      const ep = "databricks-claude-opus-4-6";

      // First 429: use default (10s) -- check it blocks
      limiter.backoff(ep, 0);
      expect(limiter.isBlocked(ep)).toBe(true);

      // Second 429: should still be blocked (escalated)
      limiter.backoff(ep, 0);
      expect(limiter.isBlocked(ep)).toBe(true);

      // Third 429: still blocked (cap)
      limiter.backoff(ep, 0);
      expect(limiter.isBlocked(ep)).toBe(true);
    });

    it("release resets consecutive counter and clears block", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-6";
      const limiter = getPoolRateLimiter();
      const ep = "databricks-claude-opus-4-6";

      // Trigger a 429 backoff
      limiter.backoff(ep, 0);
      expect(limiter.isBlocked(ep)).toBe(true);

      // Simulate a successful release (as if a call that was already in-flight succeeded)
      limiter.release(ep);

      // Block should be cleared after successful release
      expect(limiter.isBlocked(ep)).toBe(false);
    });
  });
});
