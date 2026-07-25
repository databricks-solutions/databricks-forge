"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SummaryCard } from "@/components/pipeline/run-detail/summary-card";
import { LabelWithTip } from "@/components/ui/info-tip";
import { staggerContainer, staggerItem } from "@/lib/motion";
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BrainCircuit,
  Copy,
  ExternalLink,
  FlaskConical,
  Link2,
  Loader2,
  MessageSquare,
  Sparkles,
  Table2,
} from "lucide-react";
import type { SpaceMetadata } from "@/lib/genie/space-metadata";
import type { ImproveStats } from "@/lib/genie/improve-jobs";

// ── Tooltip text for stats ──────────────────────────────────────────

const TIPS = {
  tables: "Number of Unity Catalog tables registered as data sources in this Genie Space.",
  measures:
    "Aggregate SQL snippets (SUM, COUNT, AVG, etc.) that Genie can use to answer measure-type questions.",
  sampleQuestions:
    "Pre-configured natural language questions shown to users as conversation starters.",
  filters:
    "Predefined SQL WHERE-clause snippets that Genie applies when users mention specific filter terms.",
  joins:
    "JOIN specifications telling Genie how to combine tables. More joins = richer cross-table answers.",
  benchmarks: "Test questions with expected answers used to measure and track Genie accuracy.",
} as const;

// ── Main Component ──────────────────────────────────────────────────

interface SpaceOverviewTabProps {
  spaceId: string;
  metadata: SpaceMetadata | null;
  domain: string | null;
  status: string;
  runId: string | null;
  genieUrl: string;
  canImprove: boolean;
  improving: boolean;
  fixing: boolean;
  cloning: boolean;
  onImprove: () => void;
  onClone: () => void;
}

