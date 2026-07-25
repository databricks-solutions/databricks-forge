"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { toast } from "sonner";
import type { DashboardRecommendation, TrackedDashboard } from "@/lib/dashboard/types";
import { findTrackedDashboardForDomain } from "@/lib/dashboard/domain-groups";
import type { DashboardDesignV2 } from "@/lib/dashboard/design-ir";
import { DashboardDeployModal } from "./dashboard-deploy-modal";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DashboardsTabProps {
  runId: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DashboardsTab({ runId }: DashboardsTabProps) {
  const [recommendations, setRecommendations] = useState<DashboardRecommendation[]>([]);
  const [tracked, setTracked] = useState<TrackedDashboard[]>([]);
  const [databricksHost, setDatabricksHost] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailDomain, setDetailDomain] = useState<string | null>(null);

  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [deployModalDomains, setDeployModalDomains] = useState<DashboardRecommendation[]>([]);

  const [regeneratingDomain, setRegeneratingDomain] = useState<string | null>(null);

  // Generation progress
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [genMessage, setGenMessage] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  const fetchRecommendations = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/runs/${runId}/dashboard-recommendations`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setRecommendations(data.recommendations ?? []);
      setTracked(data.tracked ?? []);
      setDatabricksHost(data.databricksHost ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard recommendations");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    fetchRecommendations();
  }, [fetchRecommendations]);

  // -------------------------------------------------------------------------
  // Generation progress polling
  // -------------------------------------------------------------------------

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    setGenerating(true);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/runs/${runId}/dashboard-engine/generate/status`);
        if (!res.ok) return;
        const data = await res.json();
        setGenProgress(data.percent ?? 0);
        setGenMessage(data.message ?? "");

        if (data.status === "completed" || data.status === "completed_with_failures") {
          stopPolling();
          setGenerating(false);
          setRegeneratingDomain(null);
          setGenProgress(100);
          setGenMessage("");
          if (data.status === "completed_with_failures") {
            const message = data.message ?? "Some dashboard domains failed validation";
            setEngineError(message);
            toast.warning(message);
          } else {
            setEngineError(null);
            toast.success("Dashboard generation complete");
          }
          fetchRecommendations();
        } else if (data.status === "failed") {
          stopPolling();
          setGenerating(false);
          setRegeneratingDomain(null);
          setGenMessage("");
          setEngineError(data.error ?? "Dashboard generation failed");
          toast.error(`Dashboard generation failed: ${data.error ?? "unknown error"}`);
          fetchRecommendations();
        }
      } catch {
        /* ignore transient poll errors */
      }
    }, 2000);
  }, [runId, stopPolling, fetchRecommendations]);

  // Auto-detect in-progress or failed generation on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/runs/${runId}/dashboard-engine/generate/status`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data.status === "generating") {
          setGenerating(true);
          setGenProgress(data.percent ?? 0);
          setGenMessage(data.message ?? "");
          startPolling();
        } else if (data.status === "completed_with_failures") {
          setEngineError(data.message ?? "Some dashboard domains failed validation");
        } else if (data.status === "failed") {
          setEngineError(data.error ?? "Dashboard generation failed. Try regenerating.");
        }
      } catch {
        /* no active job */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, startPolling]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function getTrackedStatus(domain: string): TrackedDashboard | undefined {
    // Same resolution the deploy route uses, so a dashboard tracked under a
    // pre-canonicalization alias still shows as deployed here.
    return findTrackedDashboardForDomain(tracked, domain);
  }

  function toggleSelect(domain: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === recommendations.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(recommendations.map((r) => r.domain)));
    }
  }

  // -------------------------------------------------------------------------
  // Deploy
  // -------------------------------------------------------------------------

  function handleDeploySelected() {
    const selectedRecs = recommendations.filter((r) => selected.has(r.domain));
    if (selectedRecs.length === 0) {
      toast.error("No dashboards selected");
      return;
    }
    setDeployModalDomains(selectedRecs);
    setDeployModalOpen(true);
  }

  function handleDeploySingle(rec: DashboardRecommendation) {
    setDeployModalDomains([rec]);
    setDeployModalOpen(true);
  }

  // -------------------------------------------------------------------------
  // Regenerate
  // -------------------------------------------------------------------------

  async function handleRegenerateDomain(domain: string) {
    setRegeneratingDomain(domain);
    try {
      const res = await fetch(`/api/runs/${runId}/dashboard-engine/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains: [domain] }),
      });
      if (!res.ok) throw new Error("Regeneration failed");
      toast.success(`Regenerating dashboard for ${domain}...`);
      setGenerating(true);
      startPolling();
    } catch (err) {
      setRegeneratingDomain(null);
      toast.error(err instanceof Error ? err.message : "Regeneration failed");
    }
  }

  // -------------------------------------------------------------------------
  // Detail rec
  // -------------------------------------------------------------------------

  const detailRec = detailDomain ? recommendations.find((r) => r.domain === detailDomain) : null;

  const detailDesign: DashboardDesignV2 | null = detailRec?.dashboardDesign ?? null;
  const detailWidgets = detailDesign
    ? [
        ...detailDesign.pages.flatMap((page) => page.widgets),
        ...[
          ...detailDesign.globalFilters,
          ...detailDesign.pages.flatMap((page) => page.filters),
        ].map((filter) => ({
          type: filter.type,
          title: filter.title,
          datasetName: filter.bindings.map((binding) => binding.datasetName).join(", "),
          fields: filter.bindings.map((binding) => ({ name: binding.fieldName })),
        })),
      ]
    : [];

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Dashboards</CardTitle>
          <CardDescription className="text-red-500">{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={async () => {
              setError(null);
              try {
                await fetch(`/api/runs/${runId}/dashboard-engine/generate`, { method: "POST" });
                toast.success("Dashboard generation started");
                setGenerating(true);
                startPolling();
              } catch {
                toast.error("Failed to start dashboard generation");
              }
            }}
          >
            Retry Generation
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (recommendations.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Dashboards</CardTitle>
          <CardDescription>
            {generating
              ? "Generating dashboard recommendations..."
              : engineError
                ? engineError
                : "No dashboard recommendations generated yet. Dashboard recommendations are created automatically when the pipeline completes."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {generating ? (
            <div className="space-y-1" aria-live="polite">
              <Progress value={genProgress} className="h-2" />
              <p className="text-[10px] text-muted-foreground">{genMessage}</p>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={async () => {
                setEngineError(null);
                try {
                  await fetch(`/api/runs/${runId}/dashboard-engine/generate`, { method: "POST" });
                  toast.success("Dashboard generation started");
                  setGenerating(true);
                  startPolling();
                } catch {
                  toast.error("Failed to start dashboard generation");
                }
              }}
            >
              {engineError ? "Retry Generation" : "Generate Dashboards"}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>AI/BI Dashboard Recommendations</CardTitle>
            <CardDescription>
              {recommendations.length} dashboard{recommendations.length !== 1 ? "s" : ""} generated
              {" -- "}select and deploy to your Databricks workspace
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={generating}
              onClick={async () => {
                try {
                  await fetch(`/api/runs/${runId}/dashboard-engine/generate`, { method: "POST" });
                  toast.success("Regenerating all dashboards...");
                  setGenerating(true);
                  startPolling();
                } catch {
                  toast.error("Failed to start regeneration");
                }
              }}
            >
              {generating ? "Generating..." : "Regenerate All"}
            </Button>
            <Button size="sm" disabled={selected.size === 0} onClick={handleDeploySelected}>
              Deploy Selected ({selected.size})
            </Button>
          </div>
        </CardHeader>

        {generating && (
          <div className="space-y-1 px-6 pb-4" aria-live="polite">
            <Progress value={genProgress} className="h-2" />
            <p className="text-[10px] text-muted-foreground">{genMessage}</p>
          </div>
        )}

        {!generating && engineError && (
          <div
            className="mx-6 mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
            role="status"
          >
            {engineError}
          </div>
        )}

        <CardContent>
          {/* Table header */}
          <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-4 px-2 py-2 text-sm font-medium text-muted-foreground border-b">
            <Checkbox
              checked={selected.size === recommendations.length && recommendations.length > 0}
              onCheckedChange={toggleSelectAll}
            />
            <span>Domain</span>
            <span className="text-center">Datasets</span>
            <span className="text-center">Widgets</span>
            <span className="text-center">Status</span>
            <span className="text-right">Actions</span>
          </div>

          {/* Table rows */}
          {recommendations.map((rec) => {
            const trackedDash = getTrackedStatus(rec.domain);
            const isDeployed = !!trackedDash;

            return (
              <div
                key={rec.domain}
                className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-4 px-2 py-3 items-center hover:bg-muted/50 cursor-pointer border-b last:border-b-0"
                onClick={() => setDetailDomain(rec.domain)}
              >
                <Checkbox
                  checked={selected.has(rec.domain)}
                  onCheckedChange={() => toggleSelect(rec.domain)}
                  onClick={(e) => e.stopPropagation()}
                />
                <div>
                  <div className="flex items-center gap-1.5 font-medium text-sm">
                    {rec.title}
                    {rec.recommendationType === "enhancement" && (
                      <Badge variant="outline" className="text-[9px] border-sky-400 text-sky-600">
                        Enhancement
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {rec.subdomains.length > 0 ? rec.subdomains.join(", ") : rec.domain}
                  </div>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {rec.datasetCount}
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  {rec.widgetCount}
                </Badge>
                <div>
                  {isDeployed ? (
                    <Badge variant="default" className="bg-green-600 text-xs">
                      Deployed
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">
                      Ready
                    </Badge>
                  )}
                </div>
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button variant="outline" size="sm" onClick={() => handleDeploySingle(rec)}>
                    {isDeployed ? "Update" : "Deploy"}
                  </Button>
                  {isDeployed && trackedDash?.dashboardUrl && (
                    <Button variant="ghost" size="sm" asChild>
                      <a href={trackedDash.dashboardUrl} target="_blank" rel="noopener noreferrer">
                        Open
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Detail Sheet */}
      <Sheet open={!!detailDomain} onOpenChange={(open) => !open && setDetailDomain(null)}>
        <SheetContent className="w-[600px] sm:max-w-[600px] overflow-y-auto">
          {detailRec && (
            <>
              <SheetHeader>
                <SheetTitle>{detailRec.title}</SheetTitle>
                <SheetDescription>{detailRec.description}</SheetDescription>
                {detailRec.recommendationType === "enhancement" && (
                  <Badge className="mt-1 w-fit bg-sky-500/10 text-sky-600 border-sky-500/30">
                    Enhancement of existing dashboard
                  </Badge>
                )}
              </SheetHeader>

              <div className="mt-6 space-y-4">
                {detailRec.changeSummary && (
                  <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
                    <p className="text-xs font-medium text-sky-700 dark:text-sky-400">
                      Changes vs Existing
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{detailRec.changeSummary}</p>
                  </div>
                )}

                {/* Stats */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 bg-muted rounded-md text-center">
                    <div className="text-2xl font-bold">{detailRec.datasetCount}</div>
                    <div className="text-xs text-muted-foreground">Datasets</div>
                  </div>
                  <div className="p-3 bg-muted rounded-md text-center">
                    <div className="text-2xl font-bold">{detailRec.widgetCount}</div>
                    <div className="text-xs text-muted-foreground">Widgets</div>
                  </div>
                  <div className="p-3 bg-muted rounded-md text-center">
                    <div className="text-2xl font-bold">{detailRec.useCaseIds.length}</div>
                    <div className="text-xs text-muted-foreground">Use Cases</div>
                  </div>
                </div>

                <Separator />

                {/* Dashboard Design Detail */}
                {detailDesign && (
                  <Accordion type="multiple" defaultValue={["datasets", "widgets"]}>
                    {/* Datasets */}
                    <AccordionItem value="datasets">
                      <AccordionTrigger>
                        SQL Datasets ({detailDesign.datasets.length})
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-3">
                          {detailDesign.datasets.map((ds) => (
                            <div key={ds.name} className="border rounded-md p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="font-medium text-sm">{ds.displayName}</span>
                                <Badge variant="outline" className="text-xs">
                                  {ds.purpose}
                                </Badge>
                              </div>
                              <pre className="text-xs bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap font-mono">
                                {ds.sql}
                              </pre>
                            </div>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>

                    {/* Widgets */}
                    <AccordionItem value="widgets">
                      <AccordionTrigger>Visualisations ({detailWidgets.length})</AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2">
                          {detailWidgets.map((w, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-3 py-2 border-b last:border-b-0"
                            >
                              <Badge
                                variant="secondary"
                                className="text-xs min-w-[60px] justify-center"
                              >
                                {w.type}
                              </Badge>
                              <div>
                                <div className="text-sm font-medium">{w.title}</div>
                                <div className="text-xs text-muted-foreground">
                                  Dataset: {w.datasetName} | Fields:{" "}
                                  {w.fields.map((f) => f.name).join(", ")}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>

                    {/* Raw Lakeview JSON */}
                    <AccordionItem value="json">
                      <AccordionTrigger>Lakeview JSON</AccordionTrigger>
                      <AccordionContent>
                        <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap font-mono max-h-96">
                          {(() => {
                            try {
                              return JSON.stringify(
                                JSON.parse(detailRec.serializedDashboard),
                                null,
                                2,
                              );
                            } catch {
                              return detailRec.serializedDashboard;
                            }
                          })()}
                        </pre>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                )}
              </div>

              <SheetFooter className="mt-6 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={regeneratingDomain === detailRec.domain}
                  onClick={() => handleRegenerateDomain(detailRec.domain)}
                >
                  {regeneratingDomain === detailRec.domain ? "Regenerating..." : "Regenerate"}
                </Button>
                <Button size="sm" onClick={() => handleDeploySingle(detailRec)}>
                  {getTrackedStatus(detailRec.domain) ? "Update Dashboard" : "Deploy Dashboard"}
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Deploy Modal */}
      <DashboardDeployModal
        open={deployModalOpen}
        onOpenChange={setDeployModalOpen}
        runId={runId}
        recommendations={deployModalDomains}
        databricksHost={databricksHost}
        onDeployComplete={() => {
          fetchRecommendations();
          setSelected(new Set());
        }}
      />
    </>
  );
}
