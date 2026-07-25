"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Target,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Database,
  Server,
  AlertTriangle,
  CheckCircle2,
  Lightbulb,
  Layers,
} from "lucide-react";
import type { UseCase } from "@/lib/domain/types";
import {
  computeIndustryCoverage,
  type PriorityCoverage,
} from "@/lib/domain/industry-coverage";
import { useIndustryOutcomes } from "@/lib/hooks/use-industry-outcomes";
import type { IndustryObjective } from "@/lib/domain/industry-outcomes";
import { DataGapCard } from "./data-gap-card";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function OutcomeMapTabContent({
  industryId,
  useCases,
  runId,
}: {
  industryId: string;
  useCases: UseCase[];
  runId: string;
}) {
  const { getOutcome } = useIndustryOutcomes();
  const industry = getOutcome(industryId);
  if (!industry) return null;

  const coverage = computeIndustryCoverage(industry, useCases);
  const pct = Math.round(coverage.overallCoverage * 100);

  const colorClass =
    pct >= 75
      ? "text-green-600 dark:text-green-400"
      : pct >= 25
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";

  const ringColor =
    pct >= 75 ? "stroke-green-500" : pct >= 25 ? "stroke-amber-500" : "stroke-red-500";

  const totalObjectives = industry.objectives.length;
  const totalPriorities = industry.objectives.reduce((sum, obj) => sum + obj.priorities.length, 0);

  return (
    <div className="space-y-6">
      {/* Hero Section */}
      <Card className="border-violet-200 bg-gradient-to-br from-violet-50/50 via-background to-blue-50/30 dark:border-violet-800 dark:from-violet-950/20 dark:to-blue-950/10">
        <CardContent className="pt-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-5">
              <CoverageRing pct={pct} ringColor={ringColor} />
              <div>
                <div className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-violet-500" />
                  <h2 className="text-lg font-semibold">{industry.name} Outcome Map</h2>
                </div>
                <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                  Your generated use cases cover{" "}
                  <span className={`font-bold ${colorClass}`}>{pct}%</span> of the{" "}
                  <span className="font-semibold">{coverage.totalRefUseCases}</span> reference use
                  cases across {totalObjectives} strategic objective
                  {totalObjectives !== 1 ? "s" : ""} and {totalPriorities} priorit
                  {totalPriorities !== 1 ? "ies" : "y"}.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="secondary" className="gap-1">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    {coverage.coveredRefUseCases} matched
                  </Badge>
                  {coverage.gapCount > 0 && (
                    <Badge
                      variant="outline"
                      className="gap-1 border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400"
                    >
                      <AlertTriangle className="h-3 w-3" />
                      {coverage.gapCount} gap{coverage.gapCount !== 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Value Insight Banner */}
      {coverage.gapCount > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50/40 p-4 dark:border-blue-800 dark:bg-blue-950/20">
          <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
          <div>
            <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">
              Opportunity Insight
            </p>
            <p className="mt-0.5 text-sm text-blue-800 dark:text-blue-300">
              {coverage.gapCount} reference use case{coverage.gapCount !== 1 ? "s" : ""} from the{" "}
              {industry.name} outcome map {coverage.gapCount !== 1 ? "are" : "is"} not yet covered
              by your data estate. Each gap represents a concrete opportunity to drive additional
              business value by onboarding the required data entities and source systems.
            </p>
          </div>
        </div>
      )}

      {/* Overall Coverage Bar */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <TrendingUp className="h-4 w-4 text-violet-500" />
            Overall Alignment
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Progress value={pct} className="h-3" />
            </div>
            <span className={`min-w-[80px] text-right text-sm font-bold ${colorClass}`}>
              {pct}% covered
            </span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold">{coverage.totalRefUseCases}</p>
              <p className="text-xs text-muted-foreground">Reference Use Cases</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                {coverage.coveredRefUseCases}
              </p>
              <p className="text-xs text-muted-foreground">Matched</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                {coverage.gapCount}
              </p>
              <p className="text-xs text-muted-foreground">Gaps</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Objective-level Breakdown */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-violet-500" />
          <h3 className="text-sm font-semibold">Strategic Objectives</h3>
        </div>
        {industry.objectives.map((objective) => (
          <ObjectiveSection
            key={objective.name}
            objective={objective}
            coveragePriorities={coverage.priorities.filter((pc) => pc.objective === objective.name)}
          />
        ))}
      </div>

      {/* Master Repository v2 -- Reference Data Asset coverage + value at risk */}
      <DataGapCard runId={runId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coverage Ring SVG
// ---------------------------------------------------------------------------

function CoverageRing({ pct, ringColor }: { pct: number; ringColor: string }) {
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="relative h-20 w-20 shrink-0">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={radius} fill="none" className="stroke-muted" strokeWidth="6" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          className={ringColor}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-bold">{pct}%</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Objective Section (groups priorities under a strategic objective)
// ---------------------------------------------------------------------------

function ObjectiveSection({
  objective,
  coveragePriorities,
}: {
  objective: IndustryObjective;
  coveragePriorities: PriorityCoverage[];
}) {
  const [open, setOpen] = useState(true);
  const objMatched = coveragePriorities.reduce((sum, pc) => sum + pc.matchedUseCases.length, 0);
  const objTotal = coveragePriorities.reduce((sum, pc) => sum + pc.priority.useCases.length, 0);
  const objPct = objTotal > 0 ? Math.round((objMatched / objTotal) * 100) : 0;

  const objColor =
    objPct >= 75
      ? "text-green-600 dark:text-green-400"
      : objPct >= 25
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";

  const objBorderColor =
    objPct >= 75
      ? "border-green-300 dark:border-green-700"
      : objPct >= 25
        ? "border-amber-300 dark:border-amber-700"
        : "border-red-300 dark:border-red-700";

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className={`${objBorderColor}`}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer pb-3 transition-colors hover:bg-muted/20">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <CardTitle className="text-sm font-semibold">{objective.name}</CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                  {objective.whyChange}
                </p>
              </div>
              <div className="ml-3 flex shrink-0 items-center gap-3">
                <div className="text-right">
                  <p className={`text-lg font-bold ${objColor}`}>{objPct}%</p>
                  <p className="text-[10px] text-muted-foreground">
                    {objMatched}/{objTotal} use cases
                  </p>
                </div>
                {open ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>
            <Progress value={objPct} className="mt-2 h-1.5" />
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-2 pt-0">
            {coveragePriorities.map((pc) => (
              <PriorityRow key={`${pc.objective}-${pc.priority.name}`} pc={pc} />
            ))}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Priority row (collapsible)
// ---------------------------------------------------------------------------

function PriorityRow({ pc }: { pc: PriorityCoverage }) {
  const [open, setOpen] = useState(false);
  const pctCovered = Math.round(pc.coverageRatio * 100);
  const statusColor =
    pctCovered >= 75
      ? "text-green-600 dark:text-green-400"
      : pctCovered >= 25
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";

  const badgeBorder =
    pctCovered >= 75
      ? "border-green-300 dark:border-green-700"
      : pctCovered >= 25
        ? "border-amber-300 dark:border-amber-700"
        : "border-red-300 dark:border-red-700";

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border p-3 text-left transition-colors hover:bg-muted/30">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{pc.priority.name}</p>
          <p className="text-xs text-muted-foreground">
            {pc.priority.useCases.length} reference use case
            {pc.priority.useCases.length !== 1 ? "s" : ""}
            {pc.unmatchedRefUseCases.length > 0 && (
              <span className="ml-1 text-amber-600 dark:text-amber-400">
                &middot; {pc.unmatchedRefUseCases.length} gap
                {pc.unmatchedRefUseCases.length !== 1 ? "s" : ""}
              </span>
            )}
          </p>
        </div>
        <div className="ml-3 flex shrink-0 items-center gap-2">
          <Badge variant="outline" className={`${statusColor} ${badgeBorder}`}>
            {pctCovered}%
          </Badge>
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="rounded-b-md border border-t-0 px-3 py-3 space-y-3">
          {pc.matchedUseCases.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-green-600 dark:text-green-400">
                Matched ({pc.matchedUseCases.length})
              </p>
              <div className="flex flex-wrap gap-1">
                {pc.matchedUseCases.map((uc) => (
                  <Badge key={uc.id} variant="secondary" className="text-xs">
                    {uc.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {pc.unmatchedRefUseCases.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                Gaps ({pc.unmatchedRefUseCases.length})
              </p>
              <div className="space-y-2">
                {pc.unmatchedRefUseCases.map((refUc) => (
                  <div
                    key={refUc.name}
                    className="rounded-md border border-dashed border-amber-300 bg-amber-50/30 p-2.5 dark:border-amber-800 dark:bg-amber-950/10"
                  >
                    <p className="text-sm font-medium">{refUc.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                      {refUc.description}
                    </p>
                    {refUc.businessValue && (
                      <p className="mt-1 text-xs italic text-violet-600 dark:text-violet-400">
                        Value: {refUc.businessValue}
                      </p>
                    )}
                    {(refUc.typicalDataEntities?.length ?? 0) > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <Database className="h-3 w-3 text-blue-500" />
                        <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 mr-1">
                          Data:
                        </span>
                        {refUc.typicalDataEntities!.map((entity) => (
                          <Badge
                            key={entity}
                            variant="outline"
                            className="border-blue-200 text-[10px] text-blue-700 dark:border-blue-800 dark:text-blue-300"
                          >
                            {entity}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {(refUc.typicalSourceSystems?.length ?? 0) > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <Server className="h-3 w-3 text-violet-500" />
                        <span className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 mr-1">
                          Sources:
                        </span>
                        {refUc.typicalSourceSystems!.map((system) => (
                          <Badge
                            key={system}
                            variant="outline"
                            className="border-violet-200 text-[10px] text-violet-700 dark:border-violet-800 dark:text-violet-300"
                          >
                            {system}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {pc.matchedUseCases.length === 0 && pc.unmatchedRefUseCases.length === 0 && (
            <p className="text-xs italic text-muted-foreground">
              No reference use cases in this priority
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
