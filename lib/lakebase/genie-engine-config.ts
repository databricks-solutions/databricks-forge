/**
 * CRUD operations for Genie Engine Configuration -- backed by Lakebase (Prisma).
 *
 * Stores the customer-editable engine config per run, with versioning
 * to track which config produced which recommendations.
 */

import { withPrisma } from "@/lib/prisma";
import type { GenieEngineConfig } from "@/lib/genie/types";
import { defaultGenieEngineConfig } from "@/lib/genie/types";
import { v4 as uuidv4 } from "uuid";

interface StoredConfig {
  config: GenieEngineConfig;
  version: number;
}

export async function getGenieEngineConfig(runId: string): Promise<StoredConfig> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeGenieEngineConfig.findUnique({
      where: { runId },
    });

    if (!row) {
      // Version 1 (not 0) -- the engine runs with default config, which is a
      // valid config.  version: 0 is reserved for legacy/fallback-generated
      // recommendations that were never processed by the engine.
      return { config: defaultGenieEngineConfig(), version: 1 };
    }

    try {
      const config = JSON.parse(row.config) as GenieEngineConfig;
      return { config, version: row.version };
    } catch {
      return { config: defaultGenieEngineConfig(), version: row.version };
    }
  });
}

export async function saveGenieEngineConfig(
  runId: string,
  config: GenieEngineConfig,
): Promise<number> {
  return withPrisma(async (prisma) => {
    const existing = await prisma.forgeGenieEngineConfig.findUnique({
      where: { runId },
    });

    const newVersion = (existing?.version ?? 0) + 1;

    await prisma.forgeGenieEngineConfig.upsert({
      where: { runId },
      create: {
        id: uuidv4(),
        runId,
        version: newVersion,
        config: JSON.stringify(config),
      },
      update: {
        version: newVersion,
        config: JSON.stringify(config),
      },
    });

    return newVersion;
  });
}
