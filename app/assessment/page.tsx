"use client";

/**
 * WAF Assessment page.
 *
 * Customer-facing self-assessment against the Databricks Well-Architected
 * Framework. Runs deterministic SQL over `system.*` (OBO) and renders:
 *
 *   1. Per-pillar score cards (Governance / Reliability / Cost / Performance)
 *   2. Failing controls drill-down + per-pillar drill-downs
 *   3. "Fix with Forge" deep-link for controls mapped to a Forge engine
 *   4. CSV export for offline reporting
 *   5. History table with one-click compare against the latest run
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useMessages, useTranslations } from "next-intl";
import { useL10n } from "@/i18n/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeftRight,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  EyeOff,
  LayoutDashboard,
  Loader2,
  MessageCircle,
  Play,
  RotateCcw,
  Sparkles,
  Wrench,
} from "lucide-react";
import { PILLAR_LABEL } from "@/lib/engines/waf-assessment/types";
import { getCrossReference } from "@/lib/engines/waf-assessment/cross-references";
import type {
  WafAssessmentDetail,
  WafAssessmentSummary,
  WafControl,
  WafIgnoredResource,
  WafPillar,
  WafQualitativeAnswer,
  WafQualitativeResponse,
} from "@/lib/engines/waf-assessment/types";

interface ApiState {
  latest: WafAssessmentDetail | null;
  history: WafAssessmentSummary[];
  qualitativeControls: WafControl[];
  qualitativeResponses: WafQualitativeResponse[];
  ignored: WafIgnoredResource[];
}

const PILLAR_ORDER: WafPillar[] = [
  "governance",
  "interoperability_usability",
  "operational_excellence",
  "security_compliance_privacy",
  "reliability",
  "performance_efficiency",
  "cost_optimisation",
];

function scoreToVariant(score: number | null | undefined): "default" | "secondary" | "destructive" {
  if (score == null) return "secondary";
  if (score >= 75) return "default";
  if (score >= 40) return "secondary";
  return "destructive";
}

function useControlText() {
  const messages = useMessages() as {
    assessment?: { controls?: Record<string, { best_practice?: string; principle?: string }> };
  };
  return useCallback(
    (
      wafId: string,
      fallback: { bestPractice: string; principle: string },
    ): { bestPractice: string; principle: string } => {
      const entry = messages?.assessment?.controls?.[wafId];
      return {
        bestPractice: entry?.best_practice ?? fallback.bestPractice,
        principle: entry?.principle ?? fallback.principle,
      };
    },
    [messages],
  );
}

function useScoreLabel() {
  const t = useTranslations("assessment.score_label");
  return useCallback(
    (score: number | null | undefined): string => {
      if (score == null) return t("none");
      if (score >= 75) return t("mature");
      if (score >= 50) return t("progressing");
      if (score >= 25) return t("at_risk");
      return t("critical");
    },
    [t],
  );
}

type FixActionLabelKey = "fix_with_forge" | "open_estate" | "ask_forge" | "open_docs";
type FixAction =
  | { kind: "engine"; href: string; labelKey: FixActionLabelKey }
  | { kind: "docs"; href: string; labelKey: FixActionLabelKey };

/** Allow only http(s) absolute URLs or root-relative paths — blocks `javascript:`, `data:`, etc. */
const SAFE_HREF_RE = /^(https?:\/\/|\/)/;

function safeDocHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return SAFE_HREF_RE.test(value) ? value : null;
}

function fixAction(engine: string | null, paramsJson: string | null): FixAction | null {
  if (!engine) return null;
  let params: Record<string, unknown> = {};
  if (paramsJson) {
    try {
      params = JSON.parse(paramsJson);
    } catch {
      params = {};
    }
  }
  switch (engine) {
    case "comment-engine":
      return { kind: "engine", href: "/environment/comments", labelKey: "fix_with_forge" };
    case "estate-scan": {
      const reasonRaw = typeof params.reason === "string" ? params.reason : "";
      const reason = /^[a-z][a-z0-9-]{0,40}$/.test(reasonRaw) ? reasonRaw : "";
      const href = reason ? `/environment?reason=${reason}` : "/environment";
      return { kind: "engine", href, labelKey: "open_estate" };
    }
    case "tag-engine":
      return { kind: "engine", href: "/environment?tab=governance", labelKey: "fix_with_forge" };
    case "ask-forge": {
      const personaRaw = typeof params.persona === "string" ? params.persona : "";
      const persona = /^[a-z-]{1,32}$/.test(personaRaw) ? personaRaw : "tech";
      return { kind: "engine", href: `/ask-forge?persona=${persona}`, labelKey: "ask_forge" };
    }
    case "docs":
    default: {
      const href = safeDocHref(params.href);
      return href ? { kind: "docs", href, labelKey: "open_docs" } : null;
    }
  }
}

