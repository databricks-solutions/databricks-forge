"use client";

/**
 * Estate Overview page.
 *
 * Default view: aggregate estate built from the latest data per table
 * across all environment scans (pipeline runs + standalone).
 *
 * Users can also trigger new standalone scans and drill into
 * individual scan results.
 */

import React, { useCallback, useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { LabelWithTip, InfoTip } from "@/components/ui/info-tip";
import { ENVIRONMENT } from "@/lib/help-text";
import { toast } from "sonner";
import {
  Database,
  Download,
  FileSpreadsheet,
  Loader2,
  Globe,
  ArrowLeft,
  Plus,
  Workflow,
  Building2,
} from "lucide-react";
import dynamic from "next/dynamic";
import { CatalogBrowser } from "@/components/pipeline/catalog-browser";
import { loadSettings } from "@/lib/settings";
import type { ERDGraph, LineageDirection } from "@/lib/domain/types";
import { LINEAGE_DIRECTIONS } from "@/lib/domain/types";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SemanticSearchInput,
  type SemanticSearchResult,
} from "@/components/search/semantic-search-input";
import type {
  AggregateData,
  GovernanceQualityStats,
  ScanProgressData,
  SingleScanData,
  TableDetailRow,
  ViewMode,
} from "@/app/environment/types";
import { AggregateSummary } from "@/components/environment/aggregate-summary";
import { DomainExplorer } from "@/components/environment/domain-explorer";
import { RelationshipsView } from "@/components/environment/relationships-view";
import { IncludePatternsInput } from "@/components/environment/include-patterns-input";
import { StateOfTheNation } from "@/components/environment/state-of-the-nation";
import { GovernanceQualityView } from "@/components/environment/governance-quality-view";
import { ScanProgressCard } from "@/components/environment/scan-progress-card";
import { SingleScanSummary } from "@/components/environment/single-scan-summary";
import { TableCoverageView } from "@/components/environment/table-coverage-view";
import { PortfolioStateOfTheNation } from "@/components/portfolio/portfolio-state-of-the-nation";
import { useL10n } from "@/i18n/format";

