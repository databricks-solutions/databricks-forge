import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import {
  getStakeholderProfilesForLatestRun,
  getStakeholderProvenance,
} from "@/lib/lakebase/stakeholder-profiles";
import { getDegradedSteps } from "@/lib/lakebase/runs";
import { getPortfolioUseCases } from "@/lib/lakebase/portfolio";
import { requireUser } from "@/lib/auth/route-user";
import { listAccessibleIds } from "@/lib/lakebase/acl";
import { formatCurrency } from "@/lib/utils";
import type { StakeholderProfile } from "@/lib/domain/types";
import { Users, Crown, Building2, ShieldAlert, BarChart3, Star } from "lucide-react";
import { StakeholderDrillDown } from "@/components/business-value/stakeholder-drill-down";
import { BvProgressBanner } from "@/components/business-value/bv-progress-banner";
import { DegradedStakeholderBanner } from "@/components/business-value/degraded-stakeholder-banner";
import { ProvenanceFooter } from "@/components/business-value/provenance-footer";

export const dynamic = "force-dynamic";

function StakeholderSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

function aggregateUseCaseTypes(profiles: StakeholderProfile[]): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const p of profiles) {
    for (const [k, v] of Object.entries(p.useCaseTypes ?? {})) {
      acc[k] = (acc[k] ?? 0) + v;
    }
  }
  return acc;
}

function departmentSummary(profiles: StakeholderProfile[]) {
  const byDept = new Map<
    string,
    {
      totalValue: number;
      ucCount: number;
      roles: Set<string>;
      complexities: ("low" | "medium" | "high")[];
      domains: Set<string>;
    }
  >();
  for (const p of profiles) {
    const d = p.department || "Unknown";
    const existing = byDept.get(d) ?? {
      totalValue: 0,
      ucCount: 0,
      roles: new Set<string>(),
      complexities: [] as ("low" | "medium" | "high")[],
      domains: new Set<string>(),
    };
    existing.totalValue += p.totalValue;
    existing.ucCount += p.useCaseCount;
    if (p.role) existing.roles.add(p.role);
    if (p.changeComplexity) existing.complexities.push(p.changeComplexity);
    for (const dom of p.domains ?? []) existing.domains.add(dom);
    byDept.set(d, existing);
  }
  return Array.from(byDept.entries())
    .map(([dept, data]) => ({
      department: dept,
      totalValue: data.totalValue,
      useCaseCount: data.ucCount,
      roleCount: data.roles.size,
      domainCount: data.domains.size,
      changeComplexity: (data.complexities.filter((c) => c === "high").length > 0
        ? "high"
        : data.complexities.filter((c) => c === "medium").length > 0
          ? "medium"
          : "low") as "low" | "medium" | "high",
    }))
    .sort((a, b) => b.totalValue - a.totalValue || b.useCaseCount - a.useCaseCount);
}

const COMPLEXITY_CONFIG: Record<string, { label: string; className: string }> = {
  low: {
    label: "Low",
    className: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30",
  },
  medium: {
    label: "Medium",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  },
  high: {
    label: "High",
    className: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  },
};

