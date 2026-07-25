"use client";

import { SummaryCard } from "./summary-card";
import { CoverageGapCard } from "./coverage-gap-card";
import { effectiveScores } from "@/lib/domain/scoring";
import { RUN_DETAIL } from "@/lib/help-text";
import { BrainCircuit, Layers, BarChart3, Gauge } from "lucide-react";
import type { UseCase } from "@/lib/domain/types";
import type { CoverageResult } from "@/lib/domain/industry-coverage";

export function SummaryCardsSection({
  useCases,
  coverageData,
  onUseCasesClick,
  onOverviewClick,
  onInsightsOpen,
  onOutcomeMapClick,
}: {
  useCases: UseCase[];
  coverageData: CoverageResult | null;
  onUseCasesClick: () => void;
  onOverviewClick: () => void;
  onInsightsOpen: () => void;
  onOutcomeMapClick?: () => void;
}) {
  const avgScore =
    useCases.length > 0
      ? Math.round(
          (useCases.reduce((s, uc) => s + effectiveScores(uc).overall, 0) / useCases.length) * 100,
        )
      : null;

  const avgSentiment =
    avgScore == null
      ? ("neutral" as const)
      : avgScore >= 70
        ? ("positive" as const)
        : avgScore >= 40
          ? ("neutral" as const)
          : ("warning" as const);

  return (
    <div className="grid gap-4 md:grid-cols-5">
      <SummaryCard
        icon={<BrainCircuit className="h-4 w-4 text-primary" />}
        title="Total Use Cases"
        value={String(useCases.length)}
        detail={`${useCases.filter((uc) => uc.type === "AI").length} AI \u00b7 ${useCases.filter((uc) => uc.type === "Statistical").length} Statistical`}
        tip={RUN_DETAIL.totalUseCases}
        onClick={onUseCasesClick}
      />
      <SummaryCard
        icon={<Layers className="h-4 w-4 text-sky-500" />}
        title="Domains"
        value={String(new Set(useCases.map((uc) => uc.domain)).size)}
        tip={RUN_DETAIL.domainCount}
        onClick={() => {
          onOverviewClick();
          onInsightsOpen();
        }}
      />
      <SummaryCard
        icon={<BarChart3 className="h-4 w-4 text-violet-500" />}
        title="AI Use Cases"
        value={String(useCases.filter((uc) => uc.type === "AI").length)}
        tip={RUN_DETAIL.aiUseCases}
        onClick={onUseCasesClick}
      />
      <SummaryCard
        icon={<Gauge className="h-4 w-4 text-emerald-500" />}
        title="Avg Score"
        value={avgScore != null ? `${avgScore}%` : "N/A"}
        sentiment={avgSentiment}
        tip={RUN_DETAIL.avgScore}
        onClick={onOverviewClick}
      />
      <CoverageGapCard
        coverageData={coverageData}
        onClick={
          onOutcomeMapClick ??
          (() => {
            onOverviewClick();
            onInsightsOpen();
          })
        }
      />
    </div>
  );
}
