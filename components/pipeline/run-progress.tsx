"use client";

import { cn } from "@/lib/utils";
import { PipelineStep, type RunStatus } from "@/lib/domain/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PIPELINE_STEPS } from "@/lib/help-text";
import { useMemo } from "react";

const BASE_STEPS = [
  {
    key: PipelineStep.BusinessContext,
    label: "Business Context",
    pct: 10,
    tip: PIPELINE_STEPS["business-context"],
  },
  {
    key: PipelineStep.MetadataExtraction,
    label: "Metadata Extraction",
    pct: 18,
    tip: PIPELINE_STEPS["metadata-extraction"],
  },
  {
    key: PipelineStep.AssetDiscovery,
    label: "Asset Discovery",
    pct: 22,
    tip: PIPELINE_STEPS["asset-discovery"],
    optional: true,
  },
  {
    key: PipelineStep.TableFiltering,
    label: "Table Filtering",
    pct: 30,
    tip: PIPELINE_STEPS["table-filtering"],
  },
  {
    key: PipelineStep.UsecaseGeneration,
    label: "Use Case Generation",
    pct: 45,
    tip: PIPELINE_STEPS["usecase-generation"],
  },
  {
    key: PipelineStep.DomainClustering,
    label: "Domain Clustering",
    pct: 55,
    tip: PIPELINE_STEPS["domain-clustering"],
  },
  { key: PipelineStep.Scoring, label: "Scoring & Dedup", pct: 75, tip: PIPELINE_STEPS["scoring"] },
  // SQL Generation is no longer a synchronous step — it runs as a background job
  // after the run is marked completed. See `lib/pipeline/sql-engine-status.ts`
  // and the SqlProgressBanner on the run detail page.
  {
    key: PipelineStep.BusinessValueAnalysis,
    label: "Business Value",
    pct: 90,
    tip: PIPELINE_STEPS["business-value-analysis"],
  },
];

interface RunProgressProps {
  currentStep: PipelineStep | null;
  progressPct: number;
  status: RunStatus;
  statusMessage?: string;
  /** When true, shows the Asset Discovery step in the progress list. */
  assetDiscoveryEnabled?: boolean;
}

export function RunProgress({
  currentStep,
  progressPct,
  status,
  statusMessage,
  assetDiscoveryEnabled = false,
}: RunProgressProps) {
  const STEPS = useMemo(
    () => BASE_STEPS.filter((s) => !("optional" in s && s.optional) || assetDiscoveryEnabled),
    [assetDiscoveryEnabled],
  );

  const currentIdx = currentStep ? STEPS.findIndex((s) => s.key === currentStep) : -1;

  return (
    <div className="space-y-3" role="list" aria-label="Pipeline steps" aria-live="polite">
      {STEPS.map((step, idx) => {
        const isCompleted =
          status === "completed" ||
          (currentIdx >= 0 && idx < currentIdx) ||
          (idx === currentIdx && progressPct >= step.pct);
        const isActive = idx === currentIdx && status === "running" && progressPct < step.pct;
        const isFailed = status === "failed" && idx === currentIdx;
        const isCancelled = status === "cancelled" && idx === currentIdx;
        const isPending = !isCompleted && !isActive && !isFailed && !isCancelled;

        return (
          <div
            key={step.key}
            role="listitem"
            aria-current={isActive ? "step" : undefined}
            className="flex items-center gap-3"
          >
            <div
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors",
                isCompleted && "border-green-500 bg-green-500 text-white",
                isActive && "border-blue-500 bg-blue-50 text-blue-600 animate-pulse",
                isFailed && "border-red-500 bg-red-50 text-red-600",
                isCancelled && "border-amber-500 bg-amber-50 text-amber-600",
                isPending && "border-muted-foreground/30 text-muted-foreground/50",
              )}
            >
              {isCompleted ? (
                <CheckIcon />
              ) : isFailed ? (
                <XIcon />
              ) : isCancelled ? (
                <StopIcon />
              ) : (
                idx + 1
              )}
            </div>
            <div className="flex-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <p
                    className={cn(
                      "text-sm font-medium cursor-help",
                      isPending && "text-muted-foreground/50",
                      isActive && "text-blue-600",
                      isFailed && "text-red-600",
                      isCancelled && "text-amber-600",
                    )}
                  >
                    {step.label}
                  </p>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[280px]">
                  {step.tip}
                </TooltipContent>
              </Tooltip>
              {isActive && statusMessage && (
                <p className="mt-0.5 text-xs text-muted-foreground animate-pulse">
                  {statusMessage}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}
