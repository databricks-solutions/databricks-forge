"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  BarChart3,
  Check,
  Columns3,
  Database,
  Loader2,
  MessageSquareText,
  Search,
  ShieldCheck,
  Table2,
  Workflow,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommentProgressData {
  jobId: string;
  phase: string;
  message: string;
  tablesFound?: number;
  columnsFound?: number;
  lineageEdgesFound?: number;
  enrichedCount?: number;
  enrichTotal?: number;
  tablesGenerated?: number;
  columnsGenerated?: number;
  columnTablesProcessed?: number;
  currentTable?: string | null;
  tableBatches?: number;
  tableBatchesDone?: number;
  consistencyFixes?: number;
  elapsedMs?: number;
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Phase definitions
// ---------------------------------------------------------------------------

const PHASES = [
  { key: "fetching-metadata", icon: Database, label: "Scanning metadata" },
  { key: "walking-lineage", icon: Workflow, label: "Walking lineage" },
  { key: "enriching-tables", icon: Search, label: "Enriching tables" },
  { key: "classifying", icon: MessageSquareText, label: "LLM classification" },
  { key: "generating-tables", icon: Table2, label: "Table descriptions" },
  { key: "generating-columns", icon: Columns3, label: "Column descriptions" },
  { key: "consistency-review", icon: ShieldCheck, label: "Consistency review" },
  { key: "saving", icon: Database, label: "Saving proposals" },
] as const;

const PHASE_ORDER = [
  "starting",
  "fetching-metadata",
  "walking-lineage",
  "enriching-tables",
  "classifying",
  "generating-tables",
  "generating-columns",
  "consistency-review",
  "saving",
  "complete",
];

// ---------------------------------------------------------------------------
// MiniCounter (matches ScanProgressCard)
// ---------------------------------------------------------------------------

function MiniCounter({
  label,
  value,
  icon,
  tooltip,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  tooltip?: string;
}) {
  const inner = (
    <div className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs bg-white/60 text-muted-foreground dark:bg-white/5">
      {icon}
      <div>
        <div className="font-semibold tabular-nums">{value}</div>
        <div className="text-[10px] text-muted-foreground/70">{label}</div>
      </div>
    </div>
  );

  if (!tooltip) return inner;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="cursor-help">{inner}</div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px]">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CommentProgressCard({ progress }: { progress: CommentProgressData }) {
  const currentPhaseIdx = PHASE_ORDER.indexOf(progress.phase);
  const totalPhases = PHASE_ORDER.length - 1;

  // Calculate percentage with sub-phase interpolation
  let pct: number;
  if (progress.phase === "enriching-tables" && (progress.enrichTotal ?? 0) > 0) {
    const subPct = (progress.enrichedCount ?? 0) / (progress.enrichTotal ?? 1);
    pct = ((currentPhaseIdx + subPct) / totalPhases) * 100;
  } else if (progress.phase === "generating-tables" && (progress.tableBatches ?? 0) > 0) {
    const subPct = (progress.tableBatchesDone ?? 0) / (progress.tableBatches ?? 1);
    pct = ((currentPhaseIdx + subPct) / totalPhases) * 100;
  } else if (progress.phase === "generating-columns" && (progress.tablesFound ?? 0) > 0) {
    const subPct = (progress.columnTablesProcessed ?? 0) / (progress.tablesFound ?? 1);
    pct = ((currentPhaseIdx + subPct) / totalPhases) * 100;
  } else {
    pct = ((currentPhaseIdx + 0.5) / totalPhases) * 100;
  }
  pct = Math.max(3, Math.min(97, pct));

  const elapsed = progress.elapsedMs ?? 0;
  const mins = Math.floor(elapsed / 60_000);
  const secs = Math.floor((elapsed % 60_000) / 1_000);
  const elapsedStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <Card
      className="border-blue-200 bg-blue-50/30 dark:border-blue-900 dark:bg-blue-950/10"
      aria-live="polite"
    >
      <CardContent className="pt-5 pb-4 space-y-4">
        {/* Header: phase + elapsed */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
            <span className="text-sm font-semibold">Generating AI Comments</span>
          </div>
          <Badge variant="secondary" className="text-xs tabular-nums">
            {elapsedStr}
          </Badge>
        </div>

        {/* Progress bar */}
        <div className="h-2 w-full rounded-full bg-blue-100 dark:bg-blue-900/30 overflow-hidden">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Step indicators */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
          {PHASES.map((step) => {
            const stepIdx = PHASE_ORDER.indexOf(step.key);
            const isComplete = currentPhaseIdx > stepIdx;
            const isActive = progress.phase === step.key;

            return (
              <div
                key={step.key}
                className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors ${
                  isActive
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-medium"
                    : isComplete
                      ? "text-muted-foreground"
                      : "text-muted-foreground/40"
                }`}
              >
                {isComplete ? (
                  <Check className="h-3 w-3 text-green-600 dark:text-green-400 flex-shrink-0" />
                ) : isActive ? (
                  <Loader2 className="h-3 w-3 animate-spin text-blue-500 flex-shrink-0" />
                ) : (
                  <step.icon className="h-3 w-3 flex-shrink-0" />
                )}
                <span className="truncate">{step.label}</span>
              </div>
            );
          })}
        </div>

        {/* Status message */}
        <p className="text-sm text-muted-foreground">{progress.message}</p>

        {/* Current table indicator */}
        {progress.currentTable && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="font-mono truncate">{progress.currentTable}</span>
          </div>
        )}

        {/* Live counters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(progress.tablesFound ?? 0) > 0 && (
            <MiniCounter
              label="Tables"
              value={progress.tablesFound!}
              icon={<Database className="h-3.5 w-3.5" />}
              tooltip="Tables discovered in your Unity Catalog scope."
            />
          )}
          {(progress.columnsFound ?? 0) > 0 && (
            <MiniCounter
              label="Columns"
              value={progress.columnsFound!}
              icon={<BarChart3 className="h-3.5 w-3.5" />}
              tooltip="Total columns found across all discovered tables."
            />
          )}
          {(progress.lineageEdgesFound ?? 0) > 0 && (
            <MiniCounter
              label="Lineage Edges"
              value={progress.lineageEdgesFound!}
              icon={<Workflow className="h-3.5 w-3.5" />}
              tooltip="Data flow connections found between tables."
            />
          )}
          {(progress.enrichedCount ?? 0) > 0 && (
            <MiniCounter
              label="Enriched"
              value={`${progress.enrichedCount}/${progress.enrichTotal ?? "?"}`}
              icon={<Search className="h-3.5 w-3.5" />}
              tooltip="Tables enriched with DESCRIBE DETAIL and DESCRIBE HISTORY."
            />
          )}
          {(progress.tablesGenerated ?? 0) > 0 && (
            <MiniCounter
              label="Tables Described"
              value={`${progress.tablesGenerated}/${progress.tablesFound ?? "?"}`}
              icon={<Table2 className="h-3.5 w-3.5" />}
              tooltip="Table-level AI descriptions generated so far."
            />
          )}
          {(progress.columnsGenerated ?? 0) > 0 && (
            <MiniCounter
              label="Columns Described"
              value={progress.columnsGenerated!}
              icon={<Columns3 className="h-3.5 w-3.5" />}
              tooltip="Column-level AI descriptions generated so far."
            />
          )}
          {(progress.columnTablesProcessed ?? 0) > 0 && progress.phase === "generating-columns" && (
            <MiniCounter
              label="Column Tables"
              value={`${progress.columnTablesProcessed}/${progress.tablesFound ?? "?"}`}
              icon={<Columns3 className="h-3.5 w-3.5" />}
              tooltip="Tables processed in the column description pass."
            />
          )}
          {(progress.consistencyFixes ?? 0) > 0 && (
            <MiniCounter
              label="Fixes Applied"
              value={progress.consistencyFixes!}
              icon={<ShieldCheck className="h-3.5 w-3.5" />}
              tooltip="Consistency fixes applied during the quality review pass."
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
