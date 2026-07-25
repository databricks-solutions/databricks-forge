"use client";

/**
 * Per-use-case SQL generation status badge. Renders a tiny pill on each
 * use case row so users can see at-a-glance which rows still need SQL
 * after the run has flipped to `completed`.
 *
 * Status conventions (see lib/lakebase/usecases.ts for the full enum):
 *   - "pending"    → queued for background SQL generation
 *   - "generating" → currently being generated (spinner)
 *   - "generated"  → success (intentionally hidden to avoid noise)
 *   - "failed"     → terminal failure (red)
 *   - null         → legacy row, not in scope
 */

import { Badge } from "@/components/ui/badge";
import { Clock, Loader2, AlertCircle } from "lucide-react";

interface SqlStatusBadgeProps {
  status: string | null | undefined;
  /** When true, also render a subtle "Ready" badge for "generated" rows. */
  showGenerated?: boolean;
}

export function SqlStatusBadge({ status, showGenerated = false }: SqlStatusBadgeProps) {
  if (status === "pending") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400"
        title="SQL queued for generation"
      >
        <Clock className="h-3 w-3" />
        SQL queued
      </Badge>
    );
  }
  if (status === "generating") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/50 dark:text-blue-300"
        title="SQL is being generated"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        SQL generating
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300"
        title="SQL generation failed for this use case"
      >
        <AlertCircle className="h-3 w-3" />
        SQL failed
      </Badge>
    );
  }
  if (status === "generated" && showGenerated) {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
        title="SQL ready"
      >
        SQL ready
      </Badge>
    );
  }
  return null;
}
