"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GenieWorkbench } from "@/components/pipeline/genie-workbench";
import { DashboardsTab } from "@/components/pipeline/dashboards-tab";

import { OverviewTabContent } from "./overview-tab-content";
import { OutcomeMapTabContent } from "./outcome-map-tab-content";
import { UseCasesTabContent } from "./use-cases-tab-content";
import { AIObservabilityTab } from "./ai-observability-tab";
import { PromptVersionsCard } from "./prompt-versions-card";
import { BusinessValueTab } from "./business-value-tab";
import { RUN_DETAIL } from "@/lib/help-text";
import type { PipelineRun, UseCase } from "@/lib/domain/types";
import type { IndustryOutcome } from "@/lib/domain/industry-outcomes";
import type { PromptLogEntry, PromptLogStats } from "./ai-observability-tab";

interface DomainStat {
  domain: string;
  count: number;
}

export function RunCompletedTabs({
  run,
  useCases,
  lineageDiscoveredFqns,
  runId,
  domainStats,
  activeTab,
  onTabChange,
  insightsOpen,
  setInsightsOpen,
  detailsOpen,
  setDetailsOpen,
  getIndustryOutcome,
  onIndustryEdit,
  promptLogs,
  promptStats,
  logsLoading,
  genieGenerating,
  dashboardGenerating,
  bvGenerating,
  onFetchPromptLogs,
  onRerun,
  isRerunning,
  onUseCaseUpdate,
  highlightUseCaseId,
  initialDomain,
}: {
  run: PipelineRun;
  useCases: UseCase[];
  lineageDiscoveredFqns: string[];
  runId: string;
  domainStats: DomainStat[];
  activeTab: string;
  onTabChange: (value: string) => void;
  insightsOpen: boolean;
  setInsightsOpen: (open: boolean) => void;
  detailsOpen: boolean;
  setDetailsOpen: (open: boolean) => void;
  getIndustryOutcome: (id: string) => IndustryOutcome | null;
  onIndustryEdit: () => void;
  promptLogs: PromptLogEntry[];
  promptStats: PromptLogStats | null;
  logsLoading: boolean;
  genieGenerating: boolean;
  dashboardGenerating: boolean;
  bvGenerating: boolean;
  onFetchPromptLogs: () => void;
  onRerun: () => void;
  isRerunning: boolean;
  onUseCaseUpdate: (updated: UseCase) => Promise<{ ok: boolean; error?: string }>;
  highlightUseCaseId?: string;
  initialDomain?: string;
}) {
  return (
    <Tabs value={activeTab} onValueChange={onTabChange}>
      <TabsList>
        <Tooltip>
          <TooltipTrigger asChild>
            <TabsTrigger value="overview">Overview</TabsTrigger>
          </TooltipTrigger>
          <TooltipContent>{RUN_DETAIL.tabOverview}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <TabsTrigger value="usecases">Use Cases ({useCases.length})</TabsTrigger>
          </TooltipTrigger>
          <TooltipContent>{RUN_DETAIL.tabUseCases}</TooltipContent>
        </Tooltip>
        {run.config.industry && useCases.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <TabsTrigger value="outcome-map">Outcome Map</TabsTrigger>
            </TooltipTrigger>
            <TooltipContent>{RUN_DETAIL.tabOutcomeMap}</TooltipContent>
          </Tooltip>
        )}
        {useCases.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <TabsTrigger value="genie">
                Genie Spaces{" "}
                {genieGenerating && <span className="ml-1 animate-pulse text-violet-500">●</span>}
              </TabsTrigger>
            </TooltipTrigger>
            <TooltipContent>{RUN_DETAIL.tabGenie}</TooltipContent>
          </Tooltip>
        )}
        {useCases.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <TabsTrigger value="dashboards">
                Dashboards{" "}
                {dashboardGenerating && <span className="ml-1 animate-pulse text-blue-500">●</span>}
              </TabsTrigger>
            </TooltipTrigger>
            <TooltipContent>{RUN_DETAIL.tabDashboards}</TooltipContent>
          </Tooltip>
        )}
        {useCases.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <TabsTrigger value="business-value">
                Business Value{" "}
                {bvGenerating && <span className="ml-1 animate-pulse text-emerald-500">●</span>}
              </TabsTrigger>
            </TooltipTrigger>
            <TooltipContent>Financial estimates, roadmap, and executive synthesis</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <TabsTrigger value="observability" onClick={onFetchPromptLogs}>
              AI Observability
            </TabsTrigger>
          </TooltipTrigger>
          <TooltipContent>{RUN_DETAIL.tabObservability}</TooltipContent>
        </Tooltip>
      </TabsList>

      <TabsContent value="overview" className="space-y-6 pt-4">
        <OverviewTabContent
          run={run}
          useCases={useCases}
          lineageDiscoveredFqns={lineageDiscoveredFqns}
          runId={runId}
          domainStats={domainStats}
          insightsOpen={insightsOpen}
          setInsightsOpen={setInsightsOpen}
          detailsOpen={detailsOpen}
          setDetailsOpen={setDetailsOpen}
          getIndustryOutcome={getIndustryOutcome}
          onIndustryEdit={onIndustryEdit}
        />
      </TabsContent>

      <TabsContent value="usecases" className="pt-4">
        <UseCasesTabContent
          useCases={useCases}
          lineageDiscoveredFqns={lineageDiscoveredFqns}
          runId={runId}
          onUpdate={onUseCaseUpdate}
          highlightUseCaseId={highlightUseCaseId}
        />
      </TabsContent>

      {run.config.industry && useCases.length > 0 && (
        <TabsContent value="outcome-map" className="pt-4">
          <OutcomeMapTabContent
            industryId={run.config.industry}
            useCases={useCases}
            runId={runId}
          />
        </TabsContent>
      )}

      {useCases.length > 0 && (
        <TabsContent value="genie" className="pt-4">
          <GenieWorkbench runId={run.runId} initialDomain={initialDomain} />
        </TabsContent>
      )}

      {useCases.length > 0 && (
        <TabsContent value="dashboards" className="pt-4">
          <DashboardsTab runId={run.runId} />
        </TabsContent>
      )}

      {useCases.length > 0 && (
        <TabsContent value="business-value" className="pt-4">
          <BusinessValueTab runId={runId} />
        </TabsContent>
      )}

      <TabsContent value="observability" className="space-y-6 pt-4">
        <AIObservabilityTab
          logs={promptLogs}
          stats={promptStats}
          loading={logsLoading}
          stepLog={run.stepLog}
          promptVersionsNode={
            run.promptVersions ? (
              <PromptVersionsCard runVersions={run.promptVersions} runId={run.runId} />
            ) : undefined
          }
          onRerun={onRerun}
          isRerunning={isRerunning}
        />
      </TabsContent>
    </Tabs>
  );
}
