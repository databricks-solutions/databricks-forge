"use client";

import { useEffect, useState, useRef } from "react";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  Globe,
  FileText,
  Search,
  BarChart3,
  Building2,
  Map,
  Sparkles,
  CircleDot,
  Quote,
  BookOpen,
  Users,
  Link2,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import type { ResearchEngineResult } from "@/lib/demo/research-engine/types";
import type { ResearchJobStatus } from "@/lib/demo/research-engine/engine-status";
import type { ResearchPhase } from "@/lib/demo/research-engine/types";

interface ResearchResultsStepProps {
  sessionId: string;
  research: ResearchEngineResult | null;
  onResearchComplete: (result: ResearchEngineResult) => void;
}

const PHASE_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  "source-collection": { label: "Gathering Sources", icon: <Globe className="h-4 w-4" /> },
  "website-scrape": { label: "Scraping Website", icon: <Globe className="h-4 w-4" /> },
  "ir-discovery": { label: "Investor Relations", icon: <FileText className="h-4 w-4" /> },
  "doc-parsing": { label: "Parsing Documents", icon: <FileText className="h-4 w-4" /> },
  embedding: { label: "Embedding for Ask Forge", icon: <CircleDot className="h-4 w-4" /> },
  "industry-classification": { label: "Classifying Industry", icon: <Search className="h-4 w-4" /> },
  "quick-synthesis": { label: "Quick Synthesis", icon: <Sparkles className="h-4 w-4" /> },
  "industry-landscape": { label: "Industry Landscape", icon: <BarChart3 className="h-4 w-4" /> },
  "key-quotes-extraction": { label: "Extracting Key Quotes", icon: <Quote className="h-4 w-4" /> },
  "source-summaries": { label: "Summarising Sources", icon: <BookOpen className="h-4 w-4" /> },
  "strategy-and-narrative": { label: "Strategy & Narrative", icon: <Building2 className="h-4 w-4" /> },
  "company-deep-dive": { label: "Company Deep-Dive", icon: <Building2 className="h-4 w-4" /> },
  "data-strategy-mapping": { label: "Data Strategy Mapping", icon: <Map className="h-4 w-4" /> },
  "demo-narrative": { label: "Demo Narrative Design", icon: <Sparkles className="h-4 w-4" /> },
  "persona-talk-track": { label: "Persona Talk Tracks", icon: <Users className="h-4 w-4" /> },
  "evidence-linking": { label: "Linking Evidence", icon: <Link2 className="h-4 w-4" /> },
  complete: { label: "Complete", icon: <CheckCircle2 className="h-4 w-4" /> },
};

const PHASE_ORDER: ResearchPhase[] = [
  "source-collection",
  "website-scrape",
  "ir-discovery",
  "doc-parsing",
  "embedding",
  "industry-classification",
  "quick-synthesis",
  "industry-landscape",
  "key-quotes-extraction",
  "source-summaries",
  "strategy-and-narrative",
  "company-deep-dive",
  "data-strategy-mapping",
  "demo-narrative",
  "persona-talk-track",
  "evidence-linking",
  "complete",
];

