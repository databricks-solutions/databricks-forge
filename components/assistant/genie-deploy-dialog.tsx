"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CatalogBrowser } from "@/components/pipeline/catalog-browser";
import {
  Rocket,
  Sparkles,
  Check,
  ExternalLink,
  Table2,
  BarChart3,
  Link2,
  MessageSquare,
  FileText,
  AlertTriangle,
  Loader2,
  Zap,
} from "lucide-react";
import type {
  GenieSpaceRecommendation,
  SerializedSpace,
  MetricViewProposal,
} from "@/lib/genie/types";
import { useGenieDeploy } from "@/lib/genie/deploy-utils";
import { useGenieBuild } from "@/components/providers/genie-build-provider";
import { loadSettings } from "@/lib/settings";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GenieDeployDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
}

function extractDefaultSchema(tables: string[]): string {
  if (tables.length === 0) return "";
  const parts = tables[0].split(".");
  if (parts.length >= 2) return `${parts[0]}.${parts[1]}`;
  return "";
}

function parseMetricViewProposals(rec: GenieSpaceRecommendation): MetricViewProposal[] {
  const raw = rec as unknown as Record<string, unknown>;
  if (typeof raw.metricViewProposals !== "string") return [];
  try {
    return JSON.parse(raw.metricViewProposals) as MetricViewProposal[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GenieDeployDialog({ open, onOpenChange, jobId }: GenieDeployDialogProps) {
  const { getJob } = useGenieBuild();
  const { phase, deployedSpaceId, error, databricksHost, deploy, reset } = useGenieDeploy();

  const [showSchemaSelector, setShowSchemaSelector] = useState(false);
  const [metricViewsServerEnabled, setMetricViewsServerEnabled] = useState(false);
  const [schemaOverride, setSchemaOverride] = useState<string[] | null>(null);
  const job = getJob(jobId);
  const recommendation = job?.result?.recommendation ?? null;

  const parsedSpace = useMemo<SerializedSpace | null>(() => {
    if (!recommendation) return null;
    try {
      return JSON.parse(recommendation.serializedSpace);
    } catch {
      return null;
    }
  }, [recommendation]);

  const mvProposals = useMemo(
    () => (recommendation ? parseMetricViewProposals(recommendation) : []),
    [recommendation],
  );
  const hasMetricViews = mvProposals.filter((m) => m.validationStatus !== "error").length > 0;

  const parsedTables = useMemo(
    () => parsedSpace?.data_sources?.tables?.map((t) => t.identifier) ?? [],
    [parsedSpace],
  );
  const defaultSchema = useMemo(() => extractDefaultSchema(parsedTables), [parsedTables]);
  const targetSchema = schemaOverride ?? (defaultSchema ? [defaultSchema] : []);
  const setTargetSchema = setSchemaOverride;

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        reset();
        setSchemaOverride(null);
        setShowSchemaSelector(false);
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, reset],
  );

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => {
        if (d.metricViewsEnabled) setMetricViewsServerEnabled(true);
      })
      .catch(() => {});
  }, []);

  const handleSchemaChange = useCallback(
    (sources: string[], _excluded?: string[], _patterns?: string[]) => {
      if (sources.length > 1) {
        setTargetSchema([sources[sources.length - 1]]);
      } else {
        setTargetSchema(sources);
      }
    },
    [setTargetSchema],
  );

  const handleDeploy = async () => {
    if (!recommendation) return;
    if (
      recommendation.quality?.gateDecision === "warn" &&
      !window.confirm("This space has quality warnings. Deploy anyway?")
    )
      return;

    await deploy(recommendation, {
      targetSchema: targetSchema[0] || defaultSchema || undefined,
      metricViewProposals: hasMetricViews ? mvProposals : undefined,
      generateJobId: jobId,
    });
  };

  const isBlocked = recommendation?.quality?.gateDecision === "block";
  const resultMode = job?.result?.mode ?? "fast";

  if (!recommendation || !parsedSpace) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[85vh] max-w-2xl flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Loading...</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            {phase === "deployed"
              ? "Genie Space Deployed"
              : phase === "deploying"
                ? "Deploying..."
                : "Deploy Genie Space"}
          </DialogTitle>
          <DialogDescription>
            {phase === "deploying"
              ? "Creating your Genie Space in Databricks..."
              : phase === "deployed"
                ? "Your Genie Space is live and ready for queries."
                : "Review your space and deploy to Databricks."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Deploying phase */}
          {phase === "deploying" && (
            <div className="flex items-center gap-3 py-8">
              <Loader2 className="size-5 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">
                Creating Genie Space in Databricks...
              </span>
            </div>
          )}

          {/* Error phase */}
          {phase === "error" && error && (
            <div className="space-y-4 py-4">
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                  <AlertTriangle className="size-4" />
                  {error}
                </div>
              </div>
            </div>
          )}

          {/* Deployed phase */}
          {phase === "deployed" && deployedSpaceId && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                  <Check className="size-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">
                    {recommendation.title ?? "Genie Space"} is live
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Ready for natural language queries.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                {databricksHost && (
                  <Button asChild className="flex-1">
                    <a
                      href={`${databricksHost}/genie/rooms/${deployedSpaceId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="mr-2 size-4" />
                      Open in Databricks
                    </a>
                  </Button>
                )}
                <Button variant="outline" className="flex-1" asChild>
                  <a href={`/genie/${deployedSpaceId}`}>View in Genie Studio</a>
                </Button>
              </div>
            </div>
          )}

          {/* Review phase (idle or error retry) */}
          {(phase === "idle" || (phase === "error" && !deployedSpaceId)) && (
            <div className="space-y-4 py-2">
              {/* Mode + quality badge */}
              <div className="flex items-center gap-2">
                {resultMode === "fast" ? (
                  <Badge variant="outline" className="gap-1 text-amber-600 dark:text-amber-400">
                    <Zap className="size-3" />
                    Quick Build
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 text-green-600 dark:text-green-400">
                    <Sparkles className="size-3" />
                    Full Engine
                  </Badge>
                )}
                {recommendation.quality && (
                  <Badge variant="secondary" className="text-xs">
                    Quality: {recommendation.quality.score}
                  </Badge>
                )}
              </div>

              {/* Title + description */}
              <div>
                <h3 className="text-sm font-semibold">{recommendation.title}</h3>
                <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">
                  {recommendation.description}
                </p>
              </div>

              {/* Stat row */}
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
                <StatItem icon={Table2} label="Tables" value={recommendation.tableCount} />
                <StatItem icon={BarChart3} label="Measures" value={recommendation.measureCount} />
                <StatItem icon={Link2} label="Filters" value={recommendation.filterCount} />
                <StatItem
                  icon={MessageSquare}
                  label="Dimensions"
                  value={recommendation.dimensionCount}
                />
                <StatItem
                  icon={FileText}
                  label="Instructions"
                  value={recommendation.instructionCount}
                />
                <StatItem icon={Link2} label="Joins" value={recommendation.joinCount} />
                <StatItem
                  icon={MessageSquare}
                  label="Questions"
                  value={recommendation.sampleQuestionCount}
                />
              </div>

              {/* Quality gate: blocked */}
              {isBlocked && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                    <AlertTriangle className="size-4" />
                    Deployment blocked by quality gate
                  </div>
                  {recommendation.quality?.degradedReasons &&
                    recommendation.quality.degradedReasons.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                        {recommendation.quality.degradedReasons.map((reason) => (
                          <li key={reason}>- {reason.replace(/_/g, " ")}</li>
                        ))}
                      </ul>
                    )}
                </div>
              )}

              {/* Quality warnings */}
              {!isBlocked &&
                recommendation.quality &&
                recommendation.quality.degradedReasons.length > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-900/60 dark:bg-amber-950/30">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-400" />
                      Quality warnings
                    </div>
                    <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                      {recommendation.quality.degradedReasons.map((reason) => (
                        <li key={reason}>- {reason.replace(/_/g, " ")}</li>
                      ))}
                    </ul>
                  </div>
                )}

              {/* Metric view schema selector */}
              {metricViewsServerEnabled &&
                hasMetricViews &&
                loadSettings().genieEngineDefaults.generateMetricViews && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-medium">
                            Metric Views (
                            {mvProposals.filter((m) => m.validationStatus !== "error").length})
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Choose a target schema for metric view deployment.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setShowSchemaSelector(!showSchemaSelector)}
                        >
                          {targetSchema[0] || defaultSchema || "Select schema"}
                        </Button>
                      </div>
                      {showSchemaSelector && (
                        <div className="max-h-48 overflow-y-auto rounded-md border">
                          <CatalogBrowser
                            selectedSources={targetSchema}
                            onSelectionChange={handleSchemaChange}
                            selectionMode="schema"
                            defaultExpandPath={defaultSchema}
                          />
                        </div>
                      )}
                    </div>
                  </>
                )}
            </div>
          )}
        </div>

        {/* Footer */}
        {(phase === "idle" || (phase === "error" && !deployedSpaceId)) && (
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              onClick={handleDeploy}
              disabled={isBlocked}
              variant={recommendation.quality?.gateDecision === "warn" ? "outline" : "default"}
              className={`gap-1.5 ${
                recommendation.quality?.gateDecision === "warn"
                  ? "border-amber-500 text-amber-600 hover:bg-amber-50 dark:border-amber-600 dark:text-amber-400 dark:hover:bg-amber-950/30"
                  : ""
              }`}
            >
              <Rocket className="size-3.5" />
              {isBlocked
                ? "Blocked"
                : recommendation.quality?.gateDecision === "warn"
                  ? "Deploy with Warnings"
                  : "Deploy to Databricks"}
            </Button>
          </DialogFooter>
        )}

        {phase === "deployed" && (
          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  if (value === 0) return null;
  return (
    <div className="flex items-center gap-1">
      <Icon className="size-3" />
      <span>
        {value} {label}
      </span>
    </div>
  );
}
