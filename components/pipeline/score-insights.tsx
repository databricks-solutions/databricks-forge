"use client";

import React, { useState } from "react";
import {
  Target,
  Gauge,
  Zap,
  ChevronDown,
  ChevronRight,
  Shield,
  Sparkles,
  Scale,
  FlaskConical,
  Presentation,
  Award,
} from "lucide-react";
import type {
  ScoreRationale,
  ConsultingScorecard,
  PriorityFactors,
  FeasibilityFactors,
} from "@/lib/domain/types";

interface ScoreInsightsProps {
  rationale: ScoreRationale | null;
  scorecard: ConsultingScorecard | null;
}

const PRIORITY_FACTOR_META: {
  key: keyof PriorityFactors;
  label: string;
  weight: string;
}[] = [
  { key: "roi", label: "Return on Investment", weight: "60%" },
  { key: "strategic_alignment", label: "Strategic Alignment", weight: "25%" },
  { key: "time_to_value", label: "Time to Value", weight: "7.5%" },
  { key: "reusability", label: "Reusability", weight: "7.5%" },
];

const FEASIBILITY_FACTOR_META: {
  key: keyof FeasibilityFactors;
  label: string;
}[] = [
  { key: "data_availability", label: "Data Availability" },
  { key: "data_accessibility", label: "Data Accessibility" },
  { key: "architecture_fitness", label: "Architecture Fitness" },
  { key: "team_skills", label: "Team Skills" },
  { key: "domain_knowledge", label: "Domain Knowledge" },
  { key: "people_allocation", label: "People Allocation" },
  { key: "budget_allocation", label: "Budget Allocation" },
  { key: "time_to_production", label: "Time to Production" },
];

const SCORECARD_META: {
  key: keyof Omit<ConsultingScorecard, "blendedScore">;
  label: string;
  icon: React.ReactNode;
}[] = [
  { key: "strategicAlignment", label: "Strategic Alignment", icon: <Target className="h-3 w-3" /> },
  { key: "measurableValue", label: "Measurable Value", icon: <Scale className="h-3 w-3" /> },
  {
    key: "implementationFeasibility",
    label: "Implementation Feasibility",
    icon: <FlaskConical className="h-3 w-3" />,
  },
  { key: "evidenceStrength", label: "Evidence Strength", icon: <Shield className="h-3 w-3" /> },
  { key: "novelty", label: "Novelty", icon: <Sparkles className="h-3 w-3" /> },
  {
    key: "boardroomDefensibility",
    label: "Boardroom Defensibility",
    icon: <Presentation className="h-3 w-3" />,
  },
];

function tierColor(score: number): string {
  if (score >= 0.7) return "bg-green-500 dark:bg-green-400";
  if (score >= 0.4) return "bg-amber-500 dark:bg-amber-400";
  return "bg-red-500 dark:bg-red-400";
}

function tierTextColor(score: number): string {
  if (score >= 0.7) return "text-green-700 dark:text-green-400";
  if (score >= 0.4) return "text-amber-700 dark:text-amber-400";
  return "text-red-700 dark:text-red-400";
}

function FactorBar({ label, score, weight }: { label: string; score: number; weight?: string }) {
  const pct = Math.round(score * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex w-[140px] shrink-0 items-center justify-between text-xs">
        <span className="text-muted-foreground truncate" title={label}>
          {label}
        </span>
        {weight && (
          <span className="ml-1 text-[10px] text-muted-foreground/60 shrink-0">{weight}</span>
        )}
      </div>
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${tierColor(score)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`w-9 text-right text-xs font-medium tabular-nums ${tierTextColor(score)}`}>
        {pct}%
      </span>
    </div>
  );
}

function InsightSection({
  icon,
  title,
  rationale,
  defaultOpen = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  rationale?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg border border-border/60">
      <button
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium hover:bg-muted/40 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="opacity-60">{icon}</span>
        <span className="flex-1">{title}</span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2.5">
          {rationale && (
            <p className="text-xs italic text-muted-foreground leading-relaxed">{rationale}</p>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

export function ScoreInsights({ rationale, scorecard }: ScoreInsightsProps) {
  if (!rationale && !scorecard) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Award className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Score Insights
        </p>
      </div>

      {rationale && (
        <>
          <InsightSection
            icon={<Target className="h-4 w-4 text-blue-500" />}
            title="Priority Breakdown"
            rationale={rationale.priority.rationale}
            defaultOpen
          >
            <div className="space-y-1.5">
              {PRIORITY_FACTOR_META.map((f) => (
                <FactorBar
                  key={f.key}
                  label={f.label}
                  score={rationale.priority.factors[f.key]}
                  weight={f.weight}
                />
              ))}
            </div>
          </InsightSection>

          <InsightSection
            icon={<Gauge className="h-4 w-4 text-orange-500" />}
            title="Feasibility Breakdown"
            rationale={rationale.feasibility.rationale}
            defaultOpen
          >
            <div className="space-y-1.5">
              {FEASIBILITY_FACTOR_META.map((f) => (
                <FactorBar
                  key={f.key}
                  label={f.label}
                  score={rationale.feasibility.factors[f.key]}
                />
              ))}
            </div>
          </InsightSection>

          <InsightSection
            icon={<Zap className="h-4 w-4 text-yellow-500" />}
            title="Impact"
            rationale={rationale.impact.rationale}
          >
            <div />
          </InsightSection>
        </>
      )}

      {scorecard && (
        <InsightSection
          icon={<Shield className="h-4 w-4 text-violet-500" />}
          title="Consulting Quality Signals"
        >
          <div className="space-y-1.5">
            {SCORECARD_META.map((s) => (
              <FactorBar key={s.key} label={s.label} score={scorecard[s.key]} />
            ))}
          </div>
        </InsightSection>
      )}
    </div>
  );
}
