"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Copy,
  Database,
  Rocket,
  Loader2,
  ExternalLink,
  Layers,
  BarChart3,
  Clock,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { DemoSessionSummary } from "@/lib/demo/types";

interface SessionDetail extends DemoSessionSummary {
  genieMode?: boolean;
  genieSpaceId?: string | null;
  genieSpaceUrl?: string | null;
  genieDeployError?: string | null;
}

interface CompleteStepProps {
  sessionId: string;
  catalog: string;
  schema: string;
  customerName?: string;
  industryId?: string;
  wizardStartTime?: number;
  genieMode?: boolean;
}

export function CompleteStep({
  sessionId,
  catalog,
  schema,
  customerName,
  industryId,
  wizardStartTime,
  genieMode,
}: CompleteStepProps) {
  const router = useRouter();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [launchState, setLaunchState] = useState<"ready" | "launching" | "launched" | "failed">(
    "ready",
  );
  const [launchError, setLaunchError] = useState<string>("");
  const launchedRef = useRef(false);

  const fqn = `${catalog}.${schema}`;

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/demo/sessions/${sessionId}`)
      .then((r) => r.json())
      .then(setSession)
      .catch(() => {});
  }, [sessionId]);

  const launchDiscovery = useCallback(async () => {
    if (launchedRef.current) return;
    launchedRef.current = true;
    setLaunchState("launching");

    try {
      const createRes = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: customerName ?? catalog,
          ucMetadata: fqn,
          industry: industryId ?? "",
          businessPriorities: ["Increase Revenue"],
          discoveryDepth: "balanced",
          estateScanEnabled: true,
        }),
      });
      if (!createRes.ok) throw new Error("Failed to create pipeline run");
      const { runId } = await createRes.json();

      const execRes = await fetch(`/api/runs/${runId}/execute`, { method: "POST" });
      if (!execRes.ok) throw new Error("Failed to start pipeline");

      setLaunchState("launched");
      toast.success("Discovery pipeline with estate scan started");
      router.push(`/runs/${runId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to launch discovery";
      setLaunchState("failed");
      setLaunchError(msg);
      launchedRef.current = false;
      toast.error(msg);
    }
  }, [fqn, customerName, industryId, catalog, router]);

  const handleCopyFqn = () => {
    navigator.clipboard.writeText(fqn);
    toast.success("Copied to clipboard");
  };

  return (
    <div className="space-y-6 px-1">
      {/* Header */}
      <div className="flex flex-col items-center gap-3 py-6">
        {launchState === "ready" ? (
          <>
            <div className="relative">
              <CheckCircle2 className="h-14 w-14 text-emerald-500" />
              <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
                <span className="relative inline-flex h-4 w-4 rounded-full bg-emerald-500" />
              </span>
            </div>
            <h3 className="text-xl font-semibold tracking-tight">Demo Data Ready</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              Your demo data has been generated successfully. Review the summary below, then launch
              the discovery pipeline.
            </p>
          </>
        ) : launchState === "launching" ? (
          <>
            <div className="relative">
              <div className="h-14 w-14 animate-spin rounded-full border-[3px] border-primary/20 border-t-primary" />
            </div>
            <h3 className="text-xl font-semibold tracking-tight">Launching Discovery</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              Starting discovery pipeline with environment scan...
            </p>
          </>
        ) : launchState === "launched" ? (
          <>
            <div className="relative">
              <CheckCircle2 className="h-14 w-14 text-emerald-500" />
              <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
                <span className="relative inline-flex h-4 w-4 rounded-full bg-emerald-500" />
              </span>
            </div>
            <h3 className="text-xl font-semibold tracking-tight">Pipeline Started</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              Redirecting to the discovery pipeline...
            </p>
          </>
        ) : (
          <>
            <AlertCircle className="h-14 w-14 text-destructive/60" />
            <h3 className="text-xl font-semibold tracking-tight">Launch Failed</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              Data generated but pipeline launch failed. You can retry below.
            </p>
            {launchError && <p className="text-xs text-destructive">{launchError}</p>}
          </>
        )}
      </div>

      {/* Schema card */}
      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <code className="text-sm font-mono font-medium">{fqn}</code>
          </div>
          <Button variant="ghost" size="sm" onClick={handleCopyFqn}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>

        {session && (
          <div className="grid grid-cols-4 gap-3">
            <div className="rounded-md bg-muted/50 p-2.5 text-center">
              <Layers className="mx-auto h-4 w-4 text-muted-foreground mb-1" />
              <p className="text-lg font-semibold">{session.tablesCreated}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Tables</p>
            </div>
            <div className="rounded-md bg-muted/50 p-2.5 text-center">
              <BarChart3 className="mx-auto h-4 w-4 text-muted-foreground mb-1" />
              <p className="text-lg font-semibold">{session.totalRows.toLocaleString()}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Rows</p>
            </div>
            <div className="rounded-md bg-muted/50 p-2.5 text-center">
              <Clock className="mx-auto h-4 w-4 text-muted-foreground mb-1" />
              <p className="text-lg font-semibold">{Math.round(session.durationMs / 1000)}s</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Generation
              </p>
            </div>
            <div className="rounded-md bg-muted/50 p-2.5 text-center">
              <Clock className="mx-auto h-4 w-4 text-muted-foreground mb-1" />
              <p className="text-lg font-semibold">
                {wizardStartTime
                  ? `${Math.round((Date.now() - wizardStartTime) / 1000)}s`
                  : `${Math.round(session.durationMs / 1000)}s`}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Total Time
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Genie Space card (Genie Mode only) */}
      {(genieMode || session?.genieMode) && (
        <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-4 dark:border-violet-900 dark:bg-violet-950/20">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-violet-100 dark:bg-violet-900/40">
              <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-300" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Genie Space</p>
                {session?.genieSpaceId && (
                  <span className="text-[10px] font-medium uppercase tracking-wider rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 px-2 py-0.5">
                    Deployed
                  </span>
                )}
              </div>
              {session?.genieSpaceId ? (
                <>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Your Genie Space is ready. It&apos;s bound to{" "}
                    <code className="font-mono text-[11px]">{fqn}</code>.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {session.genieSpaceUrl && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 border-violet-300 text-violet-700 hover:bg-violet-100 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-900/40"
                        onClick={() => window.open(session.genieSpaceUrl!, "_blank")}
                      >
                        Open in Databricks
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5"
                      onClick={() => router.push("/genie")}
                    >
                      View in Forge
                    </Button>
                  </div>
                </>
              ) : session?.genieDeployError ? (
                <>
                  <p className="mt-0.5 text-xs text-destructive">
                    Deploy failed: {session.genieDeployError}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Data was generated successfully. You can retry the Genie Space from the Genie
                    page or contact the field team.
                  </p>
                </>
              ) : (
                <p className="mt-0.5 text-xs text-muted-foreground flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Finalising Genie Space...
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Primary action: Start Discovery Run */}
      {(launchState === "ready" || launchState === "failed") && (
        <Button className="w-full gap-2" size="lg" onClick={launchDiscovery}>
          <Rocket className="h-4 w-4" />
          Start Discovery Run
        </Button>
      )}

      {/* Launching indicator */}
      {launchState === "launching" && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Creating pipeline run with environment scan...
        </div>
      )}

      {/* Session link */}
      <div className="flex justify-center">
        <Button
          variant="link"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          onClick={() => window.open(`/demo/sessions/${sessionId}`, "_blank")}
        >
          View full research briefing
          <ExternalLink className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
