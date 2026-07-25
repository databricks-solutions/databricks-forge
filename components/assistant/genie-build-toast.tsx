"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  BrainCircuit,
  Sparkles,
  AlertTriangle,
  Ban,
  RefreshCw,
  Rocket,
  ExternalLink,
  X,
} from "lucide-react";
import { useGenieBuild } from "@/components/providers/genie-build-provider";

// ---------------------------------------------------------------------------
// Toast content component (rendered inside sonner's custom toast container)
// ---------------------------------------------------------------------------

interface BuildToastContentProps {
  jobId: string;
  toastId: string | number;
  onDeploy: (jobId: string) => void;
  onRetry?: (jobId: string) => void;
}

function BuildToastContent({ jobId, toastId, onDeploy, onRetry }: BuildToastContentProps) {
  const { getJob, cancelBuild } = useGenieBuild();
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);

  const job = getJob(jobId);
  const jobStatus = job?.status;

  // Auto-dismiss after cancel confirmed
  useEffect(() => {
    if (jobStatus !== "cancelled") return undefined;
    const t = setTimeout(() => toast.dismiss(toastId), 5000);
    return () => clearTimeout(t);
  }, [jobStatus, toastId]);

  // Auto-dismiss after deploy confirmed
  useEffect(() => {
    if (jobStatus !== "completed" || !job?.deployedSpaceId) return undefined;
    const t = setTimeout(() => toast.dismiss(toastId), 10_000);
    return () => clearTimeout(t);
  }, [jobStatus, job?.deployedSpaceId, toastId]);

  if (!job) {
    return null;
  }

  const handleCancel = async () => {
    setCancelling(true);
    await cancelBuild(jobId);
  };

  const handleRetry = () => {
    toast.dismiss(toastId);
    onRetry?.(jobId);
  };

  const handleDeploy = () => {
    toast.dismiss(toastId);
    onDeploy(jobId);
  };

  const handleViewStudio = () => {
    toast.dismiss(toastId);
    router.push(`/genie/build/${jobId}`);
  };

  // --- Generating ---
  if (job.status === "generating") {
    return (
      <ToastShell borderClass="border-violet-500/30">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <BrainCircuit className="size-4 shrink-0 animate-pulse text-violet-500" />
            <span
              className="truncate text-sm font-semibold"
              title={job.title || "Building Genie Space..."}
            >
              {job.title || "Building Genie Space..."}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-1.5 text-[10px] text-muted-foreground hover:text-destructive"
            disabled={cancelling}
            onClick={handleCancel}
          >
            {cancelling ? "..." : "Cancel"}
          </Button>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="truncate" title={job.message}>
              {job.message}
            </span>
            <span className="shrink-0 pl-2">{job.percent}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-violet-500 transition-all duration-500"
              style={{ width: `${job.percent}%` }}
            />
          </div>
        </div>
        {job.domain && (
          <p className="truncate text-[10px] text-muted-foreground" title={job.domain}>
            {job.domain}
          </p>
        )}
      </ToastShell>
    );
  }

  // --- Completed (ready to deploy) ---
  if (job.status === "completed" && !job.deployedSpaceId) {
    return (
      <ToastShell borderClass="border-green-500/30">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="size-4 shrink-0 text-green-500" />
            <span className="truncate text-sm font-semibold">Ready to Deploy</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-1.5 text-[10px] text-muted-foreground"
            onClick={() => toast.dismiss(toastId)}
          >
            <X className="size-3" />
          </Button>
        </div>
        <p className="truncate text-xs text-muted-foreground" title={job.title || "Genie Space"}>
          {job.title || "Genie Space"}
        </p>
        <div className="flex gap-2">
          <Button size="sm" className="h-7 gap-1 text-xs" onClick={handleDeploy}>
            <Rocket className="size-3" />
            Deploy
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={handleViewStudio}
          >
            <ExternalLink className="size-3" />
            Studio
          </Button>
        </div>
      </ToastShell>
    );
  }

  // --- Already deployed ---
  if (job.status === "completed" && job.deployedSpaceId) {
    return (
      <ToastShell borderClass="border-green-500/30">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="size-4 shrink-0 text-green-500" />
            <span className="truncate text-sm font-semibold">Deployed</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-1.5 text-[10px] text-muted-foreground"
            onClick={() => toast.dismiss(toastId)}
          >
            <X className="size-3" />
          </Button>
        </div>
        <p
          className="truncate text-xs text-muted-foreground"
          title={job.title ? `${job.title} is live` : "Genie Space is live"}
        >
          {job.title || "Genie Space"} is live
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => {
            toast.dismiss(toastId);
            router.push(`/genie/${job.deployedSpaceId}`);
          }}
        >
          <ExternalLink className="size-3" />
          View Space
        </Button>
      </ToastShell>
    );
  }

  // --- Failed ---
  if (job.status === "failed") {
    return (
      <ToastShell borderClass="border-destructive/30">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <AlertTriangle className="size-4 shrink-0 text-destructive" />
            <span className="truncate text-sm font-semibold">Build Failed</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-1.5 text-[10px] text-muted-foreground"
            onClick={() => toast.dismiss(toastId)}
          >
            <X className="size-3" />
          </Button>
        </div>
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {job.error || "An error occurred"}
        </p>
        <div className="flex gap-2">
          {onRetry && (
            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={handleRetry}>
              <RefreshCw className="size-3" />
              Retry
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={handleViewStudio}
          >
            <ExternalLink className="size-3" />
            Details
          </Button>
        </div>
      </ToastShell>
    );
  }

  // --- Cancelled ---
  if (job.status === "cancelled") {
    return (
      <ToastShell borderClass="border-amber-500/30">
        <div className="flex min-w-0 items-center gap-2">
          <Ban className="size-4 shrink-0 text-amber-500" />
          <span className="truncate text-sm font-semibold">Build Cancelled</span>
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={handleRetry}>
            <RefreshCw className="size-3" />
            Retry
          </Button>
        )}
      </ToastShell>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Shell wrapper for consistent padding/border
// ---------------------------------------------------------------------------

function ToastShell({ children, borderClass }: { children: React.ReactNode; borderClass: string }) {
  return (
    <div
      className={`w-full space-y-1.5 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg ${borderClass}`}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public API: show a build toast
// ---------------------------------------------------------------------------

export function showBuildToast(
  jobId: string,
  onDeploy: (jobId: string) => void,
  onRetry?: (jobId: string) => void,
): string | number {
  return toast.custom(
    (id) => <BuildToastContent jobId={jobId} toastId={id} onDeploy={onDeploy} onRetry={onRetry} />,
    { duration: Infinity, id: `genie-build-${jobId}` },
  );
}
