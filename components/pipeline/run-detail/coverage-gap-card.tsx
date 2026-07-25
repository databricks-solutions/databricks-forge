"use client";

import { Eye } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface CoverageGapCardProps {
  coverageData: {
    overallCoverage: number;
    gapCount: number;
  } | null;
  onClick?: () => void;
}

export function CoverageGapCard({ coverageData, onClick }: CoverageGapCardProps) {
  if (!coverageData) {
    return (
      <Card className="border-l-[3px] border-l-border opacity-60">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Coverage
            </p>
          </div>
          <p className="mt-2 text-2xl font-bold text-muted-foreground">N/A</p>
          <p className="mt-0.5 text-xs text-muted-foreground">No industry map</p>
        </CardContent>
      </Card>
    );
  }

  const pct = Math.round(coverageData.overallCoverage * 100);
  const sentiment = pct >= 75 ? "positive" : pct >= 25 ? "neutral" : "warning";

  const borderClass =
    sentiment === "positive"
      ? "border-l-green-500 dark:border-l-green-400"
      : sentiment === "warning"
        ? "border-l-amber-500 dark:border-l-amber-400"
        : "border-l-border";

  const colorClass =
    sentiment === "positive"
      ? "text-green-600 dark:text-green-400"
      : sentiment === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground";

  return (
    <Card
      className={cn(
        "border-l-[3px]",
        borderClass,
        onClick &&
          "cursor-pointer transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md",
      )}
      onClick={onClick}
    >
      <CardContent className="pt-6">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-violet-500" />
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Coverage
          </p>
        </div>
        <p className={cn("mt-2 text-2xl font-bold", colorClass)}>{pct}%</p>
        {coverageData.gapCount > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {coverageData.gapCount} gap{coverageData.gapCount !== 1 ? "s" : ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
