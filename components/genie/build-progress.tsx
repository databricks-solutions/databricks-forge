"use client";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GENIE_BUILDER_STEPS, type GenieBuilderStep } from "@/lib/genie/builder-steps";

interface GenieBuildProgressProps {
  currentStep: GenieBuilderStep | null;
  progressPct: number;
  status: "generating" | "completed" | "failed" | "cancelled";
  statusMessage?: string;
}

export function GenieBuildProgress({
  currentStep,
  progressPct,
  status,
  statusMessage,
}: GenieBuildProgressProps) {
  const currentIdx = currentStep ? GENIE_BUILDER_STEPS.findIndex((s) => s.key === currentStep) : -1;
  const pctFallback = currentIdx < 0 && status === "generating";
  const nextPendingIdx = pctFallback
    ? GENIE_BUILDER_STEPS.findIndex((s) => progressPct < s.pct)
    : -1;

  return (
    <div className="space-y-3" role="list" aria-label="Build steps" aria-live="polite">
      {GENIE_BUILDER_STEPS.map((step, idx) => {
        const isCompleted =
          status === "completed" ||
          (currentIdx >= 0 && idx < currentIdx) ||
          (idx === currentIdx && progressPct >= step.pct) ||
          (pctFallback && progressPct >= step.pct);
        const isActive =
          (idx === currentIdx && status === "generating" && progressPct < step.pct) ||
          (pctFallback && idx === nextPendingIdx);
        const isFailed = status === "failed" && (idx === currentIdx || (currentIdx < 0 && idx === nextPendingIdx));
        const isCancelled = status === "cancelled" && (idx === currentIdx || (currentIdx < 0 && idx === nextPendingIdx));
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
