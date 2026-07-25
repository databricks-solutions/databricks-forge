"use client";

/**
 * StepInstrumentationLine -- live banner showing rate-limit waiting and
 * throttle time for the in-flight pipeline step.
 *
 * Polls `/api/runs/[runId]/step-instrumentation` while the run is active.
 * Shows nothing when there's no contention. Surfaces a yellow "throttled"
 * indicator when the 429 circuit breaker has fired recently, and a soft
 * blue "waiting" indicator when slots are queued.
 *
 * Designed to be unobtrusive: render below the main progress bar.
 */

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";

interface Counter {
  step: string;
  waitingMs: number;
  throttledMs: number;
  acquires: number;
  throttleEvents: number;
}

interface Props {
  runId: string;
  currentStep: string | null;
  active: boolean;
}

const POLL_MS = 5000;

export function StepInstrumentationLine({ runId, currentStep, active }: Props) {
  const [counters, setCounters] = useState<Counter[]>([]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}/step-instrumentation`, {
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const json = (await res.json()) as { counters: Counter[] };
        if (!cancelled) setCounters(json.counters ?? []);
      } catch {
        /* ignore transient errors */
      }
    };
    void fetchOnce();
    const t = setInterval(fetchOnce, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [runId, active]);

  if (!active || !currentStep) return null;

  const current = counters.find((c) => c.step === currentStep);
  if (!current) return null;
  if (current.waitingMs < 500 && current.throttledMs === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      {current.waitingMs > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
          Waiting on rate limit: {formatMs(current.waitingMs)}
          <span className="text-muted-foreground/60">
            ({current.acquires} {current.acquires === 1 ? "call" : "calls"})
          </span>
        </span>
      )}
      {current.throttledMs > 0 && (
        <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3" />
          Throttled by endpoint: {formatMs(current.throttledMs)}
          <span className="text-muted-foreground/60">
            ({current.throttleEvents} 429
            {current.throttleEvents === 1 ? "" : "s"})
          </span>
        </span>
      )}
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}
