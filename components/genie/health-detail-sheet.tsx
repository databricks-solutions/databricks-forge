"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  PartyPopper,
  Shield,
  Sparkles,
  Wrench,
  XCircle,
  FlaskConical,
  Lightbulb,
  Zap,
} from "lucide-react";
import type { SpaceHealthReport } from "@/lib/genie/health-checks/types";
import Link from "next/link";

interface HealthDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string;
  spaceTitle: string;
  report: SpaceHealthReport | null;
  loading?: boolean;
  onFix?: (checkIds: string[]) => void;
  fixing?: boolean;
}

function gradeColor(grade: string): string {
  switch (grade) {
    case "A":
    case "B":
      return "text-green-600";
    case "C":
      return "text-amber-600";
    case "D":
    case "F":
      return "text-red-600";
    default:
      return "text-muted-foreground";
  }
}

function gradeBg(grade: string): string {
  switch (grade) {
    case "A":
    case "B":
      return "bg-green-100 dark:bg-green-900/30";
    case "C":
      return "bg-amber-100 dark:bg-amber-900/30";
    case "D":
    case "F":
      return "bg-red-100 dark:bg-red-900/30";
    default:
      return "bg-muted";
  }
}

function severityIcon(severity: string) {
  switch (severity) {
    case "critical":
      return <XCircle className="size-4 text-red-500" />;
    case "warning":
      return <AlertTriangle className="size-4 text-amber-500" />;
    case "info":
      return <Info className="size-4 text-blue-500" />;
    default:
      return null;
  }
}

