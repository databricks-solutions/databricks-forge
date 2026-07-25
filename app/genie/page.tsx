"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  BrainCircuit,
  ExternalLink,
  Sparkles,
  Trash2,
  Loader2,
  Table2,
  BarChart3,
  MessageSquare,
  Link2,
  FlaskConical,
  RefreshCw,
  Search,
  FileText,
  MessageCircle,
  Wrench,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
} from "lucide-react";
import type { TrackedGenieSpace } from "@/lib/genie/types";
import type { SpaceHealthReport } from "@/lib/genie/health-checks/types";
import { PageHeader } from "@/components/page-header";
import { HealthDetailSheet } from "@/components/genie/health-detail-sheet";
import { ImportSpaceDialog } from "@/components/genie/import-space-dialog";
import { HealthCheckSettingsDialog } from "@/components/genie/health-check-settings";
import { parseErrorResponse } from "@/lib/error-utils";
import { useGenieBuild } from "@/components/providers/genie-build-provider";
import { Database } from "lucide-react";

interface CachedSpaceData {
  spaceId: string;
  title: string;
  description?: string | null;
  tableCount?: number | null;
  measureCount?: number | null;
  sampleQuestionCount?: number | null;
  filterCount?: number | null;
  healthScore?: number | null;
  healthReportJson?: string | null;
  permissionDenied?: boolean;
  lastDiscoveredAt?: string | null;
}

interface SpaceCardData {
  spaceId: string;
  title: string;
  description?: string | null;
  source: "pipeline" | "metadata" | "workspace";
  status: "created" | "updated" | "trashed" | "active";
  domain?: string;
  runId?: string | null;
  tableCount?: number;
  measureCount?: number;
  sampleQuestionCount?: number;
  filterCount?: number;
  updatedAt?: string;
  permissionDenied?: boolean;
}

