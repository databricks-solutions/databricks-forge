#!/usr/bin/env node

/**
 * Lakebase startup credential helper (standalone, no TypeScript).
 *
 * Called by scripts/start.sh BEFORE prisma db push. The `postgres` app
 * resource binding has already given us PGHOST / PGUSER / PGDATABASE /
 * LAKEBASE_ENDPOINT. This script:
 *
 *   1. Mints a short-lived OAuth Postgres credential via
 *      POST /api/2.0/postgres/credentials { endpoint: <LAKEBASE_ENDPOINT> }
 *   2. Assembles the connection URL from the platform-injected metadata
 *   3. Verifies the credential is usable (cold endpoints can take 15-30s)
 *   4. Prints the verified URL to stdout for start.sh to consume
 *
 * Exits 0 on success, 1 on failure. All diagnostics go to stderr so stdout
 * contains only the verified connection URL.
 */

const API_TIMEOUT = 30_000;

function log(msg) {
  process.stderr.write(`[provision] ${msg}\n`);
}

function getHost() {
  let h = process.env.DATABRICKS_HOST || "";
  if (h && !h.startsWith("https://")) h = `https://${h}`;
  return h.replace(/\/+$/, "");
}

async function timedFetch(url, init, timeoutMs = API_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getWorkspaceToken() {
  const clientId = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
  const host = getHost();

  const resp = await timedFetch(`${host}/oidc/v1/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "all-apis",
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Workspace OAuth failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  return data.access_token;
}

async function generateCredential(token, endpointName) {
  const host = getHost();
  const resp = await timedFetch(`${host}/api/2.0/postgres/credentials`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ endpoint: endpointName }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Generate credential failed (${resp.status}): ${text}`);
  }
  const data = await resp.json();
  if (!data.token) throw new Error("Generate credential returned no token");
  return data.token;
}

// ---------------------------------------------------------------------------
// Credential verification — wait until the credential is actually usable.
//
// Cold Lakebase endpoints can take 15-30s to propagate a fresh credential,
// especially after scale-from-zero. Strategy:
//   1. Wait an initial delay before first attempt (reduces wasted connections)
//   2. Use generous intervals between attempts (avoids connection rate limiter)
//   3. Reuse a single Pool to minimise TCP churn
// ---------------------------------------------------------------------------

const VERIFY_INITIAL_DELAY_MS = 5_000;
const VERIFY_MAX_ATTEMPTS = 8;
const VERIFY_INTERVAL_MS = 3_000;

async function verifyCredential(url) {
  const pg = (await import("pg")).default;

  log(`Waiting ${VERIFY_INITIAL_DELAY_MS / 1_000}s for credential propagation...`);
  await new Promise((r) => setTimeout(r, VERIFY_INITIAL_DELAY_MS));

  const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 10_000, max: 1 });

  try {
    for (let attempt = 1; attempt <= VERIFY_MAX_ATTEMPTS; attempt++) {
      try {
        await pool.query("SELECT 1");
        log(`Credential verified (attempt ${attempt}/${VERIFY_MAX_ATTEMPTS}).`);
        return true;
      } catch (err) {
        if (attempt < VERIFY_MAX_ATTEMPTS) {
          log(
            `Credential not yet usable (attempt ${attempt}/${VERIFY_MAX_ATTEMPTS}), ` +
              `waiting ${VERIFY_INTERVAL_MS / 1_000}s...`,
          );
          await new Promise((r) => setTimeout(r, VERIFY_INTERVAL_MS));
        } else {
          log(
            `Credential verification failed after ${VERIFY_MAX_ATTEMPTS} attempts: ${err.message}`,
          );
        }
      }
    }
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const CREDENTIAL_MAX_GENERATIONS = 2;

async function main() {
  const clientId = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
  const host = process.env.DATABRICKS_HOST;
  const pgHost = process.env.PGHOST;
  const pgUser = process.env.PGUSER;
  const pgDatabase = process.env.PGDATABASE || "databricks_postgres";
  const pgPort = process.env.PGPORT || "5432";
  const pgSslMode = process.env.PGSSLMODE || "require";
  const endpointName = process.env.LAKEBASE_ENDPOINT;

  if (!clientId || !clientSecret || !host) {
    log("ERROR: Missing DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET, or DATABRICKS_HOST");
    process.exit(1);
  }
  if (!pgHost || !pgUser || !endpointName) {
    log(
      "ERROR: Missing Lakebase resource binding env vars (PGHOST, PGUSER, LAKEBASE_ENDPOINT). " +
        "Run deploy.sh to bind the `postgres` resource in app.yaml.",
    );
    process.exit(1);
  }

  log(
    `Lakebase resource binding: endpoint=${endpointName}, host=${pgHost}, user=${pgUser}, database=${pgDatabase}`,
  );

  const wsToken = await getWorkspaceToken();

  for (let gen = 1; gen <= CREDENTIAL_MAX_GENERATIONS; gen++) {
    const dbToken = await generateCredential(wsToken, endpointName);

    const url =
      `postgresql://${encodeURIComponent(pgUser)}:${encodeURIComponent(dbToken)}` +
      `@${pgHost}:${pgPort}/${pgDatabase}` +
      `?sslmode=${encodeURIComponent(pgSslMode)}&uselibpqcompat=true`;

    const verified = await verifyCredential(url);
    if (verified) {
      process.stdout.write(url);
      log("Startup connection URL generated.");
      return;
    }

    if (gen < CREDENTIAL_MAX_GENERATIONS) {
      log(`Regenerating credential (attempt ${gen + 1}/${CREDENTIAL_MAX_GENERATIONS})...`);
    }
  }

  log("FATAL: Could not verify database credential after multiple generations.");
  process.exit(1);
}

main().catch((err) => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
