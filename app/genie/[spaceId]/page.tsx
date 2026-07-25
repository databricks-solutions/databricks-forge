"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Activity,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Loader2,
  Settings,
  Shield,
  XCircle,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";

import { SpaceDetailHero } from "@/components/genie/space-detail-hero";
import { ShareButton, SharedByBadge } from "@/components/share/share-button";
import { SpaceOverviewTab, ImprovementAdvice } from "@/components/genie/space-overview-tab";
import { SpaceConfigViewer } from "@/components/genie/space-config-viewer";
import { SpaceHealthTab } from "@/components/genie/space-health-tab";
import { SpaceBenchmarksTab } from "@/components/genie/space-benchmarks-tab";
import { OptimizationReview } from "@/components/genie/optimization-review";

import type { SerializedSpace } from "@/lib/genie/types";
import type { SpaceHealthReport } from "@/lib/genie/health-checks/types";
import type { SpaceMetadata } from "@/lib/genie/space-metadata";
import type { ImproveStats, ImproveChange } from "@/lib/genie/improve-jobs";
import { parseErrorResponse, safeJsonParse } from "@/lib/error-utils";

// ── Types ───────────────────────────────────────────────────────────

interface SpaceDetail {
  spaceId: string;
  // Forge tracking-row id; null for off-platform / untracked spaces.
  // ShareButton and any other ACL helper must key on this, not spaceId.
  trackingId: string | null;
  title: string;
  description: string;
  domain: string | null;
  runId: string | null;
  status: string;
  source: string;
  serializedSpace: string;
  metadata: SpaceMetadata | null;
  healthReport: SpaceHealthReport | null;
  ownerEmail?: string | null;
}

interface FixResult {
  updatedSerializedSpace: string;
  changes: Array<{
    section: string;
    description: string;
    added: number;
    modified: number;
  }>;
  strategiesRun: string[];
  originalSerializedSpace?: string;
}

interface ImproveResult {
  recommendation?: { serializedSpace: string; title: string; description: string };
  updatedSerializedSpace?: string;
  originalSerializedSpace: string;
  changes: ImproveChange[];
  statsBefore: ImproveStats;
  statsAfter: ImproveStats;
  diagnostics?: { strategiesRun: string[]; mode: string };
}

interface ImproveProgress {
  status: "generating" | "completed" | "failed" | "cancelled" | "idle";
  message: string;
  percent: number;
  error: string | null;
  result: ImproveResult | null;
}

// ── Page Component ──────────────────────────────────────────────────

