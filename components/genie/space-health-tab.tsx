"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileText,
  FlaskConical,
  Info,
  Lightbulb,
  Loader2,
  Shield,
  Sparkles,
  Wrench,
  XCircle,
} from "lucide-react";
import type { SpaceHealthReport, Severity } from "@/lib/genie/health-checks/types";

// ── Helpers ─────────────────────────────────────────────────────────

function gradeBg(grade: string): string {
  switch (grade) {
    case "A":
    case "B":
      return "bg-green-50 dark:bg-green-950/20";
    case "C":
      return "bg-amber-50 dark:bg-amber-950/20";
    case "D":
    case "F":
      return "bg-red-50 dark:bg-red-950/20";
    default:
      return "bg-muted";
  }
}

function gradeColor(grade: string): string {
  switch (grade) {
    case "A":
    case "B":
      return "text-green-600 dark:text-green-400";
    case "C":
      return "text-amber-600 dark:text-amber-400";
    case "D":
    case "F":
      return "text-red-600 dark:text-red-400";
    default:
      return "text-muted-foreground";
  }
}

function gradeBorder(grade: string): string {
  switch (grade) {
    case "A":
    case "B":
      return "border-green-200 dark:border-green-900";
    case "C":
      return "border-amber-200 dark:border-amber-900";
    case "D":
    case "F":
      return "border-red-200 dark:border-red-900";
    default:
      return "";
  }
}

function severityIcon(severity: Severity) {
  switch (severity) {
    case "critical":
      return <XCircle className="size-4 text-red-500" />;
    case "warning":
      return <AlertTriangle className="size-4 text-amber-500" />;
    case "info":
      return <Info className="size-4 text-blue-500" />;
  }
}

function progressColor(score: number): string {
  if (score >= 80) return "[&>div]:bg-green-500";
  if (score >= 50) return "[&>div]:bg-amber-500";
  return "[&>div]:bg-red-500";
}

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  data_sources: Database,
  instructions: FileText,
  semantic_richness: Sparkles,
  quality_assurance: Shield,
};

// ── Component ───────────────────────────────────────────────────────

interface SpaceHealthTabProps {
  report: SpaceHealthReport;
  spaceId: string;
  onFix: (checkIds: string[]) => void;
  fixing: boolean;
}

export function SpaceHealthTab({ report, spaceId, onFix, fixing }: SpaceHealthTabProps) {
  const fixableChecks = report.checks.filter((c) => !c.passed && c.fixable);

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {/* ── Grade Header Card ── */}
      <motion.div variants={staggerItem}>
        <Card className={cn(gradeBorder(report.grade), gradeBg(report.grade))}>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <div className={cn("text-5xl font-bold tracking-tight", gradeColor(report.grade))}>
                  {report.grade}
                </div>
                <div>
                  <div className="text-2xl font-semibold">{report.overallScore}/100</div>
                  {report.fixableCount > 0 && (
                    <Badge variant="destructive" className="mt-1 text-xs">
                      {report.fixableCount} fixable issue{report.fixableCount !== 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {fixableChecks.length > 0 && (
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
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Quick Wins ── */}
      {report.quickWins.length > 0 && (
        <motion.div variants={staggerItem} className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-medium">
            <Lightbulb className="size-4 text-amber-500" />
            Quick Wins
          </h3>
          <div className="space-y-1.5">
            {report.quickWins.map((qw, i) => (
              <div key={i} className="rounded-lg border bg-muted/50 px-4 py-2.5 text-sm">
                {qw}
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ── Category Cards ── */}
      <motion.div variants={staggerItem} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(report.categories).map(([catId, cat]) => {
          const Icon = CATEGORY_ICONS[catId] ?? Shield;
          return (
            <Card key={catId}>
              <CardContent className="pt-5 pb-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Icon className="size-4 text-muted-foreground" />
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {cat.label}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-bold">{cat.score}%</span>
                  <span className="text-xs text-muted-foreground">
                    {cat.passed}/{cat.total}
                  </span>
                </div>
                <Progress value={cat.score} className={cn("h-2", progressColor(cat.score))} />
              </CardContent>
            </Card>
          );
        })}
      </motion.div>

      {/* ── All Checks (collapsible by category) ── */}
      <motion.div variants={staggerItem} className="space-y-3">
        <h3 className="text-sm font-medium">All Checks</h3>
        <Accordion
          type="multiple"
          defaultValue={Object.entries(report.categories)
            .filter(([catId]) => report.checks.some((c) => c.category === catId && !c.passed))
            .map(([catId]) => catId)}
          className="w-full"
        >
          {Object.entries(report.categories).map(([catId, cat]) => {
            const catChecks = report.checks.filter((c) => c.category === catId);
            if (catChecks.length === 0) return null;
            const Icon = CATEGORY_ICONS[catId] ?? Shield;

            return (
              <AccordionItem key={catId} value={catId}>
                <AccordionTrigger className="text-sm">
                  <div className="flex items-center gap-2">
                    <Icon className="size-4 text-muted-foreground" />
                    <span>{cat.label}</span>
                    <Badge variant="secondary" className="ml-1 text-[10px]">
                      {cat.passed}/{cat.total}
                    </Badge>
                    {cat.passed === cat.total ? (
                      <CheckCircle2 className="size-3.5 text-green-500" />
                    ) : catChecks.some((c) => !c.passed && c.severity === "critical") ? (
                      <XCircle className="size-3.5 text-destructive" />
                    ) : (
                      <AlertTriangle className="size-3.5 text-amber-500" />
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-1.5">
                    {catChecks.map((check, idx) => (
                      <div
                        key={check.id}
                        className={cn(
                          "flex items-start gap-2.5 rounded-lg border px-4 py-2.5",
                          idx % 2 === 1 && "bg-muted/30",
                        )}
                      >
                        <div className="mt-0.5 shrink-0">
                          {check.passed ? (
                            <CheckCircle2 className="size-4 text-green-500" />
                          ) : (
                            severityIcon(check.severity)
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm">{check.description}</div>
                          {check.detail && (
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {check.detail}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {!check.passed && check.fixable && (
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
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </motion.div>
    </motion.div>
  );
}
