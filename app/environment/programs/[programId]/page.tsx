"use client";

/**
 * Estate Program detail — the C-level Estate Overview for one company.
 *
 * Renders the company rollup, scan-coverage panel (which business areas have
 * been scanned), tier distribution + metadata-quality coverage, and the
 * company -> domain -> canonical entity -> table ontology tree. Also manages
 * the planned scan sequence (add scopes, run sequence) and exports the board
 * pack.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Building2,
  Play,
  Pause,
  Plus,
  Download,
  Loader2,
  ArrowRight,
  Trash2,
  Info,
  X,
  Ban,
  FileSpreadsheet,
} from "lucide-react";
import { toast } from "sonner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CatalogBrowser } from "@/components/pipeline/catalog-browser";
import { EstateTreeView } from "@/components/environment/estate-tree-view";
import { RelationshipsView } from "@/components/environment/relationships-view";
import { ScanProgressCard } from "@/components/environment/scan-progress-card";
import { EstateExecSummary, type ExecSummaryData } from "@/components/environment/estate-exec-summary";
import { ScopeRetryButton } from "@/components/environment/scope-retry-button";
import type { ScanProgressData } from "@/app/environment/types";
import {
  buildEstateTree,
  parseCanonicalEntities,
  type AggregateDetailRow,
  type AggregateInsightRow,
} from "@/lib/domain/estate-tree";
import { computeTierDistribution } from "@/lib/domain/estate-readiness";
import type { MetadataQualityCoverage } from "@/lib/domain/estate-readiness";
import type { TableDetail } from "@/lib/domain/types";
import { buildEstateScopeCreateInputs } from "@/lib/domain/estate-program-form";
import { estateProgramCapabilities } from "@/lib/domain/estate-program-permissions";
import { readApiError } from "@/lib/http/api-error";
import { useL10n } from "@/i18n/format";

interface Scope {
  id: string;
  label: string;
  ucMetadata: string;
  status: string;
  scanId: string | null;
  sequence: number;
  errorMessage: string | null;
  inclusionPatterns: string | null;
  workspaceId: string | null;
  teamLabel: string | null;
}

interface ProgramDetail {
  id: string;
  name: string;
  description: string | null;
  industryId: string | null;
  scopes: Scope[];
}

interface AggregatePayload {
  details: AggregateDetailRow[];
  insights: AggregateInsightRow[];
  stats: {
    totalTables: number;
    totalScans: number;
    totalSizeBytes: string;
    domainCount: number;
    assetInventory: {
      models: number;
      functions: number;
      genieSpaces: number;
      dashboards: number;
      metricViews: number;
    };
    /** Server-computed metadata-quality coverage (tags + column comments). */
    metadataCoverage: MetadataQualityCoverage;
    coverageByScope: Array<{
      ucPath: string;
      scanId: string;
      tableCount: number;
      scannedAt: string;
    }>;
  };
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  planned: "outline",
  queued: "secondary",
  running: "secondary",
  complete: "default",
  failed: "destructive",
  paused: "outline",
  cancelled: "destructive",
};