function mergeSpacesFromCache(
  cached: CachedSpaceData[],
  tracked: TrackedGenieSpace[],
): SpaceCardData[] {
  const trackedMap = new Map<string, TrackedGenieSpace>();
  for (const t of tracked) trackedMap.set(t.spaceId, t);

  const result: SpaceCardData[] = [];
  const seen = new Set<string>();

  for (const c of cached) {
    seen.add(c.spaceId);
    const t = trackedMap.get(c.spaceId);
    result.push({
      spaceId: c.spaceId,
      title: t?.title ?? c.title,
      description: c.description,
      source: t ? "pipeline" : "workspace",
      status: t?.status ?? "active",
      domain: t?.domain,
      runId: t?.runId,
      updatedAt: t?.updatedAt,
      tableCount: c.tableCount ?? undefined,
      measureCount: c.measureCount ?? undefined,
      sampleQuestionCount: c.sampleQuestionCount ?? undefined,
      filterCount: c.filterCount ?? undefined,
      permissionDenied: c.permissionDenied,
    });
  }

  for (const t of tracked) {
    if (seen.has(t.spaceId)) continue;
    result.push({
      spaceId: t.spaceId,
      title: t.title,
      source: "pipeline",
      status: t.status,
      domain: t.domain,
      runId: t.runId,
      updatedAt: t.updatedAt,
    });
  }

  return result.sort((a, b) => {
    if (a.status === "trashed" && b.status !== "trashed") return 1;
    if (a.status !== "trashed" && b.status === "trashed") return -1;
    return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  });
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function GenieSpacesPage() {
  const router = useRouter();
  const [spaces, setSpaces] = useState<SpaceCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ percent: number; message: string } | null>(
    null,
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [trashTarget, setTrashTarget] = useState<SpaceCardData | null>(null);
  const [trashing, setTrashing] = useState(false);
  const [databricksHost, setDatabricksHost] = useState("");
  const [healthScores, setHealthScores] = useState<Record<string, SpaceHealthReport | null>>({});
  const [inaccessibleIds, setInaccessibleIds] = useState<Set<string>>(new Set());
  const [healthSheetOpen, setHealthSheetOpen] = useState(false);
  const [healthSheetTarget, setHealthSheetTarget] = useState<SpaceCardData | null>(null);
  const [improveStatuses, setImproveStatuses] = useState<
    Record<string, { status: string; percent: number; message: string }>
  >({});
  const [page, setPage] = useState(0);
  const improveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const spacesRef = useRef(spaces);
  spacesRef.current = spaces;

  // Active generate jobs from shared provider
  const { jobs: generateJobs, cancelBuild } = useGenieBuild();

  // Load spaces from Lakebase cache (fast, no Databricks API calls)
  const loadFromCache = useCallback(async () => {
    try {
      const res = await fetch("/api/genie-spaces");
      if (!res.ok) throw new Error("Failed to load spaces");
      const data = await res.json();
      const merged = mergeSpacesFromCache(data.spaces ?? [], data.tracked ?? []);
      setSpaces(merged);
      setLastSyncedAt(data.lastSyncedAt ?? null);

      // Populate health scores + inaccessible IDs from cached data
      const cachedHealth: Record<string, SpaceHealthReport | null> = {};
      const denied = new Set<string>();
      for (const s of data.spaces ?? []) {
        if (s.healthReportJson) {
          try {
            cachedHealth[s.spaceId] = JSON.parse(s.healthReportJson);
          } catch {
            /* invalid JSON */
          }
        }
        if (s.permissionDenied) denied.add(s.spaceId);
      }
      if (Object.keys(cachedHealth).length > 0) setHealthScores(cachedHealth);
      if (denied.size > 0) setInaccessibleIds(denied);
    } catch {
      toast.error("Failed to load Genie Spaces");
    } finally {
      setLoading(false);
    }
  }, []);

  const runDiscovery = useCallback(async (spaceIds: string[]) => {
    if (spaceIds.length === 0) return;
    setDiscovering(true);
    try {
      const res = await fetch("/api/genie-spaces/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceIds }),
      });
      if (!res.ok) return;

      const data: Record<
        string,
        {
          metadata: {
            tableCount?: number;
            measureCount?: number;
            sampleQuestionCount?: number;
            filterCount?: number;
          } | null;
          healthReport: SpaceHealthReport | null;
          permissionDenied?: boolean;
        }
      > = await res.json();

      const deniedIds = new Set<string>();
      const reports: Record<string, SpaceHealthReport | null> = {};
      for (const [id, result] of Object.entries(data)) {
        if (result.permissionDenied) deniedIds.add(id);
        reports[id] = result.healthReport;
      }

      if (deniedIds.size > 0) {
        setInaccessibleIds((prev) => {
          const next = new Set(prev);
          for (const id of deniedIds) next.add(id);
          return next;
        });
      }

      setSpaces((prev) =>
        prev.map((s) => {
          const disc = data[s.spaceId];
          if (!disc?.metadata) return s;
          return {
            ...s,
            tableCount: disc.metadata.tableCount,
            measureCount: disc.metadata.measureCount,
            sampleQuestionCount: disc.metadata.sampleQuestionCount,
            filterCount: disc.metadata.filterCount,
          };
        }),
      );

      setHealthScores((prev) => ({ ...prev, ...reports }));
    } catch {
      // Discovery is non-critical
    } finally {
      setDiscovering(false);
    }
  }, []);

  // Fire-and-forget sync: POST to start, then poll GET for progress
  const handleRefresh = useCallback(() => {
    setSyncing(true);
    setSyncProgress({ percent: 0, message: "Starting sync..." });

    fetch("/api/genie-spaces/sync", { method: "POST" })
      .then((res) => res.json())
      .then((data: { jobId: string; alreadyRunning?: boolean }) => {
        if (data.alreadyRunning) {
          toast.info("A sync is already in progress");
        }

        const pollSync = () => {
          fetch(`/api/genie-spaces/sync?jobId=${data.jobId}`)
            .then((r) => r.json())
            .then(
              (job: {
                status: string;
                message: string;
                percent: number;
                spacesFound: number;
                error: string | null;
              }) => {
                setSyncProgress({ percent: job.percent, message: job.message });

                if (job.status === "completed") {
                  if (syncTimerRef.current) {
                    clearInterval(syncTimerRef.current);
                    syncTimerRef.current = null;
                  }
                  setSyncing(false);
                  setSyncProgress(null);
                  toast.success(`Synced ${job.spacesFound.toLocaleString()} spaces`);
                  loadFromCache();
                } else if (job.status === "failed") {
                  if (syncTimerRef.current) {
                    clearInterval(syncTimerRef.current);
                    syncTimerRef.current = null;
                  }
                  setSyncing(false);
                  setSyncProgress(null);
                  toast.error(job.error ?? "Sync failed");
                }
              },
            )
            .catch(() => {});
        };

        syncTimerRef.current = setInterval(pollSync, 3000);
        pollSync();
      })
      .catch(() => {
        setSyncing(false);
        setSyncProgress(null);
        toast.error("Failed to start sync");
      });
  }, [loadFromCache]);

  // Initial load from cache + health check
  useEffect(() => {
    loadFromCache();
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => {
        if (d.host) {
          setDatabricksHost(d.host.replace(/\/$/, ""));
          localStorage.setItem("forge-databricks-host", d.host.replace(/\/$/, ""));
        }
      })
      .catch(() => {});
    return () => {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    };
  }, [loadFromCache]);

  // Discover health for visible spaces that are missing scores
  const discoveredRef = useRef(new Set<string>());
  useEffect(() => {
    if (loading || syncing || discovering) return;
    const visible = spaces
      .filter((s) => s.status !== "trashed" && !inaccessibleIds.has(s.spaceId))
      .slice(page * 12, (page + 1) * 12);
    const missing = visible
      .filter((s) => !healthScores[s.spaceId] && !discoveredRef.current.has(s.spaceId))
      .map((s) => s.spaceId);
    if (missing.length === 0) return;
    for (const id of missing) discoveredRef.current.add(id);
    runDiscovery(missing);
  }, [loading, syncing, discovering, spaces, page, healthScores, inaccessibleIds, runDiscovery]);

  // Poll for active improvement jobs
  useEffect(() => {
    const prevStatuses = new Map<string, string>();

    const pollImproveStatuses = async () => {
      try {
        const res = await fetch("/api/genie-spaces/improve-status");
        if (res.ok) {
          const data: {
            jobs: Record<string, { status: string; percent: number; message: string }>;
          } = await res.json();
          setImproveStatuses(data.jobs);

          for (const [sid, job] of Object.entries(data.jobs)) {
            const prev = prevStatuses.get(sid);
            if (prev === "generating" && job.status === "completed") {
              const space = spacesRef.current.find((s) => s.spaceId === sid);
              toast.success(`"${space?.title ?? "Space"}" improvement complete — click to review`, {
                action: { label: "Review", onClick: () => router.push(`/genie/${sid}`) },
                duration: 8000,
              });
            }
            prevStatuses.set(sid, job.status);
          }

          const hasActive = Object.values(data.jobs).some((j) => j.status === "generating");
          if (!hasActive && improveTimerRef.current) {
            clearInterval(improveTimerRef.current);
            improveTimerRef.current = null;
          }
        }
      } catch {
        // Non-critical
      }
    };

    pollImproveStatuses();
    improveTimerRef.current = setInterval(pollImproveStatuses, 5000);
    return () => {
      if (improveTimerRef.current) clearInterval(improveTimerRef.current);
    };
  }, [router]);

  const handleCancelGenerate = async (jobId: string) => {
    const ok = await cancelBuild(jobId);
    if (!ok) toast.error("Failed to cancel generation");
  };

  const handleTrash = async () => {
    if (!trashTarget) return;
    setTrashing(true);
    try {
      const res = await fetch(`/api/genie-spaces/${trashTarget.spaceId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(await parseErrorResponse(res, "Failed to trash space"));
      }
      toast.success(`"${trashTarget.title}" trashed`);
      setTrashTarget(null);
      loadFromCache();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to trash space");
    } finally {
      setTrashing(false);
    }
  };

  const activeSpaces = spaces.filter(
    (s) => s.status !== "trashed" && !inaccessibleIds.has(s.spaceId),
  );
  const inaccessibleSpaces = spaces.filter(
    (s) => s.status !== "trashed" && inaccessibleIds.has(s.spaceId),
  );
  const trashedSpaces = spaces.filter((s) => s.status === "trashed");
  const visibleJobs = generateJobs.filter((j) => !j.deployedSpaceId);

  const PAGE_SIZE = 12;
  const totalPages = Math.max(1, Math.ceil(activeSpaces.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginatedSpaces = activeSpaces.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      <PageHeader
        title="Genie Studio"
        subtitle="Create, manage, and improve Databricks Genie Spaces for natural language SQL exploration."
        actions={
          <div className="flex items-center gap-2">
            <HealthCheckSettingsDialog />
            <ImportSpaceDialog
              onImported={(result) => {
                const importedId = `imported-${Date.now()}`;
                setSpaces((prev) => [
                  {
                    spaceId: importedId,
                    title: result.title,
                    description: "Imported via JSON paste",
                    source: "workspace" as const,
                    status: "active" as const,
                    tableCount: result.metadata?.tableCount,
                    measureCount: result.metadata?.measureCount,
                    sampleQuestionCount: result.metadata?.sampleQuestionCount,
                    filterCount: result.metadata?.filterCount,
                  },
                  ...prev,
                ]);
                setHealthScores((prev) => ({ ...prev, [importedId]: result.healthReport }));
              }}
            />
            {lastSyncedAt && (
              <span className="text-xs text-muted-foreground">
                Synced {formatRelativeTime(lastSyncedAt)}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={loading || syncing}
            >
              {syncing ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 size-4" />
              )}
              {syncing && syncProgress ? `${syncProgress.percent}%` : "Sync Spaces"}
            </Button>
          </div>
        }
      />

      {/* Genie Studio Entry Points */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StudioEntryCard
          icon={Search}
          title="Scan Schema"
          description="Point at a catalog.schema and auto-generate a Genie Space with AI table selection and data profiling."
          href="/genie/create/schema"
          accent="blue"
          badge="New"
        />
        <StudioEntryCard
          icon={FileText}
          title="Upload Requirements"
          description="Upload a PDF, Markdown, or text document. Forge extracts tables, questions, and instructions."
          href="/genie/create/requirements"
          accent="violet"
          badge="New"
        />
        <StudioEntryCard
          icon={MessageCircle}
          title="Describe Your Space"
          description="Tell Ask Forge what you need in plain text. It builds the space from your conversation."
          href="/ask-forge?persona=genie-builder"
          accent="emerald"
        />
        <StudioEntryCard
          icon={Wrench}
          title="Improve Existing"
          description={
            activeSpaces.length > 0
              ? `Run result-based benchmarks with auto-fix loops. ${activeSpaces.length} space${activeSpaces.length !== 1 ? "s" : ""} available.`
              : "Create a Genie Space first, then use benchmarks and auto-fix to improve it."
          }
          href={activeSpaces.length > 0 ? "/genie/improve" : undefined}
          onClick={
            activeSpaces.length === 0
              ? () => toast.info("Create a Genie Space first, then come back to improve it.")
              : undefined
          }
          accent="amber"
          badge="Enhanced"
          disabled={loading || activeSpaces.length === 0}
        />
      </div>

      {/* Spaces List */}
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : spaces.length === 0 && visibleJobs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Sparkles className="mb-4 size-12 text-muted-foreground/50" />
            <h2 className="text-lg font-semibold">
              {lastSyncedAt ? "No Genie Spaces yet" : "Sync your workspace"}
            </h2>
            <p className="mx-auto mt-1 max-w-sm text-center text-sm text-muted-foreground">
              {lastSyncedAt
                ? "Choose an entry point above to create your first Genie Space."
                : "Click Sync Spaces to pull Genie Spaces from your Databricks workspace into the local cache."}
            </p>
            {!lastSyncedAt && (
              <Button className="mt-4" onClick={handleRefresh} disabled={syncing}>
                {syncing ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 size-4" />
                )}
                Sync Spaces
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="active">
          <TabsList>
            <TabsTrigger value="active">Active ({activeSpaces.length})</TabsTrigger>
            {inaccessibleSpaces.length > 0 && (
              <TabsTrigger value="no-access">No Access ({inaccessibleSpaces.length})</TabsTrigger>
            )}
            {trashedSpaces.length > 0 && (
              <TabsTrigger value="trashed">Trashed ({trashedSpaces.length})</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="active" className="mt-4">
            {/* Generate job tiles -- building, completed (ready to deploy), and failed */}
            {visibleJobs.length > 0 && (
              <div className="mb-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {visibleJobs.map((job) => {
                  if (job.status === "generating") {
                    return (
                      <Card
                        key={job.jobId}
                        className="relative cursor-pointer overflow-hidden border-violet-500/30 transition-shadow hover:shadow-md"
                        onClick={() => router.push(`/genie/build/${job.jobId}`)}
                      >
                        <CardContent className="p-5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <BrainCircuit className="size-5 shrink-0 animate-pulse text-violet-500" />
                              <div className="min-w-0">
                                <h3 className="truncate text-sm font-semibold">
                                  {job.title || "Building Genie Space..."}
                                </h3>
                                <div className="flex items-center gap-1.5">
                                  {job.domain && (
                                    <span className="text-xs text-muted-foreground">
                                      {job.domain}
                                    </span>
                                  )}
                                  <JobSourceBadge source={job.source} />
                                </div>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 shrink-0 text-xs text-muted-foreground hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCancelGenerate(job.jobId);
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                          {job.conversationSummary && (
                            <p className="truncate text-[10px] text-muted-foreground/70">
                              From: {job.conversationSummary}
                            </p>
                          )}
                          <div className="mt-3 space-y-1.5">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span className="truncate">{job.message}</span>
                              <span className="shrink-0 pl-2">{job.percent}%</span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-violet-500 transition-all duration-500"
                                style={{ width: `${job.percent}%` }}
                              />
                            </div>
                            {job.tableCount && (
                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <Table2 className="size-3" />
                                {job.tableCount} table{job.tableCount !== 1 ? "s" : ""}
                              </div>
                            )}
                          </div>
                          <p className="mt-2 text-[10px] text-muted-foreground/70">
                            Click for details <ArrowRight className="ml-0.5 inline size-2.5" />
                          </p>
                        </CardContent>
                      </Card>
                    );
                  }
                  if (job.status === "completed") {
                    return (
                      <Card
                        key={job.jobId}
                        className="relative cursor-pointer overflow-hidden border-green-500/30 transition-shadow hover:shadow-md"
                        onClick={() => router.push(`/genie/build/${job.jobId}`)}
                      >
                        <CardContent className="p-5">
                          <div className="flex items-start justify-between">
                            <div className="flex min-w-0 items-center gap-2">
                              <Sparkles className="size-5 shrink-0 text-green-500" />
                              <div className="min-w-0">
                                <h3 className="truncate text-sm font-semibold">
                                  {job.title || "Genie Space Ready"}
                                </h3>
                                <div className="flex items-center gap-1.5">
                                  {job.domain && (
                                    <span className="text-xs text-muted-foreground">
                                      {job.domain}
                                    </span>
                                  )}
                                  <JobSourceBadge source={job.source} />
                                </div>
                              </div>
                            </div>
                            <Badge
                              variant="outline"
                              className="text-xs text-green-600 border-green-300 dark:text-green-400"
                            >
                              {job.deployedSpaceId ? "Deployed" : "Ready"}
                            </Badge>
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">{job.message}</p>
                          <p className="mt-2 text-xs font-medium text-primary">
                            {job.deployedSpaceId ? "View Space" : "Review & Deploy"}{" "}
                            <ArrowRight className="ml-0.5 inline size-3" />
                          </p>
                        </CardContent>
                      </Card>
                    );
                  }
                  if (job.status === "failed") {
                    return (
                      <Card
                        key={job.jobId}
                        className="relative cursor-pointer overflow-hidden border-destructive/30 transition-shadow hover:shadow-md"
                        onClick={() => router.push(`/genie/build/${job.jobId}`)}
                      >
                        <CardContent className="p-5">
                          <div className="flex items-start justify-between">
                            <div className="flex min-w-0 items-center gap-2">
                              <BrainCircuit className="size-5 shrink-0 text-destructive" />
                              <div className="min-w-0">
                                <h3 className="truncate text-sm font-semibold">
                                  {job.title || "Build Failed"}
                                </h3>
                                <div className="flex items-center gap-1.5">
                                  {job.domain && (
                                    <span className="text-xs text-muted-foreground">
                                      {job.domain}
                                    </span>
                                  )}
                                  <JobSourceBadge source={job.source} />
                                </div>
                              </div>
                            </div>
                            <Badge
                              variant="outline"
                              className="text-xs text-destructive border-destructive/30"
                            >
                              Failed
                            </Badge>
                          </div>
                          <p className="mt-2 text-xs text-destructive">
                            {job.error || job.message}
                          </p>
                        </CardContent>
                      </Card>
                    );
                  }
                  return null;
                })}
              </div>
            )}

            {activeSpaces.length === 0 &&
            visibleJobs.filter((j) => j.status === "generating").length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No active spaces. Choose an entry point above to get started.
              </p>
            ) : activeSpaces.length > 0 ? (
              <>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {paginatedSpaces.map((space) => (
                    <SpaceCard
                      key={space.spaceId}
                      space={space}
                      databricksHost={databricksHost}
                      onTrash={() => setTrashTarget(space)}
                      onCardClick={() => router.push(`/genie/${space.spaceId}`)}
                      healthReport={healthScores[space.spaceId] ?? undefined}
                      healthLoading={syncing || (discovering && !healthScores[space.spaceId])}
                      onHealthClick={() => {
                        setHealthSheetTarget(space);
                        setHealthSheetOpen(true);
                      }}
                      improveStatus={improveStatuses[space.spaceId]}
                    />
                  ))}
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-2">
                    <p className="text-sm text-muted-foreground">
                      Page {currentPage + 1} of {totalPages}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={currentPage === 0}
                        onClick={() => setPage(currentPage - 1)}
                      >
                        <ChevronLeft className="mr-1 size-4" />
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={currentPage >= totalPages - 1}
                        onClick={() => setPage(currentPage + 1)}
                      >
                        Next
                        <ChevronRight className="ml-1 size-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </TabsContent>

          {inaccessibleSpaces.length > 0 && (
            <TabsContent value="no-access" className="mt-4 space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
                <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="text-sm">
                  <p className="font-medium text-amber-800 dark:text-amber-300">
                    These spaces reference tables you don&apos;t have permission to access.
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Contact your workspace admin to request access to the underlying tables, or ask
                    the space owner to grant you permissions.
                  </p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {inaccessibleSpaces.map((space) => (
                  <Card
                    key={space.spaceId}
                    className="flex h-full flex-col overflow-hidden opacity-75"
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <CardTitle className="line-clamp-2 text-base">{space.title}</CardTitle>
                          {space.description && (
                            <CardDescription className="mt-1 line-clamp-2 text-xs">
                              {space.description}
                            </CardDescription>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <ShieldAlert className="size-4 text-amber-500" />
                          <SourceBadge source={space.source} />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col">
                      {space.domain && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Sparkles className="size-3" />
                          <span>{space.domain}</span>
                        </div>
                      )}
                      <p className="mt-2 text-xs text-muted-foreground">
                        Permission denied to underlying tables.
                      </p>
                      <div className="mt-auto flex items-center gap-2 pt-3">
                        {databricksHost && (
                          <Button size="sm" variant="outline" asChild className="h-7 text-xs">
                            <a
                              href={`${databricksHost}/genie/rooms/${space.spaceId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="mr-1.5 size-3" />
                              Open in Databricks
                            </a>
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>
          )}

          {trashedSpaces.length > 0 && (
            <TabsContent value="trashed" className="mt-4">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {trashedSpaces.map((space) => (
                  <SpaceCard key={space.spaceId} space={space} databricksHost={databricksHost} />
                ))}
              </div>
            </TabsContent>
          )}
        </Tabs>
      )}

      {/* Trash confirmation dialog */}
      <AlertDialog open={!!trashTarget} onOpenChange={(open) => !open && setTrashTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trash Genie Space</AlertDialogTitle>
            <AlertDialogDescription>
              This will trash &quot;{trashTarget?.title}&quot; in Databricks. The space can be
              recovered from the Databricks workspace trash.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={trashing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleTrash}
              disabled={trashing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {trashing ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 size-4" />
              )}
              Trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Health detail sheet -- onFix navigates to detail page health tab */}
      <HealthDetailSheet
        open={healthSheetOpen}
        onOpenChange={setHealthSheetOpen}
        spaceId={healthSheetTarget?.spaceId ?? ""}
        spaceTitle={healthSheetTarget?.title ?? ""}
        report={healthSheetTarget ? (healthScores[healthSheetTarget.spaceId] ?? null) : null}
        loading={syncing}
        onFix={() => {
          if (healthSheetTarget) {
            setHealthSheetOpen(false);
            router.push(`/genie/${healthSheetTarget.spaceId}?tab=health`);
          }
        }}
      />
    </div>
  );
}

