"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw, Square, X } from "lucide-react";
import { GenieSpacesTab } from "./genie-spaces-tab";
import { GenieConfigEditor } from "./genie-config-editor";
import { GenieSpacePreview } from "./genie-space-preview";
import { ExistingAssetsTab } from "./existing-assets-tab";
import { GenieEngineProgressDetail, type DomainStatusEntry } from "./genie-engine-progress-detail";
import type { GenieEngineConfig } from "@/lib/genie/types";
import { defaultGenieEngineConfig } from "@/lib/genie/types";
import { loadSettings } from "@/lib/settings";

interface GenieWorkbenchProps {
  runId: string;
  initialDomain?: string;
}

function applyGlobalDefaults(cfg: GenieEngineConfig): GenieEngineConfig {
  if (typeof window === "undefined") return cfg;
  const settings = loadSettings();
  const g = settings.genieEngineDefaults;
  cfg.maxTablesPerSpace = g.maxTablesPerSpace;
  cfg.maxAutoSpaces = g.maxAutoSpaces;
  cfg.llmRefinement = g.llmRefinement;
  cfg.generateBenchmarks = g.generateBenchmarks;
  cfg.generateMetricViews = g.generateMetricViews;
  cfg.autoTimePeriods = g.autoTimePeriods;
  cfg.generateTrustedAssets = g.generateTrustedAssets;
  cfg.fiscalYearStartMonth = g.fiscalYearStartMonth;
  cfg.entityMatchingMode = g.entityMatchingMode;
  cfg.qualityPreset = g.qualityPreset;
  cfg.questionComplexity = settings.questionComplexity.genieEngine;
  return cfg;
}

