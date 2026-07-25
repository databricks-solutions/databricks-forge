"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { GenieSpaceRecommendation, MetricViewProposal } from "./types";
import { loadSettings } from "@/lib/settings";
import { parseErrorResponse, safeJsonParse } from "@/lib/error-utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeployOptions {
  targetSchema?: string;
  metricViewProposals?: MetricViewProposal[];
  /** Generate job ID to write deployedSpaceId back to the job store */
  generateJobId?: string;
}

export interface DeployState {
  phase: "idle" | "deploying" | "deployed" | "error";
  deployedSpaceId: string | null;
  error: string | null;
  databricksHost: string;
}

// ---------------------------------------------------------------------------
// Pure deploy function (non-hook, for programmatic use)
// ---------------------------------------------------------------------------

export async function deployGenieSpace(
  recommendation: GenieSpaceRecommendation,
  options?: DeployOptions,
): Promise<{ spaceId: string }> {
  const settings = loadSettings();

  const mvPayload =
    options?.metricViewProposals && options.targetSchema
      ? options.metricViewProposals
          .filter((m) => m.validationStatus !== "error")
          .map((m) => ({ name: m.name, ddl: m.ddl, description: m.description }))
      : [];

  const res = await fetch("/api/genie-spaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: recommendation.title,
      description: recommendation.description,
      serializedSpace: recommendation.serializedSpace,
      domain: recommendation.domain,
      quality: recommendation.quality,
      authMode: settings.genieDeployAuthMode,
      targetSchema: options?.targetSchema || undefined,
      metricViews: mvPayload.length > 0 ? mvPayload : undefined,
      resourcePrefix: settings.catalogResourcePrefix,
    }),
  });

  if (!res.ok) {
    throw new Error(await parseErrorResponse(res, "Deployment failed"));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await safeJsonParse(res);
  if (!data) throw new Error("Invalid response from server");

  if (data.spaceId) {
    await backfillEmbeddings();
    if (options?.generateJobId) {
      await markJobDeployed(options.generateJobId, data.spaceId);
    }
    return { spaceId: data.spaceId };
  }

  if (data.jobId) {
    const spaceId = await pollDeployCompletion(data.jobId);
    await backfillEmbeddings();
    if (options?.generateJobId) {
      await markJobDeployed(options.generateJobId, spaceId);
    }
    return { spaceId };
  }

  throw new Error("Unexpected response from server");
}

async function pollDeployCompletion(deployJobId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/genie-spaces?deployJobId=${deployJobId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === "completed" && data.result) {
          clearInterval(timer);
          resolve(data.result.spaceId);
        } else if (data.status === "failed") {
          clearInterval(timer);
          reject(new Error(data.error || "Deployment failed"));
        }
      } catch {
        /* retry on next poll */
      }
    }, 2000);

    setTimeout(
      () => {
        clearInterval(timer);
        reject(new Error("Deploy timed out"));
      },
      5 * 60 * 1000,
    );
  });
}

function backfillEmbeddings(): Promise<void> {
  return fetch("/api/embeddings/backfill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "genie" }),
  })
    .then(() => {})
    .catch(() => {});
}

async function markJobDeployed(jobId: string, spaceId: string): Promise<void> {
  try {
    await fetch("/api/genie-spaces/generate", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, deployedSpaceId: spaceId }),
    });
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// React hook for deploy with state management
// ---------------------------------------------------------------------------

export function useGenieDeploy() {
  const [state, setState] = useState<DeployState>({
    phase: "idle",
    deployedSpaceId: null,
    error: null,
    databricksHost: "",
  });

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => {
        if (d.host) {
          setState((s) => ({ ...s, databricksHost: d.host.replace(/\/$/, "") }));
        }
      })
      .catch(() => {});
    const ref = pollRef;
    return () => {
      if (ref.current) clearInterval(ref.current);
    };
  }, []);

  const deploy = useCallback(
    async (recommendation: GenieSpaceRecommendation, options?: DeployOptions) => {
      if (recommendation.quality?.gateDecision === "block") {
        setState((s) => ({
          ...s,
          phase: "error",
          error: "Deployment blocked by quality gate",
        }));
        return;
      }

      setState((s) => ({ ...s, phase: "deploying", error: null }));

      try {
        const { spaceId } = await deployGenieSpace(recommendation, options);
        setState((s) => ({ ...s, phase: "deployed", deployedSpaceId: spaceId }));
      } catch (err) {
        setState((s) => ({
          ...s,
          phase: "error",
          error: err instanceof Error ? err.message : "Deployment failed",
        }));
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setState((s) => ({
      ...s,
      phase: "idle",
      deployedSpaceId: null,
      error: null,
    }));
  }, []);

  return { ...state, deploy, reset };
}
