"use client";

/**
 * State of the Nation — the consultant-grade estate diagnosis.
 *
 * Renders the persisted ForgeEstateSynthesis for a scan: a readiness scorecard
 * (overall + six sub-scores on a radar), an evidence-backed executive brief,
 * value-at-risk, and click-through strengths / risks / quick-wins findings that
 * each route to the Forge engine that remediates them.
 *
 * Loading / empty / error states are all handled; "Regenerate diagnosis" is the
 * dominant CTA.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle,
  ArrowRight,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type {
  EstateFinding,
  EstateScores,
  EstateSynthesisResult,
  Evidence,
} from "@/lib/domain/estate-synthesis-types";
import { useL10n } from "@/i18n/format";

interface SynthesisResponse extends EstateSynthesisResult {
  id?: string;
  scanId?: string | null;
  createdAt?: string;
}

interface StateOfTheNationProps {
  scanId: string;
  /** Optional CTA the empty-state surfaces when there is nothing to diagnose. */
  onScan?: () => void;
}

const SUBSCORE_KEYS: Array<keyof Omit<EstateScores, "overall" | "band">> = [
  "governance",
  "quality",
  "freshness",
  "documentation",
  "analyticsMaturity",
  "cost",
];

function bandColor(band: string): string {
  switch (band) {
    case "leading":
      return "text-green-600";
    case "established":
      return "text-emerald-600";
    case "developing":
      return "text-amber-600";
    default:
      return "text-red-600";
  }
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-green-600";
  if (score >= 40) return "text-amber-600";
  return "text-red-600";
}

function severityVariant(
  sev: EstateFinding["severity"],
): "default" | "secondary" | "destructive" | "outline" {
  if (sev === "critical" || sev === "high") return "destructive";
  if (sev === "positive") return "default";
  return "secondary";
}

