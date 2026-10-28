export const DEFAULT_MODEL_ENDPOINT = "databricks-claude-opus-5-5";

export const KNOWN_MODEL_KEYS = [
  // Anthropic Claude 5.x & 4.x
  "databricks-claude-opus-5-5",
  "databricks-claude-opus-5",
  "databricks-claude-opus-4-8",
  "databricks-claude-opus-4-7",
  "databricks-claude-opus-4-6",
  "databricks-claude-opus-4-5",
  "databricks-claude-sonnet-5-5",
  "databricks-claude-sonnet-5",
  "databricks-claude-sonnet-4-6",
  "databricks-claude-sonnet-4-5",
  "databricks-claude-haiku-5-5",
  "databricks-claude-haiku-4-5",
  // OpenAI GPT-6.1, GPT-6 & GPT-5.x
  "databricks-gpt-6-1-terra",
  "databricks-gpt-6-1-sol",
  "databricks-gpt-6-astra",
  "databricks-gpt-6-sol",
  "databricks-gpt-6-luna",
  "databricks-gpt-5-4-mini",
  "databricks-gpt-5-4-nano",
  "databricks-gpt-5-4",
  // Google Gemini 4 & 3.x
  "databricks-gemini-4-argon",
  "databricks-gemini-3-8-flash",
  "databricks-gemini-3-7-flash",
  "databricks-gemini-3-6-flash",
  "databricks-gemini-3-5-flash-lite",
  "databricks-gemini-3-5-flash",
  "databricks-gemini-3-1-flash-lite",
  "databricks-gemini-3-1-pro",
  "databricks-gemini-3-flash",
  // Meta Llama 4
  "databricks-llama-4-maverick",
];

const SORTED_KNOWN_MODEL_KEYS = [...KNOWN_MODEL_KEYS].sort((a, b) => b.length - a.length);

const CONFIGURED_ENDPOINTS = [
  ["DATABRICKS_SERVING_ENDPOINT", true],
  ["DATABRICKS_SERVING_ENDPOINT_FAST", true],
  ["DATABRICKS_REVIEW_ENDPOINT", true],
  ["DATABRICKS_SERVING_ENDPOINT_REASONING_2", false],
  ["DATABRICKS_SERVING_ENDPOINT_GENERATION", false],
  ["DATABRICKS_SERVING_ENDPOINT_SQL", false],
  ["DATABRICKS_SERVING_ENDPOINT_LIGHTWEIGHT", false],
];

export function findKnownModelKey(name) {
  const lower = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/^system\.ai\.databricks-/, "databricks-")
    .replace(/^system\.ai\./, "databricks-");
  if (!lower) return null;
  const exact = KNOWN_MODEL_KEYS.find((key) => lower === key);
  if (exact) return exact;
  return SORTED_KNOWN_MODEL_KEYS.find((key) => lower.includes(key)) ?? null;
}

export function runtimeEndpointAdmission(env = process.env) {
  const byName = new Map();
  const rejected = [];

  for (const [envVar, required] of CONFIGURED_ENDPOINTS) {
    const name = env[envVar];
    if (!name) continue;
    const normalized = name.toLowerCase();
    const knownModelKey = findKnownModelKey(name);
    if (!knownModelKey) {
      rejected.push(name);
      continue;
    }
    const existing = byName.get(normalized);
    if (existing) {
      existing.required ||= required;
      continue;
    }
    byName.set(normalized, { name, knownModelKey, required });
  }

  let admitted = [...byName.values()];
  if (admitted.length === 0) {
    admitted = [
      {
        name: DEFAULT_MODEL_ENDPOINT,
        knownModelKey: DEFAULT_MODEL_ENDPOINT,
        required: true,
      },
    ];
  }

  const allowed = new Set(
    String(env.DATABRICKS_ALLOWED_MODELS || "")
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  );
  let allowlistFallback = false;
  if (allowed.size > 0) {
    const filtered = admitted.filter((endpoint) => allowed.has(endpoint.name.toLowerCase()));
    if (filtered.length > 0) {
      admitted = filtered;
    } else {
      admitted = admitted.slice(0, 1);
      allowlistFallback = true;
    }
  }

  return { admitted, rejected, allowlistFallback };
}

export function runtimeAdmittedEndpointNames(env = process.env) {
  return runtimeEndpointAdmission(env).admitted.map((endpoint) => endpoint.name);
}

export function evaluateEndpointReadiness(env = process.env) {
  const rawState = env.FORGE_ENDPOINT_VALIDATION_STATE;
  const state = rawState === "completed" || rawState === "auth_skipped" ? rawState : "not_run";
  const admission = runtimeEndpointAdmission(env);
  const required = admission.admitted.filter((endpoint) => endpoint.required);

  if (state !== "completed") {
    return {
      state,
      shouldStart: true,
      admittedCount: admission.admitted.length,
      admittedRequiredCount: required.length,
      usableRequiredCount: required.length,
    };
  }

  const validated = new Set(
    String(env.FORGE_VALIDATED_ENDPOINTS || "")
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  );
  const usableRequiredCount = required.filter((endpoint) =>
    validated.has(endpoint.name.toLowerCase()),
  ).length;

  return {
    state,
    shouldStart: usableRequiredCount > 0,
    admittedCount: admission.admitted.length,
    admittedRequiredCount: required.length,
    usableRequiredCount,
  };
}
