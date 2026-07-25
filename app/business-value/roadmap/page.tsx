import { Suspense } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { getPortfolioData, getPortfolioUseCases } from "@/lib/lakebase/portfolio";
import { requireUser } from "@/lib/auth/route-user";
import { listAccessibleIds } from "@/lib/lakebase/acl";
import { formatCurrency } from "@/lib/utils";
import type { RoadmapPhase } from "@/lib/domain/types";
import type { PortfolioUseCase } from "@/lib/lakebase/portfolio";
import { ArrowRight, Clock } from "lucide-react";
import { RoadmapPhaseDetail } from "@/components/business-value/roadmap-phase-detail";
import { BvProgressBanner } from "@/components/business-value/bv-progress-banner";
import { ProvenanceFooter } from "@/components/business-value/provenance-footer";
import { getRoadmapPhasesProvenance } from "@/lib/lakebase/roadmap-phases";

export const dynamic = "force-dynamic";

const PHASE_CONFIG: Record<
  RoadmapPhase,
  { label: string; timeframe: string; description: string; bgTint: string }
> = {
  quick_wins: {
    label: "Quick Wins",
    timeframe: "0–3 months",
    description: "High-impact, low-effort initiatives ready to deliver value immediately",
    bgTint: "bg-amber-500/10",
  },
  foundation: {
    label: "Foundation",
    timeframe: "3–9 months",
    description: "Core capabilities and infrastructure that enable advanced analytics",
    bgTint: "bg-blue-500/10",
  },
  transformation: {
    label: "Transformation",
    timeframe: "9–18 months",
    description: "Strategic, high-complexity programs that reshape how the business operates",
    bgTint: "bg-violet-500/10",
  },
};

function RoadmapSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-32 w-full rounded-xl" />
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-48 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

const EFFORT_LABELS: Record<string, string> = {
  xs: "XS",
  s: "Small",
  m: "Medium",
  l: "Large",
  xl: "XL",
};

async function RoadmapContent() {
  let portfolio;
  let useCases: PortfolioUseCase[];
  let provenance: { generatedByModel: string | null; generatedAt: Date | null } = {
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
    if (portfolio.latestRunId) {
      provenance = await getRoadmapPhasesProvenance(portfolio.latestRunId);
    }
  } catch {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <p className="text-muted-foreground">Failed to load roadmap data.</p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/configure">Run a discovery pipeline first</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const byPhase = portfolio.byPhase;
  const totalPhases = Object.values(byPhase).reduce((s, p) => s + p.count, 0);

  if (totalPhases === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <p className="text-muted-foreground">No roadmap phases yet.</p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/configure">Run a discovery pipeline first</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const phaseOrder: RoadmapPhase[] = ["quick_wins", "foundation", "transformation"];

  const phaseUseCases = new Map<string, PortfolioUseCase[]>();
  for (const uc of useCases) {
    if (!uc.phase) continue;
    const arr = phaseUseCases.get(uc.phase) ?? [];
    arr.push(uc);
    phaseUseCases.set(uc.phase, arr);
  }

  const totalValue = useCases.reduce((s, u) => s + u.valueMid, 0);

  return (
    <div className="space-y-8">
      <BvProgressBanner runId={portfolio.latestRunId} />
      {/* Timeline Overview */}
      <Card>
        <CardContent className="pt-5 pb-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Clock className="h-4 w-4 text-primary" />
              Delivery Timeline
            </div>
            <span className="text-xs text-muted-foreground">
              {totalPhases} use cases · {formatCurrency(totalValue)} total value
            </span>
          </div>
          <div className="flex items-center gap-2">
            {phaseOrder.map((phase, idx) => {
              const config = PHASE_CONFIG[phase];
              const count = byPhase[phase].count;
              const pct = totalPhases > 0 ? (count / totalPhases) * 100 : 0;
              const phaseValue = (phaseUseCases.get(phase) ?? []).reduce(
                (s, u) => s + u.valueMid,
                0,
              );
              return (
                <div
                  key={phase}
                  className="flex items-center gap-2"
                  style={{ flex: Math.max(pct, 10) }}
                >
                  {idx > 0 && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/40" />}
                  <div className="w-full">
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="text-xs font-medium">{config.label}</span>
                      <span className="text-[10px] text-muted-foreground">{config.timeframe}</span>
                    </div>
                    <div
                      className={`relative h-12 w-full overflow-hidden rounded-lg ${config.bgTint}`}
                    >
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-lg font-bold tabular-nums">{count}</span>
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {formatCurrency(phaseValue)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Phase Detail Cards */}
      <RoadmapPhaseDetail
        phases={phaseOrder.map((phase) => ({
          phase,
          config: PHASE_CONFIG[phase],
          useCases: (phaseUseCases.get(phase) ?? []).sort(
            (a, b) => b.overallScore - a.overallScore,
          ),
          totalValue: (phaseUseCases.get(phase) ?? []).reduce((s, u) => s + u.valueMid, 0),
        }))}
        effortLabels={EFFORT_LABELS}
      />

      <ProvenanceFooter
        generatedByModel={provenance.generatedByModel}
        generatedAt={provenance.generatedAt}
        label="Roadmap phases generated"
      />
    </div>
  );
}

export default function RoadmapPage() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      <PageHeader
        title="Implementation Roadmap"
        subtitle="Phase-based delivery timeline across discovery runs"
      />

      <Suspense fallback={<RoadmapSkeleton />}>
        <RoadmapContent />
      </Suspense>
    </div>
  );
}
