"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExportToolbar } from "@/components/pipeline/export-toolbar";
import {
  Copy,
  GitCompareArrows,
  ArrowLeft,
  Zap,
  MoreHorizontal,
  Users,
  Share2,
} from "lucide-react";
import type { PipelineRun } from "@/lib/domain/types";
import { ShareDialog } from "@/components/share/share-dialog";
import { useCurrentUser } from "@/lib/hooks/use-current-user";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  queued: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  running: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  cancelled: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
};

export function RunHeader({
  run,
  runId,
  scanId,
  hasFabricTag,
  onDuplicate,
  onOpenPbiDialog,
}: {
  run: PipelineRun;
  runId: string;
  scanId: string | null;
  hasFabricTag: boolean;
  onDuplicate: () => void;
  onOpenPbiDialog: () => void;
}) {
  const isCompleted = run.status === "completed";
  const { email: currentEmail, isolationEnabled } = useCurrentUser();
  const [shareOpen, setShareOpen] = useState(false);
  const isOwner =
    !!currentEmail && !!run.ownerEmail && run.ownerEmail.toLowerCase() === currentEmail;
  const isShared =
    !!run.ownerEmail && !!currentEmail && run.ownerEmail.toLowerCase() !== currentEmail;
  const showShare = isOwner && isolationEnabled;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/runs" className="hover:text-foreground transition-colors">
          Runs
        </Link>
        <span>/</span>
        <span className="text-foreground">Run Detail</span>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {run.config.businessName}
            </h1>
            <Badge variant="secondary" className={STATUS_STYLES[run.status] ?? ""}>
              {STATUS_LABELS[run.status]}
            </Badge>
            {isShared && (
              <Badge
                variant="outline"
                className="border-violet-300 text-violet-700 dark:border-violet-500/50 dark:text-violet-300"
                title={`Shared by ${run.ownerEmail}`}
              >
                <Users className="mr-1 h-3 w-3" />
                Shared
              </Badge>
            )}
          </div>
          <p className="mt-1 font-mono text-sm text-muted-foreground">{run.config.ucMetadata}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Created{" "}
            {new Date(run.createdAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {run.completedAt &&
              ` \u2022 Completed ${new Date(run.completedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {showShare && (
            <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}>
              <Share2 className="mr-1.5 h-3.5 w-3.5" />
              Share
            </Button>
          )}
          {isCompleted && (
            <>
              <ExportToolbar
                runId={run.runId}
                businessName={run.config.businessName}
                scanId={scanId}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={onDuplicate}>
                    <Copy className="mr-2 h-4 w-4" />
                    Duplicate Run
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={`/runs/compare?run=${runId}`}>
                      <GitCompareArrows className="mr-2 h-4 w-4" />
                      Compare
                    </Link>
                  </DropdownMenuItem>
                  {!hasFabricTag && (
                    <DropdownMenuItem onClick={onOpenPbiDialog}>
                      <Zap className="mr-2 h-4 w-4 text-violet-500" />
                      Enrich with PBI
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          <Button variant="ghost" size="sm" asChild>
            <Link href="/runs">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Runs
            </Link>
          </Button>
        </div>
      </div>
      {showShare && (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          resourceType="run"
          resourceId={runId}
          resourceLabel={`"${run.config.businessName}"`}
        />
      )}
    </div>
  );
}
