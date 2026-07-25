/**
 * Per-user usage counter writes for ForgeUsage.
 *
 * Each row represents (userEmail, day) and records the number of pipeline
 * runs, scans, Genie deploys, demo engines, LLM calls, and embed tokens
 * the user generated that day. Used for soft accounting and a future
 * chargeback report -- no enforcement happens off this table yet.
 *
 * Writes are best-effort: failures are logged but never throw.
 */

import { withPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

type UsageField =
  | "pipelineRuns"
  | "scans"
  | "genieDeploys"
  | "demoEngines"
  | "llmCalls"
  | "embedTokens";

function dayUtc(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function bumpUsage(userEmail: string, field: UsageField, by = 1): Promise<void> {
  if (!userEmail || by <= 0) return;
  const owner = userEmail.toLowerCase().trim();
  const day = dayUtc();
  try {
    await withPrisma(async (prisma) => {
      await prisma.forgeUsage.upsert({
        where: { userEmail_day: { userEmail: owner, day } },
        create: {
          userEmail: owner,
          day,
          pipelineRuns: field === "pipelineRuns" ? by : 0,
          scans: field === "scans" ? by : 0,
          genieDeploys: field === "genieDeploys" ? by : 0,
          demoEngines: field === "demoEngines" ? by : 0,
          llmCalls: field === "llmCalls" ? by : 0,
          embedTokens: field === "embedTokens" ? by : 0,
        },
        update: {
          [field]: { increment: by },
        },
      });
    });
  } catch (err) {
    logger.warn("[usage] bump failed", {
      userEmail: owner,
      field,
      by,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export const recordUsage = {
  pipelineRun: (userEmail: string) => bumpUsage(userEmail, "pipelineRuns"),
  scan: (userEmail: string) => bumpUsage(userEmail, "scans"),
  genieDeploy: (userEmail: string) => bumpUsage(userEmail, "genieDeploys"),
  demoEngine: (userEmail: string) => bumpUsage(userEmail, "demoEngines"),
  llmCall: (userEmail: string, count = 1) => bumpUsage(userEmail, "llmCalls", count),
  embedTokens: (userEmail: string, tokens: number) =>
    bumpUsage(userEmail, "embedTokens", Math.max(0, Math.floor(tokens))),
};

export async function getUsageForUser(
  userEmail: string,
  days = 30,
): Promise<
  Array<{
    day: Date;
    pipelineRuns: number;
    scans: number;
    genieDeploys: number;
    demoEngines: number;
    llmCalls: number;
    embedTokens: number;
  }>
> {
  if (!userEmail) return [];
  const owner = userEmail.toLowerCase().trim();
  const since = new Date(Date.now() - days * 86_400_000);
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeUsage.findMany({
      where: { userEmail: owner, day: { gte: since } },
      orderBy: { day: "desc" },
    });
    return rows.map((r) => ({
      day: r.day,
      pipelineRuns: r.pipelineRuns,
      scans: r.scans,
      genieDeploys: r.genieDeploys,
      demoEngines: r.demoEngines,
      llmCalls: r.llmCalls,
      embedTokens: r.embedTokens,
    }));
  });
}
