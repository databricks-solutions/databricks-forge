"use client";

import { useState } from "react";
import { ChevronDown, Check, X, Loader2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { DomainPhase } from "@/lib/genie/engine-status";

export interface DomainStatusEntry {
  domain: string;
  tables: number;
  phase: DomainPhase;
  startedAt: number | null;
  completedAt: number | null;
  error?: string;
}

interface GenieEngineProgressDetailProps {
  domainStatuses: DomainStatusEntry[];
  elapsedMs: number;
  /** Current timestamp from parent (avoids impure Date.now() in render). */
  now: number;
}

const PHASE_CONFIG: Record<DomainPhase, { label: string; percent: number; color: string }> = {
  pending: { label: "Waiting...", percent: 0, color: "bg-muted-foreground/30" },
  expressions: { label: "Analyzing columns...", percent: 25, color: "bg-violet-500" },
  joins: { label: "Inferring joins...", percent: 50, color: "bg-violet-500" },
  assets: { label: "Building assets...", percent: 75, color: "bg-violet-500" },
  assembly: { label: "Assembling space...", percent: 90, color: "bg-violet-500" },
  completed: { label: "Complete", percent: 100, color: "bg-emerald-500" },
  failed: { label: "Failed", percent: 100, color: "bg-destructive" },
};

function formatElapsed(ms: number): string {
  if (ms < 1000) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

function DomainRow({ entry, now }: { entry: DomainStatusEntry; now: number }) {
  const config = PHASE_CONFIG[entry.phase];
  const isActive =
    entry.phase !== "pending" && entry.phase !== "completed" && entry.phase !== "failed";
  const elapsed = entry.startedAt ? (entry.completedAt ?? now) - entry.startedAt : 0;

  return (
    <div className="flex items-center gap-2 py-0.5">
      <div className="flex w-5 shrink-0 items-center justify-center">
        {entry.phase === "completed" && <Check className="h-3 w-3 text-emerald-500" />}
        {entry.phase === "failed" && <X className="h-3 w-3 text-destructive" />}
        {entry.phase === "pending" && (
          <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
        )}
        {isActive && <Loader2 className="h-3 w-3 animate-spin text-violet-500" />}
      </div>

      <span
        className={cn(
          "w-28 truncate text-[10px] font-medium",
          entry.phase === "pending" && "text-muted-foreground",
          entry.phase === "completed" && "text-emerald-600 dark:text-emerald-400",
          entry.phase === "failed" && "text-destructive",
          isActive && "text-foreground",
        )}
        title={entry.domain}
      >
        {entry.domain}
      </span>

      <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-primary/10">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            config.color,
            isActive && "animate-pulse",
          )}
          style={{ width: `${config.percent}%` }}
        />
      </div>

      <span className="w-24 text-right text-[9px] text-muted-foreground">{config.label}</span>

      <span className="w-10 text-right text-[9px] tabular-nums text-muted-foreground">
        {elapsed > 0 ? formatElapsed(elapsed) : ""}
      </span>
    </div>
  );
}

export function GenieEngineProgressDetail({
  domainStatuses,
  elapsedMs,
  now,
}: GenieEngineProgressDetailProps) {
  const [open, setOpen] = useState(false);

  if (domainStatuses.length === 0) return null;

  const completed = domainStatuses.filter((d) => d.phase === "completed").length;
  const failed = domainStatuses.filter((d) => d.phase === "failed").length;
  const total = domainStatuses.length;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center justify-between">
        <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
          <ChevronDown
            className={cn("h-3 w-3 transition-transform duration-200", !open && "-rotate-90")}
          />
          <span>
            {completed} of {total} domains{failed > 0 ? ` (${failed} failed)` : ""}
          </span>
        </CollapsibleTrigger>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {formatElapsed(elapsedMs)}
        </span>
      </div>

      <CollapsibleContent>
        <div className="mt-1.5 space-y-0 rounded-md border bg-muted/30 px-2 py-1.5">
          {domainStatuses.map((entry) => (
            <DomainRow key={entry.domain} entry={entry} now={now} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
