"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { resilientFetch } from "@/lib/resilient-fetch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeftRight,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronDown,
  FileCode2,
  Zap,
  Clock,
  Hash,
} from "lucide-react";
import type { PipelineRun } from "@/lib/domain/types";
import type {
  RunComparisonResult,
  PromptDiff,
  RunMetrics,
  UseCaseAlignmentEntry,
  StepMetrics,
} from "@/lib/lakebase/run-comparison";
import { PageHeader } from "@/components/page-header";
import { InfoTip } from "@/components/ui/info-tip";
import { COMPARE } from "@/lib/help-text";
import { SemanticOverlap } from "@/components/compare/semantic-overlap";

export default function ComparePage() {
  return (
    <Suspense>
      <ComparePageInner />
    </Suspense>
  );
}

function ComparePageInner() {
  const searchParams = useSearchParams();
  const runAParam = searchParams?.get("runA") ?? searchParams?.get("run") ?? "";
  const runBParam = searchParams?.get("runB") ?? "";

  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [runA, setRunA] = useState(runAParam);
  const [runB, setRunB] = useState(runBParam);
  const [compareData, setCompareData] = useState<RunComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [runsLoading, setRunsLoading] = useState(true);

  useEffect(() => {
    resilientFetch("/api/runs?limit=100")
      .then((r) => r.json())
      .then((data) => {
        const completedRuns = (data.runs as PipelineRun[]).filter((r) => r.status === "completed");
        setRuns(completedRuns);
      })
      .catch(() => setRuns([]))
      .finally(() => setRunsLoading(false));
  }, []);

  const fetchComparison = useCallback(async () => {
    if (!runA || !runB || runA === runB) return;
    setLoading(true);
    try {
      const res = await resilientFetch(`/api/runs/compare?runA=${runA}&runB=${runB}`);
      if (res.ok) {
        setCompareData(await res.json());
      }
    } catch {
      // handled silently
    } finally {
      setLoading(false);
    }
  }, [runA, runB]);

  useEffect(() => {
    if (runA && runB && runA !== runB) {
      fetchComparison();
    }
  }, [runA, runB, fetchComparison]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      <PageHeader
        title="Compare Runs"
        subtitle="Side-by-side comparison of two discovery runs including prompt version diffs"
        actions={
          <div className="flex items-center gap-2">
            {compareData && (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/runs/compare/export?runA=${runA}&runB=${runB}`);
                    if (!res.ok) throw new Error("Export failed");
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `forge_comparison_${runA.substring(0, 8)}_vs_${runB.substring(0, 8)}.xlsx`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  } catch {
                    // Silent fail — toast not available here
                  }
                }}
              >
                Export Comparison
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link href="/runs">
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back to Runs
              </Link>
            </Button>
          </div>
        }
      />

      {/* Run Selectors */}
      {!runsLoading && runs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <ArrowLeftRight className="mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="font-medium">No completed runs to compare</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              You need at least two completed discovery runs to use the comparison tool.
            </p>
            <Button className="mt-4" asChild>
              <Link href="/configure">Start a New Discovery</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[200px]">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Run A (baseline)</p>
                {runsLoading ? (
                  <Skeleton className="h-10" />
                ) : (
                  <Select value={runA} onValueChange={setRunA}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a run..." />
                    </SelectTrigger>
                    <SelectContent>
                      {runs.map((r) => (
                        <SelectItem key={r.runId} value={r.runId}>
                          {r.config.businessName} ({new Date(r.createdAt).toLocaleDateString()})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <ArrowLeftRight className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1 min-w-[200px]">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Run B (comparison)
                </p>
                {runsLoading ? (
                  <Skeleton className="h-10" />
                ) : (
                  <Select value={runB} onValueChange={setRunB}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a run..." />
                    </SelectTrigger>
                    <SelectContent>
                      {runs.map((r) => (
                        <SelectItem key={r.runId} value={r.runId}>
                          {r.config.businessName} ({new Date(r.createdAt).toLocaleDateString()})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="space-y-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-32" />
        </div>
      )}

      {!loading && runA && runB && runA === runB && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Please select two different runs to compare.</p>
          </CardContent>
        </Card>
      )}

      {!loading && compareData && (
        <>
          {/* Side-by-side run summaries */}
          <div className="grid gap-4 md:grid-cols-2">
            <RunSummaryCard
              label="Run A (baseline)"
              run={compareData.runA.run}
              metrics={compareData.runA.metrics}
            />
            <RunSummaryCard
              label="Run B (comparison)"
              run={compareData.runB.run}
              metrics={compareData.runB.metrics}
            />
          </div>

          {/* Metric Comparison */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                Metric Comparison
                <InfoTip tip={COMPARE.metricComparison} />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <CompareRow
                  label="Use Cases"
                  valueA={compareData.runA.metrics.useCaseCount}
                  valueB={compareData.runB.metrics.useCaseCount}
                />
                <CompareRow
                  label="Avg Score"
                  valueA={compareData.runA.metrics.avgOverallScore}
                  valueB={compareData.runB.metrics.avgOverallScore}
                  suffix="%"
                />
                <CompareRow
                  label="Domains"
                  valueA={compareData.runA.metrics.domains.length}
                  valueB={compareData.runB.metrics.domains.length}
                />
                <CompareRow
                  label="AI Use Cases"
                  valueA={compareData.runA.metrics.aiCount}
                  valueB={compareData.runB.metrics.aiCount}
                />
                <CompareRow
                  label="Statistical Use Cases"
                  valueA={compareData.runA.metrics.statisticalCount}
                  valueB={compareData.runB.metrics.statisticalCount}
                />
                <CompareRow
                  label="SQL Success Rate"
                  valueA={compareData.runA.metrics.sqlSuccessRate}
                  valueB={compareData.runB.metrics.sqlSuccessRate}
                  suffix="%"
                />
                <CompareRow
                  label="Total Tokens"
                  valueA={compareData.runA.metrics.totalTokens}
                  valueB={compareData.runB.metrics.totalTokens}
                  icon={<Hash className="h-3.5 w-3.5 text-muted-foreground" />}
                />
                <CompareRow
                  label="Total Duration"
                  valueA={Math.round(compareData.runA.metrics.totalDurationMs / 1000)}
                  valueB={Math.round(compareData.runB.metrics.totalDurationMs / 1000)}
                  suffix="s"
                  icon={<Clock className="h-3.5 w-3.5 text-muted-foreground" />}
                />
              </div>
            </CardContent>
          </Card>

          {/* Step-Level Metrics */}
          {compareData.stepMetrics.length > 0 && (
            <StepMetricsCard steps={compareData.stepMetrics} />
          )}

          {/* Prompt Version Diffs */}
          <PromptDiffsCard diffs={compareData.promptDiffs} />

          {/* Use Case Overlap */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                Use Case Overlap
                <InfoTip tip={COMPARE.useCaseOverlap} />
              </CardTitle>
              <CardDescription>Matched by exact name comparison</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="rounded-md border p-4">
                  <p className="text-2xl font-bold text-blue-600">
                    {compareData.overlap.uniqueACount}
                  </p>
                  <p className="text-xs text-muted-foreground">Unique to Run A</p>
                </div>
                <div className="rounded-md border p-4">
                  <p className="text-2xl font-bold text-green-600">
                    {compareData.overlap.sharedCount}
                  </p>
                  <p className="text-xs text-muted-foreground">Shared</p>
                </div>
                <div className="rounded-md border p-4">
                  <p className="text-2xl font-bold text-violet-600">
                    {compareData.overlap.uniqueBCount}
                  </p>
                  <p className="text-xs text-muted-foreground">Unique to Run B</p>
                </div>
              </div>
              {compareData.overlap.sharedNames.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-semibold text-muted-foreground">
                    Shared Use Cases
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {compareData.overlap.sharedNames.map((name) => (
                      <Badge key={name} variant="secondary" className="text-xs">
                        {name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Use Case Alignment (fuzzy) */}
          {compareData.useCaseAlignment.length > 0 && (
            <UseCaseAlignmentCard entries={compareData.useCaseAlignment} />
          )}

          {/* Semantic Overlap (embedding-based) */}
          <SemanticOverlap runA={runA} runB={runB} />

          {/* Config Diff */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                Configuration Differences
                <InfoTip tip={COMPARE.configDiff} />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <ConfigDiffRow
                  label="Business Name"
                  a={compareData.runA.run.config.businessName}
                  b={compareData.runB.run.config.businessName}
                />
                <ConfigDiffRow
                  label="UC Metadata"
                  a={compareData.runA.run.config.ucMetadata}
                  b={compareData.runB.run.config.ucMetadata}
                />
                <ConfigDiffRow
                  label="AI Model"
                  a={compareData.runA.run.config.aiModel}
                  b={compareData.runB.run.config.aiModel}
                />
                <ConfigDiffRow
                  label="Discovery Depth"
                  a={compareData.runA.run.config.discoveryDepth ?? "balanced"}
                  b={compareData.runB.run.config.discoveryDepth ?? "balanced"}
                />
                <ConfigDiffRow
                  label="Priorities"
                  a={compareData.runA.run.config.businessPriorities.join(", ")}
                  b={compareData.runB.run.config.businessPriorities.join(", ")}
                />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RunSummaryCard({
  label,
  run,
  metrics,
}: {
  label: string;
  run: PipelineRun;
  metrics: RunMetrics;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-sm font-medium">{label}</CardTitle>
          </div>
          <Badge variant="secondary">{run.status}</Badge>
        </div>
        <CardDescription>
          <Link href={`/runs/${run.runId}`} className="hover:underline">
            {run.config.businessName}
          </Link>
          <span className="ml-2 text-xs">{new Date(run.createdAt).toLocaleDateString()}</span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 text-center">
          <MetricCell value={String(metrics.useCaseCount)} label="Use Cases" />
          <MetricCell value={`${metrics.avgOverallScore}%`} label="Avg Score" />
          <MetricCell value={String(metrics.domains.length)} label="Domains" />
          <MetricCell value={`${metrics.sqlSuccessRate}%`} label="SQL Success" />
          <MetricCell
            value={metrics.totalTokens > 0 ? `${(metrics.totalTokens / 1000).toFixed(0)}k` : "—"}
            label="Tokens"
          />
          <MetricCell
            value={
              metrics.totalDurationMs > 0 ? `${Math.round(metrics.totalDurationMs / 1000)}s` : "—"
            }
            label="Duration"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function MetricCell({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-md bg-muted/50 p-2">
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function CompareRow({
  label,
  valueA,
  valueB,
  suffix = "",
  icon,
}: {
  label: string;
  valueA: number;
  valueB: number;
  suffix?: string;
  icon?: React.ReactNode;
}) {
  const diff = valueB - valueA;
  return (
    <div className="flex items-center justify-between rounded-md border p-2.5">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm font-mono">
          {valueA.toLocaleString()}
          {suffix}
        </span>
        <div className="flex items-center gap-1">
          {diff > 0 ? (
            <TrendingUp className="h-3.5 w-3.5 text-green-500" />
          ) : diff < 0 ? (
            <TrendingDown className="h-3.5 w-3.5 text-red-500" />
          ) : (
            <Minus className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span
            className={`text-xs font-medium ${
              diff > 0 ? "text-green-600" : diff < 0 ? "text-red-600" : "text-muted-foreground"
            }`}
          >
            {diff > 0 ? `+${diff.toLocaleString()}` : diff === 0 ? "=" : diff.toLocaleString()}
          </span>
        </div>
        <span className="text-sm font-mono">
          {valueB.toLocaleString()}
          {suffix}
        </span>
      </div>
    </div>
  );
}

function StepMetricsCard({ steps }: { steps: StepMetrics[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Clock className="h-4 w-4 text-blue-500" />
          Step-Level Comparison
          <InfoTip tip={COMPARE.stepComparison} />
        </CardTitle>
        <CardDescription>Per-pipeline-step duration, token usage, and success rate</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5">
          <div className="grid grid-cols-[1fr_repeat(4,80px)] gap-2 text-xs font-semibold text-muted-foreground px-2">
            <span>Step</span>
            <span className="text-center">Duration</span>
            <span className="text-center">Tokens</span>
            <span className="text-center">LLM Calls</span>
            <span className="text-center">Success</span>
          </div>
          <Separator />
          {steps.map((step) => {
            const fmtDur = (ms: number | null) => (ms != null ? `${(ms / 1000).toFixed(1)}s` : "—");
            const fmtTok = (t: number) => (t > 0 ? `${(t / 1000).toFixed(1)}k` : "—");
            const durDiff =
              step.durationMsA != null && step.durationMsB != null
                ? step.durationMsB - step.durationMsA
                : null;
            const tokDiff = step.tokensB - step.tokensA;

            return (
              <div
                key={step.step}
                className="grid grid-cols-[1fr_repeat(4,80px)] gap-2 items-center rounded-md border px-2 py-1.5"
              >
                <span className="text-xs font-medium truncate">{step.step}</span>
                <div className="text-center text-xs font-mono">
                  <span>{fmtDur(step.durationMsA)}</span>
                  <span className="text-muted-foreground mx-0.5">/</span>
                  <span>{fmtDur(step.durationMsB)}</span>
                  {durDiff != null && durDiff !== 0 && (
                    <span
                      className={`block text-[10px] ${
                        durDiff < 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {durDiff < 0 ? "" : "+"}
                      {(durDiff / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
                <div className="text-center text-xs font-mono">
                  <span>{fmtTok(step.tokensA)}</span>
                  <span className="text-muted-foreground mx-0.5">/</span>
                  <span>{fmtTok(step.tokensB)}</span>
                  {tokDiff !== 0 && (
                    <span
                      className={`block text-[10px] ${
                        tokDiff < 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {tokDiff < 0 ? "" : "+"}
                      {(tokDiff / 1000).toFixed(1)}k
                    </span>
                  )}
                </div>
                <div className="text-center text-xs font-mono">
                  {step.callsA}
                  <span className="text-muted-foreground mx-0.5">/</span>
                  {step.callsB}
                </div>
                <div className="text-center text-xs font-mono">
                  <span className={step.successRateA < 100 ? "text-red-600" : ""}>
                    {step.successRateA}%
                  </span>
                  <span className="text-muted-foreground mx-0.5">/</span>
                  <span className={step.successRateB < 100 ? "text-red-600" : ""}>
                    {step.successRateB}%
                  </span>
                </div>
              </div>
            );
          })}
          <p className="text-[10px] text-muted-foreground pt-1">
            Values shown as Run A / Run B. Duration improvements (faster) shown in green.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function PromptDiffsCard({ diffs }: { diffs: PromptDiff[] }) {
  if (diffs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <FileCode2 className="h-4 w-4 text-green-500" />
            Prompt Versions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            All prompt templates are identical between these two runs.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <FileCode2 className="h-4 w-4 text-amber-500" />
          Prompt Version Changes ({diffs.length})
        </CardTitle>
        <CardDescription>Prompt templates that differ between Run A and Run B</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {diffs.map((diff) => (
          <PromptDiffItem key={diff.promptKey} diff={diff} />
        ))}
      </CardContent>
    </Card>
  );
}

function PromptDiffItem({ diff }: { diff: PromptDiff }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border p-3 text-left transition-colors hover:bg-muted/50">
        <div className="flex items-center gap-3">
          <Zap className="h-4 w-4 shrink-0 text-amber-500" />
          <div>
            <p className="text-sm font-medium">{diff.promptKey}</p>
            <p className="text-xs text-muted-foreground">
              <code className="rounded bg-muted px-1">{diff.versionA || "—"}</code>
              {" \u2192 "}
              <code className="rounded bg-muted px-1">{diff.versionB || "—"}</code>
            </p>
          </div>
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t px-3 py-3">
          {diff.templateA && diff.templateB ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="mb-1 text-xs font-semibold text-blue-600">Run A ({diff.versionA})</p>
                <pre className="max-h-64 overflow-auto rounded-md bg-blue-50 p-2 font-mono text-xs leading-relaxed dark:bg-blue-950/30">
                  {diff.templateA.length > 3000
                    ? diff.templateA.slice(0, 3000) + "\n... (truncated)"
                    : diff.templateA}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-violet-600">
                  Run B ({diff.versionB})
                </p>
                <pre className="max-h-64 overflow-auto rounded-md bg-violet-50 p-2 font-mono text-xs leading-relaxed dark:bg-violet-950/30">
                  {diff.templateB.length > 3000
                    ? diff.templateB.slice(0, 3000) + "\n... (truncated)"
                    : diff.templateB}
                </pre>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              Template text not available for one or both versions. Templates are archived from runs
              created after the prompt versioning feature was enabled.
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function UseCaseAlignmentCard({ entries }: { entries: UseCaseAlignmentEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          Use Case Alignment ({entries.length} matched pairs)
        </CardTitle>
        <CardDescription>
          Fuzzy-matched by name similarity. Compare how scores changed for similar use cases.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5">
          <div className="grid grid-cols-[1fr_80px_80px_80px_1fr] gap-2 text-xs font-semibold text-muted-foreground px-2">
            <span>Run A</span>
            <span className="text-center">Score A</span>
            <span className="text-center">Score B</span>
            <span className="text-center">Match</span>
            <span>Run B</span>
          </div>
          <Separator />
          {entries.slice(0, 30).map((entry, i) => {
            const scoreDiff = entry.scoreB - entry.scoreA;
            return (
              <div
                key={i}
                className="grid grid-cols-[1fr_80px_80px_80px_1fr] gap-2 items-center rounded-md border px-2 py-1.5"
              >
                <span className="truncate text-xs">{entry.nameA}</span>
                <span className="text-center text-xs font-mono">{entry.scoreA}%</span>
                <span
                  className={`text-center text-xs font-mono font-medium ${
                    scoreDiff > 0 ? "text-green-600" : scoreDiff < 0 ? "text-red-600" : ""
                  }`}
                >
                  {entry.scoreB}%
                  {scoreDiff !== 0 && (
                    <span className="ml-0.5 text-[10px]">
                      ({scoreDiff > 0 ? "+" : ""}
                      {scoreDiff})
                    </span>
                  )}
                </span>
                <span className="text-center">
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      entry.similarity >= 80
                        ? "border-green-300 text-green-700"
                        : entry.similarity >= 50
                          ? "border-amber-300 text-amber-700"
                          : "border-muted text-muted-foreground"
                    }`}
                  >
                    {entry.similarity}%
                  </Badge>
                </span>
                <span className="truncate text-xs">{entry.nameB}</span>
              </div>
            );
          })}
          {entries.length > 30 && (
            <p className="text-center text-xs text-muted-foreground pt-2">
              Showing 30 of {entries.length} matched pairs
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ConfigDiffRow({ label, a, b }: { label: string; a: string; b: string }) {
  const isDifferent = a !== b;
  return (
    <div
      className={`rounded-md border p-2.5 ${
        isDifferent
          ? "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-900/10"
          : ""
      }`}
    >
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <p className="text-sm truncate">{a || "(empty)"}</p>
        <p className="text-sm truncate">{b || "(empty)"}</p>
      </div>
    </div>
  );
}
