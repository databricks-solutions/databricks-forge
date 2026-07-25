"use client";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ScoreDistributionChart,
  DomainBreakdownChart,
  TypeSplitChart,
  StepDurationChart,
  ScoreRadarOverview,
} from "@/components/charts/lazy";
import { SchemaCoverageCard } from "./schema-coverage-card";
import { BusinessContextCard } from "./business-context-card";
import { ConfigField } from "./config-field";
import { EnvironmentScanCard } from "./environment-scan-card";
import { effectiveScores } from "@/lib/domain/scoring";
import {
  BarChart3,
  Settings2,
  ChevronDown,
  ChevronUp,
  Target,
  BookOpen,
  FileText,
  Database,
  Pencil,
  Zap,
} from "lucide-react";
import type { PipelineRun, UseCase } from "@/lib/domain/types";
import type { IndustryOutcome } from "@/lib/domain/industry-outcomes";

interface DomainStat {
  domain: string;
  count: number;
}

export function OverviewTabContent({
  run,
  useCases,
  lineageDiscoveredFqns,
  runId,
  domainStats,
  insightsOpen,
  setInsightsOpen,
  detailsOpen,
  setDetailsOpen,
  getIndustryOutcome,
  onIndustryEdit,
}: {
  run: PipelineRun;
  useCases: UseCase[];
  lineageDiscoveredFqns: string[];
  runId: string;
  domainStats: DomainStat[];
  insightsOpen: boolean;
  setInsightsOpen: (open: boolean) => void;
  detailsOpen: boolean;
  setDetailsOpen: (open: boolean) => void;
  getIndustryOutcome: (id: string) => IndustryOutcome | null;
  onIndustryEdit: () => void;
}) {
  const isCompleted = run.status === "completed";

  return (
    <div className="space-y-6">
      {/* Insights group (expanded by default) */}
      <Collapsible open={insightsOpen} onOpenChange={setInsightsOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border bg-muted/30 px-4 py-2.5 text-left transition-colors hover:bg-muted/50">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-blue-500" />
            <span className="text-sm font-semibold">Insights</span>
          </div>
          {insightsOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-6 pt-4">
          {useCases.length > 1 && <ScoreRadarOverview useCases={useCases} />}

          {useCases.length > 0 && (
            <div className="grid gap-6 md:grid-cols-3">
              <ScoreDistributionChart
                scores={useCases.map((uc) => effectiveScores(uc).overall)}
                title="Score Distribution"
              />
              <DomainBreakdownChart
                data={domainStats.map((d) => ({
                  domain: d.domain,
                  count: d.count,
                }))}
                title="Use Cases by Domain"
              />
              <TypeSplitChart
                aiCount={useCases.filter((uc) => uc.type === "AI").length}
                statisticalCount={useCases.filter((uc) => uc.type === "Statistical").length}
                geospatialCount={useCases.filter((uc) => uc.type === "Geospatial").length}
                title="Use Case Types"
              />
            </div>
          )}

          {/* Schema Coverage */}
          {useCases.length > 0 && (
            <SchemaCoverageCard useCases={useCases} lineageDiscoveredFqns={lineageDiscoveredFqns} />
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Run Details group (collapsed by default) */}
      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border bg-muted/30 px-4 py-2.5 text-left transition-colors hover:bg-muted/50">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Run Details</span>
          </div>
          {detailsOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-6 pt-4">
          {/* Business Context */}
          {run.businessContext && <BusinessContextCard context={run.businessContext} />}

          {/* Context Sources (Enrichment Provenance) */}
          {run.contextSources && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-amber-500" />
                  <CardTitle className="text-sm font-medium">Enrichment Context Sources</CardTitle>
                </div>
                <CardDescription>
                  External knowledge sources that informed this pipeline run
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {/* Benchmarks */}
                  <div className="rounded-md border p-3">
                    <div className="flex items-center gap-1.5">
                      <BarChart3 className="h-3.5 w-3.5 text-amber-500" />
                      <p className="text-xs font-semibold">Benchmarks</p>
                    </div>
                    <p className="mt-1 text-sm">
                      {run.contextSources.benchmarks.strategy === "default"
                        ? "Default pack (no custom benchmarks)"
                        : `${run.contextSources.benchmarks.recordIds.length} records via ${run.contextSources.benchmarks.strategy.replace("_", " ")}`}
                    </p>
                    {run.contextSources.benchmarks.chunkCount > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {run.contextSources.benchmarks.chunkCount} chunks
                      </p>
                    )}
                  </div>

                  {/* Outcome Map */}
                  <div className="rounded-md border p-3">
                    <div className="flex items-center gap-1.5">
                      <Target className="h-3.5 w-3.5 text-blue-500" />
                      <p className="text-xs font-semibold">Outcome Map</p>
                    </div>
                    <p className="mt-1 text-sm">
                      {run.contextSources.outcomeMap.sections.length > 0
                        ? `${run.contextSources.outcomeMap.industryId ?? "cross-industry"}`
                        : "Not used"}
                    </p>
                    {run.contextSources.outcomeMap.sections.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Sections: {run.contextSources.outcomeMap.sections.join(", ")}
                      </p>
                    )}
                  </div>

                  {/* Documents */}
                  <div className="rounded-md border p-3">
                    <div className="flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-purple-500" />
                      <p className="text-xs font-semibold">RAG Documents</p>
                    </div>
                    <p className="mt-1 text-sm">
                      {run.contextSources.documents.sourceIds.length > 0
                        ? `${run.contextSources.documents.sourceIds.length} sources`
                        : "None retrieved"}
                    </p>
                    {run.contextSources.documents.chunkCount > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {run.contextSources.documents.chunkCount} chunks (
                        {run.contextSources.documents.kinds.join(", ")})
                      </p>
                    )}
                  </div>

                  {/* Fabric / Power BI */}
                  {run.contextSources.fabric?.scanId && (
                    <div className="rounded-md border border-violet-200 bg-violet-50/50 p-3 dark:border-violet-800 dark:bg-violet-950/20">
                      <div className="flex items-center gap-1.5">
                        <Zap className="h-3.5 w-3.5 text-violet-500" />
                        <p className="text-xs font-semibold">Power BI / Fabric</p>
                      </div>
                      <p className="mt-1 text-sm">
                        {run.contextSources.fabric.datasetCount} datasets,{" "}
                        {run.contextSources.fabric.measureCount} measures,{" "}
                        {run.contextSources.fabric.reportCount} reports
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Scan: {run.contextSources.fabric.scanId.slice(0, 8)}...
                      </p>
                    </div>
                  )}
                </div>
                {run.contextSources.steps.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Enriched in: {run.contextSources.steps.join(", ")}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Run Configuration */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Run Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                <ConfigField
                  label="Discovery Depth"
                  value={
                    (run.config.discoveryDepth ?? "balanced").charAt(0).toUpperCase() +
                    (run.config.discoveryDepth ?? "balanced").slice(1) +
                    (run.config.depthConfig
                      ? ` (${run.config.depthConfig.batchTargetMin}-${run.config.depthConfig.batchTargetMax}/batch, floor ${run.config.depthConfig.qualityFloor}, cap ${run.config.depthConfig.adaptiveCap}, lineage ${run.config.depthConfig.lineageDepth} hops)`
                      : "")
                  }
                />
                <ConfigField label="AI Model" value={run.config.aiModel} />
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Industry</p>
                  <p className="mt-0.5 text-sm">
                    {run.config.industry
                      ? (getIndustryOutcome(run.config.industry)?.name ?? run.config.industry)
                      : "Not specified"}
                    {run.config.industry && run.industryAutoDetected && (
                      <span className="ml-1.5 inline-block rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        auto-detected
                      </span>
                    )}
                    {isCompleted && (
                      <button
                        className="ml-1.5 inline-flex items-center text-xs text-violet-600 hover:text-violet-800 dark:text-violet-400 dark:hover:text-violet-200"
                        onClick={onIndustryEdit}
                      >
                        <Pencil className="mr-0.5 h-3 w-3" />
                        {run.config.industry ? "change" : "assign"}
                      </button>
                    )}
                  </p>
                </div>
                <ConfigField
                  label="Priorities"
                  value={
                    run.config.businessPriorities.length > 0
                      ? run.config.businessPriorities.join(", ")
                      : "Default"
                  }
                />
              </div>
              {run.config.sampleRowsPerTable > 0 ? (
                <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-800 dark:bg-blue-950/30">
                  <Database className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <p className="text-sm text-blue-800 dark:text-blue-300">
                    <span className="font-medium">Data sampling enabled</span>
                    {" \u2014 "}
                    {run.config.sampleRowsPerTable} rows per table sampled during discovery and SQL
                    generation
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-muted px-3 py-2">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Data sampling disabled — metadata only (no row-level data read)
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Environment Scan */}
          <EnvironmentScanCard runId={runId} />

          {/* Pipeline Timeline */}
          {run.stepLog.length > 0 && <StepDurationChart steps={run.stepLog} />}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
