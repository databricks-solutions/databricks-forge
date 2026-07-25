"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenieBuildJob {
  jobId: string;
  status: "generating" | "completed" | "failed" | "cancelled";
  currentStep: string | null;
  message: string;
  percent: number;
  error: string | null;
  result: {
    recommendation: import("@/lib/genie/types").GenieSpaceRecommendation;
    mode: "fast" | "full";
  } | null;
  title?: string;
  domain?: string;
  tableCount?: number;
  source?: string;
  deployedSpaceId?: string;
  conversationSummary?: string;
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const LS_KEY = "forge-active-build-jobs";

function readActiveJobIds(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeActiveJobIds(ids: string[]): void {
  try {
    if (ids.length === 0) {
      localStorage.removeItem(LS_KEY);
    } else {
      localStorage.setItem(LS_KEY, JSON.stringify(ids));
    }
  } catch {
    /* SSR or quota */
  }
}

function addJobId(id: string): void {
  const ids = readActiveJobIds();
  if (!ids.includes(id)) writeActiveJobIds([...ids, id]);
}

function removeJobId(id: string): void {
  writeActiveJobIds(readActiveJobIds().filter((x) => x !== id));
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const POLL_INTERVAL = 3000;

export function useGenieBuildJobs() {
  const [jobs, setJobs] = useState<GenieBuildJob[]>([]);
  const pollingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const startPolling = useCallback((fetchFn: () => Promise<void>) => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    timerRef.current = setInterval(fetchFn, POLL_INTERVAL);
  }, []);

  const stopPolling = useCallback(() => {
    if (!pollingRef.current) return;
    pollingRef.current = false;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/genie-spaces/generate");
      if (!res.ok) return;
      const data = await res.json();
      if (mountedRef.current) {
        setJobs(data.jobs ?? []);
      }
    } catch {
      /* non-critical */
    }
  }, []);

  // On mount: single fetch; resume polling if localStorage has active jobs
  useEffect(() => {
    mountedRef.current = true;
    const stored = readActiveJobIds();
    if (stored.length > 0) {
      startPolling(fetchJobs);
    }
    const initial = setTimeout(fetchJobs, 0);
    return () => {
      mountedRef.current = false;
      clearTimeout(initial);
      stopPolling();
    };
  }, [fetchJobs, startPolling, stopPolling]);

  // Sync localStorage and polling when jobs change
  useEffect(() => {
    const active = jobs.filter((j) => j.status === "generating").map((j) => j.jobId);
    const stored = readActiveJobIds();
    const terminal = jobs.filter((j) => j.status !== "generating").map((j) => j.jobId);

    for (const id of terminal) {
      if (stored.includes(id)) removeJobId(id);
    }
    for (const id of active) {
      if (!stored.includes(id)) addJobId(id);
    }

    if (active.length > 0) {
      startPolling(fetchJobs);
    } else {
      stopPolling();
    }
  }, [jobs, fetchJobs, startPolling, stopPolling]);

  const activeJobs = jobs.filter((j) => j.status === "generating");
  const isAnyActive = activeJobs.length > 0;

  const getJob = useCallback(
    (jobId: string) => jobs.find((j) => j.jobId === jobId) ?? null,
    [jobs],
  );

  const startBuild = useCallback(
    async (
      tables: string[],
      config: Record<string, unknown>,
      source?: string,
    ): Promise<string | null> => {
      try {
        const res = await fetch("/api/genie-spaces/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tables, config, source, async: true }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        const jobId = data.jobId as string;
        if (jobId) {
          addJobId(jobId);
          startPolling(fetchJobs);
          fetchJobs();
        }
        return jobId ?? null;
      } catch {
        return null;
      }
    },
    [fetchJobs, startPolling],
  );

  const cancelBuild = useCallback(async (jobId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/genie-spaces/generate?jobId=${jobId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        removeJobId(jobId);
        // Optimistic update
        setJobs((prev) =>
          prev.map((j) =>
            j.jobId === jobId
              ? { ...j, status: "cancelled" as const, message: "Generation cancelled" }
              : j,
          ),
        );
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  return {
    jobs,
    activeJobs,
    isAnyActive,
    getJob,
    startBuild,
    cancelBuild,
    refetch: fetchJobs,
  };
}
