"use client";

/**
 * Run-detail-page banner that polls /api/runs/[runId]/sql-engine/generate/status
 * and surfaces overall SQL generation progress while the background job
 * is in flight. Modelled on `components/business-value/bv-progress-banner.tsx`.
 *
 * Auto-refreshes the surrounding server-rendered page when the job
 * transitions from generating → completed/failed so the newly-persisted
 * use-case SQL appears underneath the banner without a manual reload.
 */

import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Code2, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";

interface SqlProgressBannerProps {
  runId: string | null | undefined;
}

interface SqlStatusResponse {
  runId: string;
  status: "idle" | "generating" | "completed" | "failed" | "cancelled";
  message: string;
  percent: number;
  total: number;
  counts: {
    pending: number;
    generating: number;
    generated: number;
    failed: number;
    total: number;
  };
  error: string | null;
  elapsedMs: number;
}

const POLL_INTERVAL_MS = 3500;

export function SqlProgressBanner({ runId }: SqlProgressBannerProps) {
  const router = useRouter();
  const [status, setStatus] = useState<SqlStatusResponse | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const lastStatusRef = useRef<SqlStatusResponse["status"] | null>(null);

  useEffect(() => {
    if (!runId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}/sql-engine/generate/status`, {
          cache: "no-store",
        });
        if (!res.ok) {
          // 4xx/5xx: stop polling silently. Page still renders persisted data.
          return;
        }
        const data = (await res.json()) as SqlStatusResponse;
        if (cancelled) return;

        setStatus(data);

        // Transition from generating → terminal: refresh so the server
        // component picks up the newly-persisted use-case SQL.
        if (
          lastStatusRef.current === "generating" &&
          data.status !== "generating"
        ) {
          router.refresh();
        }
        lastStatusRef.current = data.status;

        if (data.status === "generating") {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch {
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

  const handleCancel = async () => {
    if (!runId || cancelling) return;
    setCancelling(true);
    try {
      await fetch(`/api/runs/${runId}/sql-engine/generate/cancel`, { method: "POST" });
    } catch {
      /* surfaced via the next poll */
    } finally {
      setCancelling(false);
    }
  };

  if (!runId) return null;
  if (!status) return null;
  if (status.status !== "generating") return null;

  const { counts, percent, message } = status;
  const total = status.total || counts.total;
  const done = counts.generated + counts.failed;

  return (
    <Card className="border-blue-500/40 bg-blue-500/5">
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="relative mt-0.5 shrink-0">
            <Code2 className="h-5 w-5 text-blue-500" aria-hidden="true" />
            <Loader2
              className="absolute inset-0 h-5 w-5 animate-spin text-blue-500/60"
              aria-hidden="true"
            />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">
              Generating SQL in the background…
            </p>
            <p className="text-xs leading-relaxed text-blue-700/80 dark:text-blue-200/80">
              {message}
              {total > 0 && (
                <>
                  {" "}
                  — {done} of {total} use case{total === 1 ? "" : "s"} complete
                  {counts.failed > 0 ? ` (${counts.failed} failed)` : ""}.
                </>
              )}{" "}
              Use cases are explorable now; SQL fills in per row as it lands.
              Genie spaces and dashboard recommendations will start once SQL
              finishes.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-center">
          <span className="text-xs tabular-nums text-blue-700/80 dark:text-blue-200/80">
            {percent}%
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCancel}
            disabled={cancelling}
            className="h-7 gap-1 text-xs text-blue-700 hover:bg-blue-100 hover:text-blue-900 dark:text-blue-300 dark:hover:bg-blue-950 dark:hover:text-blue-100"
            title="Cancel SQL generation"
          >
            <X className="h-3 w-3" />
            {cancelling ? "Cancelling…" : "Cancel"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
