#!/usr/bin/env node

/**
 * Startup endpoint availability probe.
 *
 * Called by scripts/start.sh BEFORE the Next.js server starts. Probes each
 * configured Model Serving endpoint via GET /api/2.0/serving-endpoints/{name}
 * to determine which ones are actually reachable in this workspace/region.
 *
 * Outputs a comma-separated list of available endpoint names to stdout.
 * Diagnostic messages go to stderr.
 *
 * Non-fatal: if the script errors out, start.sh proceeds without validation
 * and the runtime layer handles unavailable endpoints via 404 rotation.
 */

const PROBE_TIMEOUT = 10_000;

function getHost() {
  const h = process.env.DATABRICKS_HOST || "";
  return h.replace(/\/+$/, "");
}

async function getToken() {
  const pat = process.env.DATABRICKS_TOKEN || process.env.DATABRICKS_API_TOKEN;
  if (pat) return pat;

  const clientId = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const host = getHost();
  const resp = await fetch(`${host}/oidc/v1/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "all-apis" }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT),
  });

  if (!resp.ok) return null;
  const data = await resp.json();
  return data.access_token || null;
}

async function probeEndpoint(host, token, name) {
  try {
    const resp = await fetch(`${host}/api/2.0/serving-endpoints/${encodeURIComponent(name)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(PROBE_TIMEOUT),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function main() {
  const host = getHost();
  if (!host) {
    process.stderr.write("[validate-endpoints] DATABRICKS_HOST not set, skipping.\n");
    process.exit(0);
  }

  let token;
  try {
    token = await getToken();
  } catch {
    process.stderr.write("[validate-endpoints] Could not obtain auth token, skipping.\n");
    process.exit(0);
  }
  if (!token) {
    process.stderr.write("[validate-endpoints] No credentials available, skipping.\n");
    process.exit(0);
  }

  const envVars = [
    "DATABRICKS_SERVING_ENDPOINT",
    "DATABRICKS_SERVING_ENDPOINT_FAST",
    "DATABRICKS_REVIEW_ENDPOINT",
    "DATABRICKS_EMBEDDING_ENDPOINT",
    "DATABRICKS_SERVING_ENDPOINT_REASONING_2",
    "DATABRICKS_SERVING_ENDPOINT_GENERATION",
    "DATABRICKS_SERVING_ENDPOINT_SQL",
    "DATABRICKS_SERVING_ENDPOINT_LIGHTWEIGHT",
  ];

  const endpoints = new Set();
  for (const ev of envVars) {
    const name = process.env[ev];
    if (name) endpoints.add(name);
  }

  if (endpoints.size === 0) {
    process.stderr.write("[validate-endpoints] No endpoints configured, skipping.\n");
    process.exit(0);
  }

  process.stderr.write(`[validate-endpoints] Probing ${endpoints.size} endpoint(s)...\n`);

  const available = [];
  const unavailable = [];

  const probes = [...endpoints].map(async (name) => {
    const ok = await probeEndpoint(host, token, name);
    if (ok) {
      available.push(name);
      process.stderr.write(`[validate-endpoints]   ✓ ${name}\n`);
    } else {
      unavailable.push(name);
      process.stderr.write(`[validate-endpoints]   ✗ ${name} (not available)\n`);
    }
  });

  await Promise.all(probes);

  if (unavailable.length > 0) {
    process.stderr.write(
      `[validate-endpoints] ${unavailable.length} endpoint(s) unavailable — runtime will route around them.\n`,
    );
  }

  // Write available endpoints to stdout (consumed by start.sh)
  process.stdout.write(available.join(","));
}

main().catch((err) => {
  process.stderr.write(`[validate-endpoints] Error: ${err.message}\n`);
  process.exit(0); // Non-fatal
});
