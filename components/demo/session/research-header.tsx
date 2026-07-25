"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Rocket,
  ScanSearch,
  MessageSquare,
  FileText,
  Download,
  ChevronDown,
  Loader2,
  Clock,
  Copy,
  Database,
} from "lucide-react";
import type { ResearchEngineResult } from "@/lib/demo/research-engine/types";

interface ResearchHeaderProps {
  customerName: string;
  industryId: string;
  researchPreset: string;
  status: string;
  createdAt: string;
  catalogName: string;
  schemaName: string;
  research: ResearchEngineResult | null;
  launching: "discovery" | "scan" | null;
  onLaunchDiscovery: () => void;
  onLaunchEstateScan: () => void;
  onExport: (format: "pptx" | "pdf") => void;
  onCopyFqn: () => void;
  onScrollToTab: (tab: string) => void;
}

function getAccountThesis(research: ResearchEngineResult | null): string {
  if (!research?.companyProfile) return "Research data pending";
  const gaps = research.companyProfile.strategicGaps;
  const priorities = research.companyProfile.statedPriorities;
  if (gaps?.length) {
    return `${gaps[0].gap} — creating an opening for ${gaps[0].opportunity}`;
  }
  if (priorities?.length) {
    return `Focused on ${priorities[0].priority.toLowerCase()}, creating alignment with data-driven solutions`;
  }
  return "Multiple strategic openings identified across their data landscape";
}

function getBestWedge(research: ResearchEngineResult | null): string {
  if (!research?.demoNarrative?.killerMoments?.length) return "Pending analysis";
  return research.demoNarrative.killerMoments[0].title;
}

function getWhyNow(research: ResearchEngineResult | null): string {
  if (!research?.companyProfile?.urgencySignals?.length) return "Market timing favourable";
  return research.companyProfile.urgencySignals[0].signal;
}

function getConfidence(research: ResearchEngineResult | null): { label: string; color: string } {
  const c = research?.confidence ?? 0;
  if (c >= 0.75) return { label: "High", color: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20" };
  if (c >= 0.45) return { label: "Medium", color: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20" };
  return { label: "Low", color: "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20" };
}

function timeAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return iso;
  }
}

export function ResearchHeader({
  customerName,
  industryId,
  researchPreset,
  status,
  createdAt,
  catalogName,
  schemaName,
  research,
  launching,
  onLaunchDiscovery,
  onLaunchEstateScan,
  onExport,
  onCopyFqn,
  onScrollToTab,
}: ResearchHeaderProps) {
  const thesis = getAccountThesis(research);
  const wedge = getBestWedge(research);
  const whyNow = getWhyNow(research);
  const confidence = getConfidence(research);
  const isCompleted = status === "completed";
  const fqn = `${catalogName}.${schemaName}`;

  return (
    <div className="space-y-0">
      {/* Metadata badges row */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Badge variant="secondary" className="text-xs font-medium">
          {industryId}
        </Badge>
        <Badge variant="outline" className="text-xs capitalize">
          {researchPreset}
        </Badge>
        <Badge
          variant="outline"
          className={`text-xs capitalize ${
            status === "completed"
              ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
              : status === "failed"
                ? "border-red-500/30 text-red-600 dark:text-red-400"
                : "border-amber-500/30 text-amber-600 dark:text-amber-400"
          }`}
        >
          <span
            className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
              status === "completed"
                ? "bg-emerald-500"
                : status === "failed"
                  ? "bg-red-500"
                  : "bg-amber-500"
            }`}
          />
          {status}
        </Badge>
        <Badge variant="outline" className="text-xs text-muted-foreground gap-1">
          <Clock className="h-3 w-3" />
          {timeAgo(createdAt)}
        </Badge>
        <Badge variant="outline" className={`text-xs ${confidence.color}`}>
          Confidence: {confidence.label}
        </Badge>
      </div>

      {/* Customer name */}
      <h1 className="text-3xl font-bold tracking-tight">{customerName}</h1>

      {/* Account thesis */}
      <p className="mt-2 text-[15px] text-muted-foreground leading-relaxed max-w-3xl">
        {thesis}
      </p>

      {/* Wedge + Why Now inline */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:gap-6">
        <div className="flex items-start gap-2">
          <span className="shrink-0 mt-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
            Best Wedge
          </span>
          <span className="text-sm font-medium">{wedge}</span>
        </div>
        <div className="hidden sm:block h-4 w-px bg-border" />
        <div className="flex items-start gap-2">
          <span className="shrink-0 mt-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
            Why Now
          </span>
          <span className="text-sm font-medium">{whyNow}</span>
        </div>
      </div>

      {/* Schema FQN */}
      <button
        onClick={onCopyFqn}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-2.5 py-1 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Database className="h-3 w-3" />
        {fqn}
        <Copy className="h-2.5 w-2.5 opacity-50" />
      </button>

      {/* CTA row */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {isCompleted && (
          <>
            <Button
              size="sm"
              onClick={onLaunchDiscovery}
              disabled={launching !== null}
              className="gap-2"
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
              onClick={() => onScrollToTab("talk-track")}
              className="gap-2"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Open Talk Track
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onScrollToTab("evidence")}
              className="gap-2 text-muted-foreground"
            >
              <FileText className="h-3.5 w-3.5" />
              View Evidence
            </Button>

            <div className="mx-1 h-4 w-px bg-border" />

            <Button
              variant="outline"
              size="sm"
              onClick={onLaunchEstateScan}
              disabled={launching !== null}
              className="gap-2"
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
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
              <Download className="h-3.5 w-3.5" />
              Export
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
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
    </div>
  );
}
