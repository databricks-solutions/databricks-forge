import { Suspense } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { getPortfolioData, getPortfolioUseCases } from "@/lib/lakebase/portfolio";
import { formatCurrency } from "@/lib/utils";
import type { BusinessValuePortfolio } from "@/lib/domain/types";
import type { PortfolioUseCase } from "@/lib/lakebase/portfolio";
import { requireUser } from "@/lib/auth/route-user";
import { listAccessibleIds } from "@/lib/lakebase/acl";
import { getDegradedSteps, getRunById, getSynthesisProvenance } from "@/lib/lakebase/runs";
import {
  getValueEstimatesForRun,
  getValueEstimateProvenance,
} from "@/lib/lakebase/value-estimates";
import { DegradedFinancialBanner } from "@/components/business-value/degraded-financial-banner";
import { BvProgressBanner } from "@/components/business-value/bv-progress-banner";
import { ProvenanceFooter } from "@/components/business-value/provenance-footer";
import {
  TrendingUp,
  Zap,
  DollarSign,
  BarChart3,
  AlertTriangle,
  Lightbulb,
  Target,
  ArrowRight,
  Clock,
  Layers,
  ShieldCheck,
  BrainCircuit,
} from "lucide-react";
import { PortfolioDrillDown } from "@/components/business-value/portfolio-drill-down";
import { PortfolioExportButton } from "@/components/business-value/portfolio-export-button";
import { RunBvaButton } from "@/components/business-value/run-bva-button";

export const dynamic = "force-dynamic";

function PortfolioSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

function formatValueRange(low: number, high: number): string {
  if (low === 0 && high === 0) return "$0";
  return `${formatCurrency(low)} – ${formatCurrency(high)}`;
}

function SeverityIcon({ severity }: { severity: "opportunity" | "risk" | "insight" }) {
  if (severity === "opportunity") return <TrendingUp className="h-4 w-4 text-emerald-500" />;
  if (severity === "risk") return <AlertTriangle className="h-4 w-4 text-red-400" />;
  return <Lightbulb className="h-4 w-4 text-blue-400" />;
}

function PriorityBadge({ priority }: { priority: "high" | "medium" | "low" }) {
  const cls =
    priority === "high"
      ? "bg-red-500/15 text-red-400 border-red-500/30"
      : priority === "medium"
        ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
        : "bg-slate-500/15 text-slate-400 border-slate-500/30";
  return (
    <Badge variant="outline" className={cls}>
      {priority}
    </Badge>
  );
}