export default function SpaceDetailPage() {
  const { spaceId = "" } = useParams<{ spaceId: string }>() ?? {};
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = searchParams?.get("tab") ?? "overview";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [detail, setDetail] = useState<SpaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [databricksHost, setDatabricksHost] = useState("");
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState<FixResult | null>(null);
  const [cloning, setCloning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [applying, setApplying] = useState(false);

  const [improving, setImproving] = useState(false);
  const [improveProgress, setImproveProgress] = useState<ImproveProgress | null>(null);
  const [improveResult, setImproveResult] = useState<ImproveResult | null>(null);
  const improveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-improve polling state (when redirected from the improve page)
  const autoImproveJobId = searchParams?.get("autoImprove") ?? "";
  const autoImproveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [autoImproveStatus, setAutoImproveStatus] = useState<{
    status: string;
    iteration?: number;
    maxIterations?: number;
    currentScore?: number;
    targetScore?: number;
    message?: string;
  } | null>(null);

  // ── Data fetching ─────────────────────────────────────────────────

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/genie-spaces/${spaceId}/detail`);
      if (!res.ok) throw new Error("Failed to load space details");
      const data: SpaceDetail = await res.json();
      setDetail(data);
    } catch {
      toast.error("Failed to load space details");
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    fetchDetail();
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => {
        if (d.host) setDatabricksHost(d.host.replace(/\/$/, ""));
      })
      .catch(() => {});
  }, [fetchDetail]);

  // Auto-improve polling effect
  useEffect(() => {
    if (!autoImproveJobId) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/genie-spaces/auto-improve?jobId=${autoImproveJobId}`);
        if (!res.ok) return;
        const data = await res.json();
        setAutoImproveStatus(data);
        if (data.status === "completed" || data.status === "failed") {
          if (autoImproveTimerRef.current) clearInterval(autoImproveTimerRef.current);
          if (data.status === "completed") {
            toast.success("Auto-improve complete! Refreshing...");
            fetchDetail();
          } else {
            toast.error(data.error || "Auto-improve failed");
          }
        }
      } catch {
        /* retry */
      }
    };
    poll();
    autoImproveTimerRef.current = setInterval(poll, 3000);
    return () => {
      if (autoImproveTimerRef.current) clearInterval(autoImproveTimerRef.current);
    };
  }, [autoImproveJobId, fetchDetail]);

  // ── Fix handlers ──────────────────────────────────────────────────

  const handleFix = async (checkIds: string[]) => {
    setFixing(true);
    setFixResult(null);
    try {
      const res = await fetch(`/api/genie-spaces/${spaceId}/fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checks: checkIds }),
      });
      if (!res.ok) throw new Error("Fix failed");
      const data: FixResult = await res.json();
      setFixResult(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Fix failed");
    } finally {
      setFixing(false);
    }
  };

  const handleApply = async (serializedSpace: string) => {
    setApplying(true);
    try {
      const res = await fetch(`/api/genie-spaces/${spaceId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serializedSpace }),
      });
      if (!res.ok) throw new Error("Apply failed");
      toast.success("Changes applied successfully");
      setFixResult(null);
      fetchDetail();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setApplying(false);
    }
  };

  const handleCloneAndApply = async (serializedSpace: string) => {
    setCloning(true);
    try {
      const cloneRes = await fetch(`/api/genie-spaces/${spaceId}/clone`, {
        method: "POST",
      });
      if (!cloneRes.ok) throw new Error("Clone failed");
      const { clonedSpaceId } = await cloneRes.json();

      const applyRes = await fetch(`/api/genie-spaces/${clonedSpaceId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serializedSpace }),
      });
      if (!applyRes.ok) throw new Error("Apply to clone failed");

      toast.success("Cloned and applied changes");
      setFixResult(null);
      router.push(`/genie/${clonedSpaceId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Clone and apply failed");
    } finally {
      setCloning(false);
    }
  };

  const pollDeployJob = async (jobId: string): Promise<string> => {
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const pollRes = await fetch(`/api/genie-spaces?deployJobId=${jobId}`);
      if (!pollRes.ok) continue;
      const pollData = await pollRes.json();
      if (pollData.status === "completed" && pollData.result?.spaceId) {
        return pollData.result.spaceId;
      }
      if (pollData.status === "failed") {
        throw new Error(pollData.error || "Deployment failed");
      }
    }
    throw new Error("Deploy timed out");
  };

  const handleCreateNewSpace = async (serializedSpace: string) => {
    setCreating(true);
    try {
      const res = await fetch("/api/genie-spaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${detail?.title ?? "Space"} (Optimized)`,
          description: detail?.description ?? "",
          serializedSpace,
          domain: detail?.domain ?? "general",
        }),
      });
      if (!res.ok) {
        throw new Error(await parseErrorResponse(res, "Create failed"));
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const createResult: any = await safeJsonParse(res);
      if (!createResult) throw new Error("Invalid response from server");

      let newSpaceId: string;
      if (createResult.jobId) {
        toast.info("Deploying new space...");
        newSpaceId = await pollDeployJob(createResult.jobId);
      } else {
        newSpaceId = createResult.spaceId;
      }

      toast.success("New space created from optimized config");
      setFixResult(null);
      router.push(`/genie/${newSpaceId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create new space failed");
    } finally {
      setCreating(false);
    }
  };

  const handleClone = async () => {
    setCloning(true);
    try {
      const res = await fetch(`/api/genie-spaces/${spaceId}/clone`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Clone failed");
      const { clonedSpaceId, title } = await res.json();
      toast.success(`Cloned as "${title}"`);
      router.push(`/genie/${clonedSpaceId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Clone failed");
    } finally {
      setCloning(false);
    }
  };

  // ── Improve with Genie Engine ─────────────────────────────────────

  const stopImprovePolling = useCallback(() => {
    if (improveTimerRef.current) {
      clearInterval(improveTimerRef.current);
      improveTimerRef.current = null;
    }
  }, []);

  const pollImproveStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/genie-spaces/${spaceId}/improve`);
      if (!res.ok) return;
      const data: ImproveProgress = await res.json();
      setImproveProgress(data);

      if (data.status === "completed" && data.result) {
        setImproving(false);
        setImproveResult(data.result);
        stopImprovePolling();
        toast.success("Genie Engine improvement complete");
      } else if (data.status === "failed") {
        setImproving(false);
        stopImprovePolling();
        toast.error(data.error ?? "Improvement failed");
      } else if (data.status === "cancelled") {
        setImproving(false);
        stopImprovePolling();
      }
    } catch {
      // Transient fetch error, keep polling
    }
  }, [spaceId, stopImprovePolling]);

  const startImprovePolling = useCallback(() => {
    stopImprovePolling();
    improveTimerRef.current = setInterval(pollImproveStatus, 2000);
  }, [pollImproveStatus, stopImprovePolling]);

  useEffect(() => {
    return () => stopImprovePolling();
  }, [stopImprovePolling]);

  useEffect(() => {
    if (!spaceId) return;
    fetch(`/api/genie-spaces/${spaceId}/improve`)
      .then((r) => r.json())
      .then((data: ImproveProgress) => {
        if (data.status === "generating") {
          setImproving(true);
          setImproveProgress(data);
          startImprovePolling();
        } else if (data.status === "completed" && data.result) {
          setImproveResult(data.result);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  const handleStartImprove = async () => {
    setImproving(true);
    setImproveResult(null);
    setImproveProgress(null);
    try {
      const res = await fetch(`/api/genie-spaces/${spaceId}/improve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to start improvement");
      }
      startImprovePolling();
      toast.info("Genie Engine improvement started");
    } catch (err) {
      setImproving(false);
      toast.error(err instanceof Error ? err.message : "Failed to start improvement");
    }
  };

  const handleCancelImprove = async () => {
    try {
      await fetch(`/api/genie-spaces/${spaceId}/improve`, { method: "DELETE" });
      setImproving(false);
      setImproveProgress(null);
      stopImprovePolling();
      toast.info("Improvement cancelled");
    } catch {
      toast.error("Failed to cancel improvement");
    }
  };

  const dismissImproveResult = useCallback(() => {
    setImproveResult(null);
    fetch(`/api/genie-spaces/${spaceId}/improve?action=dismiss`, { method: "DELETE" }).catch(
      () => {},
    );
  }, [spaceId]);

  const handleApplyImprove = async (serializedSpace: string) => {
    setApplying(true);
    try {
      const res = await fetch(`/api/genie-spaces/${spaceId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serializedSpace }),
      });
      if (!res.ok) throw new Error("Apply failed");
      toast.success("Improved configuration applied");
      dismissImproveResult();
      fetchDetail();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setApplying(false);
    }
  };

  const handleCreateNewFromImprove = async (serializedSpace: string) => {
    setCreating(true);
    try {
      const title = improveResult?.recommendation?.title ?? detail?.title ?? "Space";
      const res = await fetch("/api/genie-spaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${title} (Improved)`,
          description: detail?.description ?? "",
          serializedSpace,
          domain: detail?.domain ?? "general",
        }),
      });
      if (!res.ok) {
        throw new Error(await parseErrorResponse(res, "Create failed"));
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const improvedResult: any = await safeJsonParse(res);
      if (!improvedResult) throw new Error("Invalid response from server");

      let newSpaceId: string;
      if (improvedResult.jobId) {
        toast.info("Deploying improved space...");
        newSpaceId = await pollDeployJob(improvedResult.jobId);
      } else {
        newSpaceId = improvedResult.spaceId;
      }

      toast.success("New improved space created");
      dismissImproveResult();
      router.push(`/genie/${newSpaceId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create new space failed");
    } finally {
      setCreating(false);
    }
  };

  // ── Derived values ────────────────────────────────────────────────

  const canImprove = !detail?.runId && detail?.healthReport?.grade !== "A";
  const genieUrl = databricksHost ? `${databricksHost}/genie/rooms/${spaceId}` : "";

  const parsed: SerializedSpace | null = (() => {
    if (!detail) return null;
    try {
      return JSON.parse(detail.serializedSpace) as SerializedSpace;
    } catch {
      return null;
    }
  })();

  // ── Loading ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-10 w-96" />
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-48" />
      </div>
    );
  }

  // ── Not found ─────────────────────────────────────────────────────

  if (!detail) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/genie">
            <ArrowLeft className="mr-1 size-4" />
            Back to Genie Spaces
          </Link>
        </Button>
        <p className="text-sm text-muted-foreground">Space not found or inaccessible.</p>
      </div>
    );
  }

  // ── Fix review mode ───────────────────────────────────────────────

  if (fixResult) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-8">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setFixResult(null)}>
            <ArrowLeft className="mr-1 size-4" />
            Back to Space
          </Button>
        </div>
        <OptimizationReview
          changes={fixResult.changes}
          strategiesRun={fixResult.strategiesRun}
          currentSerializedSpace={detail.serializedSpace}
          updatedSerializedSpace={fixResult.updatedSerializedSpace}
          onApply={handleApply}
          onCloneAndApply={handleCloneAndApply}
          onCreateNew={handleCreateNewSpace}
          onCancel={() => setFixResult(null)}
          applying={applying}
          cloning={cloning}
          creating={creating}
        />
      </div>
    );
  }

  // ── Improve review mode ───────────────────────────────────────────

  if (improveResult) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-8">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={dismissImproveResult}>
            <ArrowLeft className="mr-1 size-4" />
            Back to Space
          </Button>
          <h1 className="text-xl font-bold tracking-tight">
            Genie Engine Improvement Review
            <span className="ml-2 text-base font-normal text-muted-foreground">
              — {detail.title}
            </span>
          </h1>
        </div>

        <ImprovementAdvice
          statsBefore={improveResult.statsBefore}
          statsAfter={improveResult.statsAfter}
        />

        <OptimizationReview
          changes={improveResult.changes}
          strategiesRun={improveResult.diagnostics?.strategiesRun ?? ["Genie Engine Full Analysis"]}
          currentSerializedSpace={improveResult.originalSerializedSpace}
          updatedSerializedSpace={
            improveResult.recommendation?.serializedSpace ??
            improveResult.updatedSerializedSpace ??
            improveResult.originalSerializedSpace
          }
          onApply={handleApplyImprove}
          onCloneAndApply={handleCloneAndApply}
          onCreateNew={handleCreateNewFromImprove}
          onCancel={dismissImproveResult}
          applying={applying}
          cloning={cloning}
          creating={creating}
        />
      </div>
    );
  }

  // ── Main view ─────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex items-center justify-end gap-2">
        <SharedByBadge ownerEmail={detail.ownerEmail} />
        <ShareButton
          resourceType="genie_space"
          resourceId={detail.trackingId ?? ""}
          ownerEmail={detail.ownerEmail}
          resourceLabel={`"${detail.title}"`}
        />
      </div>
      <SpaceDetailHero
        title={detail.title}
        description={detail.description}
        grade={detail.healthReport?.grade}
        overallScore={detail.healthReport?.overallScore}
        source={detail.source}
        genieUrl={genieUrl}
        canImprove={canImprove}
        improving={improving}
        fixing={fixing}
        onImprove={handleStartImprove}
      />

      {/* Engine improvement progress banner -- visible across all tabs */}
      {improving && improveProgress && (
        <EngineProgressBanner
          message={improveProgress.message ?? ""}
          percent={improveProgress.percent ?? 0}
          onCancel={handleCancelImprove}
        />
      )}

      {/* Auto-improve progress banner */}
      {autoImproveStatus && autoImproveStatus.status === "running" && (
        <EngineProgressBanner
          message={
            autoImproveStatus.message ??
            `Auto-improve iteration ${autoImproveStatus.iteration ?? "?"}/${autoImproveStatus.maxIterations ?? "?"} — score ${autoImproveStatus.currentScore ?? "?"}/${autoImproveStatus.targetScore ?? 80}`
          }
          percent={
            autoImproveStatus.iteration && autoImproveStatus.maxIterations
              ? Math.round((autoImproveStatus.iteration / autoImproveStatus.maxIterations) * 100)
              : 50
          }
        />
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">
            <Activity className="mr-1.5 size-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="configuration">
            <Settings className="mr-1.5 size-4" />
            Configuration
          </TabsTrigger>
          <TabsTrigger value="health">
            <Shield className="mr-1.5 size-4" />
            Health
          </TabsTrigger>
          <TabsTrigger value="benchmarks">
            <FlaskConical className="mr-1.5 size-4" />
            Benchmarks
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <SpaceOverviewTab
            spaceId={spaceId}
            metadata={detail.metadata}
            domain={detail.domain}
            status={detail.status}
            runId={detail.runId}
            genieUrl={genieUrl}
            canImprove={canImprove}
            improving={improving}
            fixing={fixing}
            cloning={cloning}
            onImprove={handleStartImprove}
            onClone={handleClone}
          />
        </TabsContent>

        <TabsContent value="configuration" className="mt-4">
          {parsed ? (
            <SpaceConfigViewer space={parsed} />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Unable to parse space configuration.
            </p>
          )}
        </TabsContent>

        <TabsContent value="health" className="mt-4">
          {detail.healthReport ? (
            <SpaceHealthTab
              report={detail.healthReport}
              spaceId={spaceId}
              onFix={handleFix}
              fixing={fixing}
            />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Health report unavailable.
            </p>
          )}
        </TabsContent>

        <TabsContent value="benchmarks" className="mt-4">
          <SpaceBenchmarksTab
            spaceId={spaceId}
            benchmarkCount={detail.metadata?.benchmarkCount ?? 0}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EngineProgressBanner({
  message,
  percent,
  onCancel,
}: {
  message: string;
  percent: number;
  onCancel?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="rounded-lg border bg-card p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-medium"
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <Loader2 className="size-4 animate-spin text-primary" />
          Genie Engine Improving...
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{Math.round(percent)}%</span>
          {onCancel && (
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onCancel}>
              <XCircle className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="mt-2 space-y-1.5">
          <Progress value={percent} className="h-1.5" />
          <p className="text-xs text-muted-foreground">{message}</p>
        </div>
      )}
    </div>
  );
}