function CrossRefBadges({ wafId, pillar }: { wafId: string; pillar: WafPillar }) {
  const refs = getCrossReference(wafId, pillar);
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      <a
        href={refs.awsHref}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        title={refs.awsLabel}
      >
        {refs.awsLabel}
      </a>
      <a
        href={refs.azureHref}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        title={refs.azureLabel}
      >
        {refs.azureLabel}
      </a>
    </div>
  );
}

function pillarScoreFor(s: WafAssessmentSummary | null, p: WafPillar): number | null {
  if (!s) return null;
  if (p === "governance") return s.governanceScore;
  if (p === "interoperability_usability") return s.iuScore;
  if (p === "operational_excellence") return s.oeScore;
  if (p === "security_compliance_privacy") return s.scpScore;
  if (p === "reliability") return s.reliabilityScore;
  if (p === "cost_optimisation") return s.costScore;
  if (p === "performance_efficiency") return s.performanceScore;
  return null;
}

/** Build a CSV string + trigger a download. Client-side only. */
function downloadCsv(latest: WafAssessmentDetail): void {
  const headers = [
    "waf_id",
    "pillar",
    "principle",
    "best_practice",
    "score_percentage",
    "threshold_percentage",
    "met",
    "recommendation",
  ];
  // Cells starting with these characters are interpreted as formulas by
  // Excel/Sheets/Numbers — prefix with a single quote to neutralise.
  const FORMULA_LEAD = /^[=+\-@\t\r]/;
  const escape = (raw: string) => {
    const s = FORMULA_LEAD.test(raw) ? `'${raw}` : raw;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = latest.results.map((r) =>
    [
      r.wafId,
      PILLAR_LABEL[r.pillar],
      r.control.principle,
      r.control.bestPractice,
      r.scorePercentage.toFixed(1),
      r.thresholdPercentage.toFixed(0),
      r.thresholdMet ? "yes" : "no",
      r.control.recommendationIfNotMet ?? "",
    ]
      .map((v) => escape(String(v)))
      .join(","),
  );
  const csv = [headers.map(escape).join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = (latest.completedAt ?? latest.createdAt).slice(0, 10);
  a.href = url;
  a.download = `waf-assessment-${date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function AssessmentPage() {
  const locale = useLocale();
  const tPage = useTranslations("assessment.page");
  const tEmpty = useTranslations("assessment.empty_state");
  const tPartial = useTranslations("assessment.partial_run");
  const tTabs = useTranslations("assessment.tabs");
  const tToasts = useTranslations("assessment.toasts");
  const tShortPillar = useTranslations("assessment.pillar_short");
  const [data, setData] = useState<ApiState | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [deployingDashboard, setDeployingDashboard] = useState(false);
  const [deployingGenie, setDeployingGenie] = useState(false);
  const [dashboardUrl, setDashboardUrl] = useState<string | null>(null);
  const [genieUrl, setGenieUrl] = useState<string | null>(null);

  const refreshAssets = useCallback(async () => {
    try {
      const res = await fetch("/api/assessment/assets", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as {
        dashboard: { url: string } | null;
        genie: { url: string } | null;
      };
      setDashboardUrl(json.dashboard?.url ?? null);
      setGenieUrl(json.genie?.url ?? null);
    } catch {
      // best-effort; UI falls back to "Generate" buttons
    }
  }, []);

  useEffect(() => {
    void refreshAssets();
  }, [refreshAssets]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/assessment", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load assessment (${res.status})`);
      const json = (await res.json()) as ApiState;
      setData(json);
    } catch (error) {
      const message = error instanceof Error ? error.message : tToasts("load_failed");
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [tToasts]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runAssessment = useCallback(async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/assessment/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Run failed (${res.status})`);
      }
      const summary = (await res.json()) as WafAssessmentSummary;
      if (summary.status === "failed") {
        toast.error(summary.errorMessage ?? tToasts("failed"));
      } else {
        toast.success(tToasts("completed"));
      }
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : tToasts("start_failed");
      toast.error(message);
    } finally {
      setRunning(false);
    }
  }, [refresh, tToasts]);

  const generateDashboard = useCallback(async () => {
    setDeployingDashboard(true);
    try {
      const res = await fetch("/api/assessment/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publish: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Dashboard deploy failed (${res.status})`);
      const url = body.dashboardUrl as string | undefined;
      if (url) setDashboardUrl(url);
      toast.success(tToasts("dashboard_action", { action: body.action ?? "ready" }), {
        action: url
          ? { label: tToasts("open"), onClick: () => window.open(url, "_blank", "noopener") }
          : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : tToasts("dashboard_failed");
      toast.error(message);
    } finally {
      setDeployingDashboard(false);
      void refreshAssets();
    }
  }, [refreshAssets, tToasts]);

  const generateGenie = useCallback(async () => {
    setDeployingGenie(true);
    try {
      const res = await fetch("/api/assessment/genie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Genie deploy failed (${res.status})`);
      const url = body.spaceUrl as string | undefined;
      if (url) setGenieUrl(url);
      toast.success(tToasts("genie_action", { action: body.action ?? "ready" }), {
        action: url
          ? { label: tToasts("open"), onClick: () => window.open(url, "_blank", "noopener") }
          : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : tToasts("genie_failed");
      toast.error(message);
    } finally {
      setDeployingGenie(false);
      void refreshAssets();
    }
  }, [locale, refreshAssets, tToasts]);

  const saveQualitative = useCallback(
    async (input: { wafId: string; response: WafQualitativeAnswer; notes: string | null }) => {
      const res = await fetch("/api/assessment/qualitative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Save failed (${res.status})`);
      }
      await refresh();
    },
    [refresh],
  );

  const ignoreControl = useCallback(
    async (wafId: string) => {
      const reason = window.prompt(tToasts("ignore_prompt", { wafId }));
      if (!reason || !reason.trim()) return;
      const res = await fetch("/api/assessment/ignored", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wafId, reason: reason.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? tToasts("ignore_failed", { wafId }));
        return;
      }
      toast.success(tToasts("ignored_success", { wafId }));
      await refresh();
    },
    [refresh, tToasts],
  );

  const restoreIgnored = useCallback(
    async (id: string, wafId: string) => {
      const res = await fetch("/api/assessment/ignored", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? tToasts("restore_failed", { wafId }));
        return;
      }
      toast.success(tToasts("restore_success", { wafId }));
      await refresh();
    },
    [refresh, tToasts],
  );

  const latest = data?.latest ?? null;

  const notMet = useMemo(() => {
    if (!latest) return [];
    return latest.results
      .filter((r) => !r.thresholdMet)
      .sort((a, b) => a.scorePercentage - b.scorePercentage);
  }, [latest]);

  const byPillar = useMemo(() => {
    const map: Record<WafPillar, WafAssessmentDetail["results"]> = {
      governance: [],
      interoperability_usability: [],
      operational_excellence: [],
      security_compliance_privacy: [],
      reliability: [],
      cost_optimisation: [],
      performance_efficiency: [],
    };
    if (!latest) return map;
    for (const r of latest.results) {
      map[r.pillar].push(r);
    }
    for (const p of PILLAR_ORDER) {
      map[p].sort((a, b) => {
        if (a.thresholdMet !== b.thresholdMet) return a.thresholdMet ? 1 : -1;
        return a.scorePercentage - b.scorePercentage;
      });
    }
    return map;
  }, [latest]);

  const pillarStats = useMemo(() => {
    const stats: Record<WafPillar, { met: number; total: number }> = {
      governance: { met: 0, total: 0 },
      interoperability_usability: { met: 0, total: 0 },
      operational_excellence: { met: 0, total: 0 },
      security_compliance_privacy: { met: 0, total: 0 },
      reliability: { met: 0, total: 0 },
      cost_optimisation: { met: 0, total: 0 },
      performance_efficiency: { met: 0, total: 0 },
    };
    for (const p of PILLAR_ORDER) {
      const rows = byPillar[p];
      stats[p] = {
        met: rows.filter((r) => r.thresholdMet).length,
        total: rows.length,
      };
    }
    return stats;
  }, [byPillar]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{tPage("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tPage("subtitle_pre")} <code className="text-xs">system.*</code>{" "}
            {tPage("subtitle_post")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={runAssessment} disabled={running}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            {latest ? tPage("rerun_assessment") : tPage("run_assessment")}
          </Button>
          {dashboardUrl && (
            <Button
              variant="outline"
              onClick={() => window.open(dashboardUrl, "_blank", "noopener")}
              title={tPage("open_dashboard_title")}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              {tPage("open_dashboard")}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={generateDashboard}
            disabled={deployingDashboard}
            title={tPage(
              dashboardUrl ? "regenerate_dashboard_title" : "generate_dashboard_title",
            )}
          >
            {deployingDashboard ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <LayoutDashboard className="mr-2 h-4 w-4" />
            )}
            {tPage(dashboardUrl ? "regenerate_dashboard" : "generate_dashboard")}
          </Button>
          {genieUrl && (
            <Button
              variant="outline"
              onClick={() => window.open(genieUrl, "_blank", "noopener")}
              title={tPage("open_genie_title")}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              {tPage("open_genie")}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={generateGenie}
            disabled={deployingGenie}
            title={tPage(genieUrl ? "regenerate_genie_title" : "generate_genie_title")}
          >
            {deployingGenie ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <MessageCircle className="mr-2 h-4 w-4" />
            )}
            {tPage(genieUrl ? "regenerate_genie" : "generate_genie")}
          </Button>
          {latest && (
            <div className="ml-1 flex items-center gap-2 border-l border-border pl-3">
              <Button variant="outline" onClick={() => downloadCsv(latest)}>
                <Download className="mr-2 h-4 w-4" /> {tPage("export_csv")}
              </Button>
            </div>
          )}
        </div>
      </div>

      {loading && !data ? (
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : !latest && (data?.history.length ?? 0) > 0 ? (
        <div className="space-y-4">
          <Card className="border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20">
            <CardContent className="flex items-start gap-3 py-4 text-sm">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="font-medium">{tEmpty("failed_title")}</p>
                <p className="mt-1 text-muted-foreground">
                  {data?.history[0]?.errorMessage ?? tEmpty("failed_description")}
                </p>
              </div>
            </CardContent>
          </Card>
          <HistoryTable history={data?.history ?? []} latestId="" />
        </div>
      ) : !latest ? (
        <Card>
          <CardHeader>
            <CardTitle>{tEmpty("title")}</CardTitle>
            <CardDescription>
              {tEmpty("description_pre")} <strong>{tEmpty("description_run")}</strong>{" "}
              {tEmpty("description_post")}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <ScoreOverview
            summary={latest}
            qualitativeAnswered={data?.qualitativeResponses.length ?? 0}
            qualitativeTotal={data?.qualitativeControls.length ?? 0}
          />

          {latest.errorMessage && (
            <Card className="border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20">
              <CardContent className="flex items-start gap-3 py-4 text-sm">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div>
                  <p className="font-medium">{tPartial("title")}</p>
                  <p className="mt-1 text-muted-foreground">{latest.errorMessage}</p>
                </div>
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="failing">
            <ScrollableTabsRow>
              <TabsList className="w-max min-w-full justify-start [&>button]:flex-none">
                <TabsTrigger value="failing">
                  {tTabs("failing", { count: notMet.length })}
                </TabsTrigger>
                {PILLAR_ORDER.map((p) => (
                  <TabsTrigger key={p} value={p}>
                    {tShortPillar(p)} ({pillarStats[p].met}/{pillarStats[p].total})
                  </TabsTrigger>
                ))}
                <TabsTrigger value="qualitative">
                  {tTabs("qualitative", {
                    answered: data?.qualitativeResponses.length ?? 0,
                    total: data?.qualitativeControls.length ?? 0,
                  })}
                </TabsTrigger>
                <TabsTrigger value="ignored">
                  {tTabs("ignored", { count: data?.ignored.length ?? 0 })}
                </TabsTrigger>
                <TabsTrigger value="history">
                  {tTabs("history", { count: data?.history.length ?? 0 })}
                </TabsTrigger>
              </TabsList>
            </ScrollableTabsRow>

            <TabsContent value="failing" className="mt-4">
              {notMet.length === 0 ? (
                <Card>
                  <CardContent className="flex items-center gap-3 py-8">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    <p className="text-sm">{tTabs("all_passed")}</p>
                  </CardContent>
                </Card>
              ) : (
                <ResultsTable rows={notMet} showPillar onIgnore={ignoreControl} />
              )}
            </TabsContent>

            {PILLAR_ORDER.map((p) => (
              <TabsContent key={p} value={p} className="mt-4 space-y-3">
                <PillarHeader
                  pillar={p}
                  score={pillarScoreFor(latest, p)}
                  met={pillarStats[p].met}
                  total={pillarStats[p].total}
                />
                <ResultsTable rows={byPillar[p]} onIgnore={ignoreControl} />
              </TabsContent>
            ))}

            <TabsContent value="qualitative" className="mt-4">
              <QualitativeTab
                controls={data?.qualitativeControls ?? []}
                responses={data?.qualitativeResponses ?? []}
                onSave={saveQualitative}
              />
            </TabsContent>

            <TabsContent value="ignored" className="mt-4">
              <IgnoredTab ignored={data?.ignored ?? []} onRestore={restoreIgnored} />
            </TabsContent>

            <TabsContent value="history" className="mt-4">
              <HistoryTable
                history={data?.history ?? []}
                latestId={latest.assessmentId}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function ScrollableTabsRow({ children }: { children: React.ReactNode }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateState();
    const onScroll = () => updateState();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(updateState);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [updateState]);

  const scrollBy = (dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "left" ? -240 : 240, behavior: "smooth" });
  };

  return (
    <div className="relative">
      <div ref={scrollRef} className="overflow-x-auto">
        {children}
      </div>
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-background to-transparent transition-opacity ${canLeft ? "opacity-100" : "opacity-0"}`}
      />
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-background to-transparent transition-opacity ${canRight ? "opacity-100" : "opacity-0"}`}
      />
      {canLeft && (
        <button
          type="button"
          aria-label="Scroll tabs left"
          onClick={() => scrollBy("left")}
          className="absolute left-1 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-border/50 bg-background/80 text-foreground/80 shadow-sm backdrop-blur-sm transition hover:bg-background hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      {canRight && (
        <button
          type="button"
          aria-label="Scroll tabs right"
          onClick={() => scrollBy("right")}
          className="absolute right-1 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-border/50 bg-background/80 text-foreground/80 shadow-sm backdrop-blur-sm transition hover:bg-background hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function ScoreOverview({
  summary,
  qualitativeAnswered,
  qualitativeTotal,
}: {
  summary: WafAssessmentSummary;
  qualitativeAnswered: number;
  qualitativeTotal: number;
}) {
  const tOverview = useTranslations("assessment.overview");
  const tFullPillar = useTranslations("assessment.pillar_full");
  const getScoreLabel = useScoreLabel();
  const l10n = useL10n();
  const qualitativePending = qualitativeTotal - qualitativeAnswered;
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>{tOverview("overall")}</CardDescription>
          <CardTitle className="text-3xl">
            {summary.overallScore == null ? "—" : l10n.number(summary.overallScore)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Badge variant={scoreToVariant(summary.overallScore)}>
            {getScoreLabel(summary.overallScore)}
          </Badge>
          <p className="mt-2 text-xs text-muted-foreground">
            {tOverview("controls_met", {
              met: summary.metControls,
              total: summary.totalControls,
            })}{" "}
            · {tOverview("last_run_pre")}{" "}
            {l10n.dateTime(summary.completedAt ?? summary.createdAt)}
          </p>
        </CardContent>
      </Card>
      {PILLAR_ORDER.map((p) => {
        const score = pillarScoreFor(summary, p);
        return (
          <Card key={p}>
            <CardHeader className="pb-2">
              <CardDescription>{tFullPillar(p)}</CardDescription>
              <CardTitle className="text-3xl">{score == null ? "—" : l10n.number(score)}</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant={scoreToVariant(score)}>{getScoreLabel(score)}</Badge>
            </CardContent>
          </Card>
        );
      })}
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>{tOverview("qualitative")}</CardDescription>
          <CardTitle className="text-3xl tabular-nums">
            {qualitativeAnswered}/{qualitativeTotal || "—"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {qualitativeTotal === 0 ? (
            <Badge variant="secondary">{tOverview("no_controls")}</Badge>
          ) : qualitativePending === 0 ? (
            <Badge variant="default">{tOverview("complete")}</Badge>
          ) : (
            <Badge variant="destructive">
              {tOverview("pending", { count: qualitativePending })}
            </Badge>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {qualitativePending > 0 ? tOverview("answer_pending") : tOverview("all_answered")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function PillarHeader({
  pillar,
  score,
  met,
  total,
}: {
  pillar: WafPillar;
  score: number | null;
  met: number;
  total: number;
}) {
  const tFullPillar = useTranslations("assessment.pillar_full");
  const tHeader = useTranslations("assessment.pillar_header");
  const getScoreLabel = useScoreLabel();
  const l10n = useL10n();
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div>
          <div className="text-sm text-muted-foreground">{tFullPillar(pillar)}</div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-3xl font-semibold tabular-nums">
              {score == null ? "—" : l10n.number(score)}
            </span>
            <Badge variant={scoreToVariant(score)}>{getScoreLabel(score)}</Badge>
          </div>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <div className="font-medium text-foreground">
            {tHeader("controls_met", { met, total })}
          </div>
          {total > met && (
            <div className="mt-1 text-xs">
              {tHeader("failing_sorted", { count: total - met })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ResultsTable({
  rows,
  showPillar = false,
  onIgnore,
}: {
  rows: WafAssessmentDetail["results"];
  showPillar?: boolean;
  onIgnore?: (wafId: string) => Promise<void>;
}) {
  const tResults = useTranslations("assessment.results_table");
  const tShortPillar = useTranslations("assessment.pillar_short");
  const tActions = useTranslations("assessment.actions");
  const controlText = useControlText();
  const l10n = useL10n();
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[100px]">{tResults("control")}</TableHead>
            {showPillar && <TableHead>{tResults("pillar")}</TableHead>}
            <TableHead>{tResults("best_practice")}</TableHead>
            <TableHead className="text-right">{tResults("score")}</TableHead>
            <TableHead className="text-right">{tResults("threshold")}</TableHead>
            <TableHead className="w-[100px]">{tResults("status")}</TableHead>
            <TableHead className="w-[160px]">{tResults("action")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const action = fixAction(r.control.fixActionEngine, r.control.fixActionParamsJson);
            const ct = controlText(r.wafId, {
              bestPractice: r.control.bestPractice,
              principle: r.control.principle,
            });
            return (
              <TableRow key={r.wafId}>
                <TableCell className="font-mono text-xs">{r.wafId}</TableCell>
                {showPillar && (
                  <TableCell className="text-sm">{tShortPillar(r.pillar)}</TableCell>
                )}
                <TableCell className="text-sm">
                  <div className="font-medium">{ct.bestPractice}</div>
                  <div className="text-xs text-muted-foreground">{ct.principle}</div>
                  {!r.thresholdMet && r.control.recommendationIfNotMet && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-muted-foreground">
                        {tResults("recommendation")}
                      </summary>
                      <pre className="mt-1 max-w-3xl whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                        {r.control.recommendationIfNotMet}
                      </pre>
                    </details>
                  )}
                  <CrossRefBadges wafId={r.wafId} pillar={r.pillar} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {l10n.number(r.scorePercentage)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {l10n.integer(r.thresholdPercentage)}
                </TableCell>
                <TableCell>
                  {r.thresholdMet ? (
                    <Badge variant="default" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" /> {tResults("met")}
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1">
                      <AlertCircle className="h-3 w-3" /> {tResults("not_met")}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    {!r.thresholdMet && action ? (
                      <Button size="sm" variant="outline" asChild>
                        {action.kind === "docs" ? (
                          <a href={action.href} target="_blank" rel="noopener noreferrer">
                            <BookOpen className="mr-1.5 h-3.5 w-3.5" /> {tActions(action.labelKey)}
                          </a>
                        ) : (
                          <Link href={action.href}>
                            <Wrench className="mr-1.5 h-3.5 w-3.5" /> {tActions(action.labelKey)}
                          </Link>
                        )}
                      </Button>
                    ) : !r.thresholdMet ? (
                      <Button size="sm" variant="ghost" asChild>
                        <Link href="/ask-forge">
                          <Sparkles className="mr-1.5 h-3.5 w-3.5" /> {tResults("ask_forge")}
                        </Link>
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                    {!r.thresholdMet && onIgnore && (
                      <Button
                        size="sm"
                        variant="ghost"
                        title={tResults("ignore_title")}
                        onClick={() => void onIgnore(r.wafId)}
                      >
                        <EyeOff className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

function HistoryTable({
  history,
  latestId,
}: {
  history: WafAssessmentSummary[];
  latestId: string;
}) {
  const tHistory = useTranslations("assessment.history");
  const l10n = useL10n();
  const fmt = (v: number | null | undefined) => (v == null ? "—" : l10n.number(v));
  if (history.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {tHistory("no_runs")}
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tHistory("when")}</TableHead>
            <TableHead>{tHistory("status")}</TableHead>
            <TableHead className="text-right">{tHistory("overall")}</TableHead>
            <TableHead className="text-right">{tHistory("governance")}</TableHead>
            <TableHead className="text-right">{tHistory("iu")}</TableHead>
            <TableHead className="text-right">{tHistory("oe")}</TableHead>
            <TableHead className="text-right">{tHistory("scp")}</TableHead>
            <TableHead className="text-right">{tHistory("reliability")}</TableHead>
            <TableHead className="text-right">{tHistory("cost")}</TableHead>
            <TableHead className="text-right">{tHistory("performance")}</TableHead>
            <TableHead className="text-right">{tHistory("met_total")}</TableHead>
            <TableHead className="w-[140px]">{tHistory("compare")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.map((h) => {
            const isLatest = h.assessmentId === latestId;
            const canCompare = h.status === "completed" && !isLatest;
            return (
              <TableRow key={h.assessmentId}>
                <TableCell className="text-sm">
                  {l10n.dateTime(h.createdAt)}
                  {isLatest && (
                    <span className="ml-2 text-xs text-muted-foreground">{tHistory("latest")}</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={h.status === "completed" ? "default" : "secondary"}>
                    {h.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmt(h.overallScore)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(h.governanceScore)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(h.iuScore)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(h.oeScore)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(h.scpScore)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(h.reliabilityScore)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(h.costScore)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(h.performanceScore)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {h.metControls} / {h.totalControls}
                </TableCell>
                <TableCell>
                  {canCompare ? (
                    <Button size="sm" variant="ghost" asChild>
                      <Link
                        href={`/assessment/compare?from=${encodeURIComponent(
                          h.assessmentId,
                        )}&to=${encodeURIComponent(latestId)}`}
                      >
                        <ArrowLeftRight className="mr-1.5 h-3.5 w-3.5" /> {tHistory("vs_latest")}
                      </Link>
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

function IgnoredTab({
  ignored,
  onRestore,
}: {
  ignored: WafIgnoredResource[];
  onRestore: (id: string, wafId: string) => Promise<void>;
}) {
  const tIgnored = useTranslations("assessment.ignored");
  const l10n = useL10n();
  if (ignored.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {tIgnored("empty")}
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[120px]">{tIgnored("control")}</TableHead>
            <TableHead className="w-[140px]">{tIgnored("scope")}</TableHead>
            <TableHead>{tIgnored("reason")}</TableHead>
            <TableHead className="w-[160px]">{tIgnored("ignored_at")}</TableHead>
            <TableHead className="w-[160px]">{tIgnored("by")}</TableHead>
            <TableHead className="w-[100px]">{tIgnored("restore")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ignored.map((row) => {
            const scope =
              row.resourceType && row.resourceId
                ? `${row.resourceType}: ${row.resourceId}`
                : tIgnored("whole_control");
            return (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">{row.wafId}</TableCell>
                <TableCell className="text-xs">{scope}</TableCell>
                <TableCell className="text-sm whitespace-pre-wrap">{row.reason}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {l10n.dateTime(row.createdAt)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {row.ignoredBy ?? "—"}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void onRestore(row.id, row.wafId)}
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> {tIgnored("restore")}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

function QualitativeTab({
  controls,
  responses,
  onSave,
}: {
  controls: WafControl[];
  responses: WafQualitativeResponse[];
  onSave: (input: {
    wafId: string;
    response: WafQualitativeAnswer;
    notes: string | null;
  }) => Promise<void>;
}) {
  const tQualitative = useTranslations("assessment.qualitative");
  const responseByWafId = useMemo(() => {
    const map = new Map<string, WafQualitativeResponse>();
    for (const r of responses) map.set(r.wafId, r);
    return map;
  }, [responses]);

  if (controls.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {tQualitative("empty")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="py-4 text-xs text-muted-foreground">
          {tQualitative("intro_pre")} <strong>{tQualitative("yes")}</strong>{" "}
          {tQualitative("intro_yes_score")}, <strong>{tQualitative("partial")}</strong>{" "}
          {tQualitative("intro_partial_score")}, <strong>{tQualitative("no")}</strong>{" "}
          {tQualitative("intro_no_score")}, <strong>{tQualitative("na")}</strong>{" "}
          {tQualitative("intro_na_score")}. {tQualitative("intro_post")}
        </CardContent>
      </Card>
      {controls.map((control) => (
        <QualitativeRow
          key={control.wafId}
          control={control}
          response={responseByWafId.get(control.wafId) ?? null}
          onSave={onSave}
        />
      ))}
    </div>
  );
}

function QualitativeRow({
  control,
  response,
  onSave,
}: {
  control: WafControl;
  response: WafQualitativeResponse | null;
  onSave: (input: {
    wafId: string;
    response: WafQualitativeAnswer;
    notes: string | null;
  }) => Promise<void>;
}) {
  const tQualitative = useTranslations("assessment.qualitative");
  const tFullPillar = useTranslations("assessment.pillar_full");
  const controlText = useControlText();
  const ct = controlText(control.wafId, {
    bestPractice: control.bestPractice,
    principle: control.principle,
  });
  const l10n = useL10n();
  const [answer, setAnswer] = useState<WafQualitativeAnswer | "">(response?.response ?? "");
  const [notes, setNotes] = useState<string>(response?.notes ?? "");
  const [saving, setSaving] = useState(false);

  const dirty = answer !== (response?.response ?? "") || notes !== (response?.notes ?? "");

  const optionLabel = (opt: WafQualitativeAnswer) =>
    opt === "not_applicable" ? tQualitative("na") : tQualitative(opt);

  const handleSave = useCallback(async () => {
    if (!answer) {
      toast.error(tQualitative("pick_answer"));
      return;
    }
    setSaving(true);
    try {
      await onSave({ wafId: control.wafId, response: answer, notes: notes.trim() || null });
      toast.success(tQualitative("saved_toast", { wafId: control.wafId }));
    } catch (error) {
      const message = error instanceof Error ? error.message : tQualitative("save_failed");
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }, [answer, notes, control.wafId, onSave, tQualitative]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{control.wafId}</span>
            <Badge variant="outline" className="text-xs">
              {tFullPillar(control.pillar)}
            </Badge>
            {response ? (
              <Badge variant="default" className="text-xs">
                {tQualitative("answered")}
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">
                {tQualitative("pending_response")}
              </Badge>
            )}
          </div>
          <CardTitle className="text-base">{ct.bestPractice}</CardTitle>
          <CardDescription className="text-xs">{ct.principle}</CardDescription>
          <CrossRefBadges wafId={control.wafId} pillar={control.pillar} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {control.details && (
          <p className="text-xs text-muted-foreground whitespace-pre-wrap">{control.details}</p>
        )}
        <ToggleGroup
          type="single"
          value={answer}
          onValueChange={(v: string) => v && setAnswer(v as WafQualitativeAnswer)}
          className="justify-start"
        >
          {(["yes", "partial", "no", "not_applicable"] as WafQualitativeAnswer[]).map((opt) => (
            <ToggleGroupItem key={opt} value={opt} className="px-3 text-xs">
              {optionLabel(opt)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={tQualitative("notes_placeholder")}
          className="min-h-[60px] text-xs"
        />
        <div className="flex items-center justify-end gap-2">
          {response && (
            <span className="text-xs text-muted-foreground">
              {tQualitative("last_updated", { date: l10n.dateTime(response.updatedAt) })}
            </span>
          )}
          <Button size="sm" onClick={handleSave} disabled={!dirty || saving || !answer}>
            {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            {tQualitative("save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
