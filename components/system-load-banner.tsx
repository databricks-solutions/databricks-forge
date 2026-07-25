"use client";

/**
 * SystemLoadBanner -- a thin, non-disruptive strip that appears below the
 * header when the system is heavily loaded. Polls /api/system-load every
 * ~10s and explains the user's wait state without exposing other users'
 * identities.
 */

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader2, AlertTriangle, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

interface SystemLoadSnapshot {
  active: {
    pipelineRuns: number;
    scans: number;
    genieDeploys: number;
    demoEngines: number;
    queued: number;
  };
  llm: {
    totalInflight: number;
    totalQueued: number;
    perEndpoint: Array<{
      name: string;
      inflight: number;
      pending: number;
      blocked: boolean;
      retryInMs: number | null;
    }>;
    yourInflight: number;
    yourQueued: number;
  };
}

const POLL_MS = 10_000;

function classify(snap: SystemLoadSnapshot): {
  level: "calm" | "busy" | "throttled";
  primary: string;
  secondary?: string;
} {
  const anyBlocked = snap.llm.perEndpoint.some((e) => e.blocked);
  if (anyBlocked) {
    const longest = Math.max(
      0,
      ...snap.llm.perEndpoint.map((e) => e.retryInMs ?? 0),
    );
    return {
      level: "throttled",
      primary: "Model endpoint is rate-limiting briefly — retries will continue automatically.",
      secondary:
        longest > 0 ? `Backoff ~${Math.ceil(longest / 1000)}s` : undefined,
    };
  }

  const heavyQueue =
    snap.llm.totalQueued > 8 || snap.active.queued > 0 || snap.llm.yourQueued > 2;
  if (heavyQueue) {
    const yourPart =
      snap.llm.yourQueued > 0
        ? `Your work is queued (${snap.llm.yourQueued} step${snap.llm.yourQueued === 1 ? "" : "s"} waiting).`
        : "Other work is currently running.";
    const queuedRuns =
      snap.active.queued > 0
        ? ` ${snap.active.queued} run${snap.active.queued === 1 ? "" : "s"} queued system-wide.`
        : "";
    return {
      level: "busy",
      primary: `${yourPart}${queuedRuns}`,
      secondary: `Active: ${snap.active.pipelineRuns} runs, ${snap.active.genieDeploys} Genie deploys, ${snap.active.demoEngines} demo gens`,
    };
  }

  return { level: "calm", primary: "" };
}

export function SystemLoadBanner() {
  const [snap, setSnap] = useState<SystemLoadSnapshot | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const res = await fetch("/api/system-load", {
          cache: "no-store",
          credentials: "include",
        });
        if (!res.ok) return;
        const data = (await res.json()) as SystemLoadSnapshot;
        if (!cancelled) setSnap(data);
      } catch {
        // best-effort
      } finally {
        if (!cancelled) {
          timer = setTimeout(poll, POLL_MS);
        }
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const status = useMemo(() => (snap ? classify(snap) : null), [snap]);

  if (!status || status.level === "calm" || dismissed) return null;

  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={status.level}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.18 }}
        className={cn(
          "flex shrink-0 items-center justify-between gap-3 border-b px-4 py-1.5 text-xs md:px-6",
          status.level === "throttled"
            ? "border-amber-300/40 bg-amber-50/80 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
            : "border-sky-300/40 bg-sky-50/80 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100",
        )}
        role="status"
        aria-live="polite"
      >
        <div className="flex min-w-0 items-center gap-2">
          {status.level === "throttled" ? (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          ) : status.level === "busy" ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : (
            <Activity className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate font-medium">{status.primary}</span>
          {status.secondary && (
            <span className="hidden truncate opacity-70 md:inline">
              · {status.secondary}
            </span>
          )}
        </div>
        <button
          type="button"
          className="shrink-0 rounded px-2 py-0.5 font-medium opacity-70 hover:opacity-100"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss system load notice"
        >
          Dismiss
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