async function PortfolioContent() {
  let portfolio: BusinessValuePortfolio & { latestRunId: string | null };
  let useCases: PortfolioUseCase[];
  let financialDegraded = false;
  let degradedRunLabel: string | null = null;
  let degradedMissingCount: number | undefined;
  let provenance: { generatedByModel: string | null; generatedAt: Date | null } = {
    generatedByModel: null,
    generatedAt: null,
  };
  let synthesisProvenance: { generatedByModel: string | null; generatedAt: Date | null } = {
    generatedByModel: null,
    generatedAt: null,
  };
  try {
    const user = await requireUser();
    const accessibleRunIds = await listAccessibleIds(user.email, "run");
    [portfolio, useCases] = await Promise.all([
      getPortfolioData(user.email, accessibleRunIds),
      getPortfolioUseCases(user.email, accessibleRunIds),
    ]);

    // Surface step-level degradation so the user never sees a silent $0.
    if (portfolio.latestRunId) {
      const [degradedSteps, run, estimates, valueProvenance, synProv] = await Promise.all([
        getDegradedSteps(portfolio.latestRunId),
        getRunById(portfolio.latestRunId),
        getValueEstimatesForRun(portfolio.latestRunId),
        getValueEstimateProvenance(portfolio.latestRunId),
        getSynthesisProvenance(portfolio.latestRunId),
      ]);
      financialDegraded = degradedSteps.includes("financial-quantification");
      degradedRunLabel = run?.config.businessName ?? null;
      provenance = valueProvenance;
      synthesisProvenance = synProv;
      if (financialDegraded) {
        // useCases comes from the latest run; count the ones missing an estimate.
        const withEstimate = new Set(estimates.map((e) => e.useCaseId));
        degradedMissingCount = useCases.filter((uc) => !withEstimate.has(uc.id)).length;
      }
    }
  } catch {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <p className="text-muted-foreground">Failed to load portfolio data.</p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/configure">Run a discovery pipeline first</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const hasData =
    portfolio.totalUseCases > 0 ||
    portfolio.deliveredValue > 0 ||
    Object.values(portfolio.byPhase).some((p) => p.count > 0);

  if (!hasData) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <p className="text-muted-foreground">No portfolio data yet.</p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/configure">Run a discovery pipeline first</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const synthesis = portfolio.latestSynthesis;
  const keyFindings = synthesis?.keyFindings ?? [];
  const recommendations = synthesis?.strategicRecommendations ?? [];
  const risks = synthesis?.riskCallouts ?? [];

  const topDomains = [...portfolio.byDomain]
    .sort((a, b) => b.valueMid - a.valueMid || b.useCaseCount - a.useCaseCount)
    .slice(0, 8);
  const maxDomainValue = Math.max(...topDomains.map((d) => d.valueMid || d.useCaseCount), 1);

  const totalPhaseCount = Object.values(portfolio.byPhase).reduce((s, p) => s + p.count, 0);

  return (
    <div className="space-y-8">
      <BvProgressBanner runId={portfolio.latestRunId} />
      {financialDegraded && portfolio.latestRunId && (
        <DegradedFinancialBanner
          runId={portfolio.latestRunId}
          runLabel={degradedRunLabel}
          missingCount={degradedMissingCount}
        />
      )}

      {/* Hero KPI Strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="relative overflow-hidden transition-shadow hover:shadow-md">
          <div className="absolute inset-y-0 left-0 w-1 bg-emerald-500" />
          <CardContent className="pt-5 pb-5 pl-5">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <DollarSign className="h-3.5 w-3.5" />
              Total Estimated Value
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight">
              {formatValueRange(
                portfolio.totalEstimatedValue.low,
                portfolio.totalEstimatedValue.high,
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Mid-point: {formatCurrency(portfolio.totalEstimatedValue.mid)}
            </p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden transition-shadow hover:shadow-md">
          <div className="absolute inset-y-0 left-0 w-1 bg-amber-500" />
          <CardContent className="pt-5 pb-5 pl-5">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Zap className="h-3.5 w-3.5" />
              Quick Wins
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight">
              {portfolio.byPhase.quick_wins.count}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Ready to start in 0–3 months</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden transition-shadow hover:shadow-md">
          <div className="absolute inset-y-0 left-0 w-1 bg-blue-500" />
          <CardContent className="pt-5 pb-5 pl-5">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Delivered Value
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight">
              {formatCurrency(portfolio.deliveredValue)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {portfolio.byStage.delivered + portfolio.byStage.measured} use cases delivered
            </p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden transition-shadow hover:shadow-md">
          <div className="absolute inset-y-0 left-0 w-1 bg-violet-500" />
          <CardContent className="pt-5 pb-5 pl-5">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <BarChart3 className="h-3.5 w-3.5" />
              Use Cases
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight">{portfolio.totalUseCases}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Across {portfolio.byDomain.length} domains
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Velocity Metrics -- Conversion Funnel */}
      {portfolio.totalUseCases > 0 && (
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
            <TrendingUp className="h-4 w-4 text-primary" />
            Portfolio Velocity
          </h2>
          <Card>
            <CardContent className="pt-5 pb-5">
              <div className="flex items-center gap-0 overflow-hidden rounded-lg">
                {(
                  [
                    {
                      label: "Discovered",
                      count: portfolio.byStage.discovered,
                      color: "bg-slate-200 dark:bg-slate-700",
                    },
                    {
                      label: "Planned",
                      count: portfolio.byStage.planned,
                      color: "bg-blue-200 dark:bg-blue-800",
                    },
                    {
                      label: "In Progress",
                      count: portfolio.byStage.in_progress,
                      color: "bg-amber-200 dark:bg-amber-800",
                    },
                    {
                      label: "Delivered",
                      count: portfolio.byStage.delivered,
                      color: "bg-green-200 dark:bg-green-800",
                    },
                    {
                      label: "Measured",
                      count: portfolio.byStage.measured,
                      color: "bg-emerald-200 dark:bg-emerald-800",
                    },
                  ] as const
                ).map((s) => {
                  const pct =
                    portfolio.totalUseCases > 0
                      ? Math.max(5, Math.round((s.count / portfolio.totalUseCases) * 100))
                      : 20;
                  return (
                    <div
                      key={s.label}
                      className={`flex flex-col items-center justify-center py-3 ${s.color}`}
                      style={{ width: `${pct}%`, minWidth: 60 }}
                    >
                      <span className="text-lg font-bold tabular-nums">{s.count}</span>
                      <span className="text-[10px] font-medium opacity-80">{s.label}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>
                  Conversion rate:{" "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {portfolio.totalUseCases > 0
                      ? Math.round(
                          ((portfolio.byStage.delivered + portfolio.byStage.measured) /
                            portfolio.totalUseCases) *
                            100,
                        )
                      : 0}
                    %
                  </span>
                </span>
                {portfolio.deliveredValue > 0 && portfolio.totalEstimatedValue.mid > 0 && (
                  <span>
                    Realization rate:{" "}
                    <span className="font-semibold text-foreground tabular-nums">
                      {Math.round(
                        (portfolio.deliveredValue / portfolio.totalEstimatedValue.mid) * 100,
                      )}
                      %
                    </span>
                  </span>
                )}
                <span>
                  In pipeline:{" "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {portfolio.byStage.planned + portfolio.byStage.in_progress}
                  </span>
                </span>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Executive Insights */}
      {keyFindings.length > 0 && (
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
            <Target className="h-4 w-4 text-primary" />
            Key Findings
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {keyFindings.slice(0, 6).map((f, i) => (
              <Card key={i} className="group transition-colors hover:border-primary/30">
                <CardContent className="pt-4 pb-4">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0 flex items-center gap-2">
                      <SeverityIcon severity={f.severity} />
                      <span className="truncate text-sm font-medium leading-tight" title={f.title}>
                        {f.title}
                      </span>
                    </div>
                    {f.domain && (
                      <Badge
                        variant="secondary"
                        className="max-w-full shrink-0 text-[10px]"
                        title={f.domain}
                      >
                        {f.domain}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{f.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Delivery Pipeline */}
      {totalPhaseCount > 0 && (
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
            <Clock className="h-4 w-4 text-primary" />
            Delivery Pipeline
          </h2>
          <Card>
            <CardContent className="pt-5 pb-5">
              <div className="flex items-center gap-2">
                {(
                  [
                    {
                      key: "quick_wins" as const,
                      label: "Quick Wins",
                      time: "0–3 mo",
                      color: "bg-amber-500",
                    },
                    {
                      key: "foundation" as const,
                      label: "Foundation",
                      time: "3–9 mo",
                      color: "bg-blue-500",
                    },
                    {
                      key: "transformation" as const,
                      label: "Transformation",
                      time: "9–18 mo",
                      color: "bg-violet-500",
                    },
                  ] as const
                ).map((phase, idx) => {
                  const count = portfolio.byPhase[phase.key].count;
                  const pct = totalPhaseCount > 0 ? (count / totalPhaseCount) * 100 : 0;
                  return (
                    <div
                      key={phase.key}
                      className="flex items-center gap-2"
                      style={{ flex: pct || 1 }}
                    >
                      {idx > 0 && (
                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                      )}
                      <div className="w-full">
                        <div className="mb-1 flex items-baseline justify-between">
                          <span className="text-xs font-medium">{phase.label}</span>
                          <span className="text-xs text-muted-foreground">{phase.time}</span>
                        </div>
                        <div className="relative h-10 w-full overflow-hidden rounded-md bg-muted/50">
                          <div
                            className={`absolute inset-y-0 left-0 ${phase.color} opacity-20`}
                            style={{ width: "100%" }}
                          />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-lg font-bold">{count}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Domain Heatmap */}
      {topDomains.length > 0 && (
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
            <Layers className="h-4 w-4 text-primary" />
            Domain Performance
          </h2>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Domain</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Use Cases</TableHead>
                    <TableHead className="text-right">Avg Score</TableHead>
                    <TableHead className="text-right">Feasibility</TableHead>
                    <TableHead className="w-[200px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topDomains.map((d) => {
                    const intensity = (d.valueMid || d.useCaseCount) / maxDomainValue;
                    return (
                      <TableRow key={d.domain}>
                        <TableCell className="font-medium">
                          <span className="block truncate max-w-[200px]" title={d.domain}>
                            {d.domain}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatCurrency(d.valueMid)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{d.useCaseCount}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {(d.avgScore * 100).toFixed(0)}%
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {(d.avgFeasibility * 100).toFixed(0)}%
                        </TableCell>
                        <TableCell>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary/60 transition-all"
                              style={{ width: `${(intensity * 100).toFixed(0)}%` }}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Strategic Recommendations + Risk Callouts */}
      {(recommendations.length > 0 || risks.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {recommendations.length > 0 && (
            <section>
              <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
                <TrendingUp className="h-4 w-4 text-emerald-500" />
                Strategic Recommendations
              </h2>
              <div className="space-y-3">
                {recommendations.slice(0, 5).map((r, i) => (
                  <Card key={i}>
                    <CardContent className="flex items-start gap-3 pt-4 pb-4">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium" title={r.title}>
                            {r.title}
                          </span>
                          <PriorityBadge priority={r.priority} />
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {r.description}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {risks.length > 0 && (
            <section>
              <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
                <AlertTriangle className="h-4 w-4 text-red-400" />
                Risk Callouts
              </h2>
              <div className="space-y-3">
                {risks.slice(0, 5).map((r, i) => (
                  <Card key={i} className="border-red-500/10">
                    <CardContent className="flex items-start gap-3 pt-4 pb-4">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-xs font-bold text-red-400">
                        !
                      </span>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium" title={r.title}>
                            {r.title}
                          </span>
                          <PriorityBadge priority={r.impact} />
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {r.description}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Drill-Down (client component) */}
      {useCases.length > 0 && (
        <PortfolioDrillDown useCases={useCases} runId={portfolio.latestRunId ?? undefined} />
      )}

      <div className="space-y-1 pt-2">
        <ProvenanceFooter
          generatedByModel={provenance.generatedByModel}
          generatedAt={provenance.generatedAt}
          label="Value estimates generated"
        />
        <ProvenanceFooter
          generatedByModel={synthesisProvenance.generatedByModel}
          generatedAt={synthesisProvenance.generatedAt}
          label="Executive synthesis generated"
        />
      </div>
    </div>
  );
}

export default function BusinessValuePage() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      <PageHeader
        title="Business Value Portfolio"
        subtitle="Executive overview of data-driven value across your organization"
        actions={
          <div className="flex items-center gap-2">
            <RunBvaButton />
            <Button variant="outline" size="sm" asChild>
              <Link href="/ask-forge?persona=strategic">
                <BrainCircuit className="mr-1.5 size-4" />
                Strategic Advisor
              </Link>
            </Button>
            <PortfolioExportButton />
          </div>
        }
      />

      <Suspense fallback={<PortfolioSkeleton />}>
        <PortfolioContent />
      </Suspense>
    </div>
  );
}