const ACCENT_CLASSES = {
  blue: "border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/30",
  violet: "border-violet-200 bg-violet-50/50 dark:border-violet-800 dark:bg-violet-950/30",
  emerald: "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/30",
  amber: "border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30",
} as const;

const ICON_ACCENT_CLASSES = {
  blue: "text-blue-600 dark:text-blue-400",
  violet: "text-violet-600 dark:text-violet-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
} as const;

function StudioEntryCard({
  icon: Icon,
  title,
  description,
  href,
  onClick,
  accent,
  badge,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  href?: string;
  onClick?: () => void;
  accent: keyof typeof ACCENT_CLASSES;
  badge?: string;
  disabled?: boolean;
}) {
  const content = (
    <Card
      className={`group relative flex h-full flex-col border transition-all ${
        disabled
          ? "cursor-not-allowed opacity-50"
          : "cursor-pointer hover:shadow-lg hover:-translate-y-0.5"
      } ${ACCENT_CLASSES[accent]}`}
      onClick={disabled ? undefined : onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div
            className={`rounded-lg border bg-background p-2 shadow-sm ${ICON_ACCENT_CLASSES[accent]}`}
          >
            <Icon className="size-5" />
          </div>
          {badge && (
            <Badge variant="secondary" className="text-[10px] font-medium">
              {badge}
            </Badge>
          )}
        </div>
        <CardTitle className="mt-3 text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col pt-0">
        <CardDescription className="text-xs leading-relaxed">{description}</CardDescription>
        <div className="mt-auto flex items-center gap-1 pt-3 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
          Get started{" "}
          <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
        </div>
      </CardContent>
    </Card>
  );

  if (href && !disabled) {
    return (
      <Link href={href} className="no-underline">
        {content}
      </Link>
    );
  }
  return content;
}

function HealthGradeBadge({
  report,
  loading,
  onClick,
}: {
  report?: SpaceHealthReport;
  loading?: boolean;
  onClick?: () => void;
}) {
  if (loading) return <Skeleton className="size-7 rounded-full" />;
  if (!report) return null;

  const colorClass =
    report.grade === "A" || report.grade === "B"
      ? "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/40 dark:text-green-400"
      : report.grade === "C"
        ? "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/40 dark:text-amber-400"
        : "bg-red-100 text-red-700 border-red-300 dark:bg-red-900/40 dark:text-red-400";

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={`flex size-7 items-center justify-center rounded-full border text-xs font-bold transition-transform hover:scale-110 ${colorClass}`}
      title={`Health: ${report.grade} (${report.overallScore}/100)`}
    >
      {report.grade}
    </button>
  );
}

