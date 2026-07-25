"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { resilientFetch } from "@/lib/resilient-fetch";
import { toast } from "sonner";
import type { PipelineRun, UseCase } from "@/lib/domain/types";
import type {
  PromptLogEntry,
  PromptLogStats,
} from "@/components/pipeline/run-detail/ai-observability-tab";

export function useRunDetail(runId: string) {
  const router = useRouter();
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [useCases, setUseCases] = useState<UseCase[]>([]);
  const [lineageDiscoveredFqns, setLineageDiscoveredFqns] = useState<string[]>([]);
  const [scanId, setScanId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fetchingRef = useRef(false);
  const runLoadedRef = useRef(false);

  const [genieGenerating, setGenieGenerating] = useState(false);
  const geniePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [dashboardGenerating, setDashboardGenerating] = useState(false);
  const dashboardPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [bvGenerating, setBvGenerating] = useState(false);
  const bvPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [sqlGenerating, setSqlGenerating] = useState(false);
  const sqlPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sqlRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [promptLogs, setPromptLogs] = useState<PromptLogEntry[]>([]);
  const [promptStats, setPromptStats] = useState<PromptLogStats | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [isRerunning, setIsRerunning] = useState(false);
  const [industryEditing, setIndustryEditing] = useState(false);
  const [industrySaving, setIndustrySaving] = useState(false);

  const [pbiDialogOpen, setPbiDialogOpen] = useState(false);
  const [pbiScans, setPbiScans] = useState<Array<{ id: string; label: string }>>([]);
  const [pbiSelectedScan, setPbiSelectedScan] = useState<string | null>(null);
  const [pbiEnriching, setPbiEnriching] = useState(false);
  const [pbiResult, setPbiResult] = useState<{ overlapCount: number; total: number } | null>(null);

  const fetchRun = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const url =
        useCases.length === 0 ? `/api/runs/${runId}?fields=summary` : `/api/runs/${runId}`;
      const res = await resilientFetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error("Run not found");
      const data = await res.json();
      setRun(data.run);
      runLoadedRef.current = true;
      if (data.useCases) setUseCases(data.useCases);
      if (data.lineageDiscoveredFqns) setLineageDiscoveredFqns(data.lineageDiscoveredFqns);
      if (data.scanId) setScanId(data.scanId);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (!runLoadedRef.current) setError(err instanceof Error ? err.message : "Failed to load run");
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [runId, useCases.length]);

  const fetchPromptLogs = useCallback(async () => {
    if (logsLoaded || logsLoading) return;
    setLogsLoading(true);
    try {
      const res = await fetch(`/api/runs/${runId}/prompt-logs`);
      if (res.ok) {
        const data = await res.json();
        setPromptLogs(data.logs ?? []);
        setPromptStats(data.stats ?? null);
      }
    } catch {
      /* non-critical */
    } finally {
      setLogsLoading(false);
      setLogsLoaded(true);
    }
  }, [runId, logsLoaded, logsLoading]);

  const handleIndustryAssign = useCallback(
    async (industryId: string | null) => {
      if (!run) return;
      setIndustrySaving(true);
      try {
        const res = await fetch(`/api/runs/${runId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ industry: industryId }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        setRun(data.run);
        setIndustryEditing(false);
        toast.success(
          industryId ? "Industry outcome map assigned" : "Industry outcome map removed",
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update industry");
      } finally {
        setIndustrySaving(false);
      }
    },
    [run, runId],
  );

  const handleRerun = useCallback(async () => {
    if (!run) return;
    setIsRerunning(true);
    try {
      const cfg = run.config;
      const createRes = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: cfg.businessName,
          ucMetadata: cfg.ucMetadata,
          industry: cfg.industry,
          businessDomains: cfg.businessDomains,
          businessPriorities: cfg.businessPriorities,
          strategicGoals: cfg.strategicGoals,
          languages: cfg.languages,
          sampleRowsPerTable: cfg.sampleRowsPerTable,
          discoveryDepth: cfg.discoveryDepth,
          depthConfig: cfg.depthConfig,
          estateScanEnabled: cfg.estateScanEnabled,
          assetDiscoveryEnabled: cfg.assetDiscoveryEnabled,
        }),
      });
      if (!createRes.ok) {
        const err = await createRes.json();
        throw new Error(err.error ?? "Failed to create run");
      }
      const { runId: newRunId } = await createRes.json();
      const execRes = await fetch(`/api/runs/${newRunId}/execute`, { method: "POST" });
      if (!execRes.ok) {
        const err = await execRes.json();
        throw new Error(err.error ?? "Failed to start pipeline");
      }
      toast.success("Pipeline restarted! Redirecting to new run...");
      router.push(`/runs/${newRunId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to rerun pipeline");
    } finally {
      setIsRerunning(false);
    }
  }, [run, router]);

  const openPbiDialog = useCallback(async () => {
    setPbiDialogOpen(true);
    try {
      const res = await fetch("/api/fabric/scan");
      if (res.ok) {
        const data = await res.json();
        const completed = (data.scans ?? [])
          .filter((s: { status: string }) => s.status === "completed")
          .slice(0, 20)
          .map(
            (s: {
              id: string;
              datasetCount?: number;
              reportCount?: number;
              createdAt?: string;
            }) => ({
              id: s.id,
              label: `${s.datasetCount ?? 0} datasets, ${s.reportCount ?? 0} reports (${s.createdAt ? new Date(s.createdAt).toLocaleDateString() : "unknown"})`,
            }),
          );
        setPbiScans(completed);
      }
    } catch {
      /* best-effort */
    }
  }, []);

  const enrichWithPbi = useCallback(async () => {
    if (!pbiSelectedScan) return;
    setPbiEnriching(true);
    try {
      const res = await fetch(`/api/runs/${runId}/enrich-pbi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fabricScanId: pbiSelectedScan }),
      });
      if (res.ok) {
        const data = await res.json();
        setPbiResult({ overlapCount: data.overlapCount, total: data.totalUseCases });
        setPbiDialogOpen(false);
        fetchRun();
      }
    } catch {
      /* best-effort */
    }
    setPbiEnriching(false);
  }, [pbiSelectedScan, runId, fetchRun]);

  useEffect(() => {
    fetchRun();
    return () => {
      abortRef.current?.abort();
      fetchingRef.current = false;
    };
  }, [fetchRun]);

  const runStatusRef = useRef(run?.status);
  runStatusRef.current = run?.status;
  const fetchRunRef = useRef(fetchRun);
  fetchRunRef.current = fetchRun;

  useEffect(() => {
    const isActive =
      run?.status === "running" || run?.status === "pending" || run?.status === "queued";
    if (!isActive) return;
    let delay = 2000;
    let lastStatus: string | undefined = run?.status;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => {
      fetchRunRef.current().then(() => {
        if (cancelled) return;
        const currentStatus = runStatusRef.current;
        if (currentStatus !== lastStatus) {
          delay = 2000;
          lastStatus = currentStatus;
        } else {
          delay = Math.min(delay * 1.3, 8000);
        }
        timer = setTimeout(poll, delay);
      });
    };
    timer = setTimeout(poll, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [run?.status]);

  useEffect(() => {
    if (run?.status !== "completed" || useCases.length === 0) return;
    let cancelled = false;
    async function checkGenieStatus() {
      try {
        const res = await fetch(`/api/runs/${runId}/genie-engine/generate/status`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data.status === "generating") {
          setGenieGenerating(true);
          if (!geniePollRef.current) {
            let genieDelay = 2000;
            const geniePoll = async () => {
              try {
                const r = await fetch(`/api/runs/${runId}/genie-engine/generate/status`);
                if (r.ok) {
                  const d = await r.json();
                  if (d.status !== "generating") {
                    setGenieGenerating(false);
                    geniePollRef.current = null;
                    return;
                  }
                }
              } catch {
                /* ignore */
              }
              genieDelay = Math.min(genieDelay * 1.3, 10000);
              geniePollRef.current = setTimeout(geniePoll, genieDelay);
            };
            geniePollRef.current = setTimeout(geniePoll, genieDelay);
          }
        } else setGenieGenerating(false);
      } catch {
        /* ignore */
      }
    }
    checkGenieStatus();
    return () => {
      cancelled = true;
      if (geniePollRef.current) {
        clearTimeout(geniePollRef.current);
        geniePollRef.current = null;
      }
    };
  }, [run?.status, runId, useCases.length]);

  useEffect(() => {
    if (run?.status !== "completed" || useCases.length === 0) return;
    let cancelled = false;
    async function checkDashboardStatus() {
      try {
        const res = await fetch(`/api/runs/${runId}/dashboard-engine/generate/status`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data.status === "generating") {
          setDashboardGenerating(true);
          if (!dashboardPollRef.current) {
            let dashDelay = 2000;
            const dashPoll = async () => {
              try {
                const r = await fetch(`/api/runs/${runId}/dashboard-engine/generate/status`);
                if (r.ok) {
                  const d = await r.json();
                  if (d.status !== "generating") {
                    setDashboardGenerating(false);
                    dashboardPollRef.current = null;
                    return;
                  }
                }
              } catch {
                /* ignore */
              }
              dashDelay = Math.min(dashDelay * 1.3, 10000);
              dashboardPollRef.current = setTimeout(dashPoll, dashDelay);
            };
            dashboardPollRef.current = setTimeout(dashPoll, dashDelay);
          }
        } else setDashboardGenerating(false);
      } catch {
        /* ignore */
      }
    }
    checkDashboardStatus();
    return () => {
      cancelled = true;
      if (dashboardPollRef.current) {
        clearTimeout(dashboardPollRef.current);
        dashboardPollRef.current = null;
      }
    };
  }, [run?.status, runId, useCases.length]);

  // Business Value background-job indicator. Mirrors the Genie / Dashboard
  // effects above: hits the BV status endpoint once the run completes, then
  // self-reschedules with exponential backoff until the status leaves
  // `generating`. Drives the pulsing dot on the Business Value tab strip.
  // Independent of the in-tab `BvProgressBanner` polling -- both share the
  // endpoint, neither relies on shared state, and both stop on completion.
  useEffect(() => {
    if (run?.status !== "completed" || useCases.length === 0) return;
    let cancelled = false;
    async function checkBvStatus() {
      try {
        const res = await fetch(`/api/runs/${runId}/business-value/status`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data.status === "generating") {
          setBvGenerating(true);
          if (!bvPollRef.current) {
            let bvDelay = 2000;
            const bvPoll = async () => {
              try {
                const r = await fetch(`/api/runs/${runId}/business-value/status`);
                if (r.ok) {
                  const d = await r.json();
                  if (d.status !== "generating") {
                    setBvGenerating(false);
                    bvPollRef.current = null;
                    return;
                  }
                }
              } catch {
                /* ignore */
              }
              bvDelay = Math.min(bvDelay * 1.3, 10000);
              bvPollRef.current = setTimeout(bvPoll, bvDelay);
            };
            bvPollRef.current = setTimeout(bvPoll, bvDelay);
          }
        } else setBvGenerating(false);
      } catch {
        /* ignore */
      }
    }
    checkBvStatus();
    return () => {
      cancelled = true;
      if (bvPollRef.current) {
        clearTimeout(bvPollRef.current);
        bvPollRef.current = null;
      }
    };
  }, [run?.status, runId, useCases.length]);

  // SQL Engine background-job indicator. Async SQL generation runs after
  // step 6 marks the run completed; we poll the status endpoint with
  // exponential backoff while the job is active so the page can render an
  // in-flight banner and per-UC `sqlStatus` badges. Once the job moves out
  // of `generating`, polling stops; the SqlProgressBanner triggers a
  // `router.refresh()` so the server component picks up the final state.
  useEffect(() => {
    if (run?.status !== "completed" || useCases.length === 0) return;
    let cancelled = false;
    async function checkSqlStatus() {
      try {
        const res = await fetch(`/api/runs/${runId}/sql-engine/generate/status`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data.status === "generating") {
          setSqlGenerating(true);
          if (!sqlPollRef.current) {
            let sqlDelay = 2500;
            const sqlPoll = async () => {
              try {
                const r = await fetch(`/api/runs/${runId}/sql-engine/generate/status`);
                if (r.ok) {
                  const d = await r.json();
                  if (d.status !== "generating") {
                    setSqlGenerating(false);
                    sqlPollRef.current = null;
                    // Final refresh to pick up the freshly-persisted SQL.
                    fetchRunRef.current();
                    return;
                  }
                }
              } catch {
                /* ignore */
              }
              sqlDelay = Math.min(sqlDelay * 1.2, 8000);
              sqlPollRef.current = setTimeout(sqlPoll, sqlDelay);
            };
            sqlPollRef.current = setTimeout(sqlPoll, sqlDelay);
          }
        } else setSqlGenerating(false);
      } catch {
        /* ignore */
      }
    }
    checkSqlStatus();
    return () => {
      cancelled = true;
      if (sqlPollRef.current) {
        clearTimeout(sqlPollRef.current);
        sqlPollRef.current = null;
      }
    };
  }, [run?.status, runId, useCases.length]);

  // While the SQL background job is generating, refresh the run (and its
  // use cases) every ~7s so the per-UC SqlStatusBadge in the table reflects
  // freshly-persisted `sqlStatus` transitions (pending → generating → generated).
  // Polling stops once `sqlGenerating` flips back to false.
  useEffect(() => {
    if (!sqlGenerating) {
      if (sqlRefreshRef.current) {
        clearTimeout(sqlRefreshRef.current);
        sqlRefreshRef.current = null;
      }
      return;
    }
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      fetchRunRef.current();
      sqlRefreshRef.current = setTimeout(tick, 7000);
    };
    sqlRefreshRef.current = setTimeout(tick, 7000);
    return () => {
      cancelled = true;
      if (sqlRefreshRef.current) {
        clearTimeout(sqlRefreshRef.current);
        sqlRefreshRef.current = null;
      }
    };
  }, [sqlGenerating]);

  return {
    run,
    useCases,
    setUseCases,
    lineageDiscoveredFqns,
    scanId,
    loading,
    error,
    fetchRun,
    fetchPromptLogs,
    genieGenerating,
    dashboardGenerating,
    bvGenerating,
    sqlGenerating,
    promptLogs,
    promptStats,
    logsLoading,
    isRerunning,
    industryEditing,
    setIndustryEditing,
    industrySaving,
    handleIndustryAssign,
    handleRerun,
    pbiDialogOpen,
    setPbiDialogOpen,
    pbiScans,
    pbiSelectedScan,
    setPbiSelectedScan,
    pbiEnriching,
    pbiResult,
    setPbiResult,
    openPbiDialog,
    enrichWithPbi,
  };
}