const ERDViewer = dynamic(
  () =>
    import("@/components/environment/erd-viewer").then((m) => ({
      default: m.ERDViewer,
    })),
  { ssr: false, loading: () => <Skeleton className="h-[600px] w-full" /> },
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Map a WAF assessment `reason` (passed via `?reason=...`) to a default tab
 * and a short human-readable label. Used to deep-link from the WAF assessment
 * "Fix with Forge" CTAs into the most relevant Estate panel.
 */
const WAF_REASON_TO_TAB: Record<string, { tab: string; labelKey: string }> = {
  lineage: { tab: "tables", labelKey: "lineage" },
  tags: { tab: "governance", labelKey: "tags" },
  format: { tab: "tables", labelKey: "format" },
  "managed-tables": { tab: "tables", labelKey: "managedTables" },
  "access-control": { tab: "governance", labelKey: "accessControl" },
  quality: { tab: "governance", labelKey: "quality" },
  "dlt-expectations": { tab: "tables", labelKey: "dltExpectations" },
  constraints: { tab: "tables", labelKey: "constraints" },
  "runtime-versions": { tab: "tables", labelKey: "runtimeVersions" },
  photon: { tab: "tables", labelKey: "photon" },
  "tagging-cost-attribution": { tab: "governance", labelKey: "costAttributionTags" },
};

export default function EstatePage() {
  const t = useTranslations("estateRoot");
  const l10n = useL10n();
  const searchParams = useSearchParams();
  const highlightFqn = useMemo(() => searchParams?.get("highlight") ?? "", [searchParams]);
  const tabParam = useMemo(() => searchParams?.get("tab") ?? "", [searchParams]);
  const scanParam = useMemo(() => searchParams?.get("scan") ?? "", [searchParams]);
  const reasonParam = useMemo(() => searchParams?.get("reason") ?? "", [searchParams]);
  const wafReason = useMemo(
    () => (reasonParam ? (WAF_REASON_TO_TAB[reasonParam] ?? null) : null),
    [reasonParam],
  );

  const [viewMode, setViewMode] = useState<ViewMode>("aggregate");
  const [aggregate, setAggregate] = useState<AggregateData | null>(null);
  const [erdGraph, setErdGraph] = useState<ERDGraph | null>(null);
  const [selectedScan, setSelectedScan] = useState<SingleScanData | null>(null);
  const [selectedErdGraph, setSelectedErdGraph] = useState<ERDGraph | null>(null);
  const [governanceQuality, setGovernanceQuality] = useState<GovernanceQualityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchFilter, setSearchFilter] = useState("");
  const [activeTab, setActiveTab] = useState("state");
  const [embeddingEnabled, setEmbeddingEnabled] = useState(false);
  const [portfolioAllowed, setPortfolioAllowed] = useState(false);
  const [semanticSourceIds, setSemanticSourceIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (tabParam) setActiveTab(tabParam);
    else if (wafReason) setActiveTab(wafReason.tab);
  }, [tabParam, wafReason]);

  useEffect(() => {
    if (highlightFqn) {
      setSearchFilter(highlightFqn);
      if (!tabParam) setActiveTab("tables");
    }
  }, [highlightFqn, tabParam]);

  useEffect(() => {
    const settings = loadSettings();
    if (!settings.semanticSearchEnabled) return;
    fetch("/api/embeddings/status")
      .then((r) => r.json())
      .then((d) => setEmbeddingEnabled(d.enabled ?? false))
      .catch(() => {});
  }, []);

  // Cross-estate Portfolio is an admin-gated tab within the consolidated Estate
  // interface. The authoritative check is server-side on every /api/portfolio*
  // route; this only decides whether to surface the tab trigger.
  useEffect(() => {
    fetch("/api/portfolio/access")
      .then((r) => r.json())
      .then((d) => setPortfolioAllowed(d.allowed ?? false))
      .catch(() => setPortfolioAllowed(false));
  }, []);

  const handleSemanticResults = React.useCallback((results: SemanticSearchResult[]) => {
    setSemanticSourceIds(new Set(results.map((r) => r.sourceId)));
  }, []);

  // New scan form
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [excludedSources, setExcludedSources] = useState<string[]>([]);
  const [exclusionPatterns, setExclusionPatterns] = useState<string[]>([]);
  const [inclusionPatterns, setInclusionPatterns] = useState<string[]>([]);
  const [lineageEnabled, setLineageEnabled] = useState<boolean>(true);
  const [lineageDirection, setLineageDirection] = useState<LineageDirection>("upstream");
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgressData | null>(null);

  // Seed per-scan lineage controls from the saved discovery-depth defaults.
  useEffect(() => {
    const settings = loadSettings();
    const cfg = settings.discoveryDepthConfigs[settings.defaultDiscoveryDepth];
    if (cfg) {
      setLineageEnabled(cfg.lineageEnabled ?? true);
      setLineageDirection(cfg.lineageDirection ?? "upstream");
    }
  }, []);

  // Load aggregate estate data
  const fetchAggregate = useCallback(async () => {
    try {
      setLoading(true);
      const resp = await fetch("/api/environment/aggregate");
      if (!resp.ok) throw new Error("Failed to fetch aggregate");
      const data = await resp.json();
      setAggregate(data);
    } catch {
      // No scans yet — that's fine
      setAggregate(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchGovernanceQuality = useCallback(async () => {
    try {
      const resp = await fetch("/api/stats");
      if (!resp.ok) return;
      const data = await resp.json();
      if (data?.quality) {
        setGovernanceQuality(data.quality as GovernanceQualityStats);
      }
    } catch {
      // Non-fatal for estate page
    }
  }, []);

  const fetchAggregateErd = useCallback(async () => {
    try {
      const resp = await fetch("/api/environment/aggregate/erd?format=json");
      if (resp.ok) {
        setErdGraph(await resp.json());
      }
    } catch {
      // Non-fatal
    }
  }, []);

  // Load a single scan's detail
  const loadSingleScan = useCallback(
    async (scanId: string) => {
      try {
        const resp = await fetch(`/api/environment-scan/${scanId}`);
        if (!resp.ok) throw new Error("Not found");
        const scan = await resp.json();
        setSelectedScan(scan);
        setViewMode("single-scan");

        const erdResp = await fetch(`/api/environment-scan/${scanId}/erd?format=json`);
        if (erdResp.ok) {
          setSelectedErdGraph(await erdResp.json());
        }
      } catch {
        toast.error(t("toast.loadDetailsFailed"));
      }
    },
    [t],
  );

  useEffect(() => {
    if (scanParam) loadSingleScan(scanParam);
  }, [scanParam, loadSingleScan]);

  // Back to aggregate
  const backToAggregate = useCallback(() => {
    setViewMode("aggregate");
    setSelectedScan(null);
    setSelectedErdGraph(null);
    setSearchFilter("");
  }, []);

  // Delete a scan
  const deleteScan = useCallback(
    async (scanId: string) => {
      try {
        const resp = await fetch(`/api/environment-scan/${scanId}`, { method: "DELETE" });
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          throw new Error(body.error ?? "Delete failed");
        }
        toast.success(t("toast.deleted"));
        if (selectedScan?.scanId === scanId) {
          setViewMode("aggregate");
          setSelectedScan(null);
          setSelectedErdGraph(null);
        }
        fetchAggregate();
        fetchAggregateErd();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("toast.deleteFailed"));
      }
    },
    [selectedScan, fetchAggregate, fetchAggregateErd, t],
  );

  // Derive the UC scope string from selected catalog browser sources
  const ucScope = selectedSources.join(", ");

  // Start a new scan
  const handleScan = useCallback(async () => {
    if (selectedSources.length === 0) {
      toast.error(t("toast.selectScope"));
      return;
    }
    const scope = selectedSources.join(", ");
    setScanning(true);
    setScanProgress(null);
    try {
      const settings = loadSettings();
      const depthCfg = settings.discoveryDepthConfigs[settings.defaultDiscoveryDepth];
      const resp = await fetch("/api/environment-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ucMetadata: scope,
          lineageDepth: depthCfg.lineageDepth,
          lineageEnabled,
          lineageDirection,
          excludedScope: excludedSources.join(", ") || undefined,
          exclusionPatterns: exclusionPatterns.join(", ") || undefined,
          inclusionPatterns: inclusionPatterns.join(", ") || undefined,
        }),
      });
      if (!resp.ok) throw new Error("Failed to start scan");
      const data = await resp.json();
      toast.success(t("toast.started", { id: data.scanId.slice(0, 8) }));

      // Start polling for progress
      pollForScan(data.scanId);
    } catch {
      toast.error(t("toast.startFailed"));
      setScanning(false);
    }
  }, [selectedSources]); // eslint-disable-line react-hooks/exhaustive-deps

  const pollForScan = useCallback(
    (scanId: string) => {
      let attempts = 0;
      const maxAttempts = 300; // 10 minutes at 2s intervals
      const interval = 2_000;
      let consecutiveMisses = 0;
      const maxConsecutiveMisses = 5;

      const poll = async () => {
        attempts++;
        try {
          // Poll progress endpoint for live status
          const progResp = await fetch(`/api/environment-scan/${scanId}/progress`);
          if (progResp.ok) {
            consecutiveMisses = 0;
            const prog: ScanProgressData = await progResp.json();
            setScanProgress(prog);

            // Check for completion
            if (prog.phase === "complete") {
              setScanning(false);
              setSelectedSources([]);
              setScanProgress(null);
              toast.success(t("toast.complete"));
              fetchAggregate();
              fetchAggregateErd();
              loadSingleScan(scanId);
              return;
            }

            if (prog.phase === "failed") {
              setScanning(false);
              setScanProgress(null);
              toast.error(prog.message || t("toast.failed"));
              return;
            }
          } else {
            // Progress endpoint 404 = scan may have completed, or failed
            // and the in-memory entry expired. Fall back to the persisted
            // scan record to check for results.
            const scanResp = await fetch(`/api/environment-scan/${scanId}`);
            if (scanResp.ok) {
              const scan = await scanResp.json();
              if (scan.tableCount > 0) {
                setScanning(false);
                setSelectedSources([]);
                setScanProgress(null);
                toast.success(t("toast.complete"));
                fetchAggregate();
                fetchAggregateErd();
                loadSingleScan(scanId);
                return;
              }
            }

            // Neither endpoint knows about this scan -- it likely failed
            // without saving. Stop after a few consecutive misses to avoid
            // filling logs with 404s for 10 minutes.
            consecutiveMisses++;
            if (consecutiveMisses >= maxConsecutiveMisses) {
              setScanning(false);
              setScanProgress(null);
              toast.error(t("toast.missingProgress"));
              return;
            }
          }
        } catch {
          // Continue polling on transient network errors
        }

        if (attempts < maxAttempts) {
          setTimeout(poll, interval);
        } else {
          setScanning(false);
          setScanProgress(null);
          toast.error(t("toast.timedOut"));
        }
      };

      // Start polling immediately
      setTimeout(poll, 1_000);
    },
    [fetchAggregate, fetchAggregateErd, loadSingleScan, t],
  );

  // On mount: load aggregate data and resume any in-progress scan
  useEffect(() => {
    fetchAggregate();
    fetchAggregateErd();
    fetchGovernanceQuality();

    // Check for scans that are still running server-side (e.g. user
    // navigated away mid-scan and came back).
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch("/api/environment-scan/active");
        if (!resp.ok || cancelled) return;
        const { scans } = await resp.json();
        if (cancelled || !scans?.length) return;

        const active = scans[0];
        setScanning(true);
        setScanProgress(active);
        pollForScan(active.scanId);
      } catch {
        // Non-fatal -- just means no active scan to resume
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchAggregate, fetchAggregateErd, fetchGovernanceQuality, pollForScan]);

  const [exporting, setExporting] = useState(false);

  const downloadExcel = useCallback(
    async (url: string, filename: string) => {
      setExporting(true);
      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error("Export failed");
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(blobUrl);
        toast.success(t("toast.exported"));
      } catch {
        toast.error(t("toast.exportFailed"));
      } finally {
        setExporting(false);
      }
    },
    [t],
  );

  const handleExport = useCallback(() => {
    if (viewMode === "single-scan" && selectedScan) {
      downloadExcel(
        `/api/environment-scan/${selectedScan.scanId}/export?format=excel`,
        `estate-report-${selectedScan.scanId.slice(0, 8)}.xlsx`,
      );
    } else {
      downloadExcel(
        `/api/environment/aggregate/export?format=excel`,
        `estate-report-aggregate.xlsx`,
      );
    }
  }, [viewMode, selectedScan, downloadExcel]);

  const humanSize = (bytes: string | number | null): string => {
    if (!bytes) return "—";
    const n = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
    if (isNaN(n) || n === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
    return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  };

  const humanNumber = (value: string | number | null): string => {
    if (!value) return "—";
    const n = typeof value === "string" ? parseInt(value, 10) : value;
    if (isNaN(n) || n === 0) return "0";
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return l10n.integer(n);
  };

  const timeAgo = (iso: string): string => l10n.relative(iso);

  // Active data depends on view mode
  const activeDetails: TableDetailRow[] =
    viewMode === "single-scan" ? (selectedScan?.details ?? []) : (aggregate?.details ?? []);

  const filteredTables = activeDetails.filter((t) => {
    if (semanticSourceIds.size > 0) {
      return semanticSourceIds.has(t.tableFqn);
    }
    if (!searchFilter) return true;
    // Support comma-separated FQNs from deep-link highlights
    if (searchFilter.includes(",")) {
      const fqns = searchFilter.split(",").map((f) => f.trim().toLowerCase());
      return fqns.some(
        (fqn) =>
          t.tableFqn.toLowerCase().includes(fqn) ||
          (t.dataDomain ?? "").toLowerCase().includes(fqn),
      );
    }
    return (
      t.tableFqn.toLowerCase().includes(searchFilter.toLowerCase()) ||
      (t.dataDomain ?? "").toLowerCase().includes(searchFilter.toLowerCase())
    );
  });

  const activeErd = viewMode === "single-scan" ? selectedErdGraph : erdGraph;

  // The scan whose consultant-grade synthesis backs the "State of the Nation".
  // In single-scan view that's the open scan; in aggregate view it's the most
  // recent scan in scope (the freshest diagnosis of the estate).
  const diagnosisScanId = useMemo(() => {
    if (viewMode === "single-scan") return selectedScan?.scanId ?? "";
    const scopes = aggregate?.stats.coverageByScope ?? [];
    if (scopes.length === 0) return "";
    return [...scopes].sort(
      (a, b) => new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime(),
    )[0].scanId;
  }, [viewMode, selectedScan, aggregate]);

  // If a non-admin deep-links to ?tab=portfolio, fall back to the default tab.
  const effectiveTab = activeTab === "portfolio" && !portfolioAllowed ? "state" : activeTab;

  // The Portfolio (cross-estate) tab is self-contained and aggregates across
  // estates, so it must stay reachable even when this estate has no local scans
  // yet — bypass the per-estate loading/empty gates when it's the active tab.
  const showingPortfolio = effectiveTab === "portfolio" && portfolioAllowed;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {viewMode === "single-scan" && (
            <Button
              variant="ghost"
              size="icon"
              onClick={backToAggregate}
              className="shrink-0"
              aria-label={t("header.backLabel")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div>
            {viewMode === "aggregate" ? (
              <>
                <div className="flex items-center gap-2">
                  <Globe className="h-6 w-6 text-primary" />
                  <h1 className="text-2xl font-bold tracking-tight">{t("header.title")}</h1>
                  {aggregate && aggregate.stats.totalScans > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {t("header.combinedScans", { count: aggregate.stats.totalScans })}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-muted-foreground">{t("header.subtitle")}</p>
              </>
            ) : viewMode === "single-scan" && selectedScan ? (
              <>
                <div className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-muted-foreground" />
                  <h1 className="text-2xl font-bold tracking-tight">
                    {t("header.scanTitle", { scope: selectedScan.ucPath })}
                  </h1>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {l10n.dateTime(selectedScan.createdAt)}
                  {selectedScan.runId && (
                    <> · {t("header.pipelineRun", { id: selectedScan.runId.slice(0, 8) })}</>
                  )}
                  {!selectedScan.runId && <> · {t("header.standalone")}</>}
                </p>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" asChild title={t("header.manageDescription")}>
            <Link href="/environment/programs">
              <Building2 className="h-4 w-4 mr-2" />
              {t("header.manage")}
            </Link>
          </Button>
          {(viewMode === "single-scan" || (aggregate && aggregate.stats.totalScans > 0)) && (
            <Button variant="outline" disabled={exporting} onClick={handleExport}>
              {exporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {t("actions.exporting")}
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  {t("actions.report")}
                </>
              )}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() =>
              viewMode === "new-scan" ? setViewMode("aggregate") : setViewMode("new-scan")
            }
          >
            <Plus className="h-4 w-4 mr-2" />
            {t("actions.newScan")}
          </Button>
        </div>
      </div>

      {/* WAF assessment context — shown when navigated here from /assessment */}
      {wafReason && (
        <div className="rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span>
              {t.rich("waf.focused", {
                focus: t(`waf.reasons.${wafReason.labelKey}` as "waf.reasons.lineage"),
                strong: (chunks) => <span className="font-medium">{chunks}</span>,
              })}
            </span>
            <Link href="/assessment" className="text-primary underline-offset-2 hover:underline">
              {t("waf.back")}
            </Link>
          </div>
        </div>
      )}

      {/* New Scan Form with Catalog Browser (hidden while a scan is running) */}
      {viewMode === "new-scan" && !scanning && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              {t("newScan.title")}
            </CardTitle>
            <CardDescription>{t("newScan.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <CatalogBrowser
              selectedSources={selectedSources}
              excludedSources={excludedSources}
              exclusionPatterns={exclusionPatterns}
              onSelectionChange={(sources, excluded, patterns) => {
                setSelectedSources(sources);
                setExcludedSources(excluded);
                setExclusionPatterns(patterns);
              }}
            />

            <IncludePatternsInput patterns={inclusionPatterns} onChange={setInclusionPatterns} />

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-md border border-muted bg-muted/30 p-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="scan-lineage-enabled"
                  checked={lineageEnabled}
                  onCheckedChange={(checked) => setLineageEnabled(checked === true)}
                />
                <label htmlFor="scan-lineage-enabled" className="text-sm cursor-pointer">
                  {t("newScan.walkLineage")}
                </label>
                <InfoTip tip={ENVIRONMENT.lineageEnabled} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm">{t("newScan.direction")}</span>
                <InfoTip tip={ENVIRONMENT.lineageDirection} />
                <Select
                  value={lineageDirection}
                  disabled={!lineageEnabled}
                  onValueChange={(v) => setLineageDirection(v as LineageDirection)}
                >
                  <SelectTrigger size="sm" className="w-36 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LINEAGE_DIRECTIONS.map((dir) => (
                      <SelectItem key={dir} value={dir}>
                        {t(`newScan.directions.${dir}` as "newScan.directions.upstream")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {selectedSources.length > 0
                  ? t("newScan.scope", { scope: ucScope })
                  : t("newScan.selectPrompt")}
              </p>
              <Button onClick={handleScan} disabled={scanning || selectedSources.length === 0}>
                {scanning ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" /> {t("actions.scanning")}
                  </>
                ) : (
                  <>
                    <Workflow className="h-4 w-4 mr-2" /> {t("actions.scan")}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Live scan progress */}
      {scanning && scanProgress && <ScanProgressCard progress={scanProgress} />}

      {/* Loading state */}
      {loading && viewMode === "aggregate" && !showingPortfolio ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-96" />
        </div>
      ) : /* Empty state */
      viewMode === "aggregate" &&
        !showingPortfolio &&
        (!aggregate || aggregate.stats.totalScans === 0) ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Globe className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h2 className="text-xl font-semibold">{t("empty.estateTitle")}</h2>
            <p className="mt-2 max-w-md text-muted-foreground">{t("empty.estateDescription")}</p>
            <Button className="mt-6" onClick={() => setViewMode("new-scan")}>
              <Plus className="mr-2 h-4 w-4" />
              {t("empty.start")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        /* Tabbed content (aggregate or single-scan) */
        <Tabs value={effectiveTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="state">{t("tabs.state")}</TabsTrigger>
            <TabsTrigger value="summary">{t("tabs.summary")}</TabsTrigger>
            <TabsTrigger value="domains">{t("tabs.domains")}</TabsTrigger>
            <TabsTrigger value="relationships">{t("tabs.relationships")}</TabsTrigger>
            <TabsTrigger value="tables">
              {t("tabs.tables", { count: activeDetails.length })}
            </TabsTrigger>
            <TabsTrigger value="erd" className="gap-1">
              ERD
              <InfoTip tip={ENVIRONMENT.erdView} />
            </TabsTrigger>
            {viewMode === "aggregate" && (
              <TabsTrigger value="coverage">{t("tabs.coverage")}</TabsTrigger>
            )}
            {viewMode === "aggregate" && (
              <TabsTrigger value="governance">{t("tabs.governance")}</TabsTrigger>
            )}
            {viewMode === "single-scan" && (
              <TabsTrigger value="export">{t("tabs.export")}</TabsTrigger>
            )}
            {portfolioAllowed && (
              <TabsTrigger value="portfolio" className="gap-1">
                {t("tabs.portfolio")}
                <InfoTip tip={t("tabs.portfolioHelp")} />
              </TabsTrigger>
            )}
          </TabsList>

          {/* State of the Nation (consultant-grade synthesis) */}
          <TabsContent value="state" className="space-y-4">
            {diagnosisScanId ? (
              <StateOfTheNation scanId={diagnosisScanId} onScan={() => setViewMode("new-scan")} />
            ) : (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <Globe className="mb-4 h-12 w-12 text-muted-foreground/50" />
                  <h2 className="text-xl font-semibold">{t("empty.diagnosisTitle")}</h2>
                  <p className="mt-2 max-w-md text-muted-foreground">
                    {t("empty.diagnosisDescription")}
                  </p>
                  <Button className="mt-6" onClick={() => setViewMode("new-scan")}>
                    <Plus className="mr-2 h-4 w-4" />
                    {t("empty.start")}
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Summary */}
          <TabsContent value="summary" className="space-y-4">
            {viewMode === "aggregate" && aggregate ? (
              <AggregateSummary
                stats={aggregate.stats}
                details={aggregate.details}
                insights={aggregate.insights ?? []}
                humanSize={humanSize}
                humanNumber={humanNumber}
                timeAgo={timeAgo}
                onViewScan={loadSingleScan}
                onDeleteScan={deleteScan}
              />
            ) : viewMode === "single-scan" && selectedScan ? (
              <SingleScanSummary
                scan={selectedScan}
                humanSize={humanSize}
                humanNumber={humanNumber}
              />
            ) : null}
          </TabsContent>

          {/* Domains (progressive-zoom explorer: domain → subdomain → table) */}
          <TabsContent value="domains" className="space-y-4">
            <DomainExplorer
              details={activeDetails}
              humanNumber={humanNumber}
              humanSize={humanSize}
              scanId={diagnosisScanId || undefined}
              editable={!!diagnosisScanId}
            />
          </TabsContent>

          {/* Relationships (lineage + ontology edges, cross-boundary flags) */}
          <TabsContent value="relationships" className="space-y-4">
            {diagnosisScanId ? (
              <RelationshipsView scanId={diagnosisScanId} />
            ) : (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <Workflow className="mb-4 h-12 w-12 text-muted-foreground/50" />
                  <h3 className="text-lg font-semibold">{t("empty.relationshipsTitle")}</h3>
                  <p className="mt-2 max-w-md text-muted-foreground">
                    {t("empty.relationshipsDescription")}
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Tables */}
          <TabsContent value="tables" className="space-y-3">
            <SemanticSearchInput
              placeholder={t("tables.filter")}
              scope="estate"
              scanId={selectedScan?.scanId}
              onExactChange={setSearchFilter}
              onSemanticResults={handleSemanticResults}
              embeddingEnabled={embeddingEnabled}
              className="max-w-md"
            />
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <LabelWithTip
                        label={t("tables.headers.table")}
                        tip={t("tables.help.table")}
                      />
                    </TableHead>
                    <TableHead>
                      <LabelWithTip
                        label={t("tables.headers.domain")}
                        tip={t("tables.help.domain")}
                      />
                    </TableHead>
                    <TableHead>
                      <LabelWithTip label={t("tables.headers.tier")} tip={t("tables.help.tier")} />
                    </TableHead>
                    <TableHead>
                      <LabelWithTip label={t("tables.headers.size")} tip={t("tables.help.size")} />
                    </TableHead>
                    <TableHead>
                      <LabelWithTip label={t("tables.headers.rows")} tip={t("tables.help.rows")} />
                    </TableHead>
                    <TableHead>
                      <LabelWithTip
                        label={t("tables.headers.owner")}
                        tip={t("tables.help.owner")}
                      />
                    </TableHead>
                    <TableHead>
                      <LabelWithTip
                        label={t("tables.headers.governance")}
                        tip={t("tables.help.governance")}
                      />
                    </TableHead>
                    <TableHead>
                      <LabelWithTip
                        label={t("tables.headers.sensitivity")}
                        tip={t("tables.help.sensitivity")}
                      />
                    </TableHead>
                    <TableHead>
                      <LabelWithTip
                        label={t("tables.headers.modified")}
                        tip={t("tables.help.modified")}
                      />
                    </TableHead>
                    <TableHead>
                      <LabelWithTip label={t("tables.headers.via")} tip={t("tables.help.via")} />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTables.slice(0, 100).map((t) => (
                    <TableRow key={t.tableFqn}>
                      <TableCell className="font-mono text-xs">
                        <div className="truncate max-w-[300px]" title={t.tableFqn}>
                          {t.tableFqn}
                        </div>
                        {(t.comment || t.generatedDescription) && (
                          <div className="text-muted-foreground font-sans mt-0.5 truncate max-w-[300px]">
                            {t.comment || t.generatedDescription}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {t.dataDomain ? (
                          <Badge variant="secondary" className="max-w-full" title={t.dataDomain}>
                            {t.dataDomain}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {t.dataTier ? (
                          <Badge
                            variant="outline"
                            className={
                              t.dataTier === "gold"
                                ? "border-yellow-500 text-yellow-700 max-w-full"
                                : t.dataTier === "silver"
                                  ? "border-gray-400 text-gray-600 max-w-full"
                                  : t.dataTier === "bronze"
                                    ? "border-orange-500 text-orange-700 max-w-full"
                                    : "border-blue-400 text-blue-600 max-w-full"
                            }
                            title={t.dataTier}
                          >
                            {t.dataTier}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>{humanSize(t.sizeInBytes)}</TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {humanNumber(t.numRows)}
                      </TableCell>
                      <TableCell className="text-xs">{t.owner ?? "—"}</TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {t.governanceScore != null ? (
                          <span
                            className={
                              t.governanceScore >= 70
                                ? "text-green-600 font-semibold"
                                : t.governanceScore >= 40
                                  ? "text-amber-600 font-semibold"
                                  : "text-red-600 font-semibold"
                            }
                          >
                            {t.governanceScore.toFixed(0)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {t.sensitivityLevel === "confidential" ||
                        t.sensitivityLevel === "restricted" ? (
                          <Badge
                            variant="destructive"
                            className="max-w-full"
                            title={t.sensitivityLevel}
                          >
                            {t.sensitivityLevel}
                          </Badge>
                        ) : t.sensitivityLevel ? (
                          <Badge
                            variant="secondary"
                            className="max-w-full"
                            title={t.sensitivityLevel}
                          >
                            {t.sensitivityLevel}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t.lastModified ? timeAgo(t.lastModified) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={t.discoveredVia === "lineage" ? "outline" : "default"}
                          className="text-xs"
                        >
                          {t.discoveredVia}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredTables.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                        {t("tables.empty")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {filteredTables.length > 100 && (
              <p className="text-xs text-muted-foreground">
                {t("tables.showing", { shown: 100, total: filteredTables.length })}
              </p>
            )}
          </TabsContent>

          {/* ERD */}
          <TabsContent value="erd">
            {activeErd ? (
              <ERDViewer graph={activeErd} />
            ) : (
              <div className="flex items-center justify-center h-[400px] text-muted-foreground">
                <p>{t("empty.erd")}</p>
              </div>
            )}
          </TabsContent>

          {/* Table Coverage (aggregate only) */}
          {viewMode === "aggregate" && (
            <TabsContent value="coverage" className="space-y-4">
              <TableCoverageView />
            </TabsContent>
          )}

          {viewMode === "aggregate" && (
            <TabsContent value="governance" className="space-y-4">
              <GovernanceQualityView
                quality={governanceQuality}
                details={aggregate?.details}
                insights={aggregate?.insights ?? []}
              />
            </TabsContent>
          )}

          {/* Export (single scan only) */}
          {viewMode === "single-scan" && selectedScan && (
            <TabsContent value="export" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileSpreadsheet className="h-5 w-5" />
                    {t("export.title")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">{t("export.description")}</p>
                  <Button disabled={exporting} onClick={handleExport}>
                    {exporting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        {t("actions.exporting")}
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4 mr-2" />
                        {t("export.download")}
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* Portfolio (cross-estate CDO roll-up; admin-gated, self-contained) */}
          {portfolioAllowed && (
            <TabsContent value="portfolio" className="space-y-4">
              <PortfolioStateOfTheNation />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
