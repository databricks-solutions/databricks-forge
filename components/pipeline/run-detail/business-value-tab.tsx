"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import type {
  ValueEstimate,
  RoadmapPhaseAssignment,
  ExecutiveSynthesis,
  StakeholderProfile,
} from "@/lib/domain/types";

interface BusinessValueData {
  estimates: ValueEstimate[];
  valueSummary: {
    totalLow: number;
    totalMid: number;
    totalHigh: number;
    count: number;
    byType: Record<string, { low: number; mid: number; high: number; count: number }>;
  };
  roadmapPhases: RoadmapPhaseAssignment[];
  stakeholders: StakeholderProfile[];
  synthesis: ExecutiveSynthesis | null;
  degradedSteps?: string[];
}

export function BusinessValueTab({ runId }: { runId: string }) {
  const [data, setData] = useState<BusinessValueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(() => {
    return fetch(`/api/runs/${runId}/business-value`)
      .then((r) => r.json())
      .then((d: BusinessValueData) => {
        setData(d);
        return d;
      })
      .catch(() => {
        setData(null);
        return null;
      });
  }, [runId]);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchData]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/runs/${runId}/business-value/rerun`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Refresh failed" }));
        throw new Error(body.error || "Refresh failed");
      }
      toast.success("Business value refresh started");

      pollRef.current = setInterval(async () => {
        const d = await fetchData();
        if (d && d.estimates.length > 0) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setRefreshing(false);
          toast.success("Business value analysis refreshed");
        }
      }, 3000);

      // Safety timeout: stop polling after 3 minutes
      setTimeout(() => {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setRefreshing(false);
          fetchData();
        }
      }, 180_000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
      setRefreshing(false);
    }
  }, [runId, fetchData]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if ((!data || data.estimates.length === 0) && !refreshing) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">
            No business value data available for this run. Business value analysis runs
            automatically after the scoring step completes.
          </p>
          <Link
            href="/business-value"
            className="mt-4 inline-block text-sm text-primary hover:underline"
          >
            View Portfolio Overview
          </Link>
        </CardContent>
      </Card>
    );
  }

  const { valueSummary, roadmapPhases, synthesis, stakeholders } = data ?? {
    valueSummary: { totalLow: 0, totalMid: 0, totalHigh: 0, count: 0, byType: {} },
    roadmapPhases: [] as RoadmapPhaseAssignment[],
    stakeholders: [] as StakeholderProfile[],
    synthesis: null,
  };
  const phaseDistribution = {
    quick_wins: roadmapPhases.filter((p) => p.phase === "quick_wins").length,
    foundation: roadmapPhases.filter((p) => p.phase === "foundation").length,
    transformation: roadmapPhases.filter((p) => p.phase === "transformation").length,
  };

  return (
    <div className="space-y-6">
      {/* Header with Refresh */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Business Value Analysis</h3>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={refreshing}>
              {refreshing ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              )}
              {refreshing ? "Refreshing..." : "Refresh Analysis"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Refresh business value analysis?</AlertDialogTitle>
              <AlertDialogDescription>
                This will regenerate all financial estimates, roadmap phases, executive synthesis,
                and stakeholder profiles using the latest AI models. Value tracking and value
                captures you have entered will be preserved.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleRefresh}>Refresh</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {refreshing && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-4 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">
            Regenerating business value analysis... This typically takes 30&ndash;60 seconds.
          </span>
        </div>
      )}

      {!refreshing && data?.degradedSteps?.includes("financial-quantification") && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
              Financial estimates incomplete
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-amber-700/80 dark:text-amber-200/80">
              The reasoning model returned empty content for one or more use case batches.
              Click <em>Refresh Analysis</em> above to retry -- the run will rotate to a
              fallback endpoint and split into smaller batches.
            </p>
          </div>
        </div>
      )}

      {/* Value Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Estimated Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(valueSummary.totalMid)}</p>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(valueSummary.totalLow)} &ndash;{" "}
              {formatCurrency(valueSummary.totalHigh)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Use Cases Valued
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{valueSummary.count}</p>
            <p className="text-xs text-muted-foreground">with financial estimates</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Quick Wins</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{phaseDistribution.quick_wins}</p>
            <p className="text-xs text-muted-foreground">0&ndash;3 months</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Stakeholders
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stakeholders.length}</p>
            <p className="text-xs text-muted-foreground">
              {stakeholders.filter((s) => s.isChampion).length} champions identified
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Executive Synthesis */}
      {synthesis && synthesis.keyFindings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Executive Synthesis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="mb-2 text-sm font-semibold">Key Findings</h4>
              <div className="space-y-2">
                {synthesis.keyFindings.map((f, i) => (
                  <div
                    key={i}
                    className={`rounded-md border-l-4 p-3 ${
                      f.severity === "opportunity"
                        ? "border-l-green-500 bg-green-50 dark:bg-green-950/20"
                        : f.severity === "risk"
                          ? "border-l-red-500 bg-red-50 dark:bg-red-950/20"
                          : "border-l-blue-500 bg-blue-50 dark:bg-blue-950/20"
                    }`}
                  >
                    <p className="text-sm font-medium">{f.title}</p>
                    <p className="text-xs text-muted-foreground">{f.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {synthesis.strategicRecommendations.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-semibold">Strategic Recommendations</h4>
                <div className="space-y-2">
                  {synthesis.strategicRecommendations.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-md border p-3">
                      <Badge
                        variant={r.priority === "high" ? "destructive" : "secondary"}
                        className="mt-0.5 shrink-0"
                      >
                        {r.priority}
                      </Badge>
                      <div>
                        <p className="text-sm font-medium">{r.title}</p>
                        <p className="text-xs text-muted-foreground">{r.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {synthesis.riskCallouts.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-semibold">Risk Callouts</h4>
                <div className="space-y-2">
                  {synthesis.riskCallouts.map((r, i) => (
                    <div
                      key={i}
                      className="rounded-md border-l-4 border-l-amber-500 bg-amber-50 p-3 dark:bg-amber-950/20"
                    >
                      <p className="text-sm font-medium">{r.title}</p>
                      <p className="text-xs text-muted-foreground">{r.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Value by Type */}
      {Object.keys(valueSummary.byType).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Value by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(valueSummary.byType).map(([type, vals]) => (
                <div key={type} className="rounded-lg border p-4">
                  <p className="text-xs font-medium text-muted-foreground capitalize">
                    {type.replace(/_/g, " ")}
                  </p>
                  <p className="text-lg font-bold">{formatCurrency(vals.mid)}</p>
                  <p className="text-xs text-muted-foreground">{vals.count} use cases</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Roadmap Phase Distribution */}
      {roadmapPhases.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Roadmap Phase Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/20">
                <p className="text-sm font-medium">Quick Wins</p>
                <p className="text-2xl font-bold text-green-700 dark:text-green-400">
                  {phaseDistribution.quick_wins}
                </p>
                <p className="text-xs text-muted-foreground">0&ndash;3 months</p>
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/20">
                <p className="text-sm font-medium">Foundation</p>
                <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">
                  {phaseDistribution.foundation}
                </p>
                <p className="text-xs text-muted-foreground">3&ndash;9 months</p>
              </div>
              <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 dark:border-purple-900 dark:bg-purple-950/20">
                <p className="text-sm font-medium">Transformation</p>
                <p className="text-2xl font-bold text-purple-700 dark:text-purple-400">
                  {phaseDistribution.transformation}
                </p>
                <p className="text-xs text-muted-foreground">9&ndash;18 months</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="text-center">
        <Link href="/business-value" className="text-sm text-primary hover:underline">
          View full Business Value Portfolio
        </Link>
      </div>
    </div>
  );
}
