"use client";

/**
 * WAF Assessment compare view.
 *
 * Diffs two assessments (`from` baseline vs. `to` comparison) and groups
 * controls by drift category:
 *   - Regressed: was met, now not met (most important — top of page)
 *   - Improved:  was not met, now met
 *   - Score moved: same status, but score delta beyond a small noise floor
 *   - Unchanged: collapsed by default
 *
 * Linked from the History tab on /assessment.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { PILLAR_LABEL } from "@/lib/engines/waf-assessment/types";
import type {
  WafAssessmentDetail,
  WafPillar,
} from "@/lib/engines/waf-assessment/types";

const PILLAR_ORDER: WafPillar[] = [
  "governance",
  "interoperability_usability",
  "operational_excellence",
  "security_compliance_privacy",
  "reliability",
  "performance_efficiency",
  "cost_optimisation",
];

const SCORE_DRIFT_THRESHOLD = 5;

interface DiffRow {
  wafId: string;
  pillar: WafPillar;
  bestPractice: string;
  principle: string;
  fromScore: number | null;
  toScore: number | null;
  fromMet: boolean | null;
  toMet: boolean | null;
  threshold: number | null;
  category: "regressed" | "improved" | "moved" | "unchanged" | "added" | "removed";
  delta: number | null;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function pillarScoreFor(d: WafAssessmentDetail | null, p: WafPillar): number | null {
  if (!d) return null;
  if (p === "governance") return d.governanceScore;
  if (p === "interoperability_usability") return d.iuScore;
  if (p === "operational_excellence") return d.oeScore;
  if (p === "security_compliance_privacy") return d.scpScore;
  if (p === "reliability") return d.reliabilityScore;
  if (p === "cost_optimisation") return d.costScore;
  if (p === "performance_efficiency") return d.performanceScore;
  return null;
}

function fmtScore(n: number | null): string {
  return n == null ? "—" : n.toFixed(1);
}

function scoreToVariant(score: number | null): "default" | "secondary" | "destructive" {
  if (score == null) return "secondary";
  if (score >= 75) return "default";
  if (score >= 40) return "secondary";
  return "destructive";
}

export default function AssessmentComparePage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <CompareInner />
    </Suspense>
  );
}

function CompareInner() {
  const searchParams = useSearchParams();
  const fromId = searchParams?.get("from") ?? "";
  const toId = searchParams?.get("to") ?? "";

  const [from, setFrom] = useState<WafAssessmentDetail | null>(null);
  const [to, setTo] = useState<WafAssessmentDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!fromId || !toId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [fromRes, toRes] = await Promise.all([
          fetch(`/api/assessment/${encodeURIComponent(fromId)}`, { cache: "no-store" }),
          fetch(`/api/assessment/${encodeURIComponent(toId)}`, { cache: "no-store" }),
        ]);
        if (!fromRes.ok) throw new Error(`Baseline failed (${fromRes.status})`);
        if (!toRes.ok) throw new Error(`Comparison failed (${toRes.status})`);
        const fromJson = (await fromRes.json()) as WafAssessmentDetail;
        const toJson = (await toRes.json()) as WafAssessmentDetail;
        if (!cancelled) {
          setFrom(fromJson);
          setTo(toJson);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load comparison";
        toast.error(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fromId, toId]);

  const diff = useMemo(() => buildDiff(from, to), [from, to]);

  if (!fromId || !toId) {
    return (
      <div className="mx-auto max-w-[1100px] space-y-4">
        <BackLink />
        <Card>
          <CardHeader>
            <CardTitle>Missing assessments</CardTitle>
            <CardDescription>
              The compare view needs a <code>from</code> and a <code>to</code> assessment ID. Pick a
              past run from the <Link href="/assessment" className="underline">History tab</Link> to
              compare against the latest.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <BackLink />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Compare Assessments</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drift between a baseline run and a comparison run. Regressions appear first.
        </p>
      </div>

      {loading || !from || !to ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <ScoreCompare from={from} to={to} />
          <DriftSummary diff={diff} />
          <DriftSection
            title="Regressed"
            description="Controls that passed in the baseline but are failing now."
            tone="destructive"
            rows={diff.filter((r) => r.category === "regressed")}
          />
          <DriftSection
            title="Improved"
            description="Controls that were failing in the baseline and now pass."
            tone="positive"
            rows={diff.filter((r) => r.category === "improved")}
          />
          <DriftSection
            title="Score moved"
            description={`Same pass/fail status but score moved by more than ${SCORE_DRIFT_THRESHOLD} points.`}
            tone="neutral"
            rows={diff.filter((r) => r.category === "moved")}
          />
          {diff.some((r) => r.category === "added" || r.category === "removed") && (
            <DriftSection
              title="Catalog changes"
              description="Controls present in only one of the two runs (catalog evolved between runs)."
              tone="neutral"
              rows={diff.filter((r) => r.category === "added" || r.category === "removed")}
            />
          )}
          <DriftSection
            title="Unchanged"
            description="Same status, score within noise floor."
            tone="neutral"
            rows={diff.filter((r) => r.category === "unchanged")}
            collapsed
          />
        </>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link href="/assessment">
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to assessment
      </Link>
    </Button>
  );
}

function ScoreCompare({
  from,
  to,
}: {
  from: WafAssessmentDetail;
  to: WafAssessmentDetail;
}) {
  const rows: Array<{ label: string; from: number | null; to: number | null }> = [
    { label: "Overall", from: from.overallScore, to: to.overallScore },
    ...PILLAR_ORDER.map((p) => ({
      label: PILLAR_LABEL[p],
      from: pillarScoreFor(from, p),
      to: pillarScoreFor(to, p),
    })),
  ];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Score deltas</CardTitle>
        <CardDescription>
          <span className="font-medium">Baseline</span> {fmtDate(from.completedAt ?? from.createdAt)}{" "}
          → <span className="font-medium">Comparison</span>{" "}
          {fmtDate(to.completedAt ?? to.createdAt)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          {rows.map((r) => (
            <ScoreDeltaCard key={r.label} label={r.label} from={r.from} to={r.to} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ScoreDeltaCard({
  label,
  from,
  to,
}: {
  label: string;
  from: number | null;
  to: number | null;
}) {
  const delta = from != null && to != null ? to - from : null;
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">{fmtScore(to)}</span>
        <Badge variant={scoreToVariant(to)} className="text-[10px]">
          {to != null ? "now" : "—"}
        </Badge>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        Was {fmtScore(from)}{" "}
        {delta != null && delta !== 0 && (
          <DeltaBadge delta={delta} />
        )}
      </div>
    </div>
  );
}

function DeltaBadge({ delta }: { delta: number }) {
  const positive = delta > 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <span
      className={`ml-1 inline-flex items-center gap-0.5 font-medium ${
        positive ? "text-emerald-600" : "text-red-600"
      }`}
    >
      <Icon className="h-3 w-3" />
      {positive ? "+" : ""}
      {delta.toFixed(1)}
    </span>
  );
}

function DriftSummary({ diff }: { diff: DiffRow[] }) {
  const counts = {
    regressed: diff.filter((r) => r.category === "regressed").length,
    improved: diff.filter((r) => r.category === "improved").length,
    moved: diff.filter((r) => r.category === "moved").length,
    unchanged: diff.filter((r) => r.category === "unchanged").length,
    added: diff.filter((r) => r.category === "added").length,
    removed: diff.filter((r) => r.category === "removed").length,
  };
  return (
    <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
      <SummaryCell label="Regressed" value={counts.regressed} tone="destructive" />
      <SummaryCell label="Improved" value={counts.improved} tone="positive" />
      <SummaryCell label="Score moved" value={counts.moved} tone="neutral" />
      <SummaryCell label="Unchanged" value={counts.unchanged} tone="neutral" />
      {(counts.added > 0 || counts.removed > 0) && (
        <SummaryCell
          label="Catalog Δ"
          value={counts.added + counts.removed}
          tone="neutral"
        />
      )}
    </div>
  );
}

function SummaryCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "destructive" | "positive" | "neutral";
}) {
  const color =
    tone === "destructive"
      ? "text-red-600"
      : tone === "positive"
        ? "text-emerald-600"
        : "text-foreground";
  return (
    <Card>
      <CardContent className="flex items-center justify-between py-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</span>
      </CardContent>
    </Card>
  );
}

function DriftSection({
  title,
  description,
  tone,
  rows,
  collapsed = false,
}: {
  title: string;
  description: string;
  tone: "destructive" | "positive" | "neutral";
  rows: DiffRow[];
  collapsed?: boolean;
}) {
  if (rows.length === 0) return null;
  const accent =
    tone === "destructive"
      ? "border-l-4 border-l-red-500"
      : tone === "positive"
        ? "border-l-4 border-l-emerald-500"
        : "";
  if (collapsed) {
    return (
      <details className="rounded-md border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          {title} ({rows.length})
        </summary>
        <div className="border-t">
          <DriftTable rows={rows} />
        </div>
      </details>
    );
  }
  return (
    <Card className={accent}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {title} ({rows.length})
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <DriftTable rows={rows} />
      </CardContent>
    </Card>
  );
}

function DriftTable({ rows }: { rows: DiffRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[100px]">Control</TableHead>
          <TableHead>Pillar</TableHead>
          <TableHead>Best practice</TableHead>
          <TableHead className="text-right">Was</TableHead>
          <TableHead className="text-right">Now</TableHead>
          <TableHead className="text-right">Δ</TableHead>
          <TableHead className="w-[120px]">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.wafId}>
            <TableCell className="font-mono text-xs">{r.wafId}</TableCell>
            <TableCell className="text-sm">{PILLAR_LABEL[r.pillar]}</TableCell>
            <TableCell className="text-sm">
              <div className="font-medium">{r.bestPractice}</div>
              <div className="text-xs text-muted-foreground">{r.principle}</div>
            </TableCell>
            <TableCell className="text-right tabular-nums">{fmtScore(r.fromScore)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmtScore(r.toScore)}</TableCell>
            <TableCell className="text-right">
              {r.delta == null ? (
                <span className="text-xs text-muted-foreground">—</span>
              ) : r.delta === 0 ? (
                <Minus className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <DeltaBadge delta={r.delta} />
              )}
            </TableCell>
            <TableCell>
              <StatusPill row={r} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function StatusPill({ row }: { row: DiffRow }) {
  const passBadge = (
    <Badge variant="default" className="gap-1">
      <CheckCircle2 className="h-3 w-3" /> Met
    </Badge>
  );
  const failBadge = (
    <Badge variant="destructive" className="gap-1">
      <AlertCircle className="h-3 w-3" /> Not Met
    </Badge>
  );
  if (row.fromMet == null) return <span className="text-xs text-muted-foreground">added</span>;
  if (row.toMet == null) return <span className="text-xs text-muted-foreground">removed</span>;
  if (row.fromMet === row.toMet) return row.toMet ? passBadge : failBadge;
  return (
    <span className="text-xs">
      {row.fromMet ? "Met" : "Not"} → {row.toMet ? "Met" : "Not"}
    </span>
  );
}

function buildDiff(
  from: WafAssessmentDetail | null,
  to: WafAssessmentDetail | null,
): DiffRow[] {
  if (!from || !to) return [];
  const fromMap = new Map(from.results.map((r) => [r.wafId, r]));
  const toMap = new Map(to.results.map((r) => [r.wafId, r]));
  const ids = new Set<string>([...fromMap.keys(), ...toMap.keys()]);
  const rows: DiffRow[] = [];
  for (const id of ids) {
    const f = fromMap.get(id);
    const t = toMap.get(id);
    const ref = t ?? f;
    if (!ref) continue;
    const fromScore = f?.scorePercentage ?? null;
    const toScore = t?.scorePercentage ?? null;
    const fromMet = f?.thresholdMet ?? null;
    const toMet = t?.thresholdMet ?? null;
    const delta = fromScore != null && toScore != null ? toScore - fromScore : null;
    let category: DiffRow["category"];
    if (!f) category = "added";
    else if (!t) category = "removed";
    else if (fromMet === false && toMet === true) category = "improved";
    else if (fromMet === true && toMet === false) category = "regressed";
    else if (delta != null && Math.abs(delta) > SCORE_DRIFT_THRESHOLD) category = "moved";
    else category = "unchanged";
    rows.push({
      wafId: id,
      pillar: ref.pillar,
      bestPractice: ref.control.bestPractice,
      principle: ref.control.principle,
      fromScore,
      toScore,
      fromMet,
      toMet,
      threshold: ref.control.thresholdPercentage,
      category,
      delta,
    });
  }
  rows.sort((a, b) => {
    const order = ["regressed", "improved", "moved", "added", "removed", "unchanged"];
    const da = order.indexOf(a.category);
    const db = order.indexOf(b.category);
    if (da !== db) return da - db;
    if (a.pillar !== b.pillar) return PILLAR_ORDER.indexOf(a.pillar) - PILLAR_ORDER.indexOf(b.pillar);
    return a.wafId.localeCompare(b.wafId);
  });
  return rows;
}
