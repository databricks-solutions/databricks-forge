"use client";

/**
 * Portfolio State of the Nation — the cross-estate CDO roll-up.
 *
 * Org-admin-only (gated server-side by requirePortfolioAccess). Shows the
 * enterprise inventory, portfolio KPIs, and the AI-synthesised cross-estate
 * fragmentation / federated opportunities / org uplift plan. Board-pack PDF
 * export is the dominant secondary action.
 *
 * Loading / empty / error / forbidden states are all handled.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Building2, Download, Loader2, Network, RefreshCw, ShieldAlert } from "lucide-react";
import type { PortfolioOverview } from "@/lib/lakebase/portfolio-estate";
import type { PortfolioSynthesisResult } from "@/lib/ai/portfolio-synthesis/types";
import { ManageAccessDialog } from "@/components/portfolio/manage-access-dialog";
import { useL10n } from "@/i18n/format";

interface SynthesisState {
  overview: PortfolioOverview;
  synthesis: PortfolioSynthesisResult | null;
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-green-600";
  if (score >= 40) return "text-amber-600";
  return "text-red-600";
}

function severityVariant(
  sev: "critical" | "high" | "medium" | "low",
): "destructive" | "secondary" | "outline" {
  if (sev === "critical" || sev === "high") return "destructive";
  if (sev === "medium") return "secondary";
  return "outline";
}

export function PortfolioStateOfTheNation() {
  const t = useTranslations("portfolio");
  const l10n = useL10n();
  const fmtUsd = (n: number) =>
    l10n.formatter.number(n, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
      notation: "compact",
    });
  const [data, setData] = useState<SynthesisState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [synthLoading, setSynthLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(false);
    setForbidden(false);
    try {
      const resp = await fetch("/api/portfolio");
      if (resp.status === 403) {
        setForbidden(true);
        return;
      }
      if (!resp.ok) throw new Error("Failed");
      const body = await resp.json();
      setData({ overview: body.overview, synthesis: null });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  const runSynthesis = useCallback(async () => {
    setSynthLoading(true);
    try {
      const resp = await fetch("/api/portfolio/fragmentation");
      if (!resp.ok) throw new Error("Failed");
      const body = await resp.json();
      setData((prev) =>
        prev
          ? { ...prev, synthesis: body.synthesis as PortfolioSynthesisResult }
          : { overview: body.overview, synthesis: body.synthesis },
      );
    } catch {
      toast.error(t("synthesis_error"));
    } finally {
      setSynthLoading(false);
    }
  }, [t]);

  const exportPdf = useCallback(async () => {
    setExporting(true);
    try {
      const resp = await fetch("/api/portfolio/export", { method: "POST" });
      if (!resp.ok) throw new Error("Failed");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "forge-portfolio-board-pack.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("export_error"));
    } finally {
      setExporting(false);
    }
  }, [t]);

  // ---- Forbidden ----------------------------------------------------------
  if (forbidden) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <ShieldAlert aria-hidden="true" className="mb-3 h-10 w-10 text-destructive/70" />
          <h3 className="text-lg font-semibold">{t("forbidden_title")}</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{t("forbidden_description")}</p>
        </CardContent>
      </Card>
    );
  }

  // ---- Loading ------------------------------------------------------------
  if (loading) {
    return (
      <div className="space-y-4" role="status" aria-live="polite" aria-label={t("loading")}>
        <Skeleton className="h-24" />
        <div className="grid gap-4 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  // ---- Error --------------------------------------------------------------
  if (error || !data) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="flex flex-col items-center justify-center py-14 text-center">
          <AlertTriangle aria-hidden="true" className="mb-3 h-10 w-10 text-destructive/70" />
          <h3 className="text-lg font-semibold">{t("error_title")}</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{t("error_description")}</p>
          <Button className="mt-5" onClick={fetchOverview}>
            <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
            {t("retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { overview, synthesis } = data;
  const { totals, inventory } = overview;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Building2 aria-hidden="true" className="h-6 w-6 text-primary" />
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <ManageAccessDialog />
          <Button variant="outline" onClick={runSynthesis} disabled={synthLoading}>
            {synthLoading ? (
              <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Network aria-hidden="true" className="mr-2 h-4 w-4" />
            )}
            {t("run_synthesis")}
          </Button>
          <Button onClick={exportPdf} disabled={exporting}>
            {exporting ? (
              <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download aria-hidden="true" className="mr-2 h-4 w-4" />
            )}
            {t("export_pdf")}
          </Button>
        </div>
      </div>

      {/* Totals */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label={t("kpi.avg_readiness")} value={l10n.integer(totals.avgReadiness)} valueClass={scoreColor(totals.avgReadiness)} />
        <KpiCard label={t("kpi.estates")} value={l10n.integer(totals.estates)} />
        <KpiCard label={t("kpi.scans")} value={l10n.integer(totals.scans)} />
        <KpiCard label={t("kpi.tables")} value={l10n.integer(totals.tables)} />
        <KpiCard label={t("kpi.value_at_risk")} value={fmtUsd(totals.totalValueAtRisk)} valueClass="text-red-600" />
      </div>

      {/* Enterprise inventory */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("inventory.title")}</CardTitle>
          <CardDescription>{t("inventory.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
            <Stat label={t("inventory.domains")} value={inventory.domains} />
            <Stat label={t("inventory.data_products")} value={inventory.dataProducts} />
            <Stat label={t("inventory.ai_models")} value={inventory.workloads.model ?? 0} />
            <Stat label={t("inventory.pii_tables")} value={inventory.piiTables} />
            <Stat label={t("inventory.genie_spaces")} value={inventory.workloads.genie_space ?? 0} />
            <Stat label={t("inventory.dashboards")} value={inventory.workloads.dashboard ?? 0} />
            <Stat label={t("inventory.metric_views")} value={inventory.workloads.metric_view ?? 0} />
          </div>
        </CardContent>
      </Card>

      {/* Synthesis: fragmentation + opportunities + uplift */}
      {synthLoading && !synthesis ? (
        <Skeleton className="h-48" />
      ) : synthesis ? (
        <>
          {synthesis.headline && (
            <Card>
              <CardContent className="py-4">
                <p className="text-sm font-medium">{synthesis.headline}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("fragmentation.title")}</CardTitle>
              <CardDescription>{t("fragmentation.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {synthesis.fragmentation.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">{t("fragmentation.empty")}</p>
              ) : (
                synthesis.fragmentation.map((c) => (
                  <div key={c.label} className="rounded-md border bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{t("fragmentation.quoted_entity", { label: c.label })}</p>
                      <Badge variant="secondary">{t("fragmentation.estate_count", { count: c.estates.length })}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {c.estates.join(" · ")} — {t("fragmentation.tables", { count: c.totalTables })}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("opportunities.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {synthesis.opportunities.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">{t("opportunities.empty")}</p>
              ) : (
                synthesis.opportunities.map((o) => (
                  <div key={o.id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium">{o.title}</p>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={severityVariant(o.severity)} className="capitalize">
                          {t(`severity.${o.severity}` as "severity.high")}
                        </Badge>
                        <span className="text-sm font-semibold text-red-600">{fmtUsd(o.valueUsd)}</span>
                      </div>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{o.summary}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("uplift.title")}</CardTitle>
              <CardDescription>{t("uplift.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {synthesis.upliftPlan.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">{t("uplift.empty")}</p>
              ) : (
                synthesis.upliftPlan.map((a) => (
                  <div key={a.id} className="rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{t("uplift.phase", { phase: a.phase })}</Badge>
                      <p className="font-medium">{a.title}</p>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{a.rationale}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("uplift.owner")}: {a.owner} · {t("uplift.effort")}: {a.effort.toUpperCase()} ·{" "}
                      {t("uplift.cost")}: {fmtUsd(a.costUsd)} · {t("uplift.value")}: {fmtUsd(a.valueUsd)}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Network aria-hidden="true" className="mb-3 h-10 w-10 text-muted-foreground/50" />
            <h3 className="text-base font-semibold">{t("synthesis_empty_title")}</h3>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">{t("synthesis_empty_description")}</p>
            <Button className="mt-4" onClick={runSynthesis} disabled={synthLoading}>
              <Network aria-hidden="true" className="mr-2 h-4 w-4" />
              {t("run_synthesis")}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KpiCard({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-bold ${valueClass ?? ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const l10n = useL10n();
  return (
    <div className="rounded-md border bg-muted/20 p-3 text-center">
      <p className="text-xl font-bold">{l10n.integer(value)}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