async function StakeholderContent() {
  const user = await requireUser();
  const accessibleRunIds = await listAccessibleIds(user.email, "run");
  const [{ runId, profiles }, portfolioUseCases] = await Promise.all([
    getStakeholderProfilesForLatestRun(user.email, accessibleRunIds),
    getPortfolioUseCases(user.email, accessibleRunIds),
  ]);

  const degradedSteps = runId ? await getDegradedSteps(runId) : [];
  const stakeholderDegraded = degradedSteps.includes("stakeholder-analysis");
  const provenance = runId
    ? await getStakeholderProvenance(runId)
    : { generatedByModel: null, generatedAt: null };

  if (!runId || profiles.length === 0) {
    return (
      <div className="space-y-6">
        <BvProgressBanner runId={runId} />
        {runId && stakeholderDegraded ? (
          <DegradedStakeholderBanner runId={runId} />
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-muted-foreground">
                {runId
                  ? "Stakeholder intelligence is still generating for the latest run. Business value analysis runs as a background job after the main pipeline completes -- check back in a minute or two, or use Run Business Value to recompute."
                  : "Run a discovery pipeline to generate stakeholder intelligence. Business value analysis runs by default; you can opt out from the run config."}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  const champions = profiles.filter((p) => p.isChampion);
  const sponsors = profiles.filter((p) => p.isSponsor);
  const departments = departmentSummary(profiles);
  const typeDistribution = aggregateUseCaseTypes(profiles);
  const totalTypes = Object.values(typeDistribution).reduce((a, b) => a + b, 0);
  const totalValue = profiles.reduce((s, p) => s + p.totalValue, 0);
  const highComplexity = profiles.filter((p) => p.changeComplexity === "high").length;

  return (
    <div className="space-y-8">
      <BvProgressBanner runId={runId} />
      {/* KPI Strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="relative overflow-hidden transition-shadow hover:shadow-md">
          <div className="absolute inset-y-0 left-0 w-1 bg-violet-500" />
          <CardContent className="pt-5 pb-5 pl-5">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              Stakeholders
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight">{profiles.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Across {departments.length} departments
            </p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden transition-shadow hover:shadow-md">
          <div className="absolute inset-y-0 left-0 w-1 bg-amber-500" />
          <CardContent className="pt-5 pb-5 pl-5">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Crown className="h-3.5 w-3.5" />
              Champions
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight">{champions.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {sponsors.length} executive sponsor{sponsors.length !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden transition-shadow hover:shadow-md">
          <div className="absolute inset-y-0 left-0 w-1 bg-emerald-500" />
          <CardContent className="pt-5 pb-5 pl-5">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <BarChart3 className="h-3.5 w-3.5" />
              Total Stakeholder Value
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight">{formatCurrency(totalValue)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Avg {formatCurrency(profiles.length > 0 ? totalValue / profiles.length : 0)} per
              stakeholder
            </p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden transition-shadow hover:shadow-md">
          <div className="absolute inset-y-0 left-0 w-1 bg-red-500" />
          <CardContent className="pt-5 pb-5 pl-5">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <ShieldAlert className="h-3.5 w-3.5" />
              High Change Complexity
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight">{highComplexity}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {profiles.length > 0
                ? `${((highComplexity / profiles.length) * 100).toFixed(0)}% of stakeholders`
                : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recommended Champions */}
      {champions.length > 0 && (
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
            <Star className="h-4 w-4 text-amber-500" />
            Recommended Champions
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {champions.slice(0, 6).map((p) => (
              <Card
                key={p.id}
                className="border-primary/20 transition-colors hover:border-primary/40"
              >
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold">{p.role}</p>
                      <p className="text-xs text-muted-foreground">{p.department}</p>
                    </div>
                    <div className="flex gap-1">
                      {p.isChampion && (
                        <Badge
                          variant="outline"
                          className="gap-1 bg-amber-500/10 text-[10px] text-amber-500 border-amber-500/30"
                        >
                          <Crown className="h-2.5 w-2.5" />
                          Champion
                        </Badge>
                      )}
                      {p.isSponsor && (
                        <Badge variant="outline" className="text-[10px]">
                          Sponsor
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <div>
                      <p className="text-lg font-bold">{formatCurrency(p.totalValue)}</p>
                      <p className="text-[10px] text-muted-foreground">estimated value</p>
                    </div>
                    <div className="h-8 w-px bg-border" />
                    <div>
                      <p className="text-lg font-bold">{p.useCaseCount}</p>
                      <p className="text-[10px] text-muted-foreground">use cases</p>
                    </div>
                    {p.changeComplexity && (
                      <>
                        <div className="h-8 w-px bg-border" />
                        <Badge
                          variant="outline"
                          className={COMPLEXITY_CONFIG[p.changeComplexity]?.className ?? ""}
                        >
                          {COMPLEXITY_CONFIG[p.changeComplexity]?.label ?? p.changeComplexity}
                        </Badge>
                      </>
                    )}
                  </div>
                  {p.domains && p.domains.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {p.domains.slice(0, 4).map((d) => (
                        <Badge key={d} variant="secondary" className="text-[10px]">
                          {d}
                        </Badge>
                      ))}
                      {p.domains.length > 4 && (
                        <Badge variant="secondary" className="text-[10px]">
                          +{p.domains.length - 4}
                        </Badge>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Department Overview */}
      {departments.length > 0 && (
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
            <Building2 className="h-4 w-4 text-primary" />
            Department Impact
          </h2>
          <Card>
            <CardContent className="p-0">
              <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
                {departments.map((d) => (
                  <div key={d.department} className="bg-card p-4">
                    <div className="flex items-start justify-between">
                      <p className="text-sm font-semibold">{d.department}</p>
                      <Badge
                        variant="outline"
                        className={COMPLEXITY_CONFIG[d.changeComplexity]?.className ?? ""}
                      >
                        {COMPLEXITY_CONFIG[d.changeComplexity]?.label ?? d.changeComplexity}
                      </Badge>
                    </div>
                    <div className="mt-3 flex items-baseline gap-4">
                      <div>
                        <span className="text-lg font-bold">{formatCurrency(d.totalValue)}</span>
                        <span className="ml-1 text-[10px] text-muted-foreground">value</span>
                      </div>
                      <div>
                        <span className="text-sm font-medium">{d.useCaseCount}</span>
                        <span className="ml-1 text-[10px] text-muted-foreground">use cases</span>
                      </div>
                    </div>
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      {d.roleCount} role{d.roleCount !== 1 ? "s" : ""} · {d.domainCount} domain
                      {d.domainCount !== 1 ? "s" : ""}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Skills Assessment */}
      {totalTypes > 0 && (
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
            <BarChart3 className="h-4 w-4 text-primary" />
            Skills Assessment
          </h2>
          <Card>
            <CardContent className="pt-5 pb-5">
              <div className="space-y-3">
                {Object.entries(typeDistribution)
                  .sort(([, a], [, b]) => b - a)
                  .map(([typeName, count]) => {
                    const pct = totalTypes > 0 ? (count / totalTypes) * 100 : 0;
                    return (
                      <div key={typeName} className="flex items-center gap-3">
                        <span className="w-24 text-sm font-medium">{typeName}</span>
                        <div className="flex-1">
                          <div className="h-6 w-full overflow-hidden rounded bg-muted/50">
                            <div
                              className="h-full rounded bg-primary/30 transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                        <span className="w-16 text-right text-sm tabular-nums">
                          {count}{" "}
                          <span className="text-xs text-muted-foreground">({pct.toFixed(0)}%)</span>
                        </span>
                      </div>
                    );
                  })}
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Full Stakeholder Drill-Down */}
      <StakeholderDrillDown
        profiles={profiles.map((p) => ({
          id: p.id,
          role: p.role,
          department: p.department,
          useCaseCount: p.useCaseCount,
          totalValue: p.totalValue,
          domains: p.domains ?? [],
          useCaseTypes: p.useCaseTypes ?? {},
          useCaseIds: p.useCaseIds ?? [],
          changeComplexity: p.changeComplexity,
          isChampion: p.isChampion,
          isSponsor: p.isSponsor,
          championRationale: p.championRationale,
          complexityRationale: p.complexityRationale,
          keyRisks: p.keyRisks ?? [],
        }))}
        useCases={portfolioUseCases.map((uc) => ({
          id: uc.id,
          name: uc.name,
          domain: uc.domain,
          valueMid: uc.valueMid,
        }))}
      />

      <ProvenanceFooter
        generatedByModel={provenance.generatedByModel}
        generatedAt={provenance.generatedAt}
        label="Stakeholder profiles generated"
      />
    </div>
  );
}

export default function StakeholderIntelligencePage() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      <PageHeader
        title="Stakeholder Intelligence"
        subtitle="Organizational impact and readiness assessment"
      />

      <Suspense fallback={<StakeholderSkeleton />}>
        <StakeholderContent />
      </Suspense>
    </div>
  );
}
