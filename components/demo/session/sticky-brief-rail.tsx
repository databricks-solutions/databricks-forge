"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Rocket,
  ScanSearch,
  Download,
  ChevronDown,
  FileText,
  Loader2,
} from "lucide-react";
import type { ResearchEngineResult } from "@/lib/demo/research-engine/types";

interface StickyBriefRailProps {
  research: ResearchEngineResult | null;
  isCompleted: boolean;
  launching: "discovery" | "scan" | null;
  onLaunchDiscovery: () => void;
  onLaunchEstateScan: () => void;
  onExport: (format: "pptx" | "pdf") => void;
}

function getAccountThesis(research: ResearchEngineResult | null): string {
  if (!research?.companyProfile) return "Research data pending";
  const gaps = research.companyProfile.strategicGaps;
  const priorities = research.companyProfile.statedPriorities;
  if (gaps?.length) return `${gaps[0].gap} → ${gaps[0].opportunity}`;
  if (priorities?.length) return priorities[0].priority;
  return "Multiple strategic openings identified";
}

export function StickyBriefRail({
  research,
  isCompleted,
  launching,
  onLaunchDiscovery,
  onLaunchEstateScan,
  onExport,
}: StickyBriefRailProps) {
  const moments = research?.demoNarrative?.killerMoments ?? [];
  const thesis = getAccountThesis(research);

  return (
    <div className="sticky top-6 space-y-4">
      {/* Account thesis */}
      <div className="rounded-lg border p-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">
          Account Thesis
        </p>
        <p className="text-sm leading-snug font-medium">{thesis}</p>
      </div>

      {/* Top opportunities */}
      {moments.length > 0 && (
        <div className="rounded-lg border p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">
            Top Opportunities
          </p>
          <div className="space-y-2">
            {moments.slice(0, 3).map((m, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {i + 1}
                </span>
                <p className="text-xs leading-snug line-clamp-2">{m.title}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="space-y-2">
        {isCompleted && (
          <>
            <Button
              size="sm"
              className="w-full gap-2"
              onClick={onLaunchDiscovery}
              disabled={launching !== null}
            >
              {launching === "discovery" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Rocket className="h-3.5 w-3.5" />
              )}
              Start Discovery
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2"
              onClick={onLaunchEstateScan}
              disabled={launching !== null}
            >
              {launching === "scan" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ScanSearch className="h-3.5 w-3.5" />
              )}
              Estate Scan
            </Button>
          </>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full gap-1.5 text-muted-foreground">
              <Download className="h-3.5 w-3.5" />
              Export
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => onExport("pptx")}>
              <FileText className="mr-2 h-4 w-4" />
              PowerPoint (.pptx)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport("pdf")}>
              <FileText className="mr-2 h-4 w-4" />
              PDF Document
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Confidence + source summary */}
      {research && (
        <div className="rounded-lg border p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Confidence</span>
            <Badge
              variant="outline"
              className={`text-[10px] ${
                research.confidence >= 0.75
                  ? "text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                  : research.confidence >= 0.45
                    ? "text-amber-600 dark:text-amber-400 border-amber-500/20"
                    : "text-red-600 dark:text-red-400 border-red-500/20"
              }`}
            >
              {Math.round(research.confidence * 100)}%
            </Badge>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Sources</span>
            <span className="font-medium">
              {research.sources?.filter((s) => s.status === "ready").length ?? 0}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Data Assets</span>
            <span className="font-medium">
              {research.dataStrategy?.assetDetails?.length ?? 0}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Opportunities</span>
            <span className="font-medium">
              {research.demoNarrative?.killerMoments?.length ?? 0}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
