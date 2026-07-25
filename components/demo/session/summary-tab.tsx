"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronRight,
  ChevronDown,
  Zap,
  TrendingUp,
  Globe,
} from "lucide-react";
import type { ResearchEngineResult } from "@/lib/demo/research-engine/types";
import { ExecutiveBriefCard } from "./executive-brief-card";
import { CompactSwot } from "./compact-swot";

interface SummaryTabProps {
  research: ResearchEngineResult;
}

function IndustryTrends({ research }: { research: ResearchEngineResult }) {
  const forces = research.industryLandscape?.marketForces;
  if (!forces?.length) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Globe className="h-4 w-4 text-muted-foreground" />
          Industry Trends
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2 mb-3">
          {forces.slice(0, 5).map((f, i) => (
            <Badge
              key={i}
              variant="secondary"
              className={`text-xs gap-1 ${
                f.urgency === "accelerating"
                  ? "border-red-500/20 bg-red-500/5 text-red-700 dark:text-red-400"
                  : f.urgency === "emerging"
                    ? "border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-400"
                    : ""
              }`}
            >
              {f.urgency === "accelerating" && <Zap className="h-3 w-3" />}
              {f.force}
            </Badge>
          ))}
        </div>
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors group">
            <ChevronDown className="h-3 w-3 transition-transform group-data-[state=open]:rotate-180" />
            Show detail
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2">
            {forces.map((f, i) => (
              <div key={i} className="rounded border p-2.5">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{f.force}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                      f.urgency === "accelerating"
                        ? "bg-red-500/10 text-red-700 dark:text-red-400"
                        : f.urgency === "emerging"
                          ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {f.urgency}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{f.description}</p>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

function PrioritiesCard({ research }: { research: ResearchEngineResult }) {
  const stated = research.companyProfile?.statedPriorities ?? [];
  const inferred = research.companyProfile?.inferredPriorities ?? [];
  const gaps = research.companyProfile?.strategicGaps ?? [];

  if (!stated.length && !inferred.length && !gaps.length) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          Priorities & Gaps
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {stated.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">
              Stated
            </p>
            <ul className="space-y-1">
              {stated.slice(0, 5).map((p, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                  <span>
                    {p.priority}
                    {p.source && (
                      <span className="ml-1 text-muted-foreground text-xs">({p.source})</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {inferred.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">
              Inferred
            </p>
            <ul className="space-y-1">
              {inferred.slice(0, 4).map((p, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500/50" />
                  <span>
                    <span className="font-medium">{p.priority}</span>
                    {p.evidence && (
                      <span className="text-muted-foreground"> — {p.evidence}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {gaps.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">
              Strategic Gaps
            </p>
            <ul className="space-y-1.5">
              {gaps.slice(0, 4).map((g, i) => (
                <li key={i} className="text-sm">
                  <span className="font-medium">{g.gap}</span>
                  <span className="text-muted-foreground"> → {g.opportunity}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SoWhatCard({ research }: { research: ResearchEngineResult }) {
  const gap = research.companyProfile?.strategicGaps?.[0];
  const wedge = research.demoNarrative?.killerMoments?.[0];
  const urgency = research.companyProfile?.urgencySignals?.[0];

  if (!gap && !wedge && !urgency) return null;

  const summary = [
    gap && `They have a clear gap in "${gap.gap}"`,
    wedge && `our strongest play is "${wedge.title}"`,
    urgency && `and the timing is right because "${urgency.signal}"`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="rounded-lg border-l-2 border-l-primary bg-primary/[0.03] px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-primary/60 mb-1">
        So what this means for us
      </p>
      <p className="text-sm leading-relaxed">{summary}.</p>
    </div>
  );
}

export function SummaryTab({ research }: SummaryTabProps) {
  return (
    <div className="space-y-4">
      <ExecutiveBriefCard research={research} />
      <SoWhatCard research={research} />

      <div className="grid gap-4 lg:grid-cols-2">
        <PrioritiesCard research={research} />
        {research.companyProfile?.swotSummary && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">SWOT</CardTitle>
            </CardHeader>
            <CardContent>
              <CompactSwot swot={research.companyProfile.swotSummary} />
            </CardContent>
          </Card>
        )}
      </div>

      <IndustryTrends research={research} />
    </div>
  );
}
