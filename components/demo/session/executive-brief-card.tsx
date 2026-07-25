"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Briefcase, ArrowRight, Target, AlertTriangle, Sparkles, Clock } from "lucide-react";
import type {
  ResearchEngineResult,
  ExecutiveBrief,
  Evidence,
} from "@/lib/demo/research-engine/types";

interface ExecutiveBriefCardProps {
  research: ResearchEngineResult;
}

/**
 * Fallback: build a minimal brief from companyProfile when the LLM pass did
 * not produce an executiveBrief (older runs, Quick preset, or pass failure).
 */
function fallbackBrief(research: ResearchEngineResult): ExecutiveBrief {
  const profile = research.companyProfile;
  const landscape = research.industryLandscape;

  const whoTheyAre = profile?.statedPriorities?.[0]
    ? `A ${research.industryId} organisation prioritising ${profile.statedPriorities
        .slice(0, 2)
        .map((p) => p.priority.toLowerCase())
        .join(" and ")}.`
    : `A ${research.industryId} organisation analysed from ${research.sources?.length ?? 0} research sources.`;

  const whatTheyCareAbout =
    profile?.inferredPriorities?.slice(0, 3).map((p) => p.priority).join("; ") ??
    profile?.statedPriorities?.slice(0, 3).map((p) => p.priority).join("; ") ??
    "Data-driven transformation and operational efficiency.";

  const whatsLikelyBroken =
    profile?.strategicGaps?.[0]?.gap ??
    profile?.swotSummary?.weaknesses?.[0] ??
    "Gap between strategic ambition and data capability.";

  const whyNow =
    profile?.urgencySignals?.[0]?.signal ??
    landscape?.marketForces?.find((f) => f.urgency === "accelerating")?.force ??
    "Market and regulatory signals suggest action is warranted now.";

  const whereWeWin =
    research.demoNarrative?.killerMoments?.[0]?.scenario ??
    research.demoNarrative?.executiveTalkingPoints?.[0]?.headline ??
    (landscape?.marketForces?.[0]
      ? `Their exposure to "${landscape.marketForces[0].force}" creates a compelling entry point.`
      : "Demonstrate the gap between their current state and best-in-class.");

  return {
    whoTheyAre,
    whatTheyCareAbout,
    whatsLikelyBroken,
    whyNow,
    whereWeWin,
    situationComplicationResolution: {
      situation: whoTheyAre,
      complication: whatsLikelyBroken,
      resolution: whereWeWin,
    },
    evidence: [],
  };
}

const SECTIONS: Array<{
  id: keyof ExecutiveBrief;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "whoTheyAre", label: "Who they are", icon: Briefcase },
  { id: "whatTheyCareAbout", label: "What they care about", icon: Target },
  { id: "whatsLikelyBroken", label: "What's likely broken", icon: AlertTriangle },
  { id: "whyNow", label: "Why now", icon: Clock },
  { id: "whereWeWin", label: "Where we win first", icon: Sparkles },
];

function evidenceBadgeClass(tier: Evidence["tier"]): string {
  if (tier === "sourced") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
  if (tier === "benchmark") return "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20";
  return "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20";
}

export function ExecutiveBriefCard({ research }: ExecutiveBriefCardProps) {
  const brief = research.executiveBrief ?? fallbackBrief(research);
  const scr = brief.situationComplicationResolution;

  const sourcedCount = brief.evidence.filter((e) => e.tier === "sourced").length;
  const benchmarkCount = brief.evidence.filter((e) => e.tier === "benchmark").length;
  const inferredCount = brief.evidence.filter((e) => e.tier === "inferred").length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-sm font-semibold">
          <div className="flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-muted-foreground" />
            Executive Brief
          </div>
          {brief.evidence.length > 0 && (
            <div className="flex items-center gap-1 text-[10px] font-normal">
              {sourcedCount > 0 && (
                <Badge variant="outline" className={evidenceBadgeClass("sourced")}>
                  {sourcedCount} sourced
                </Badge>
              )}
              {benchmarkCount > 0 && (
                <Badge variant="outline" className={evidenceBadgeClass("benchmark")}>
                  {benchmarkCount} benchmark
                </Badge>
              )}
              {inferredCount > 0 && (
                <Badge variant="outline" className={evidenceBadgeClass("inferred")}>
                  {inferredCount} inferred
                </Badge>
              )}
            </div>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {SECTIONS.map(({ id, label, icon: Icon }) => {
          const value = brief[id];
          if (typeof value !== "string" || value.trim().length === 0) return null;
          return (
            <div key={id} className="space-y-1">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                <Icon className="h-3 w-3" />
                {label}
              </p>
              <p className="text-sm leading-relaxed">{value}</p>
            </div>
          );
        })}

        {(scr?.situation || scr?.complication || scr?.resolution) && (
          <div className="mt-4 rounded-md border bg-muted/30 p-3 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Situation &rarr; Complication &rarr; Resolution
            </p>
            {scr.situation && (
              <p className="text-xs leading-relaxed">
                <span className="font-semibold">Situation.</span> {scr.situation}
              </p>
            )}
            {scr.complication && (
              <p className="text-xs leading-relaxed">
                <span className="font-semibold">Complication.</span> {scr.complication}
              </p>
            )}
            {scr.resolution && (
              <p className="text-xs leading-relaxed flex items-start gap-1.5">
                <ArrowRight className="mt-0.5 h-3 w-3 flex-shrink-0 text-emerald-600" />
                <span>
                  <span className="font-semibold">Resolution.</span> {scr.resolution}
                </span>
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
