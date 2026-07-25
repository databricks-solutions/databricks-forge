/**
 * Demo Mode feature gate.
 *
 * Demo Mode is a workspace-shared runtime flag persisted in Lakebase
 * (`ForgeAppConfig` singleton row). When disabled, all demo-specific API
 * routes return 404 and the Settings UI hides the Demo Wizard button.
 *
 * The legacy `FORGE_DEMO_MODE_ENABLED` env var **seeds** the initial value
 * on first read (preserving existing opted-in deployments). After that, the
 * Settings UI toggle is the source of truth.
 *
 * The flag is cached in process memory for 30 seconds to keep per-request
 * overhead negligible. The toggle endpoint invalidates the local cache on
 * write; multi-pod staleness is bounded to TTL_MS, which is acceptable
 * because Demo Mode is a feature visibility gate, not a security boundary.
 */

import { withPrisma } from "@/lib/prisma";

const TTL_MS = 30_000;

let cached: { value: boolean; expiresAt: number } | null = null;

export async function isDemoModeEnabled(): Promise<boolean> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const row = await withPrisma((p) =>
    p.forgeAppConfig.upsert({
      where: { id: "singleton" },
      update: {},
      create: {
        id: "singleton",
        demoModeEnabled: process.env.FORGE_DEMO_MODE_ENABLED === "true",
      },
    }),
  );

  cached = { value: row.demoModeEnabled, expiresAt: now + TTL_MS };
  return row.demoModeEnabled;
}

export function invalidateDemoModeCache(): void {
  cached = null;
}

export async function setDemoModeEnabled(
  enabled: boolean,
  userEmail: string | null,
): Promise<void> {
  await withPrisma((p) =>
    p.forgeAppConfig.upsert({
      where: { id: "singleton" },
      update: { demoModeEnabled: enabled, updatedBy: userEmail },
      create: {
        id: "singleton",
        demoModeEnabled: enabled,
        updatedBy: userEmail,
      },
    }),
  );
  invalidateDemoModeCache();
}
