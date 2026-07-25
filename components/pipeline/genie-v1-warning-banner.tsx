"use client";

import { AlertTriangle } from "lucide-react";

interface GenieV1WarningBannerProps {
  enhancementCount: number;
}

export function GenieV1WarningBanner({ enhancementCount }: GenieV1WarningBannerProps) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950/30">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div className="flex-1">
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
          Some spaces have not been processed by the AI Engine
        </p>
        <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
          Run analysis for enriched spaces with benchmarks, metric views, and improved instructions.
        </p>
        {enhancementCount > 0 && (
          <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-400/80">
            {enhancementCount} {enhancementCount === 1 ? "space improves" : "spaces improve"}{" "}
            existing resources. Deploying creates new spaces alongside your originals.
          </p>
        )}
      </div>
    </div>
  );
}
