#!/usr/bin/env node

/**
 * Startup endpoint availability probe.
 *
 * Called by scripts/start.sh BEFORE the Next.js server starts. Probes each
 * configured Model Serving endpoint via GET /api/2.0/serving-endpoints/{name}
 * to determine which ones are actually reachable in this workspace/region.
 *
 * Outputs the validation state on line 1 and the comma-separated endpoint
 * allowlist on line 2. Diagnostic messages go to stderr.
 *
 * The caller decides whether a completed empty allowlist is fatal.
 */

import { pathToFileURL } from "node:url";

const PROBE_TIMEOUT = 10_000;
const ENDPOINT_ENV_VARS = [
  "DATABRICKS_SERVING_ENDPOINT",
  "DATABRICKS_SERVING_ENDPOINT_FAST",
  "DATABRICKS_REVIEW_ENDPOINT",
  "DATABRICKS_EMBEDDING_ENDPOINT",
  "DATABRICKS_SERVING_ENDPOINT_REASONING_2",
  "DATABRICKS_SERVING_ENDPOINT_GENERATION",
  "DATABRICKS_SERVING_ENDPOINT_SQL",
  "DATABRICKS_SERVING_ENDPOINT_LIGHTWEIGHT",
];

function getHost(env) {
  const host = String(env.DATABRICKS_HOST || "")
    .trim()
    .replace(/\/+$/, "");
  if (!host || /^https?:\/\//i.test(host)) return host;
  return `https://${host}`;
}

async function getToken(env, fetchImpl) {
  const pat = env.DATABRICKS_TOKEN || env.DATABRICKS_API_TOKEN;
  if (pat) return pat;

  const clientId = env.DATABRICKS_CLIENT_ID;
  const clientSecret = env.DATABRICKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const host = getHost(env);
  const resp = await fetchImpl(`${host}/oidc/v1/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "all-apis" }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT),
  });

  if (!resp.ok) {
    throw new Error(`Databricks OAuth token request failed with HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return data.access_token || null;
}

async function probeEndpoint(fetchImpl, host, token, name) {
  try {
    const resp = await fetchImpl(`${host}/api/2.0/serving-endpoints/${encodeURIComponent(name)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(PROBE_TIMEOUT),
    });
    if (resp.ok) return { name, outcome: "available" };
    if (resp.status === 404) return { name, outcome: "unavailable" };
    if (resp.status === 401 || resp.status === 403) return { name, outcome: "auth_error" };
    return { name, outcome: "indeterminate", status: resp.status };
  } catch (error) {
    return { name, outcome: "indeterminate", error };
  }
}

function configuredEndpoints(env) {
  const endpoints = new Set();
  for (const envVar of ENDPOINT_ENV_VARS) {
    const name = env[envVar];
    if (name) endpoints.add(name);
  }
  return [...endpoints];
}

function result(state, endpoints, available, unavailable, diagnostic) {
  return {
    state,
    validatedEndpoints: available,
    configuredCount: endpoints.length,
    availableCount: available.length,
    unavailableCount: unavailable.length,
    diagnostic,
  };
}

export async function validateEndpoints({
  env = process.env,
  fetchImpl = fetch,
  log = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  const endpoints = configuredEndpoints(env);
  if (endpoints.length === 0) {
    const diagnostic = "No endpoints configured; validation not run.";
    log(`[validate-endpoints] ${diagnostic}`);
    return result("not_run", endpoints, [], [], diagnostic);
  }

  const host = getHost(env);
  if (!host) {
    const diagnostic = "DATABRICKS_HOST is unavailable; authentication validation skipped.";
    log(`[validate-endpoints] ${diagnostic}`);
    return result("auth_skipped", endpoints, endpoints, [], diagnostic);
  }

  let token;
  try {
    token = await getToken(env, fetchImpl);
  } catch (error) {
    const diagnostic = `Could not obtain an authentication token: ${error.message}`;
    log(`[validate-endpoints] ${diagnostic}`);
    return result("auth_skipped", endpoints, endpoints, [], diagnostic);
  }
  if (!token) {
    const diagnostic = "No supported Databricks credentials are available; authentication skipped.";
    log(`[validate-endpoints] ${diagnostic}`);
    return result("auth_skipped", endpoints, endpoints, [], diagnostic);
  }

  log(`[validate-endpoints] Probing ${endpoints.length} endpoint(s)...`);
  const probes = await Promise.all(
    endpoints.map((name) => probeEndpoint(fetchImpl, host, token, name)),
  );

  if (probes.some((probe) => probe.outcome === "auth_error")) {
    const diagnostic =
      "Endpoint probes were rejected by authentication or authorization; preserving configured candidates.";
    log(`[validate-endpoints] ${diagnostic}`);
    return result("auth_skipped", endpoints, endpoints, [], diagnostic);
  }
  if (probes.some((probe) => probe.outcome === "indeterminate")) {
    const diagnostic =
      "Endpoint availability could not be established; preserving configured candidates for runtime failover.";
    log(`[validate-endpoints] ${diagnostic}`);
    return result("not_run", endpoints, endpoints, [], diagnostic);
  }

  const available = probes
    .filter((probe) => probe.outcome === "available")
    .map((probe) => probe.name);
  const unavailable = probes
    .filter((probe) => probe.outcome === "unavailable")
    .map((probe) => probe.name);
  for (const probe of probes) {
    log(
      `[validate-endpoints]   ${probe.outcome === "available" ? "✓" : "✗"} ${probe.name}` +
        (probe.outcome === "unavailable" ? " (not available)" : ""),
    );
  }
  if (unavailable.length > 0) {
    log(
      `[validate-endpoints] ${unavailable.length} endpoint(s) unavailable — runtime will route around them.`,
    );
  }
  return result("completed", endpoints, available, unavailable);
}

export function formatValidationResult(validationResult) {
  return `${validationResult.state}\n${validationResult.validatedEndpoints.join(",")}`;
}

async function main() {
  const validationResult = await validateEndpoints();
  process.stdout.write(formatValidationResult(validationResult));
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`[validate-endpoints] Error: ${error.message}\n`);
    process.stdout.write("not_run\n");
  });
}
