"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  Database,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DataJobStatus } from "@/lib/demo/data-engine/types";
import type { TablePhase } from "@/lib/demo/types";

interface GenerationProgressStepProps {
  sessionId: string;
  onComplete?: () => void;
  onRetryNeeded?: (failedTables: string[]) => void;
}

const PHASE_LABELS: Record<TablePhase, { label: string; icon: React.ReactNode }> = {
  pending: { label: "Pending", icon: <Clock className="h-3 w-3" /> },
  "generating-sql": {
    label: "Generating SQL",
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
  },
  executing: { label: "Executing", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  retrying: { label: "Retrying", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  validating: { label: "Validating", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  completed: { label: "Done", icon: <CheckCircle2 className="h-3 w-3 text-green-500" /> },
  failed: { label: "Failed", icon: <AlertCircle className="h-3 w-3 text-destructive" /> },
};

export function GenerationProgressStep({
  sessionId,
  onComplete,
  onRetryNeeded,
}: GenerationProgressStepProps) {
  const [status, setStatus] = useState<DataJobStatus | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const completedRef = useRef(false);

  useEffect(() => {
    if (!sessionId) return;

    const interval = setInterval(async () => {
      try {
        const resp = await fetch(`/api/demo/generate/status?sessionId=${sessionId}`);
        const data: DataJobStatus = await resp.json();
        setStatus(data);

        if (data.status === "generating") {
          completedRef.current = false;
        }
        if (data.status === "completed" || data.status === "failed") {
          clearInterval(interval);
          if (data.status === "completed" && !completedRef.current) {
            completedRef.current = true;
            onComplete?.();
          }
        }
      } catch {
        // retry
      }
    }, 2_000);

    return () => clearInterval(interval);
  }, [sessionId, onComplete]);

  useEffect(() => {
    if (!status?.startedAt || (status.status !== "generating")) return;
    const tick = () => setElapsed(Math.floor((Date.now() - status.startedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status?.startedAt, status?.status]);

  if (!status) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Starting generation...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 px-1">
      {status.status === "failed" && status.error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-destructive">Generation failed</p>
            <p className="text-sm text-muted-foreground mt-0.5">{status.error}</p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{status.message}</span>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              {elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`}
            </span>
            <span>
              {status.completedTables}/{status.totalTables} tables
            </span>
          </div>
        </div>
        <Progress value={status.percent} />
      </div>

      {status.tableStatuses.length > 0 && (
        <div className="space-y-1">
          {status.tableStatuses.map((table) => {
            const phaseInfo = PHASE_LABELS[table.phase];
            return (
              <div
                key={table.tableName}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <Database className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm font-mono">{table.tableName}</span>
                </div>
                <div className="flex items-center gap-2">
                  {table.rowCount > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {table.rowCount.toLocaleString()} rows
                    </span>
                  )}
                  <Badge variant={table.phase === "completed" ? "secondary" : table.phase === "failed" ? "destructive" : "outline"} className="gap-1">
                    {phaseInfo.icon}
                    {phaseInfo.label}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(status.status === "completed" || status.status === "failed") && status.tableStatuses.length > 0 && (
        <div className="rounded-md border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">
                {status.tableStatuses.filter((t) => t.phase === "completed").length} of{" "}
                {status.totalTables} tables created successfully
              </p>
              {status.tableStatuses.some((t) => t.phase === "failed") && (
                <p className="text-sm text-destructive mt-1">
                  {status.tableStatuses.filter((t) => t.phase === "failed").length} tables failed
                </p>
              )}
            </div>
            {status.tableStatuses.some((t) => t.phase === "failed") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const failedNames = status.tableStatuses
                    .filter((t) => t.phase === "failed")
                    .map((t) => t.tableName);
                  onRetryNeeded?.(failedNames);
                }}
              >
                Retry Failed Tables
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
