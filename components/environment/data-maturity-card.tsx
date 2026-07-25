"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InfoTip } from "@/components/ui/info-tip";
import { ENVIRONMENT } from "@/lib/help-text";
import type { DataMaturityScore, MaturityPillar } from "@/lib/domain/data-maturity";
import { BarChart3 } from "lucide-react";

function PillarBar({ pillar, barColorClass }: { pillar: MaturityPillar; barColorClass: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{pillar.name}</p>
        <p className="text-sm font-bold">{pillar.score}</p>
      </div>
      <div className="h-2 w-full rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${barColorClass}`}
          style={{ width: `${pillar.score}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {pillar.indicators.map((ind) => (
          <p key={ind.label} className="text-xs text-muted-foreground">
            {ind.label}: <span className="font-medium text-foreground">{ind.value}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

export interface DataMaturityCardProps {
  maturity: DataMaturityScore;
}

export function DataMaturityCard({ maturity }: DataMaturityCardProps) {
  const levelColor: Record<string, string> = {
    Foundational: "text-red-600 dark:text-red-400",
    Developing: "text-orange-600 dark:text-orange-400",
    Established: "text-yellow-600 dark:text-yellow-400",
    Advanced: "text-blue-600 dark:text-blue-400",
    Leading: "text-emerald-600 dark:text-emerald-400",
  };
  const barColor: Record<string, string> = {
    Foundational: "bg-red-500",
    Developing: "bg-orange-500",
    Established: "bg-yellow-500",
    Advanced: "bg-blue-500",
    Leading: "bg-emerald-500",
  };

  const pillBarColor = barColor[maturity.level] ?? "bg-primary";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <BarChart3 className="h-4 w-4 text-primary" />
          Data Maturity Score
          <InfoTip tip={ENVIRONMENT.dataMaturity} />
        </CardTitle>
        <CardDescription>
          Composite score across governance, architecture, operations, and analytics readiness
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-baseline gap-3">
          <span className="text-5xl font-bold tracking-tight">{maturity.overall}</span>
          <span className="text-lg text-muted-foreground">/100</span>
          <Badge variant="secondary" className={levelColor[maturity.level]}>
            {maturity.level}
          </Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <PillarBar pillar={maturity.pillars.governance} barColorClass={pillBarColor} />
          <PillarBar pillar={maturity.pillars.architecture} barColorClass={pillBarColor} />
          <PillarBar pillar={maturity.pillars.operations} barColorClass={pillBarColor} />
          <PillarBar pillar={maturity.pillars.analyticsReadiness} barColorClass={pillBarColor} />
        </div>
      </CardContent>
    </Card>
  );
}