export function HealthDetailSheet({
  open,
  onOpenChange,
  spaceId,
  spaceTitle,
  report,
  loading,
  onFix,
  fixing,
}: HealthDetailSheetProps) {
  if (!report && !loading) return null;

  const fixableChecks = report?.checks.filter((c) => !c.passed && c.fixable) ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Shield className="size-5" />
            Health Report
          </SheetTitle>
          <SheetDescription className="truncate" title={spaceTitle}>
            {spaceTitle}
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : report ? (
          <div className="mt-6 space-y-6">
            {/* Maturity tier chip — answers "is this safe to deploy?" at a glance */}
            <MaturityTierChip tier={report.maturityTier} />

            {/* Score header */}
            <div className={`flex items-center gap-4 rounded-lg p-4 ${gradeBg(report.grade)}`}>
              <div className={`text-4xl font-bold ${gradeColor(report.grade)}`}>{report.grade}</div>
              <div>
                <div className="text-2xl font-semibold">{report.overallScore}/100</div>
                <div className="text-sm text-muted-foreground">
                  {report.fixableCount > 0 && (
                    <span className="text-amber-600">
                      {report.fixableCount} fixable issue{report.fixableCount !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Quick wins */}
            {report.quickWins.length > 0 && (
              <div className="space-y-2">
                <h3 className="flex items-center gap-1.5 text-sm font-medium">
                  <Lightbulb className="size-4 text-amber-500" />
                  Quick Wins
                </h3>
                <ul className="space-y-1.5">
                  {report.quickWins.map((qw, i) => (
                    <li key={i} className="rounded border bg-muted/50 px-3 py-2 text-sm">
                      {qw}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Synthesis results */}
            {report.synthesis && (
              <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-purple-500" />
                  <h3 className="text-sm font-medium">AI Assessment</h3>
                  <Badge
                    variant={report.synthesis.assessment === "good_to_go" ? "default" : "secondary"}
                    className="text-[10px]"
                  >
                    {report.synthesis.assessment === "good_to_go"
                      ? "Good to Go"
                      : report.synthesis.assessment === "quick_wins"
                        ? "Quick Wins Available"
                        : "Foundation Needed"}
                  </Badge>
                </div>
                {report.synthesis.assessmentRationale && (
                  <p className="text-xs text-muted-foreground">
                    {report.synthesis.assessmentRationale}
                  </p>
                )}

                {report.synthesis.celebrationPoints.length > 0 && (
                  <div className="space-y-1">
                    <h4 className="flex items-center gap-1 text-xs font-medium">
                      <PartyPopper className="size-3 text-green-500" />
                      What&apos;s Working Well
                    </h4>
                    <ul className="space-y-1">
                      {report.synthesis.celebrationPoints.map((point, i) => (
                        <li key={i} className="text-xs text-muted-foreground">
                          {point}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {report.synthesis.topQuickWins.length > 0 && (
                  <div className="space-y-1">
                    <h4 className="flex items-center gap-1 text-xs font-medium">
                      <Zap className="size-3 text-amber-500" />
                      Top Quick Wins
                    </h4>
                    <ul className="space-y-1">
                      {report.synthesis.topQuickWins.map((win, i) => (
                        <li key={i} className="text-xs text-muted-foreground">
                          {win}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {report.synthesis.compensatingStrengths.length > 0 && (
                  <div className="space-y-1">
                    <h4 className="text-xs font-medium">Compensating Strengths</h4>
                    {report.synthesis.compensatingStrengths.map((cs, i) => (
                      <p key={i} className="text-xs text-muted-foreground">
                        <span className="font-medium">{cs.coveringSection}</span> compensates for{" "}
                        <span className="font-medium">{cs.coveredSection}</span>: {cs.explanation}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Findings */}
            {report.findings && report.findings.length > 0 && (
              <div className="space-y-2">
                <h3 className="flex items-center gap-1.5 text-sm font-medium">
                  <AlertTriangle className="size-4 text-amber-500" />
                  Findings ({report.findings.length})
                </h3>
                {report.findings.map((finding, i) => (
                  <div key={i} className="flex items-start gap-2 rounded border px-3 py-2">
                    {severityIcon(finding.severity)}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">{finding.description}</div>
                      {finding.recommendation && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {finding.recommendation}
                        </div>
                      )}
                    </div>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {finding.category.replace(/_/g, " ")}
                    </Badge>
                  </div>
                ))}
              </div>
            )}

            {/* Fix All + Run Benchmarks buttons */}
            <div className="flex gap-2">
              {fixableChecks.length > 0 && onFix && (
                <Button
                  size="sm"
                  onClick={() => onFix(fixableChecks.map((c) => c.id))}
                  disabled={fixing}
                >
                  {fixing ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Wrench className="mr-2 size-4" />
                  )}
                  Fix All ({fixableChecks.length})
                </Button>
              )}
              <Button size="sm" variant="outline" asChild>
                <Link href={`/genie/${spaceId}/benchmarks`}>
                  <FlaskConical className="mr-2 size-4" />
                  Run Benchmarks
                </Link>
              </Button>
            </div>

            {/* Category breakdown */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Categories</h3>
              {Object.entries(report.categories).map(([catId, cat]) => (
                <div key={catId} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{cat.label}</span>
                    <span className="text-muted-foreground">
                      {cat.passed}/{cat.total} ({cat.score}%)
                    </span>
                  </div>
                  <Progress value={cat.score} className="h-2" />
                </div>
              ))}
            </div>

            {/* Individual checks */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium">All Checks</h3>
              {Object.entries(report.categories).map(([catId, cat]) => {
                const catChecks = report.checks.filter((c) => c.category === catId);
                if (catChecks.length === 0) return null;
                return (
                  <div key={catId} className="space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {cat.label}
                    </h4>
                    {catChecks.map((check) => (
                      <div
                        key={check.id}
                        className="flex items-start gap-2 rounded border px-3 py-2"
                      >
                        {check.passed ? (
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-500" />
                        ) : (
                          severityIcon(check.severity)
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-sm">{check.description}</div>
                          {check.detail && (
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {check.detail}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {!check.passed && check.fixable && onFix && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs"
                              onClick={() => onFix([check.id])}
                              disabled={fixing}
                            >
                              <Wrench className="mr-1 size-3" />
                              Fix
                            </Button>
                          )}
                          {!check.passed && (
                            <Badge
                              variant={check.severity === "critical" ? "destructive" : "secondary"}
                              className="text-[10px]"
                            >
                              {check.severity}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Customer-facing maturity tier chip. Sits above the letter grade and gives
 * an unambiguous "is this safe to deploy?" answer.
 */
function MaturityTierChip({ tier }: { tier: SpaceHealthReport["maturityTier"] }) {
  const meta =
    tier === "trusted"
      ? {
          label: "Trusted",
          icon: <CheckCircle2 className="size-3.5" />,
          className:
            "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
          subtitle: "Production-ready: meets all maturity criteria.",
        }
      : tier === "ready_to_optimize"
        ? {
            label: "Ready to Optimize",
            icon: <Sparkles className="size-3.5" />,
            className:
              "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
            subtitle: "Usable today; optimization will unlock more value.",
          }
        : {
            label: "Not Ready",
            icon: <AlertTriangle className="size-3.5" />,
            className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
            subtitle: "Foundation gaps — fix before sharing.",
          };
  return (
    <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs ${meta.className}`}>
      <span className="flex items-center gap-1.5 font-semibold uppercase tracking-wide">
        {meta.icon}
        {meta.label}
      </span>
      <span className="text-[11px] opacity-80">{meta.subtitle}</span>
    </div>
  );
}