export function ResearchResultsStep({
  sessionId,
  research,
  onResearchComplete,
}: ResearchResultsStepProps) {
  const [status, setStatus] = useState<ResearchJobStatus | null>(null);
  const [completedPhases, setCompletedPhases] = useState<Set<string>>(new Set());
  const [elapsed, setElapsed] = useState(0);
  const lastPhaseRef = useRef<string>("");

  useEffect(() => {
    if (research) return;
    if (!sessionId) return;

    const interval = setInterval(async () => {
      try {
        const resp = await fetch(`/api/demo/research/status?sessionId=${sessionId}`);
        const data: ResearchJobStatus = await resp.json();
        setStatus(data);

        if (data.phase && data.phase !== lastPhaseRef.current) {
          if (lastPhaseRef.current) {
            setCompletedPhases((prev) => new Set([...prev, lastPhaseRef.current]));
          }
          lastPhaseRef.current = data.phase;
        }

        if (data.status === "completed") {
          clearInterval(interval);
          setCompletedPhases((prev) => new Set([...prev, "complete"]));
          const detailResp = await fetch(`/api/demo/sessions/${sessionId}`);
          const detail = await detailResp.json();
          if (detail.research) {
            onResearchComplete(detail.research);
          }
        }

        if (data.status === "failed") {
          clearInterval(interval);
        }
      } catch {
        // retry next interval
      }
    }, 2_000);

    return () => clearInterval(interval);
  }, [sessionId, research, onResearchComplete]);

  useEffect(() => {
    if (!status?.startedAt || status.status !== "researching") return;
    const tick = () => setElapsed(Math.floor((Date.now() - status.startedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status?.startedAt, status?.status]);

  if (research) {
    return <ResearchSummary research={research} sessionId={sessionId} />;
  }

  if (!status) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Connecting...</span>
      </div>
    );
  }

  if (status.status === "failed") {
    return (
      <div className="text-center py-12">
        <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
        <p className="text-destructive font-medium">Research failed</p>
        <p className="text-sm text-muted-foreground mt-1">{status.error}</p>
      </div>
    );
  }

  const activePhases = PHASE_ORDER.filter((p) => completedPhases.has(p) || p === status.phase);

  return (
    <div className="space-y-6 px-1">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{status.message}</span>
          <span className="text-xs text-muted-foreground">
            {elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`} elapsed
          </span>
        </div>
        <Progress value={status.percent} className="h-2" />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{status.percent}%</span>
        </div>
      </div>

      <div className="space-y-1.5">
        {activePhases.map((phase) => {
          const meta = PHASE_LABELS[phase] ?? { label: phase, icon: <CircleDot className="h-4 w-4" /> };
          const isCompleted = completedPhases.has(phase);
          const isActive = phase === status.phase && !isCompleted;

          return (
            <div
              key={phase}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-primary/5 border border-primary/20"
                  : isCompleted
                    ? "text-muted-foreground"
                    : "text-muted-foreground/50"
              }`}
            >
              {isCompleted ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
              ) : isActive ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
              ) : (
                <span className="h-4 w-4 shrink-0">{meta.icon}</span>
              )}
              <span className={isActive ? "font-medium text-foreground" : ""}>
                {meta.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResearchSummary({
  research,
  sessionId,
}: {
  research: ResearchEngineResult;
  sessionId: string;
}) {
  const sourceCount = research.sources.filter((s) => s.status === "ready").length;
  const assetCount = research.matchedDataAssetIds.length;
  const narrativeCount = research.dataNarratives.length;
  const priorities = research.companyProfile?.statedPriorities ?? [];
  const nomenclature = research.nomenclature ?? {};
  const nomenclatureEntries = Object.entries(nomenclature).slice(0, 10);

  return (
    <div className="space-y-5 px-1">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/10">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">Research Complete</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{research.industryId}</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => window.open(`/demo/sessions/${sessionId}`, "_blank")}
        >
          <ExternalLink className="h-3 w-3" />
          Full Report
        </Button>
      </div>

      {/* Stat ribbon */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { value: String(sourceCount), label: "Sources", icon: Globe },
          { value: String(assetCount), label: "Assets", icon: Map },
          { value: String(narrativeCount), label: "Narratives", icon: Sparkles },
          { value: String(priorities.length), label: "Priorities", icon: BarChart3 },
        ].map(({ value, label, icon: Icon }) => (
          <div
            key={label}
            className="relative overflow-hidden rounded-lg border bg-card px-3 py-2.5 text-center"
          >
            <Icon className="mx-auto mb-1 h-3.5 w-3.5 text-muted-foreground/50" />
            <p className="text-lg font-bold leading-none tracking-tight">{value}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      {/* Priorities */}
      {priorities.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Strategic Priorities
          </p>
          <ol className="space-y-1.5">
            {priorities.slice(0, 5).map((p, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  {i + 1}
                </span>
                <span className="leading-snug">{p.priority}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Nomenclature */}
      {nomenclatureEntries.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Company Terminology
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {nomenclatureEntries.map(([key, val]) => (
              <div key={key} className="flex items-baseline gap-1.5 text-sm">
                <span className="shrink-0 font-medium text-foreground">{key}</span>
                <span className="truncate text-muted-foreground">{val}</span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
