"use client";

import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Standalone info icon with hover tooltip.
 * Use next to labels, cards, or KPI values that need explanation.
 */
export function InfoTip({
  tip,
  side = "top",
  className,
}: {
  tip: string;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex cursor-help ${className ?? ""}`}>
          <Info className="h-3.5 w-3.5 text-muted-foreground/50" />
        </span>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-[280px]">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Label text with an info icon and tooltip.
 * Replaces plain labels or column headers.
 */
export function LabelWithTip({
  label,
  tip,
  side = "top",
  className,
}: {
  label: string;
  tip: string;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex items-center gap-1 cursor-help ${className ?? ""}`}>
          {label}
          <Info className="h-3 w-3 text-muted-foreground/50" />
        </span>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-[280px]">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}
