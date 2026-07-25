"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ScanProgressData } from "@/app/environment/types";
import { BarChart3, Database, Globe, Loader2, Search, ShieldAlert, Workflow } from "lucide-react";

const PHASE_LABELS: Record<string, string> = {
  starting: "Initialising",
  "listing-tables": "Discovering Tables",
  "fetching-metadata": "Fetching Metadata",
  "walking-lineage": "Walking Lineage",
  enriching: "Enriching Tables",
  "fetching-tags": "Fetching Tags",
  "health-scoring": "Health Scoring",
  "llm-intelligence": "LLM Analysis",
  saving: "Saving Results",
  complete: "Complete",
  failed: "Failed",
};

const PHASE_ORDER = [
  "starting",
  "listing-tables",
  "fetching-metadata",
  "walking-lineage",
  "enriching",
  "fetching-tags",
  "health-scoring",
  "llm-intelligence",
  "saving",
  "complete",
];

function MiniCounter({
  label,
  value,
  icon,
  alert,
  tooltip,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  alert?: boolean;
  tooltip?: string;
}) {
  const inner = (
    <div
      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs ${
        alert
          ? "bg-orange-100/60 text-orange-700 dark:bg-orange-950/20 dark:text-orange-400"
          : "bg-white/60 text-muted-foreground dark:bg-white/5"
      }`}
    >
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

export interface ScanProgressCardProps {
  progress: ScanProgressData;
}

export function ScanProgressCard({ progress }: ScanProgressCardProps) {
  const currentPhaseIdx = PHASE_ORDER.indexOf(progress.phase);
  const totalPhases = PHASE_ORDER.length - 1; // exclude "complete"
  const pct = Math.max(
    5,
    Math.min(
      95,
      progress.phase === "enriching" && progress.enrichTotal > 0
        ? // During enrichment, interpolate within the enriching phase
          ((currentPhaseIdx + progress.enrichedCount / progress.enrichTotal) / totalPhases) * 100
        : ((currentPhaseIdx + 0.5) / totalPhases) * 100,
    ),
  );

  const elapsed = progress.elapsedMs;
  const mins = Math.floor(elapsed / 60_000);
  const secs = Math.floor((elapsed % 60_000) / 1_000);
  const elapsedStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <Card
      className="border-blue-200 bg-blue-50/30 dark:border-blue-900 dark:bg-blue-950/10"
      aria-live="polite"
    >
      <CardContent className="pt-5 pb-4 space-y-4">
        {/* Phase + elapsed */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
            <span className="text-sm font-semibold">
              {PHASE_LABELS[progress.phase] ?? progress.phase}
            </span>
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

        {/* Status message */}
        <p className="text-sm text-muted-foreground">{progress.message}</p>

        {/* Live counters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {progress.tablesFound > 0 && (
            <MiniCounter
              label="Tables Found"
              value={progress.tablesFound}
              icon={<Database className="h-3.5 w-3.5" />}
              tooltip="Tables and views discovered so far in the selected Unity Catalog scope."
            />
          )}
          {progress.columnsFound > 0 && (
            <MiniCounter
              label="Columns"
              value={progress.columnsFound}
              icon={<BarChart3 className="h-3.5 w-3.5" />}
              tooltip="Total columns found across all discovered tables. Column names and types are used for AI analysis."
            />
          )}
          {progress.lineageTablesFound > 0 && (
            <MiniCounter
              label="Lineage Tables"
              value={progress.lineageTablesFound}
              icon={<Workflow className="h-3.5 w-3.5" />}
              tooltip="Additional tables discovered by following data lineage (upstream and downstream dependencies) beyond your original scope."
            />
          )}
          {progress.lineageEdgesFound > 0 && (
            <MiniCounter
              label="Lineage Edges"
              value={progress.lineageEdgesFound}
              icon={<Workflow className="h-3.5 w-3.5" />}
              tooltip="Data flow connections found between tables. Each edge represents one table feeding data into another via ETL, views, or streaming."
            />
          )}
          {progress.enrichedCount > 0 && (
            <MiniCounter
              label="Enriched"
              value={`${progress.enrichedCount}/${progress.enrichTotal}`}
              icon={<Search className="h-3.5 w-3.5" />}
              tooltip="Tables that have been deeply analysed with DESCRIBE DETAIL (size, format, files) and DESCRIBE HISTORY (write patterns, maintenance)."
            />
          )}
          {progress.domainsFound > 0 && (
            <MiniCounter
              label="Domains"
              value={progress.domainsFound}
              icon={<Globe className="h-3.5 w-3.5" />}
              tooltip="Business domains identified so far by the AI analysis pass (e.g. Finance, Customer, Operations)."
            />
          )}
          {progress.piiDetected > 0 && (
            <MiniCounter
              label="PII Tables"
              value={progress.piiDetected}
              icon={<ShieldAlert className="h-3.5 w-3.5" />}
              alert
              tooltip="Tables flagged as containing personally identifiable or sensitive data based on column names and types."
            />
          )}
          {progress.llmPass && (
            <MiniCounter
              label="LLM Pass"
              value={progress.llmPass}
              icon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}
              tooltip="The current AI analysis pass running. Passes include domain categorisation, PII detection, description generation, redundancy checks, relationship discovery, tier classification, data product identification, and governance scoring."
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