function EvidenceList({
  evidence,
  label,
}: {
  evidence: Evidence[];
  label: string;
}) {
  const t = useTranslations("estate_intelligence.findings");
  if (!evidence || evidence.length === 0) return null;
  return (
    <div className="mt-2 space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <ul className="space-y-1">
        {evidence.map((ev, i) => {
          let text = "";
          if (ev.tier === "sourced") {
            text = [ev.quote ? `“${ev.quote}”` : "", ev.sourceTitle || ev.sourceUrl || ""]
              .filter(Boolean)
              .join(" — ");
          } else if (ev.tier === "benchmark") {
            text = [ev.benchmarkLabel, ev.benchmarkRange].filter(Boolean).join(": ");
          } else {
            text = ev.rationale ?? "";
          }
          if (!text.trim()) return null;
          return (
            <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="shrink-0 text-[10px] capitalize">
                {t(`evidence_tier.${ev.tier}` as "evidence_tier.sourced")}
              </Badge>
              <span>{text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FindingCard({ finding }: { finding: EstateFinding }) {
  const t = useTranslations("estate_intelligence.findings");
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-sm font-semibold">{finding.title}</CardTitle>
          <Badge variant={severityVariant(finding.severity)} className="shrink-0 capitalize">
            {t(`severity.${finding.severity}` as "severity.high")}
          </Badge>
        </div>
        <CardDescription>{finding.summary}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <EvidenceList evidence={finding.evidence} label={t("evidence_label")} />
        {finding.action?.href && (
          <Button asChild size="sm" variant="outline" className="mt-3">
            <Link href={finding.action.href}>
              {finding.action.label}
              <ArrowRight aria-hidden="true" className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function StateOfTheNation({ scanId, onScan }: StateOfTheNationProps) {
  const t = useTranslations("estate_intelligence");
  const l10n = useL10n();
  const [data, setData] = useState<SynthesisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const fetchSynthesis = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const resp = await fetch(`/api/environment/${scanId}/synthesis`);
      if (resp.status === 404) {
        setData(null);
        return;
      }
      if (!resp.ok) throw new Error("Failed");
      setData(await resp.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [scanId]);

  useEffect(() => {
    fetchSynthesis();
  }, [fetchSynthesis]);

  const regenerate = useCallback(async () => {
    setRegenerating(true);
    try {
      const resp = await fetch(`/api/environment/${scanId}/synthesis`, { method: "POST" });
      if (!resp.ok) throw new Error("Failed");
      setData(await resp.json());
      setError(false);
      toast.success(t("landing.title"));
    } catch {
      toast.error(t("landing.error_title"));
    } finally {
      setRegenerating(false);
    }
  }, [scanId, t]);

  const radarData = useMemo(() => {
    if (!data) return [];
    return SUBSCORE_KEYS.map((k) => ({
      metric: t(`readiness.subscores.${k}` as "readiness.subscores.governance"),
      score: data.scores?.[k] ?? 0,
    }));
  }, [data, t]);

  const grouped = useMemo(() => {
    const findings = data?.findings ?? [];
    const strengths = findings.filter((f) => f.severity === "positive");
    const quickWins = findings.filter(
      (f) =>
        f.severity !== "positive" &&
        (f.kind === "opportunity" ||
          f.kind === "query_ready_domain" ||
          f.kind === "value_quantification"),
    );
    const quickWinIds = new Set(quickWins.map((f) => f.id));
    const risks = findings.filter((f) => f.severity !== "positive" && !quickWinIds.has(f.id));
    return { strengths, risks, quickWins };
  }, [data]);

  // ---- Loading ------------------------------------------------------------
  if (loading) {
    return (
      <div className="space-y-4" role="status" aria-live="polite" aria-label={t("landing.loading")}>
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-48 md:col-span-1" />
          <Skeleton className="h-48 md:col-span-2" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  // ---- Error --------------------------------------------------------------
  if (error) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="flex flex-col items-center justify-center py-14 text-center">
          <AlertTriangle aria-hidden="true" className="mb-3 h-10 w-10 text-destructive/70" />
          <h3 className="text-lg font-semibold">{t("landing.error_title")}</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {t("landing.error_description")}
          </p>
          <Button className="mt-5" onClick={fetchSynthesis}>
            <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
            {t("landing.cta_regenerate")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ---- Empty --------------------------------------------------------------
  if (!data) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Sparkles aria-hidden="true" className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <h3 className="text-xl font-semibold">{t("landing.empty_title")}</h3>
          <p className="mt-2 max-w-md text-muted-foreground">{t("landing.empty_description")}</p>
          <div className="mt-6 flex gap-3">
            <Button onClick={regenerate} disabled={regenerating}>
              {regenerating ? (
                <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles aria-hidden="true" className="mr-2 h-4 w-4" />
              )}
              {t("landing.cta_regenerate")}
            </Button>
            {onScan && (
              <Button variant="outline" onClick={onScan}>
                {t("landing.cta_scan")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  const { scores, valueAtRisk, brief } = data;
  const fmtCurrency = (n: number) =>
    l10n.formatter.number(n, {
      style: "currency",
      currency: valueAtRisk?.currency || "USD",
      maximumFractionDigits: 0,
      notation: "compact",
    });

  return (
    <div className="space-y-6">
      {/* Header row with dominant regenerate CTA */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">{t("landing.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("landing.subtitle")}</p>
        </div>
        <Button onClick={regenerate} disabled={regenerating}>
          {regenerating ? (
            <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
          )}
          {t("landing.cta_regenerate")}
        </Button>
      </div>

      {/* Scorecard + radar */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("readiness.overall")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className={`text-5xl font-bold ${scoreColor(scores.overall)}`}>
                {l10n.integer(scores.overall)}
              </span>
              <span className="text-sm text-muted-foreground">{t("readiness.out_of")}</span>
            </div>
            <p className={`mt-1 text-sm font-semibold capitalize ${bandColor(scores.band)}`}>
              {t(`readiness.band.${scores.band}` as "readiness.band.leading")}
            </p>
            {valueAtRisk && (
              <div className="mt-4 rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("value_at_risk.title")}
                </p>
                <p className="mt-0.5 text-lg font-semibold text-red-600">
                  {t("value_at_risk.range", {
                    low: fmtCurrency(valueAtRisk.low),
                    mid: fmtCurrency(valueAtRisk.mid),
                    high: fmtCurrency(valueAtRisk.high),
                  })}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t("value_at_risk.caption")}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("readiness.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <ResponsiveContainer width="100%" height={220}>
                <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="72%">
                  <PolarGrid stroke="var(--color-border)" strokeOpacity={0.5} />
                  <PolarAngleAxis
                    dataKey="metric"
                    tick={{ fontSize: 10, fill: "var(--color-foreground)" }}
                  />
                  <PolarRadiusAxis
                    angle={90}
                    domain={[0, 100]}
                    tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
                    tickCount={5}
                    axisLine={false}
                  />
                  <Radar
                    name={t("readiness.score")}
                    dataKey="score"
                    stroke="oklch(0.55 0.22 25)"
                    fill="oklch(0.55 0.22 25)"
                    fillOpacity={0.15}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--color-card)",
                      borderColor: "var(--color-border)",
                      borderRadius: "var(--radius)",
                      fontSize: 12,
                    }}
                    formatter={(value) => [`${value}/100`, undefined]}
                  />
                </RadarChart>
              </ResponsiveContainer>
              <div className="flex flex-col justify-center gap-2">
                {SUBSCORE_KEYS.map((k) => (
                  <div key={k} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {t(`readiness.subscores.${k}` as "readiness.subscores.governance")}
                    </span>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${scores[k] ?? 0}%` }}
                        />
                      </div>
                      <span className={`w-7 text-right text-xs font-semibold ${scoreColor(scores[k] ?? 0)}`}>
                        {scores[k] ?? 0}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Executive brief */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("brief.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {brief.estateShape && (
            <p className="text-muted-foreground">{brief.estateShape}</p>
          )}
          <div className="grid gap-3 md:grid-cols-3">
            <BriefBlock title={t("brief.situation")} body={brief.situationComplicationResolution?.situation} />
            <BriefBlock
              title={t("brief.complication")}
              body={brief.situationComplicationResolution?.complication}
            />
            <BriefBlock
              title={t("brief.resolution")}
              body={brief.situationComplicationResolution?.resolution}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <BriefBlock title={t("brief.strengths")} body={brief.strengths} />
            <BriefBlock title={t("brief.critical_risks")} body={brief.criticalRisks} />
            <BriefBlock title={t("brief.quick_wins")} body={brief.quickWins} />
            <BriefBlock
              title={t("brief.strategic_recommendations")}
              body={brief.strategicRecommendations}
            />
          </div>
        </CardContent>
      </Card>

      {/* Findings */}
      <div>
        <h3 className="mb-3 text-base font-semibold">{t("findings.title")}</h3>
        <Tabs defaultValue="risks">
          <TabsList>
            <TabsTrigger value="risks" className="gap-1.5">
              <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
              {t("findings.risks_tab")} ({grouped.risks.length})
            </TabsTrigger>
            <TabsTrigger value="quick_wins" className="gap-1.5">
              <TrendingUp aria-hidden="true" className="h-3.5 w-3.5" />
              {t("findings.quick_wins_tab")} ({grouped.quickWins.length})
            </TabsTrigger>
            <TabsTrigger value="strengths" className="gap-1.5">
              <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
              {t("findings.strengths_tab")} ({grouped.strengths.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="risks" className="mt-4">
            <FindingGrid findings={grouped.risks} emptyLabel={t("findings.empty")} />
          </TabsContent>
          <TabsContent value="quick_wins" className="mt-4">
            <FindingGrid findings={grouped.quickWins} emptyLabel={t("findings.empty")} />
          </TabsContent>
          <TabsContent value="strengths" className="mt-4">
            <FindingGrid findings={grouped.strengths} emptyLabel={t("findings.empty")} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function BriefBlock({ title, body }: { title: string; body?: string }) {
  if (!body || !body.trim()) return null;
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="mt-1 text-sm">{body}</p>
    </div>
  );
}

function FindingGrid({
  findings,
  emptyLabel,
}: {
  findings: EstateFinding[];
  emptyLabel: string;
}) {
  if (findings.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {findings.map((f) => (
        <FindingCard key={f.id} finding={f} />
      ))}
    </div>
  );
}
