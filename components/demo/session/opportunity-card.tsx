"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  User,
  Zap,
  MessageSquare,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  HelpCircle,
  Target,
  AlertTriangle,
  GitBranch,
  CheckCircle2,
  ExternalLink,
  Quote as QuoteIcon,
  Clock,
} from "lucide-react";
import type {
  KillerMoment,
  DataAssetDetail,
  ResearchEngineResult,
  Evidence,
} from "@/lib/demo/research-engine/types";

interface OpportunityCardProps {
  moment: KillerMoment;
  rank: number;
  assetDetails?: DataAssetDetail[];
  onUseTalkTrack?: () => void;
}

function ConfidenceDot({ level }: { level: "high" | "medium" | "low" }) {
  const styles = {
    high: "bg-emerald-500",
    medium: "bg-amber-500",
    low: "bg-red-500",
  };
  return (
    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${styles[level]}`} />
      {level}
    </span>
  );
}

function evidenceBadgeClass(tier: Evidence["tier"]): string {
  if (tier === "sourced") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
  if (tier === "benchmark") return "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20";
  return "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20";
}

function EvidenceChip({ evidence }: { evidence: Evidence }) {
  const label = evidence.tier === "sourced" ? "Sourced" : evidence.tier === "benchmark" ? "Benchmark" : "Inferred";
  const tooltip =
    evidence.tier === "sourced"
      ? evidence.quote ?? evidence.claim ?? ""
      : evidence.tier === "benchmark"
        ? `${evidence.benchmarkLabel ?? ""} ${evidence.benchmarkRange ?? ""}`.trim()
        : evidence.rationale ?? evidence.claim ?? "";

  const chip = (
    <Badge variant="outline" className={`text-[10px] gap-1 ${evidenceBadgeClass(evidence.tier)}`}>
      {evidence.tier === "sourced" && <QuoteIcon className="h-2.5 w-2.5" />}
      {label}
      {evidence.sourceUrl && <ExternalLink className="h-2.5 w-2.5" />}
    </Badge>
  );

  if (evidence.sourceUrl) {
    return (
      <a
        href={evidence.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={tooltip}
        className="inline-flex hover:opacity-80 transition-opacity"
      >
        {chip}
      </a>
    );
  }
  return <span title={tooltip}>{chip}</span>;
}

export function OpportunityCard({
  moment,
  rank,
  assetDetails,
  onUseTalkTrack,
}: OpportunityCardProps) {
  const [expanded, setExpanded] = useState(rank <= 1);
  const isTop3 = rank <= 3;
  const linkedAssets = assetDetails?.filter((a) => moment.linkedAssets?.includes(a.id)) ?? [];
  const confidence = linkedAssets.some((a) => a.relevance >= 8)
    ? "high"
    : linkedAssets.some((a) => a.relevance >= 5)
      ? "medium"
      : "low";

  const hasExtendedContent =
    (moment.hypothesisTree && moment.hypothesisTree.length > 0) ||
    moment.quantifiedImpact ||
    moment.kpiDelta ||
    moment.riskOfInaction ||
    (moment.discoveryQuestions && moment.discoveryQuestions.length > 0) ||
    moment.measureOfSuccess ||
    (moment.evidence && moment.evidence.length > 0);

  return (
    <Card className={`transition-colors ${isTop3 ? "border-primary/20 shadow-sm" : ""}`}>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start gap-3">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              isTop3 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {rank}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold leading-snug">{moment.title}</h3>
            {moment.problemStatement ? (
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                {moment.problemStatement}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{moment.scenario}</p>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-2.5 text-sm">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-1">
              <Target className="h-3 w-3" />
              Value Hypothesis
            </span>
            <p className="mt-0.5 text-muted-foreground">{moment.insightStatement}</p>
          </div>
          {moment.dataStory && (
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                Data Story
              </span>
              <p className="mt-0.5 text-muted-foreground">{moment.dataStory}</p>
            </div>
          )}
        </div>

        {moment.quantifiedImpact && (
          <div className="mt-4 rounded-md border bg-emerald-500/5 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              Quantified Impact ({moment.quantifiedImpact.unit})
            </p>
            <div className="mt-1 grid grid-cols-3 gap-2 text-sm">
              <div>
                <p className="text-[10px] text-muted-foreground">Low</p>
                <p className="font-semibold">{moment.quantifiedImpact.low}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Mid</p>
                <p className="font-semibold">{moment.quantifiedImpact.mid}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">High</p>
                <p className="font-semibold">{moment.quantifiedImpact.high}</p>
              </div>
            </div>
            {moment.kpiDelta && (
              <p className="mt-2 text-xs text-muted-foreground border-t border-emerald-500/10 pt-2">
                <span className="font-semibold">KPI delta.</span> {moment.kpiDelta}
              </p>
            )}
          </div>
        )}

        {hasExtendedContent && (
          <>
            <button
              type="button"
              className="mt-3 text-xs text-primary flex items-center gap-1 hover:underline"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? "Hide detail" : "Show full consultant brief"}
            </button>

            {expanded && (
              <div className="mt-3 space-y-3 border-t pt-3">
                {moment.hypothesisTree && moment.hypothesisTree.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1">
                      <GitBranch className="h-3 w-3" />
                      Hypothesis Tree
                    </p>
                    <ul className="mt-1 space-y-1 text-sm">
                      {moment.hypothesisTree.map((h, i) => (
                        <li key={i} className="flex gap-2 text-muted-foreground">
                          <span className="text-primary font-mono text-xs mt-0.5">{i + 1}.</span>
                          <span>{h}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {moment.riskOfInaction && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-red-500" />
                      Risk of Inaction
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{moment.riskOfInaction}</p>
                  </div>
                )}

                {moment.discoveryQuestions && moment.discoveryQuestions.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1">
                      <HelpCircle className="h-3 w-3" />
                      Discovery Questions
                    </p>
                    <ul className="mt-1 space-y-1 text-sm">
                      {moment.discoveryQuestions.map((q, i) => (
                        <li key={i} className="flex gap-2 text-muted-foreground">
                          <span className="text-primary mt-0.5">•</span>
                          <span>{q}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {moment.measureOfSuccess && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      Measure of Success
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{moment.measureOfSuccess}</p>
                  </div>
                )}

                {moment.requiredDataAssets && moment.requiredDataAssets.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1">
                      <Sparkles className="h-3 w-3" />
                      Required Data Assets
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {moment.requiredDataAssets.map((id, i) => (
                        <Badge key={i} variant="outline" className="text-[10px] font-mono">
                          {id}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {moment.evidence && moment.evidence.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      Evidence
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {moment.evidence.map((e, i) => (
                        <EvidenceChip key={i} evidence={e} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {linkedAssets.length > 0 && (
            <Badge variant="outline" className="text-[10px] gap-1">
              <Sparkles className="h-3 w-3" />
              {linkedAssets.length} data asset{linkedAssets.length > 1 ? "s" : ""}
            </Badge>
          )}
          {moment.benchmarkCitation && (
            <Badge variant="secondary" className="text-[10px]">
              {moment.benchmarkCitation}
            </Badge>
          )}
          {moment.timeToValue && (
            <Badge variant="outline" className="text-[10px] gap-1">
              <Clock className="h-3 w-3" />
              {moment.timeToValue}
            </Badge>
          )}
          <ConfidenceDot level={confidence} />
          <Badge
            variant="outline"
            className="text-[10px] gap-1 border-amber-500/20 text-amber-600 dark:text-amber-400"
          >
            <Zap className="h-3 w-3" />
            {isTop3 ? "High" : "Medium"} urgency
          </Badge>
        </div>

        {onUseTalkTrack && (
          <div className="mt-3 pt-3 border-t flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <User className="h-3 w-3" />
              Ideal buyer: {moment.idealBuyerPersona ?? (linkedAssets.length > 0 ? "CxO / Head of Data" : "Line of Business")}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={onUseTalkTrack}
            >
              <MessageSquare className="h-3 w-3" />
              Use in Talk Track
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface OpportunitiesTabProps {
  research: ResearchEngineResult;
  onSwitchToTalkTrack?: () => void;
}

export function OpportunitiesTab({ research, onSwitchToTalkTrack }: OpportunitiesTabProps) {
  const moments = research.demoNarrative?.killerMoments ?? [];
  const assetDetails = research.dataStrategy?.assetDetails ?? [];

  if (moments.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        No opportunities generated yet. Run a Full research preset for detailed opportunity cards.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {moments.map((m, i) => (
        <OpportunityCard
          key={i}
          moment={m}
          rank={i + 1}
          assetDetails={assetDetails}
          onUseTalkTrack={onSwitchToTalkTrack}
        />
      ))}
    </div>
  );
}