export default function EstateProgramDetailPage() {
  const t = useTranslations("estatePrograms.detail");
  const l10n = useL10n();
  const params = useParams<{ programId: string }>();
  const programId = params.programId;

  const router = useRouter();
  const [program, setProgram] = useState<ProgramDetail | null>(null);
  const [aggregate, setAggregate] = useState<AggregatePayload | null>(null);
  const [synthesis, setSynthesis] = useState<{
    scores?: { overall?: number; band?: string };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [permission, setPermission] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<
    { kind: "not_found" | "forbidden" | "error"; message: string } | null
  >(null);
  const [running, setRunning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgressData | null>(null);
  const [view, setView] = useState<"exec" | "detail">("exec");
  // Catalog/schema picker state for adding scopes (one scope per selection).
  const [pickerSources, setPickerSources] = useState<string[]>([]);
  const [inclusionPatterns, setInclusionPatterns] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [teamLabel, setTeamLabel] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/estate-programs/${programId}/aggregate`);
      if (!resp.ok) {
        const err = await readApiError(resp);
        // Distinguish real not-found, forbidden, and retryable failures so the
        // page can render the right dedicated state (no false success toast).
        const kind =
          err.category === "not_found"
            ? "not_found"
            : err.category === "forbidden" || err.category === "unauthorized"
              ? "forbidden"
              : "error";
        setLoadError({ kind, message: err.message });
        return;
      }
      setLoadError(null);
      const data = await resp.json();
      setProgram(data.program);
      setAggregate(data.aggregate);
      if (typeof data.permission === "string") setPermission(data.permission);
      // Prefer the persisted estate-level synthesis (read-only GET) for the
      // headline readiness so the overview matches the board pack + Portfolio.
      try {
        const sResp = await fetch(`/api/estate-programs/${programId}/synthesis`);
        setSynthesis(sResp.ok ? await sResp.json() : null);
      } catch {
        setSynthesis(null);
      }
    } catch (error) {
      setLoadError({
        kind: "error",
        message: error instanceof Error ? error.message : t("errors.load"),
      });
    } finally {
      setLoading(false);
    }
  }, [programId, t]);

  const caps = useMemo(() => estateProgramCapabilities(permission), [permission]);

  useEffect(() => {
    void load();
  }, [load]);

  const addScope = useCallback(async () => {
    const built = buildEstateScopeCreateInputs(pickerSources, {
      inclusionPatterns,
      workspaceId,
      teamLabel,
    });
    if (!built.ok) {
      toast.error(built.error);
      return;
    }
    const scopes = built.scopes;
    if (scopes.length === 0) {
      toast.error(t("errors.selectScope"));
      return;
    }
    try {
      const resp = await fetch(`/api/estate-programs/${programId}/scopes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scopes }),
      });
      if (!resp.ok) {
        const err = await readApiError(resp);
        throw new Error(err.message);
      }
      setPickerSources([]);
      setInclusionPatterns("");
      setWorkspaceId("");
      setTeamLabel("");
      toast.success(t("toast.scopesAdded", { count: scopes.length }));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("errors.addScopes"));
    }
  }, [pickerSources, inclusionPatterns, workspaceId, teamLabel, programId, load, t]);

  const removeScope = useCallback(
    async (scopeId: string) => {
      try {
        const resp = await fetch(`/api/estate-programs/${programId}/scopes/${scopeId}`, {
          method: "DELETE",
        });
        if (!resp.ok) {
          const err = await readApiError(resp);
          throw new Error(resp.status === 409 ? t("errors.removeActive") : err.message);
        }
        toast.success(t("toast.scopeRemoved"));
        await load();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("errors.removeScope"));
      }
    },
    [programId, load, t],
  );

  const deleteProgram = useCallback(async () => {
    // Client-side guard mirrors the server's 409: never delete mid-scan.
    const activeNow = (program?.scopes ?? []).some(
      (s) => s.status === "queued" || s.status === "running",
    );
    if (activeNow) {
      toast.error(t("errors.deleteActive"));
      return;
    }
    if (
      !window.confirm(
        t("deleteConfirm"),
      )
    )
      return;
    try {
      const resp = await fetch(`/api/estate-programs/${programId}`, { method: "DELETE" });
      if (!resp.ok) {
        const err = await readApiError(resp);
        throw new Error(err.message);
      }
      toast.success(t("toast.deleted"));
      router.push("/environment/programs");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("errors.delete"));
    }
  }, [programId, router, program, t]);

  const runSequence = useCallback(async () => {
    setRunning(true);
    try {
      const resp = await fetch(`/api/estate-programs/${programId}/run`, { method: "POST" });
      if (!resp.ok) {
        const err = await readApiError(resp);
        throw new Error(err.message);
      }
      const data = await resp.json();
      if (data.status === "idle") {
        toast.info(t("toast.noPlanned"));
      } else {
        toast.success(t("toast.started", { label: data.label ?? data.scopeId }));
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("errors.start"));
    } finally {
      setRunning(false);
    }
  }, [programId, load, t]);

  const controlSequence = useCallback(
    async (action: "pause" | "resume" | "cancel") => {
      try {
        const resp = await fetch(`/api/estate-programs/${programId}/${action}`, { method: "POST" });
        if (!resp.ok) {
          const err = await readApiError(resp);
          throw new Error(err.message);
        }
        toast.success(t(`toast.${action}` as "toast.pause"));
        await load();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("errors.control", { action: t(`actions.${action}` as "actions.pause") }));
      }
    },
    [programId, load, t],
  );

  // Build the tree + rollups client-side from the aggregate.
  const tree = useMemo(() => {
    if (!aggregate) return null;
    const entities = parseCanonicalEntities(aggregate.insights ?? []);
    return buildEstateTree(aggregate.details ?? [], entities);
  }, [aggregate]);

  const rollups = useMemo(() => {
    if (!aggregate) return null;
    const details = (aggregate.details ?? []).map(
      (d) =>
        ({
          fqn: (d.tableFqn ?? d.fqn ?? "") as string,
          comment: d.comment ?? null,
          generatedDescription: d.generatedDescription ?? null,
          owner: d.owner ?? null,
          dataTier: (d.dataTier ?? null) as TableDetail["dataTier"],
          dataDomain: d.dataDomain ?? null,
        }) as Pick<
          TableDetail,
          "fqn" | "comment" | "generatedDescription" | "owner" | "dataTier" | "dataDomain"
        >,
    );
    // Coverage is server-computed (tags + column comments) — consume it verbatim
    // rather than recomputing client-side with an empty-tag placeholder.
    const coverage = aggregate.stats.metadataCoverage;
    const tiers = computeTierDistribution(details);
    return { coverage, tiers };
  }, [aggregate]);

  // Assemble the exec-summary payload from aggregate + tree + rollups.
  const execData = useMemo<ExecSummaryData | null>(() => {
    if (!aggregate || !rollups || !tree) return null;
    // Overall readiness band from the gold/owned/documented signals.
    const t = aggregate.stats.totalTables || 1;
    const goldShare = rollups.tiers.gold / t;
    const proxyScore = Math.round(
      (goldShare * 100 +
        rollups.coverage.tablesWithOwnerPct +
        rollups.coverage.tablesWithCommentPct) /
        3,
    );
    // Prefer the persisted estate-level synthesis readiness when available so
    // the overview KPI matches the board pack + Portfolio.
    const score =
      typeof synthesis?.scores?.overall === "number" ? synthesis.scores.overall : proxyScore;
    const band: ExecSummaryData["readiness"] =
      score >= 70 ? "ready" : score >= 40 ? "needs_work" : "missing";
    return {
      totalTables: aggregate.stats.totalTables,
      totalSizeBytes: aggregate.stats.totalSizeBytes ?? "0",
      domainCount: aggregate.stats.domainCount,
      entityCount: tree.entityCount,
      readinessScore: score,
      readiness: band,
      assets: aggregate.stats.assetInventory,
      tier: rollups.tiers,
      coverage: rollups.coverage,
      scanCount: aggregate.stats.totalScans,
    };
  }, [aggregate, rollups, tree, synthesis]);

  // Derive the program's state to drive the contextual next-step banner and
  // the default tab.
  const scopes = program?.scopes ?? [];
  const hasScopes = scopes.length > 0;
  const activeCount = scopes.filter((s) => s.status === "queued" || s.status === "running").length;
  const plannedCount = scopes.filter((s) => s.status === "planned").length;
  const pausedCount = scopes.filter((s) => s.status === "paused").length;
  const completeCount = scopes.filter((s) => s.status === "complete").length;
  const hasScans = (aggregate?.stats.totalScans ?? 0) > 0;
  const isActive = activeCount > 0;
  const activeScope = scopes.find((s) => s.status === "running" || s.status === "queued");
  const activeScanId = activeScope?.scanId ?? null;

  // While a scope is scanning, poll TWO lightweight things and intentionally
  // do NOT reload the heavy aggregate (which would remount the CatalogBrowser):
  //  1) the live scan-progress for the running scope -> ScanProgressCard
  //  2) the program scopes (status transitions) -> sequence list + banner
  // When the active scan finishes, reload the aggregate once to refresh the tree.
  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;

    const tick = async () => {
      // 1) scan progress for the in-flight scope
      if (activeScanId) {
        try {
          const r = await fetch(`/api/environment-scan/${activeScanId}/progress`);
          if (r.ok && !cancelled) setScanProgress(await r.json());
        } catch {
          /* transient — keep polling */
        }
      }
      // 2) program scope statuses (cheap: no aggregate)
      try {
        const r = await fetch(`/api/estate-programs/${programId}`);
        if (r.ok && !cancelled) {
          const data = await r.json();
          setProgram(data.program);
          const stillActive = (data.program?.scopes ?? []).some(
            (s: Scope) => s.status === "running" || s.status === "queued",
          );
          // The sequence advanced/finished — refresh the aggregate + tree once.
          if (!stillActive) {
            setScanProgress(null);
            void load();
          }
        }
      } catch {
        /* transient */
      }
    };

    const t = setInterval(tick, 3000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [isActive, activeScanId, programId, load]);

  const defaultTab = hasScans ? "tree" : "sequence";

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!program) {
    // Dedicated states: real not-found, forbidden, and retryable error.
    if (loadError?.kind === "not_found") {
      return (
        <div className="mx-auto max-w-2xl p-6">
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <Building2 aria-hidden="true" className="text-muted-foreground/50 h-10 w-10" />
              <h2 className="text-lg font-semibold">{t("states.notFoundTitle")}</h2>
              <p className="text-muted-foreground max-w-md text-sm">{t("states.notFoundDescription")}</p>
              <Button asChild variant="outline">
                <Link href="/environment/programs">{t("states.back")}</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }
    if (loadError?.kind === "forbidden") {
      return (
        <div className="mx-auto max-w-2xl p-6">
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <Ban aria-hidden="true" className="text-muted-foreground/50 h-10 w-10" />
              <h2 className="text-lg font-semibold">{t("states.forbiddenTitle")}</h2>
              <p className="text-muted-foreground max-w-md text-sm">
                {loadError.message || t("states.forbiddenDescription")}
              </p>
              <Button asChild variant="outline">
                <Link href="/environment/programs">{t("states.back")}</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Info aria-hidden="true" className="text-muted-foreground/50 h-10 w-10" />
            <h2 className="text-lg font-semibold">{t("states.errorTitle")}</h2>
            <p className="text-muted-foreground max-w-md text-sm">
              {loadError?.message || t("states.errorDescription")}
            </p>
            <Button onClick={() => void load()}>{t("states.retry")}</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Contextual next step shown as a banner.
  const nextStep = !hasScopes
    ? {
        title: t("next.planTitle"),
        body: t("next.planBody"),
      }
    : isActive
      ? {
          title: t("next.scanningTitle", { complete: completeCount, total: scopes.length }),
          body: t("next.scanningBody"),
        }
      : plannedCount > 0
        ? {
            title: t("next.runTitle", { count: plannedCount }),
            body: t("next.runBody"),
          }
        : {
            title: t("next.reviewTitle"),
            body: t("next.reviewBody"),
          };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Building2 aria-hidden="true" className="h-6 w-6" />
            {program.name}
          </h1>
          {program.description && (
            <p className="text-muted-foreground mt-1 text-sm">{program.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          {caps.canRunSequence &&
            (pausedCount > 0 ? (
              <Button onClick={() => controlSequence("resume")} disabled={isActive}>
                <Play aria-hidden="true" className="mr-1 h-4 w-4" />
                {t("actions.resumeCount", { count: pausedCount })}
              </Button>
            ) : (
              <Button onClick={runSequence} disabled={running || isActive || plannedCount === 0}>
                <Play aria-hidden="true" className="mr-1 h-4 w-4" />
                {running || isActive ? t("actions.scanning") : t("actions.run")}
              </Button>
            ))}
          {caps.canRunSequence && (isActive || plannedCount > 0) && (
            <Button
              variant="outline"
              onClick={() => controlSequence("pause")}
              title={t("actions.pauseTitle")}
            >
              <Pause aria-hidden="true" className="mr-1 h-4 w-4" />
              {t("actions.pause")}
            </Button>
          )}
          {caps.canRunSequence && (isActive || plannedCount > 0 || pausedCount > 0) && (
            <Button
              variant="outline"
              onClick={() => controlSequence("cancel")}
              title={t("actions.cancelTitle")}
            >
              <Ban aria-hidden="true" className="mr-1 h-4 w-4" />
              {t("actions.cancel")}
            </Button>
          )}
          <a
            href={hasScans ? `/api/estate-programs/${programId}/export?format=pdf` : undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!hasScans}
          >
            <Button variant="outline" disabled={!hasScans} title={t("exports.pdfTitle")}>
              <Download aria-hidden="true" className="mr-1 h-4 w-4" />
              {t("exports.pdf")}
            </Button>
          </a>
          <a
            href={hasScans ? `/api/estate-programs/${programId}/export?format=excel` : undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!hasScans}
          >
            <Button variant="ghost" size="sm" disabled={!hasScans} title={t("exports.excelTitle")}>
              <FileSpreadsheet aria-hidden="true" className="mr-1 h-4 w-4" />
              {t("exports.excel")}
            </Button>
          </a>
          {caps.canDelete && (
            <Button variant="outline" onClick={deleteProgram} title={t("actions.delete")}>
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Relationship explainer: how a program relates to Estate Overview */}
      <Card className="bg-muted/30">
        <CardContent className="flex items-start gap-3 py-3">
          <Info aria-hidden="true" className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-muted-foreground text-xs leading-relaxed">
            {t.rich("explainer", {
              strong: (chunks) => <strong>{chunks}</strong>,
              link: (chunks) => <Link href="/environment" className="text-primary underline">{chunks}</Link>,
            })}
          </p>
        </CardContent>
      </Card>

      {/* Contextual next-step banner */}
      <Card className="border-primary/40 bg-primary/5">
        <CardContent className="flex items-center gap-3 py-3">
          {isActive ? (
            <Loader2 aria-hidden="true" className="text-primary h-5 w-5 shrink-0 animate-spin" />
          ) : (
            <ArrowRight aria-hidden="true" className="text-primary h-5 w-5 shrink-0" />
          )}
          <div>
            <div className="text-sm font-medium">{nextStep.title}</div>
            <p className="text-muted-foreground text-xs">{nextStep.body}</p>
          </div>
        </CardContent>
      </Card>

      {/* Live scan progress for the in-flight scope (reuses the estate-scan card) */}
      {isActive && scanProgress && (
        <div className="space-y-1" role="status" aria-live="polite">
          {activeScope && (
            <p className="text-muted-foreground text-xs">
              {t("progress", {
                label: activeScope.label,
                complete: completeCount,
                total: scopes.length,
              })}
            </p>
          )}
          <ScanProgressCard progress={scanProgress} />
        </div>
      )}

      {/* Exec | Detail toggle */}
      <div className="flex items-center justify-between">
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(v) => v && setView(v as "exec" | "detail")}
          variant="outline"
        >
          <ToggleGroupItem value="exec">{t("views.executive")}</ToggleGroupItem>
          <ToggleGroupItem value="detail">{t("views.detail")}</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* EXEC VIEW */}
      {view === "exec" &&
        (hasScans && execData ? (
          <EstateExecSummary data={execData} />
        ) : (
          <Card>
            <CardContent className="text-muted-foreground py-10 text-center text-sm">
              {t.rich("executiveEmpty", {
                detail: (chunks) => (
                  <button className="min-h-11 text-primary underline" onClick={() => setView("detail")}>
                    {chunks}
                  </button>
                ),
              })}
            </CardContent>
          </Card>
        ))}

      {/* DETAIL VIEW */}
      {view === "detail" && (
      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="sequence">
            {t("tabs.sequence", { count: scopes.length })}
          </TabsTrigger>
          <TabsTrigger value="tree">{t("tabs.ontology")}</TabsTrigger>
          <TabsTrigger value="relationships">{t("tabs.relationships")}</TabsTrigger>
          <TabsTrigger value="coverage">{t("tabs.coverage")}</TabsTrigger>
          <TabsTrigger value="quality">{t("tabs.quality")}</TabsTrigger>
        </TabsList>

        <TabsContent value="tree" className="mt-4">
          {hasScans && tree ? (
            <EstateTreeView tree={tree} />
          ) : (
            <p className="text-muted-foreground py-8 text-center text-sm">{t("empty.ontology")}</p>
          )}
        </TabsContent>

        <TabsContent value="relationships" className="mt-4">
          {hasScans ? (
            <RelationshipsView programId={programId} />
          ) : (
            <p className="text-muted-foreground py-8 text-center text-sm">{t("empty.relationships")}</p>
          )}
        </TabsContent>

        <TabsContent value="coverage" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("coverage.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {(aggregate?.stats.coverageByScope ?? []).length === 0 ? (
                <p className="text-muted-foreground">{t("coverage.empty")}</p>
              ) : (
                aggregate!.stats.coverageByScope.map((c) => (
                  <div key={c.scanId} className="flex items-center justify-between border-b py-1">
                    <span className="font-mono">{c.ucPath}</span>
                    <span className="text-muted-foreground">
                      {t("coverage.row", {
                        count: c.tableCount,
                        date: l10n.date(c.scannedAt),
                      })}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quality" className="mt-4 space-y-4">
          {rollups && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("quality.tierTitle")}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3 text-sm">
                  <Badge variant="outline">{t("quality.tier", { tier: t("quality.bronze"), count: rollups.tiers.bronze })}</Badge>
                  <Badge variant="outline">{t("quality.tier", { tier: t("quality.silver"), count: rollups.tiers.silver })}</Badge>
                  <Badge variant="outline">{t("quality.tier", { tier: t("quality.gold"), count: rollups.tiers.gold })}</Badge>
                  <Badge variant="outline">{t("quality.tier", { tier: t("quality.system"), count: rollups.tiers.system })}</Badge>
                  <Badge variant="outline">{t("quality.tier", { tier: t("quality.untiered"), count: rollups.tiers.unknown })}</Badge>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("quality.metadataTitle")}</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
                  <Coverage label={t("quality.description")} value={l10n.percent(rollups.coverage.tablesWithCommentPct / 100)} />
                  <Coverage label={t("quality.owner")} value={l10n.percent(rollups.coverage.tablesWithOwnerPct / 100)} />
                  <Coverage label={t("quality.tierCoverage")} value={l10n.percent(rollups.coverage.tablesWithTierPct / 100)} />
                  <Coverage label={t("quality.domain")} value={l10n.percent(rollups.coverage.tablesWithDomainPct / 100)} />
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="sequence" className="mt-4 space-y-4">
          {!caps.canManageScopes && (
            <Card className="bg-muted/30">
              <CardContent className="text-muted-foreground py-3 text-xs">
                {t("readOnly")}
              </CardContent>
            </Card>
          )}
          {caps.canManageScopes && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("sequence.addTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground text-sm">{t("sequence.addDescription")}</p>
              <CatalogBrowser
                selectedSources={pickerSources}
                onSelectionChange={(sources) => setPickerSources(sources)}
              />
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  {t("sequence.advanced")}
                </summary>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <div className="space-y-1">
                    <label htmlFor="program-inclusion-patterns" className="text-sm font-medium">{t("sequence.includeLabel")}</label>
                    <Input
                      id="program-inclusion-patterns"
                      placeholder={t("sequence.includePlaceholder")}
                      value={inclusionPatterns}
                      maxLength={1000}
                      onChange={(e) => setInclusionPatterns(e.target.value)}
                    />
                    <p className="text-muted-foreground text-xs">{t("sequence.includeHelp")}</p>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="program-workspace-id" className="text-sm font-medium">{t("sequence.workspaceLabel")}</label>
                    <Input
                      id="program-workspace-id"
                      placeholder={t("sequence.workspacePlaceholder")}
                      value={workspaceId}
                      maxLength={200}
                      onChange={(e) => setWorkspaceId(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="program-team-label" className="text-sm font-medium">{t("sequence.teamLabel")}</label>
                    <Input
                      id="program-team-label"
                      placeholder={t("sequence.teamPlaceholder")}
                      value={teamLabel}
                      maxLength={200}
                      onChange={(e) => setTeamLabel(e.target.value)}
                    />
                  </div>
                </div>
              </details>
              <div className="flex items-center gap-3">
                <Button onClick={addScope} disabled={pickerSources.length === 0}>
                  <Plus aria-hidden="true" className="mr-1 h-4 w-4" />
                  {t("sequence.addButton", { count: pickerSources.length })}
                </Button>
                {pickerSources.length > 0 && (
                  <span className="text-muted-foreground text-xs">
                    {t("sequence.selected", { count: pickerSources.length })}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  {caps.canRunSequence ? t("sequence.runTitle") : t("sequence.title")}
                </CardTitle>
                {caps.canRunSequence && (
                  <Button
                    size="sm"
                    onClick={runSequence}
                    disabled={running || isActive || plannedCount === 0}
                  >
                    <Play aria-hidden="true" className="mr-1 h-4 w-4" />
                    {running || isActive ? t("actions.scanning") : t("sequence.runPlanned", { count: plannedCount })}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {scopes.length === 0 ? (
                <p className="text-muted-foreground">{t("sequence.empty")}</p>
              ) : (
                scopes.map((s, i) => (
                  <div key={s.id} className="flex items-center gap-3 border-b py-1.5">
                    <span className="text-muted-foreground w-5 shrink-0 text-xs">{i + 1}.</span>
                    <div className="min-w-0">
                      <span className="font-mono">{s.label}</span>
                      {(s.inclusionPatterns || s.workspaceId || s.teamLabel) && (
                        <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-2 text-xs">
                          {s.inclusionPatterns && <span>{t("sequence.includeValue", { value: s.inclusionPatterns })}</span>}
                          {s.workspaceId && <span>{t("sequence.workspaceValue", { value: s.workspaceId })}</span>}
                          {s.teamLabel && <span>{t("sequence.teamValue", { value: s.teamLabel })}</span>}
                        </div>
                      )}
                    </div>
                    {s.status === "failed" && s.errorMessage && (
                      <span
                        className="text-destructive ml-2 max-w-[16rem] truncate text-xs"
                        title={s.errorMessage}
                      >
                        {s.errorMessage}
                      </span>
                    )}
                    <Badge
                      variant={STATUS_VARIANT[s.status] ?? "outline"}
                      className="ml-auto shrink-0"
                    >
                      {t(`status.${s.status}` as "status.planned")}
                    </Badge>
                    {caps.canRunSequence && s.status === "failed" && (
                      <ScopeRetryButton
                        programId={programId}
                        scopeId={s.id}
                        label={s.label}
                        disabled={isActive}
                        onRetried={load}
                      />
                    )}
                    {/* Remove is allowed for scopes that aren't mid-scan. */}
                    {caps.canManageScopes && s.status !== "queued" && s.status !== "running" && (
                      <button
                        type="button"
                        onClick={() => removeScope(s.id)}
                        title={t("sequence.remove")}
                        aria-label={t("sequence.removeLabel", { label: s.label })}
                        className="text-muted-foreground hover:text-destructive inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <X aria-hidden="true" className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      )}
    </div>
  );
}

function Coverage({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
