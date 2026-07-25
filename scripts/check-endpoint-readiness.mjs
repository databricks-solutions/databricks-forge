#!/usr/bin/env node

import { evaluateEndpointReadiness } from "../lib/dbx/model-admission.mjs";

const readiness = evaluateEndpointReadiness(process.env);

if (readiness.state === "completed") {
  if (!readiness.shouldStart) {
    process.stderr.write(
      "[startup] FATAL: Endpoint validation completed with zero runtime-admitted required endpoints.\n",
    );
    process.exit(1);
  }
  process.stdout.write(
    `[startup] Endpoint validation completed: ${readiness.usableRequiredCount} runtime-admitted required endpoint(s) usable.\n`,
  );
} else {
  process.stdout.write(
    `[startup] Endpoint validation ${readiness.state}; ${readiness.admittedCount} runtime candidate(s) preserved for runtime failover.\n`,
  );
}
