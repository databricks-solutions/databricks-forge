"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";

interface BvProgressBannerProps {
  /** Run id to poll. When null/undefined the banner is silent. */
  runId: string | null | undefined;
}

interface BvStatusResponse {
  runId: string;
  status: "idle" | "generating" | "completed" | "failed";
  message: string;
  percent: number;
  completedPasses: number;
  totalPasses: number;
  completedPassNames: string[];
  degradedPassNames: string[];
  error: string | null;
  elapsedMs: number;
}

const POLL_INTERVAL_MS = 3500;

/**
 * Polls /api/runs/[runId]/business-value/status and shows an indigo banner
 * while the background Business Value Analysis job is running. Auto-refreshes
 * the surrounding server-rendered page when the job transitions to
 * completed/failed so the newly-persisted BV data appears beneath the banner.
 *
 * Renders nothing when there is no runId, when status is `idle`, or when
 * the job has already finished.
 */
export function BvProgressBanner({ runId }: BvProgressBannerProps) {
  const router = useRouter();
  const [status, setStatus] = useState<BvStatusResponse | null>(null);
  const lastStatusRef = useRef<BvStatusResponse["status"] | null>(null);

  useEffect(() => {
    if (!runId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}/business-value/status`, {
          cache: "no-store",
        });
        if (!res.ok) {
          // 4xx/5xx: stop polling silently. The page still renders persisted data.
          return;
        }
        const data = (await res.json()) as BvStatusResponse;
        if (cancelled) return;

        setStatus(data);

        // Transition from generating -> terminal: refresh the page so the
        // server component picks up the new Lakebase rows.
        if (
          lastStatusRef.current === "generating" &&
          (data.status === "completed" || data.status === "failed")
        ) {
          router.refresh();
        }
        lastStatusRef.current = data.status;

        if (data.status === "generating") {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch {
        // Network blip — retry next tick
        if (!cancelled) {
          timer = setTimeout(poll, POLL_INTERVAL_MS * 2);
        }
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, router]);

  if (!runId) return null;
  if (!status) return null;
  if (status.status !== "generating") return null;

  const completed = status.completedPasses;
  const total = status.totalPasses;

  return (
    <Card className="border-indigo-500/40 bg-indigo-500/5">
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="relative mt-0.5 shrink-0">
            <Sparkles className="h-5 w-5 text-indigo-500" aria-hidden="true" />
            <Loader2
              className="absolute inset-0 h-5 w-5 animate-spin text-indigo-500/60"
              aria-hidden="true"
            />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">
              Business value insight generating…
            </p>
            <p className="text-xs leading-relaxed text-indigo-700/80 dark:text-indigo-200/80">
              {status.message} — {completed} of {total} pass{total === 1 ? "" : "es"} complete.
              {status.completedPassNames.length > 0 && (
                <span className="ml-1 opacity-75">
                  Finished: {status.completedPassNames.join(", ")}.
                </span>
              )}
              Any partial results already available are shown below; the page will refresh
              automatically when the job finishes.
            </p>
          </div>
        </div>
        <div className="self-start text-xs tabular-nums text-indigo-700/80 dark:text-indigo-200/80">
          {status.percent}%
        </div>
      </CardContent>
    </Card>
  );
}
