import { NextResponse } from "next/server";
import { isDemoModeEnabled } from "@/lib/demo/config";
import { runResearchEngine } from "@/lib/demo/research-engine/engine";
import {
  startResearchJob,
  completeResearchJob,
  failResearchJob,
  updateResearchJob,
} from "@/lib/demo/research-engine/engine-status";
import {
  createDemoSession,
  updateDemoSessionStatus,
} from "@/lib/lakebase/demo-sessions";
import { logActivity } from "@/lib/lakebase/activity-log";
import { logger } from "@/lib/logger";
import type { ResearchPreset, DemoScope } from "@/lib/demo/types";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { checkQuota } from "@/lib/quotas";
import { recordUsage } from "@/lib/lakebase/usage";

export async function POST(request: Request) {
  if (!(await isDemoModeEnabled())) {
    return NextResponse.json({ error: "Demo mode is not enabled" }, { status: 404 });
  }

  let user;
  try {
    user = await requireUser(request);
  } catch (e) {
    if (e instanceof ForgeAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  try {
    const body = await request.json();
    const {
      customerName,
      industryId,
      preset = "balanced",
      websiteUrl,
      scope,
      pastedContext,
    } = body as {
      customerName: string;
      industryId?: string;
      preset?: ResearchPreset;
      websiteUrl?: string;
      scope?: DemoScope;
      pastedContext?: string;
    };

    if (!customerName) {
      return NextResponse.json({ error: "customerName is required" }, { status: 400 });
    }

    const sessionId = await createDemoSession({
      customerName,
      industryId: industryId ?? "pending",
      researchPreset: preset,
      websiteUrl,
      catalogName: "",
      schemaName: "",
      scope,
      ownerEmail: user.email,
      createdBy: user.email,
    });

    const controller = await startResearchJob(sessionId);
    recordUsage.demoEngine(user.email).catch(() => {});

    const oboToken =
      request.headers.get("x-forwarded-access-token") ??
      request.headers.get("X-Forwarded-Access-Token") ??
      null;

    const startResearch = async () => {
      try {
        await updateDemoSessionStatus(sessionId, "researching");

        const result = await runResearchEngine({
          customerName,
          sessionId,
          industryId,
          preset,
          websiteUrl,
          scope,
          pastedContext,
          ownerEmail: user.email,
          oboToken,
          signal: controller.signal,
          onProgress: (phase, percent, detail) => {
            updateResearchJob(sessionId, phase, percent, detail);
          },
        });

        await updateDemoSessionStatus(sessionId, "draft", {
          researchJson: JSON.stringify(result),
          sourceDocsJson: JSON.stringify(result.sources),
        });

        await completeResearchJob(sessionId);
        await logActivity("demo_research", {
          userId: user.email,
          resourceId: sessionId,
          metadata: {
            customerName,
            industryId: result.industryId,
            preset,
            assets: result.matchedDataAssetIds.length,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("[demo/research] Engine failed", { sessionId, error: msg });
        await failResearchJob(sessionId, msg);
        await updateDemoSessionStatus(sessionId, "failed", { errorMessage: msg });
      }
    };

    const quota = await checkQuota("demo_engine", user.email, "reject");
    if (!quota.allowed) {
      // Cap reached: enqueue rather than reject. Keeps the user out of a
      // hard-error state while the cap is busy with their other session.
      const { enqueueDeferredJob } = await import("@/lib/scheduler/deferred-queue");
      const { jobId, position } = enqueueDeferredJob({
        kind: "demo_engine",
        ownerEmail: user.email,
        run: startResearch,
      });
      return NextResponse.json(
        { sessionId, status: "queued", position, jobId, cap: quota.cap, active: quota.active },
        { status: 202 },
      );
    }

    void startResearch();
    return NextResponse.json({ sessionId });
  } catch (err) {
    logger.error("[demo/research] Request error", { error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