function SpaceCard({
  space,
  databricksHost,
  onTrash,
  onCardClick,
  healthReport,
  healthLoading,
  onHealthClick,
  improveStatus,
}: {
  space: SpaceCardData;
  databricksHost: string;
  onTrash?: () => void;
  onCardClick?: () => void;
  healthReport?: SpaceHealthReport;
  healthLoading?: boolean;
  onHealthClick?: () => void;
  improveStatus?: { status: string; percent: number; message: string };
}) {
  const isTrashed = space.status === "trashed";
  const genieUrl = databricksHost ? `${databricksHost}/genie/rooms/${space.spaceId}` : "";
  const isImproving = improveStatus?.status === "generating";

  return (
    <Card
      className={`flex h-full flex-col ${isTrashed ? "overflow-hidden opacity-60" : "overflow-hidden"} ${isImproving ? "ring-1 ring-violet-300 dark:ring-violet-700" : ""} ${onCardClick ? "cursor-pointer transition-shadow hover:shadow-md" : ""}`}
      onClick={onCardClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="line-clamp-2 text-base">{space.title}</CardTitle>
            {space.description && (
              <CardDescription className="mt-1 line-clamp-2 text-xs">
                {space.description}
              </CardDescription>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            {isImproving && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex size-7 items-center justify-center">
                    <BrainCircuit className="size-5 animate-pulse text-violet-500" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Improving with Genie Engine ({improveStatus.percent}%)
                </TooltipContent>
              </Tooltip>
            )}
            {!isImproving && !isTrashed && (
              <HealthGradeBadge
                report={healthReport}
                loading={healthLoading}
                onClick={onHealthClick}
              />
            )}
            <SourceBadge source={space.source} />
            {isTrashed && (
              <Badge variant="outline" className="text-xs">
                Trashed
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col space-y-3">
        {space.domain && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="size-3" />
            <span>{space.domain}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {space.tableCount !== undefined && space.tableCount > 0 && (
            <span className="flex items-center gap-1">
              <Table2 className="size-3" />
              {space.tableCount} tables
            </span>
          )}
          {space.measureCount !== undefined && space.measureCount > 0 && (
            <span className="flex items-center gap-1">
              <BarChart3 className="size-3" />
              {space.measureCount} measures
            </span>
          )}
          {space.sampleQuestionCount !== undefined && space.sampleQuestionCount > 0 && (
            <span className="flex items-center gap-1">
              <MessageSquare className="size-3" />
              {space.sampleQuestionCount} questions
            </span>
          )}
          {space.filterCount !== undefined && space.filterCount > 0 && (
            <span className="flex items-center gap-1">
              <Link2 className="size-3" />
              {space.filterCount} filters
            </span>
          )}
        </div>

        {healthReport && !isTrashed && healthReport.fixableCount > 0 && (
          <button
            className="flex items-center gap-1 text-xs text-amber-600 transition-colors hover:text-amber-700"
            onClick={(e) => {
              e.stopPropagation();
              onHealthClick?.();
            }}
          >
            <Wrench className="size-3" />
            {healthReport.fixableCount} fixable issue{healthReport.fixableCount !== 1 ? "s" : ""}{" "}
            &mdash; Fix now
          </button>
        )}

        {space.updatedAt && (
          <p className="text-xs text-muted-foreground">
            {new Date(space.updatedAt).toLocaleDateString()}
          </p>
        )}

        <div className="mt-auto flex items-center gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
          {genieUrl && !isTrashed && (
            <Button size="sm" variant="outline" asChild className="h-7 text-xs">
              <a href={genieUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1.5 size-3" />
                Open in Databricks
              </a>
            </Button>
          )}
          {!isTrashed && (
            <Button size="sm" variant="outline" asChild className="h-7 text-xs">
              <Link href={`/genie/${space.spaceId}/benchmarks`}>
                <FlaskConical className="mr-1.5 size-3" />
                Test
              </Link>
            </Button>
          )}
          {space.runId && (
            <Button size="sm" variant="ghost" asChild className="h-7 text-xs">
              <Link href={`/runs/${space.runId}?tab=genie`}>View Run</Link>
            </Button>
          )}
          {onTrash && !isTrashed && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 text-xs text-destructive hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onTrash();
              }}
            >
              <Trash2 className="size-3" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function JobSourceBadge({ source }: { source?: string }) {
  if (!source) return null;
  const config: Record<string, { label: string; icon: React.ReactNode }> = {
    "ask-forge": { label: "Ask Forge", icon: <Sparkles className="size-2.5" /> },
    "schema-scan": { label: "Schema Scan", icon: <Database className="size-2.5" /> },
    requirements: { label: "Requirements", icon: <FileText className="size-2.5" /> },
  };
  const c = config[source];
  if (!c) return null;
  return (
    <Badge variant="outline" className="gap-0.5 text-[10px]">
      {c.icon}
      {c.label}
    </Badge>
  );
}

function SourceBadge({ source }: { source: SpaceCardData["source"] }) {
  switch (source) {
    case "pipeline":
      return (
        <Badge variant="secondary" className="text-xs">
          Pipeline
        </Badge>
      );
    case "metadata":
      return (
        <Badge variant="secondary" className="text-xs">
          Metadata
        </Badge>
      );
    case "workspace":
      return (
        <Badge variant="outline" className="text-xs">
          Workspace
        </Badge>
      );
  }
}