export function GenieWorkbench({ runId, initialDomain }: GenieWorkbenchProps) {
  const [engineEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    return loadSettings().genieEngineDefaults.engineEnabled;
  });
  const [config, setConfig] = useState<GenieEngineConfig>(() => {
    return applyGlobalDefaults(defaultGenieEngineConfig());
  });
  const [configVersion, setConfigVersion] = useState(0);
  const [configLoading, setConfigLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [genMessage, setGenMessage] = useState("");
  const [completedDomains, setCompletedDomains] = useState(0);
  const [totalDomains, setTotalDomains] = useState(0);
  const [configDirty, setConfigDirty] = useState(false);
  const [domains, setDomains] = useState<string[]>([]);
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(new Set());
  const [completedDomainNames, setCompletedDomainNames] = useState<string[]>([]);
  const [domainStatuses, setDomainStatuses] = useState<DomainStatusEntry[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [pollTs, setPollTs] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastErrorType, setLastErrorType] = useState<"auth" | "general" | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchDomains = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${runId}/genie-recommendations`);
      const data = await res.json();
      if (res.ok && data.recommendations) {
        const names: string[] = data.recommendations.map((r: { domain: string }) => r.domain);
        setDomains(names);
      }
    } catch {
      /* ignore */
    }
  }, [runId]);

  useEffect(() => {
    if (initialDomain && domains.includes(initialDomain)) {
      setSelectedDomains(new Set([initialDomain]));
    }
  }, [initialDomain, domains]);

  const startPolling = useCallback(() => {
    stopPolling();
    let delay = 2000;
    const poll = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}/genie-engine/generate/status`);
        const data = await res.json();
        if (res.ok) {
          setPollTs(Date.now());
          setGenProgress(data.percent ?? 0);
          setGenMessage(data.message ?? "");
          setCompletedDomains(data.completedDomains ?? 0);
          setTotalDomains(data.totalDomains ?? 0);
          setElapsedMs(data.elapsedMs ?? 0);
          if (Array.isArray(data.completedDomainNames)) {
            setCompletedDomainNames(data.completedDomainNames);
          }
          if (Array.isArray(data.domainStatuses)) {
            setDomainStatuses(data.domainStatuses);
          }
          if (data.status === "completed") {
            stopPolling();
            setGenerating(false);
            setGenProgress(100);
            setSelectedDomains(new Set());
            setLastError(null);
            setLastErrorType(null);
            setRefreshKey((k) => k + 1);
            fetchDomains();
            toast.success(
              `Genie Engine complete: ${data.domainCount} domain${data.domainCount !== 1 ? "s" : ""} generated`,
            );
            return;
          } else if (data.status === "cancelled") {
            stopPolling();
            setGenerating(false);
            setLastError(null);
            setLastErrorType(null);
            toast.info("Generation cancelled");
            return;
          } else if (data.status === "failed") {
            stopPolling();
            setGenerating(false);
            setLastError(data.error || "Generation failed");
            setLastErrorType(data.errorType ?? "general");
            return;
          }
          delay = 2000;
        }
      } catch {
        delay = Math.min(delay * 1.3, 10000);
      }
      pollRef.current = setTimeout(poll, delay);
    };
    pollRef.current = setTimeout(poll, delay);
  }, [runId, stopPolling, fetchDomains]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  // Auto-detect an in-progress or failed Genie job (e.g. fired by the pipeline)
  useEffect(() => {
    let cancelled = false;
    async function checkActiveJob() {
      try {
        const res = await fetch(`/api/runs/${runId}/genie-engine/generate/status`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          if (data.status === "generating") {
            setGenerating(true);
            setGenProgress(data.percent ?? 0);
            setGenMessage(data.message ?? "");
            setCompletedDomains(data.completedDomains ?? 0);
            setTotalDomains(data.totalDomains ?? 0);
            setElapsedMs(data.elapsedMs ?? 0);
            if (Array.isArray(data.completedDomainNames)) {
              setCompletedDomainNames(data.completedDomainNames);
            }
            if (Array.isArray(data.domainStatuses)) {
              setDomainStatuses(data.domainStatuses);
            }
            startPolling();
          } else if (data.status === "failed") {
            setLastError(data.error || "Generation failed");
            setLastErrorType(data.errorType ?? "general");
          }
        }
      } catch {
        // ignore -- no active job or endpoint unavailable
      }
    }
    checkActiveJob();
    return () => {
      cancelled = true;
    };
  }, [runId, startPolling]);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${runId}/genie-engine/config`);
      const data = await res.json();
      if (res.ok) {
        setConfig(applyGlobalDefaults(data.config as GenieEngineConfig));
        setConfigVersion(data.version);
      }
    } catch {
      // Use defaults
    } finally {
      setConfigLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    fetchConfig();
    fetchDomains();
  }, [fetchConfig, fetchDomains]);

  const handleConfigChange = useCallback((newConfig: GenieEngineConfig) => {
    setConfig(newConfig);
    setConfigDirty(true);
  }, []);

  const handleSaveConfig = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${runId}/genie-engine/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      const data = await res.json();
      if (res.ok) {
        setConfigVersion(data.version);
        setConfigDirty(false);
        toast.success("Engine configuration saved");
      } else {
        toast.error(data.error || "Failed to save configuration");
      }
    } catch {
      toast.error("Failed to save configuration");
    }
  }, [runId, config]);

  const handleRegenerate = useCallback(
    async (filterDomains?: string[]) => {
      if (configDirty) {
        await handleSaveConfig();
      }

      setGenerating(true);
      setGenProgress(0);
      setCompletedDomains(0);
      setTotalDomains(0);
      setCompletedDomainNames([]);
      setLastError(null);
      setLastErrorType(null);
      setGenMessage(
        filterDomains?.length
          ? `Regenerating ${filterDomains.length} domain${filterDomains.length !== 1 ? "s" : ""}...`
          : "Starting...",
      );
      try {
        const body = filterDomains?.length ? JSON.stringify({ domains: filterDomains }) : undefined;
        const res = await fetch(`/api/runs/${runId}/genie-engine/generate`, {
          method: "POST",
          ...(body ? { headers: { "Content-Type": "application/json" }, body } : {}),
        });
        const data = await res.json();
        if (res.ok) {
          startPolling();
        } else {
          toast.error(data.error || "Failed to start generation");
          setGenerating(false);
        }
      } catch {
        toast.error("Failed to start generation");
        setGenerating(false);
      }
    },
    [runId, configDirty, handleSaveConfig, startPolling],
  );

  const handleCancel = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${runId}/genie-engine/generate/cancel`, {
        method: "POST",
      });
      if (res.ok) {
        stopPolling();
        setGenerating(false);
        setLastError(null);
        setLastErrorType(null);
        toast.info("Generation cancelled");
      }
    } catch {
      toast.error("Failed to cancel generation");
    }
  }, [runId, stopPolling]);

  if (configLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              Engine v{configVersion}
            </Badge>
            {configDirty && (
              <Badge variant="secondary" className="text-xs text-amber-600">
                Unsaved changes
              </Badge>
            )}
            {config.llmRefinement && (
              <Badge className="bg-violet-500/10 text-violet-600 text-xs">LLM Enabled</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!engineEnabled && (
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                Engine Disabled
              </Badge>
            )}
            {configDirty && engineEnabled && (
              <Button variant="outline" size="sm" onClick={handleSaveConfig}>
                Save Config
              </Button>
            )}
            {selectedDomains.size > 0 ? (
              <Button
                size="sm"
                onClick={() => handleRegenerate([...selectedDomains])}
                disabled={generating || !engineEnabled}
                className="bg-violet-600 hover:bg-violet-700"
              >
                {generating
                  ? "Generating..."
                  : `Regenerate ${selectedDomains.size} Domain${selectedDomains.size !== 1 ? "s" : ""}`}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => handleRegenerate()}
                disabled={generating || !engineEnabled}
                className="bg-violet-600 hover:bg-violet-700"
              >
                {generating ? "Generating..." : "Regenerate All"}
              </Button>
            )}
          </div>
        </div>

        {/* Domain picker */}
        {domains.length > 1 && !generating && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Domains:</span>
            {domains.map((d) => (
              <label
                key={d}
                className="flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors hover:bg-muted/50 data-[selected=true]:border-violet-400 data-[selected=true]:bg-violet-500/10"
                data-selected={selectedDomains.has(d)}
              >
                <Checkbox
                  checked={selectedDomains.has(d)}
                  onCheckedChange={(checked) => {
                    setSelectedDomains((prev) => {
                      const next = new Set(prev);
                      if (checked) next.add(d);
                      else next.delete(d);
                      return next;
                    });
                  }}
                  className="h-3 w-3"
                />
                {d}
              </label>
            ))}
            {selectedDomains.size > 0 && (
              <button
                onClick={() => setSelectedDomains(new Set())}
                className="text-[10px] text-muted-foreground underline hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {generating && (
          <div className="space-y-1.5" aria-live="polite">
            <div className="flex items-center gap-2">
              <Progress value={genProgress} className="h-2 flex-1" />
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                aria-label="Cancel generation"
              >
                <Square className="h-3 w-3" />
              </Button>
            </div>
            {domainStatuses.length > 0 ? (
              <GenieEngineProgressDetail
                domainStatuses={domainStatuses}
                elapsedMs={elapsedMs}
                now={pollTs}
              />
            ) : (
              <p className="text-[10px] text-muted-foreground">
                {totalDomains > 0 && (
                  <span className="font-medium">
                    [{completedDomains} of {totalDomains} complete]{" "}
                  </span>
                )}
                {genMessage}
              </p>
            )}
          </div>
        )}

        {lastError && !generating && (
          <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium text-destructive">
                {lastErrorType === "auth" ? "Database session expired" : "Generation failed"}
              </p>
              <p className="text-xs text-muted-foreground">
                {lastErrorType === "auth"
                  ? "The database credential expired during generation. Your pipeline data is safe — click Retry to resume."
                  : lastError}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs"
                onClick={() => handleRegenerate()}
                disabled={!engineEnabled}
              >
                <RefreshCw className="h-3 w-3" />
                Retry
              </Button>
              <button
                onClick={() => {
                  setLastError(null);
                  setLastErrorType(null);
                }}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Dismiss error"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="existing">Existing Assets</TabsTrigger>
          <TabsTrigger value="config">Engine Config</TabsTrigger>
          <TabsTrigger value="preview">Space Preview</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <GenieSpacesTab
            runId={runId}
            generating={generating}
            completedDomainNames={completedDomainNames}
            refreshKey={refreshKey}
            engineEnabled={engineEnabled}
          />
        </TabsContent>

        <TabsContent value="existing" className="mt-4">
          <ExistingAssetsTab runId={runId} />
        </TabsContent>

        <TabsContent value="config" className="mt-4">
          <GenieConfigEditor
            config={config}
            onChange={handleConfigChange}
            disabled={!engineEnabled}
          />
        </TabsContent>

        <TabsContent value="preview" className="mt-4">
          <GenieSpacePreview runId={runId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
