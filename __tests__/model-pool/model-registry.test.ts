import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getModelPool,
  getEndpointsForTier,
  isMultiEndpointPool,
  resetModelPool,
  getModelCapabilities,
  type TaskTier,
} from "@/lib/dbx/model-registry";

const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  child: vi.fn(),
  timed: vi.fn(),
  context: {},
};
mockLog.child.mockReturnValue(mockLog);
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  createScopedLogger: () => mockLog,
  apiLogger: () => mockLog,
}));

const ENV_KEYS = [
  "DATABRICKS_SERVING_ENDPOINT",
  "DATABRICKS_SERVING_ENDPOINT_FAST",
  "DATABRICKS_REVIEW_ENDPOINT",
  "DATABRICKS_SERVING_ENDPOINT_REASONING_2",
  "DATABRICKS_SERVING_ENDPOINT_GENERATION",
  "DATABRICKS_SERVING_ENDPOINT_SQL",
  "DATABRICKS_SERVING_ENDPOINT_LIGHTWEIGHT",
  "DATABRICKS_ALLOWED_MODELS",
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

describe("model-registry", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = saveEnv();
    clearEnv();
    resetModelPool();
  });

  afterEach(() => {
    restoreEnv(savedEnv);
  });

  describe("Default pool", () => {
    it("when no env vars set, pool has 1 endpoint (hardcoded default)", () => {
      const pool = getModelPool();
      expect(pool).toHaveLength(1);
      expect(pool[0].name).toBe("databricks-claude-opus-4-7");
    });
  });

  describe("Legacy env vars", () => {
    it("when DATABRICKS_SERVING_ENDPOINT, _FAST, _REVIEW are set, pool has up to 3 endpoints", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-6";
      process.env.DATABRICKS_SERVING_ENDPOINT_FAST = "databricks-claude-sonnet-4-6";
      process.env.DATABRICKS_REVIEW_ENDPOINT = "databricks-gpt-5-4";

      const pool = getModelPool();
      expect(pool.length).toBeGreaterThanOrEqual(1);
      expect(pool.length).toBeLessThanOrEqual(3);
      const names = pool.map((ep) => ep.name);
      expect(names).toContain("databricks-claude-opus-4-6");
      expect(names).toContain("databricks-claude-sonnet-4-6");
      expect(names).toContain("databricks-gpt-5-4");
    });
  });

  describe("Extended pool", () => {
    it("when _REASONING_2, _GENERATION, _SQL are also set, pool has up to 6 endpoints", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-6";
      process.env.DATABRICKS_SERVING_ENDPOINT_FAST = "databricks-claude-sonnet-4-6";
      process.env.DATABRICKS_REVIEW_ENDPOINT = "databricks-gpt-5-4";
      process.env.DATABRICKS_SERVING_ENDPOINT_REASONING_2 = "databricks-claude-opus-4-5";
      process.env.DATABRICKS_SERVING_ENDPOINT_GENERATION = "databricks-claude-sonnet-4-5";
      process.env.DATABRICKS_SERVING_ENDPOINT_SQL = "databricks-gemini-3-flash";

      const pool = getModelPool();
      expect(pool.length).toBeGreaterThanOrEqual(3);
      expect(pool.length).toBeLessThanOrEqual(6);
      const names = new Set(pool.map((ep) => ep.name));
      expect(names).toContain("databricks-claude-opus-4-6");
      expect(names).toContain("databricks-claude-sonnet-4-6");
      expect(names).toContain("databricks-gpt-5-4");
      expect(names).toContain("databricks-claude-opus-4-5");
      expect(names).toContain("databricks-claude-sonnet-4-5");
      expect(names).toContain("databricks-gemini-3-flash");
    });
  });

  describe("Deduplication", () => {
    it("when two env vars point to the same endpoint name, pool deduplicates", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-6";
      process.env.DATABRICKS_SERVING_ENDPOINT_FAST = "databricks-claude-opus-4-6";
      process.env.DATABRICKS_REVIEW_ENDPOINT = "databricks-claude-opus-4-6";

      const pool = getModelPool();
      const opusCount = pool.filter((ep) => ep.name === "databricks-claude-opus-4-6").length;
      expect(opusCount).toBe(1);
    });
  });

  describe("Allowlist", () => {
    it("when DATABRICKS_ALLOWED_MODELS is set, only matching endpoints survive", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-6";
      process.env.DATABRICKS_SERVING_ENDPOINT_FAST = "databricks-claude-sonnet-4-6";
      process.env.DATABRICKS_REVIEW_ENDPOINT = "databricks-gpt-5-4";
      process.env.DATABRICKS_ALLOWED_MODELS = "databricks-claude-opus-4-6,databricks-gpt-5-4";

      const pool = getModelPool();
      const names = pool.map((ep) => ep.name);
      expect(names).toContain("databricks-claude-opus-4-6");
      expect(names).toContain("databricks-gpt-5-4");
      expect(names).not.toContain("databricks-claude-sonnet-4-6");
      expect(pool).toHaveLength(2);
    });
  });

  describe("Empty allowlist", () => {
    it("when allowlist filters everything, falls back to first configured endpoint", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-6";
      process.env.DATABRICKS_SERVING_ENDPOINT_FAST = "databricks-claude-sonnet-4-6";
      process.env.DATABRICKS_ALLOWED_MODELS = "nonexistent-model,other-model";

      const pool = getModelPool();
      expect(pool).toHaveLength(1);
      expect(pool[0].name).toBe("databricks-claude-opus-4-6");
    });
  });

  describe("getEndpointsForTier", () => {
    it("returns endpoints sorted by priority for a given tier", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-6";
      process.env.DATABRICKS_SERVING_ENDPOINT_REASONING_2 = "databricks-claude-opus-4-5";

      const reasoning = getEndpointsForTier("reasoning" as TaskTier);
      expect(reasoning.length).toBeGreaterThanOrEqual(1);
      const priorities = reasoning.map((ep) => ep.priority);
      expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
    });

    it("returns only endpoints that support the tier", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-6";
      process.env.DATABRICKS_SERVING_ENDPOINT_FAST = "databricks-claude-sonnet-4-6";
      process.env.DATABRICKS_REVIEW_ENDPOINT = "databricks-gpt-5-4";

      const sqlEndpoints = getEndpointsForTier("sql" as TaskTier);
      const names = sqlEndpoints.map((ep) => ep.name);
      expect(names).toContain("databricks-gpt-5-4");
      expect(names).not.toContain("databricks-claude-opus-4-6");
      expect(names).not.toContain("databricks-claude-sonnet-4-6");
    });
  });

  describe("Performance bundle models", () => {
    it("picks up DATABRICKS_SERVING_ENDPOINT_LIGHTWEIGHT", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-6";
      process.env.DATABRICKS_SERVING_ENDPOINT_LIGHTWEIGHT = "databricks-gemini-3-1-flash-lite";

      const pool = getModelPool();
      const names = pool.map((ep) => ep.name);
      expect(names).toContain("databricks-gemini-3-1-flash-lite");
    });

    it("databricks-gemini-3-1-flash-lite supports generation, classification, and lightweight tiers", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT_LIGHTWEIGHT = "databricks-gemini-3-1-flash-lite";

      const pool = getModelPool();
      const ep = pool.find((e) => e.name === "databricks-gemini-3-1-flash-lite");
      expect(ep).toBeDefined();
      expect(ep!.tiers).toContain("generation");
      expect(ep!.tiers).toContain("classification");
      expect(ep!.tiers).toContain("lightweight");
      expect(ep!.priority).toBe(0);
    });

    it("databricks-llama-4-maverick supports generation and classification at priority 1", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT_GENERATION = "databricks-llama-4-maverick";

      const pool = getModelPool();
      const ep = pool.find((e) => e.name === "databricks-llama-4-maverick");
      expect(ep).toBeDefined();
      expect(ep!.tiers).toContain("generation");
      expect(ep!.tiers).toContain("classification");
      expect(ep!.priority).toBe(1);
      expect(ep!.maxConcurrent).toBe(6);
    });

    it("databricks-gemini-3-flash supports generation, classification, and lightweight", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT_FAST = "databricks-gemini-3-flash";

      const pool = getModelPool();
      const ep = pool.find((e) => e.name === "databricks-gemini-3-flash");
      expect(ep).toBeDefined();
      expect(ep!.tiers).toContain("generation");
      expect(ep!.tiers).toContain("classification");
      expect(ep!.tiers).toContain("lightweight");
    });

    it("flash-lite is preferred over maverick for generation tier (lower priority number)", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT_LIGHTWEIGHT = "databricks-gemini-3-1-flash-lite";
      process.env.DATABRICKS_SERVING_ENDPOINT_GENERATION = "databricks-llama-4-maverick";

      const genEndpoints = getEndpointsForTier("generation" as TaskTier);
      expect(genEndpoints.length).toBeGreaterThanOrEqual(2);
      expect(genEndpoints[0].name).toBe("databricks-gemini-3-1-flash-lite");
      expect(genEndpoints[0].priority).toBeLessThan(genEndpoints[1].priority);
    });

    it("full performance bundle populates all 6 known endpoints", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-6";
      process.env.DATABRICKS_SERVING_ENDPOINT_FAST = "databricks-claude-sonnet-4-6";
      process.env.DATABRICKS_REVIEW_ENDPOINT = "databricks-gpt-5-4";
      process.env.DATABRICKS_SERVING_ENDPOINT_REASONING_2 = "databricks-gemini-3-flash";
      process.env.DATABRICKS_SERVING_ENDPOINT_GENERATION = "databricks-llama-4-maverick";
      process.env.DATABRICKS_SERVING_ENDPOINT_LIGHTWEIGHT = "databricks-gemini-3-1-flash-lite";

      const pool = getModelPool();
      expect(pool).toHaveLength(6);
    });
  });

  describe("isMultiEndpointPool", () => {
    it("returns false when pool has 1 endpoint", () => {
      clearEnv();
      expect(isMultiEndpointPool()).toBe(false);
    });

    it("returns true when pool has more than 1 endpoint", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-6";
      process.env.DATABRICKS_SERVING_ENDPOINT_FAST = "databricks-claude-sonnet-4-6";
      expect(isMultiEndpointPool()).toBe(true);
    });
  });

  describe("Unknown model rejection", () => {
    it("rejects unknown models from pool with a warning", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-6";
      process.env.DATABRICKS_SERVING_ENDPOINT_FAST = "totally-unknown-model";

      const pool = getModelPool();
      const names = pool.map((ep) => ep.name);
      expect(names).toContain("databricks-claude-opus-4-6");
      expect(names).not.toContain("totally-unknown-model");
    });

    it("Codex models are not in KNOWN_MODELS and are rejected", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-6";
      process.env.DATABRICKS_SERVING_ENDPOINT_SQL = "databricks-gpt-5-3-codex";

      const pool = getModelPool();
      const names = pool.map((ep) => ep.name);
      expect(names).not.toContain("databricks-gpt-5-3-codex");
    });
  });

  describe("getModelCapabilities", () => {
    it("returns correct capabilities for GPT-5.4 (supportsJsonMode: true, 128K output)", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-gpt-5-4";
      const caps = getModelCapabilities("databricks-gpt-5-4");
      expect(caps.supportsJsonMode).toBe(true);
      expect(caps.supportsTemperature).toBe(true);
      expect(caps.maxOutputTokens).toBe(128_000);
      expect(caps.defaultMaxTokens).toBe(16_384);
    });

    it("returns correct capabilities for Claude Opus 4.6 (supportsJsonMode: false, supportsTemperature: true)", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-6";
      const caps = getModelCapabilities("databricks-claude-opus-4-6");
      expect(caps.supportsJsonMode).toBe(false);
      expect(caps.supportsTemperature).toBe(true);
      expect(caps.maxOutputTokens).toBe(32_000);
      expect(caps.defaultMaxTokens).toBe(8_192);
    });

    it("returns supportsTemperature: false for Claude Opus 4.7 (rejects the param)", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-7";
      const caps = getModelCapabilities("databricks-claude-opus-4-7");
      expect(caps.supportsTemperature).toBe(false);
      expect(caps.supportsJsonMode).toBe(false);
      expect(caps.maxOutputTokens).toBe(32_000);
      expect(caps.defaultMaxTokens).toBe(8_192);
    });

    it("returns correct capabilities for Claude Sonnet 4.6 (supportsTemperature: true)", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-sonnet-4-6";
      const caps = getModelCapabilities("databricks-claude-sonnet-4-6");
      expect(caps.supportsJsonMode).toBe(false);
      expect(caps.supportsTemperature).toBe(true);
      expect(caps.maxOutputTokens).toBe(32_000);
      expect(caps.defaultMaxTokens).toBe(8_192);
    });

    it("returns correct capabilities for Gemini Flash Lite (raised to 32_768)", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT_LIGHTWEIGHT = "databricks-gemini-3-1-flash-lite";
      const caps = getModelCapabilities("databricks-gemini-3-1-flash-lite");
      expect(caps.supportsJsonMode).toBe(false);
      expect(caps.supportsTemperature).toBe(true);
      expect(caps.maxOutputTokens).toBe(32_768);
      expect(caps.defaultMaxTokens).toBe(4_096);
    });

    it("returns correct capabilities for Gemini 3 Flash (raised to 32_768)", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT_GENERATION = "databricks-gemini-3-flash";
      const caps = getModelCapabilities("databricks-gemini-3-flash");
      expect(caps.supportsJsonMode).toBe(false);
      expect(caps.supportsTemperature).toBe(true);
      expect(caps.maxOutputTokens).toBe(32_768);
      expect(caps.defaultMaxTokens).toBe(4_096);
    });

    it("returns correct capabilities for Llama 4 Maverick (8192 output)", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT_GENERATION = "databricks-llama-4-maverick";
      const caps = getModelCapabilities("databricks-llama-4-maverick");
      expect(caps.supportsJsonMode).toBe(false);
      expect(caps.supportsTemperature).toBe(true);
      expect(caps.maxOutputTokens).toBe(8_192);
      expect(caps.defaultMaxTokens).toBe(4_096);
    });

    it("returns conservative defaults for unknown endpoints (supportsTemperature: true)", () => {
      const caps = getModelCapabilities("totally-unknown-model");
      expect(caps.supportsJsonMode).toBe(false);
      expect(caps.supportsTemperature).toBe(true);
      expect(caps.maxOutputTokens).toBe(8_192);
      expect(caps.defaultMaxTokens).toBe(4_096);
    });

    it("pool endpoints include supportsJsonMode, supportsTemperature, maxOutputTokens, defaultMaxTokens fields", () => {
      process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-gpt-5-4";
      process.env.DATABRICKS_SERVING_ENDPOINT_FAST = "databricks-claude-sonnet-4-6";

      const pool = getModelPool();
      for (const ep of pool) {
        expect(typeof ep.supportsJsonMode).toBe("boolean");
        expect(typeof ep.supportsTemperature).toBe("boolean");
        expect(typeof ep.maxOutputTokens).toBe("number");
        expect(ep.maxOutputTokens).toBeGreaterThan(0);
        expect(typeof ep.defaultMaxTokens).toBe("number");
        expect(ep.defaultMaxTokens).toBeGreaterThan(0);
        expect(ep.defaultMaxTokens).toBeLessThanOrEqual(ep.maxOutputTokens);
      }
    });
  });
});