export function SpaceOverviewTab({
  spaceId,
  metadata,
  domain,
  status,
  runId,
  genieUrl,
  canImprove,
  improving,
  fixing,
  cloning,
  onImprove,
  onClone,
}: SpaceOverviewTabProps) {
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {/* ── Stats Row ── */}
      <motion.div
        variants={staggerItem}
        className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6"
      >
        <SummaryCard
          icon={<Table2 className="h-4 w-4 text-primary" />}
          title="Tables"
          value={String(metadata?.tableCount ?? 0)}
          tip={TIPS.tables}
        />
        <SummaryCard
          icon={<BarChart3 className="h-4 w-4 text-violet-500" />}
          title="Measures"
          value={String(metadata?.measureCount ?? 0)}
          tip={TIPS.measures}
        />
        <SummaryCard
          icon={<MessageSquare className="h-4 w-4 text-sky-500" />}
          title="Sample Q's"
          value={String(metadata?.sampleQuestionCount ?? 0)}
          tip={TIPS.sampleQuestions}
        />
        <SummaryCard
          icon={<Link2 className="h-4 w-4 text-emerald-500" />}
          title="Filters"
          value={String(metadata?.filterCount ?? 0)}
          tip={TIPS.filters}
        />
        <SummaryCard
          icon={<Sparkles className="h-4 w-4 text-amber-500" />}
          title="Joins"
          value={String(metadata?.joinCount ?? 0)}
          tip={TIPS.joins}
        />
        <SummaryCard
          icon={<FlaskConical className="h-4 w-4 text-chart-4" />}
          title="Benchmarks"
          value={String(metadata?.benchmarkCount ?? 0)}
          tip={TIPS.benchmarks}
        />
      </motion.div>

      {/* ── Details Card ── */}
      <motion.div variants={staggerItem}>
        <Card>
          <CardContent className="pt-6 space-y-3 text-sm">
            {domain && (
              <div className="flex justify-between">
                <LabelWithTip label="Domain" tip="The business domain this Genie Space covers." />
                <span className="font-medium">{domain}</span>
              </div>
            )}
            <div className="flex justify-between">
              <LabelWithTip label="Space ID" tip="Unique Databricks Genie Space identifier." />
              <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{spaceId}</code>
            </div>
            <div className="flex justify-between">
              <LabelWithTip label="Status" tip="Current deployment status of the Genie Space." />
              <Badge variant="outline" className="text-xs">
                {status}
              </Badge>
            </div>
            {metadata?.metricViewCount != null && metadata.metricViewCount > 0 && (
              <div className="flex justify-between">
                <LabelWithTip
                  label="Metric Views"
                  tip="Unity Catalog metric views attached as data sources."
                />
                <span className="font-medium">{metadata.metricViewCount}</span>
              </div>
            )}
            {metadata?.expressionCount != null && metadata.expressionCount > 0 && (
              <div className="flex justify-between">
                <LabelWithTip
                  label="Expressions"
                  tip="Named SQL expressions (calculated columns) available to Genie."
                />
                <span className="font-medium">{metadata.expressionCount}</span>
              </div>
            )}
            {metadata?.exampleSqlCount != null && metadata.exampleSqlCount > 0 && (
              <div className="flex justify-between">
                <LabelWithTip
                  label="Example SQLs"
                  tip="Question-SQL pairs that teach Genie how to translate specific question patterns."
                />
                <span className="font-medium">{metadata.exampleSqlCount}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Quick Actions ── */}
      <motion.div variants={staggerItem} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {canImprove && (
          <button className="group text-left" onClick={onImprove} disabled={improving || fixing}>
            <Card className="h-full border-primary/20 transition-all hover:-translate-y-0.5 hover:shadow-md">
              <CardContent className="flex h-full items-center gap-4 pt-6">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 transition-colors group-hover:bg-primary/15">
                  {improving ? (
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  ) : (
                    <BrainCircuit className="h-5 w-5 text-primary" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold">Improve with Engine</p>
                  <p className="text-xs text-muted-foreground">Full LLM analysis</p>
                </div>
                <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
              </CardContent>
            </Card>
          </button>
        )}

        {genieUrl && (
          <a href={genieUrl} target="_blank" rel="noopener noreferrer" className="group">
            <Card className="h-full transition-all hover:-translate-y-0.5 hover:shadow-md">
              <CardContent className="flex h-full items-center gap-4 pt-6">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 transition-colors group-hover:bg-sky-500/15">
                  <ExternalLink className="h-5 w-5 text-sky-500" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold">Open in Databricks</p>
                  <p className="text-xs text-muted-foreground">View in Genie UI</p>
                </div>
                <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
              </CardContent>
            </Card>
          </a>
        )}

        <Link href={`/genie/${spaceId}/benchmarks`} className="group">
          <Card className="h-full transition-all hover:-translate-y-0.5 hover:shadow-md">
            <CardContent className="flex h-full items-center gap-4 pt-6">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-chart-4/10 transition-colors group-hover:bg-chart-4/15">
                <FlaskConical className="h-5 w-5 text-chart-4" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold">Run Benchmarks</p>
                <p className="text-xs text-muted-foreground">Test accuracy</p>
              </div>
              <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
            </CardContent>
          </Card>
        </Link>

        <button className="group text-left" onClick={onClone} disabled={cloning}>
          <Card className="h-full transition-all hover:-translate-y-0.5 hover:shadow-md">
            <CardContent className="flex h-full items-center gap-4 pt-6">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 transition-colors group-hover:bg-emerald-500/15">
                {cloning ? (
                  <Loader2 className="h-5 w-5 animate-spin text-emerald-500" />
                ) : (
                  <Copy className="h-5 w-5 text-emerald-500" />
                )}
              </div>
              <div className="min-w-0">
                <p className="font-semibold">Clone Space</p>
                <p className="text-xs text-muted-foreground">Duplicate config</p>
              </div>
              <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
            </CardContent>
          </Card>
        </button>
      </motion.div>

      {/* ── View Run (link only) ── */}
      {runId && (
        <motion.div variants={staggerItem}>
          <Button size="sm" variant="ghost" asChild>
            <Link href={`/runs/${runId}?tab=genie`}>View Pipeline Run</Link>
          </Button>
        </motion.div>
      )}
    </motion.div>
  );
}

// ── Improvement Advice (before/after comparison) ────────────────────

const STAT_LABELS: {
  key: keyof ImproveStats;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "tables", label: "Tables", icon: Table2 },
  { key: "joins", label: "Joins", icon: Sparkles },
  { key: "measures", label: "Measures", icon: BarChart3 },
  { key: "filters", label: "Filters", icon: Link2 },
  { key: "dimensions", label: "Expressions", icon: MessageSquare },
  { key: "benchmarks", label: "Benchmarks", icon: FlaskConical },
  { key: "sampleQuestions", label: "Sample Questions", icon: MessageSquare },
  { key: "exampleSqls", label: "Example SQLs", icon: BarChart3 },
  { key: "metricViews", label: "Metric Views", icon: BarChart3 },
];

export function ImprovementAdvice({
  statsBefore,
  statsAfter,
}: {
  statsBefore: ImproveStats;
  statsAfter: ImproveStats;
}) {
  const improved = STAT_LABELS.filter(
    ({ key }) => (statsAfter[key] as number) > (statsBefore[key] as number),
  );
  const totalBefore = Object.values(statsBefore).reduce(
    (s, v) => s + (typeof v === "number" ? v : 0),
    0,
  );
  const totalAfter = Object.values(statsAfter).reduce(
    (s, v) => s + (typeof v === "number" ? v : 0),
    0,
  );

  return (
    <Card className="border-violet-200 bg-violet-50/50 dark:border-violet-800 dark:bg-violet-950/20">
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center gap-2 text-base font-semibold">
          <BrainCircuit className="size-5 text-violet-500" />
          Why the improved version is better
        </div>
        <p className="text-sm text-muted-foreground">
          The Genie Engine ran a full analysis across all tables — adding LLM-generated joins,
          measures, filters, benchmarks, and enriched instructions that the Quick Build did not
          include.
          {totalAfter > totalBefore && (
            <span className="font-medium text-violet-600 dark:text-violet-400">
              {" "}
              The improved configuration is{" "}
              {Math.round(((totalAfter - totalBefore) / Math.max(totalBefore, 1)) * 100)}% richer
              overall.
            </span>
          )}
        </p>

        {improved.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {improved.map(({ key, label, icon: Icon }) => {
              const before = statsBefore[key] as number;
              const after = statsAfter[key] as number;
              return (
                <div
                  key={key}
                  className="flex items-center gap-2 rounded-md border bg-background px-3 py-2"
                >
                  <Icon className="size-4 shrink-0 text-violet-500" />
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="flex items-baseline gap-1.5 text-sm">
                      <span className="text-muted-foreground line-through">{before}</span>
                      <ArrowUpRight className="inline size-3 text-green-500" />
                      <span className="font-semibold text-green-600">{after}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
