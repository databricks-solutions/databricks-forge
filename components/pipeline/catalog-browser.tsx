"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Database,
  Layers,
  TableProperties,
  ChevronRight,
  ChevronDown,
  Plus,
  Check,
  X,
  RefreshCw,
  AlertCircle,
  Search,
  Zap,
  ShieldAlert,
  Ban,
  Undo2,
  Filter,
} from "lucide-react";
import { globMatch, validateExclusionPattern } from "@/lib/domain/scope-selection";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TableNode {
  name: string;
  fqn: string;
  comment: string | null;
  tableType: string;
}

interface SchemaNode {
  name: string;
  expanded: boolean;
  loading: boolean;
  error: string | null;
  tables: TableNode[];
  fetchedAt: number | null;
}

interface CatalogNode {
  name: string;
  expanded: boolean;
  loading: boolean;
  error: string | null;
  schemas: SchemaNode[];
  fetchedAt: number | null;
}

interface CatalogBrowserProps {
  selectedSources: string[];
  excludedSources?: string[];
  exclusionPatterns?: string[];
  onSelectionChange: (sources: string[], excluded: string[], patterns: string[]) => void;
  /** "table" = select catalogs/schemas/tables (default). "schema" = single schema selection only. */
  selectionMode?: "table" | "schema";
  defaultExpandPath?: string;
}

const STALE_THRESHOLD_MS = 60_000;

type BrowserPhase = "warming-up" | "loading" | "ready" | "error";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CatalogBrowser({
  selectedSources,
  excludedSources = [],
  exclusionPatterns = [],
  onSelectionChange,
  selectionMode = "table",
  defaultExpandPath,
}: CatalogBrowserProps) {
  const t = useTranslations("comments.catalog_browser");
  const [catalogs, setCatalogs] = useState<CatalogNode[]>([]);
  const [phase, setPhase] = useState<BrowserPhase>("warming-up");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [warmupElapsed, setWarmupElapsed] = useState(0);
  const warmupStartRef = useRef<number>(Date.now());

  // Pattern input state
  const [patternInput, setPatternInput] = useState("");
  const [patternError, setPatternError] = useState<string | null>(null);

  // ── Helpers for calling back with all three arrays ──────────────────────
  const emitChange = useCallback(
    (inc: string[], exc: string[], pat: string[]) => {
      onSelectionChange(inc, exc, pat);
    },
    [onSelectionChange],
  );

  // ── Warehouse warmup ────────────────────────────────────────────────────
  const warmupWarehouse = useCallback(async () => {
    setPhase("warming-up");
    setError(null);
    setErrorCode(null);
    setWarmupElapsed(0);
    warmupStartRef.current = Date.now();

    const timer = setInterval(() => {
      setWarmupElapsed(Math.floor((Date.now() - warmupStartRef.current) / 1000));
    }, 1_000);

    try {
      const res = await fetch("/api/metadata?type=warmup");
      clearInterval(timer);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error) {
          setError(data.error);
          setErrorCode("WAREHOUSE_UNAVAILABLE");
          setPhase("error");
          return false;
        }
      }

      return true;
    } catch (err) {
      clearInterval(timer);
      setError(err instanceof Error ? err.message : "Failed to connect to SQL Warehouse");
      setErrorCode("WAREHOUSE_UNAVAILABLE");
      setPhase("error");
      return false;
    }
  }, []);

  // ── Fetch catalogs ─────────────────────────────────────────────────────
  const fetchCatalogs = useCallback(async () => {
    setPhase("loading");
    setError(null);
    setErrorCode(null);
    try {
      const res = await fetch("/api/metadata?type=catalogs");
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to fetch catalogs");
        setErrorCode(data.code ?? data.errorCode ?? "WAREHOUSE_UNAVAILABLE");
        setPhase("error");
        return;
      }

      const names: string[] = data.catalogs ?? [];
      setCatalogs(
        names.map((name) => ({
          name,
          expanded: false,
          loading: false,
          error: null,
          schemas: [],
          fetchedAt: null,
        })),
      );
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load catalogs");
      setErrorCode("WAREHOUSE_UNAVAILABLE");
      setPhase("error");
    }
  }, []);

  // ── Initial mount ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const ready = await warmupWarehouse();
      if (cancelled) return;
      if (ready) await fetchCatalogs();
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [warmupWarehouse, fetchCatalogs]);

  // ── Auto-expand default path ───────────────────────────────────────────
  const defaultExpandedRef = useRef(false);
  useEffect(() => {
    if (phase !== "ready" || !defaultExpandPath || defaultExpandedRef.current) return;
    const parts = defaultExpandPath.split(".");
    if (parts.length >= 1) {
      defaultExpandedRef.current = true;
      toggleCatalog(parts[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, defaultExpandPath]);

  // ── Retry / refresh ────────────────────────────────────────────────────
  const fullRetry = useCallback(async () => {
    const ready = await warmupWarehouse();
    if (ready) await fetchCatalogs();
  }, [warmupWarehouse, fetchCatalogs]);

  const refreshCatalogs = useCallback(async () => {
    await fetchCatalogs();
  }, [fetchCatalogs]);

  const refreshCatalogSchemas = useCallback(async (catalogName: string) => {
    setCatalogs((prev) =>
      prev.map((c) =>
        c.name === catalogName
          ? { ...c, loading: true, error: null, schemas: [], fetchedAt: null }
          : c,
      ),
    );
    try {
      const res = await fetch(
        `/api/metadata?type=schemas&catalog=${encodeURIComponent(catalogName)}`,
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? "Failed to fetch schemas");
      }
      const data = await res.json();
      const schemaNames: string[] = data.schemas ?? [];
      setCatalogs((prev) =>
        prev.map((c) =>
          c.name === catalogName
            ? {
                ...c,
                loading: false,
                fetchedAt: Date.now(),
                schemas: schemaNames.map((s) => ({
                  name: s,
                  expanded: false,
                  loading: false,
                  error: null,
                  tables: [],
                  fetchedAt: null,
                })),
              }
            : c,
        ),
      );
    } catch (err) {
      setCatalogs((prev) =>
        prev.map((c) =>
          c.name === catalogName
            ? {
                ...c,
                loading: false,
                error: err instanceof Error ? err.message : "Failed to load schemas",
              }
            : c,
        ),
      );
    }
  }, []);

  // ── Toggle catalog ─────────────────────────────────────────────────────
  const toggleCatalog = async (catalogName: string) => {
    const cat = catalogs.find((c) => c.name === catalogName);
    if (!cat) return;
    const isStale = !cat.fetchedAt || Date.now() - cat.fetchedAt > STALE_THRESHOLD_MS;
    const hasFreshData = cat.schemas.length > 0 && !isStale;
    if (hasFreshData) {
      setCatalogs((prev) =>
        prev.map((c) => (c.name === catalogName ? { ...c, expanded: !c.expanded } : c)),
      );
      return;
    }
    setCatalogs((prev) =>
      prev.map((c) =>
        c.name === catalogName ? { ...c, expanded: true, loading: true, error: null } : c,
      ),
    );
    try {
      const res = await fetch(
        `/api/metadata?type=schemas&catalog=${encodeURIComponent(catalogName)}`,
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? "Failed to fetch schemas");
      }
      const data = await res.json();
      const schemaNames: string[] = data.schemas ?? [];
      setCatalogs((prev) =>
        prev.map((c) =>
          c.name === catalogName
            ? {
                ...c,
                loading: false,
                fetchedAt: Date.now(),
                schemas: schemaNames.map((s) => ({
                  name: s,
                  expanded: false,
                  loading: false,
                  error: null,
                  tables: [],
                  fetchedAt: null,
                })),
              }
            : c,
        ),
      );
    } catch (err) {
      setCatalogs((prev) =>
        prev.map((c) =>
          c.name === catalogName
            ? {
                ...c,
                loading: false,
                error: err instanceof Error ? err.message : "Failed to load schemas",
              }
            : c,
        ),
      );
    }
  };

  // ── Refresh schema tables ──────────────────────────────────────────────
  const refreshSchemaTables = useCallback(async (catalogName: string, schemaName: string) => {
    const updateSchema = (updater: (s: SchemaNode) => SchemaNode) => {
      setCatalogs((prev) =>
        prev.map((c) =>
          c.name === catalogName
            ? { ...c, schemas: c.schemas.map((s) => (s.name === schemaName ? updater(s) : s)) }
            : c,
        ),
      );
    };
    updateSchema((s) => ({ ...s, loading: true, error: null, tables: [], fetchedAt: null }));
    try {
      const res = await fetch(
        `/api/metadata?type=tables&catalog=${encodeURIComponent(catalogName)}&schema=${encodeURIComponent(schemaName)}`,
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? "Failed to fetch tables");
      }
      const data = await res.json();
      const tables: TableNode[] = (data.tables ?? []).map(
        (t: { tableName: string; fqn: string; comment: string | null; tableType: string }) => ({
          name: t.tableName,
          fqn: t.fqn,
          comment: t.comment,
          tableType: t.tableType,
        }),
      );
      updateSchema((s) => ({ ...s, loading: false, fetchedAt: Date.now(), tables }));
    } catch (err) {
      updateSchema((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load tables",
      }));
    }
  }, []);

  // ── Toggle schema ──────────────────────────────────────────────────────
  const toggleSchema = async (catalogName: string, schemaName: string) => {
    const updateSchema = (updater: (s: SchemaNode) => SchemaNode) => {
      setCatalogs((prev) =>
        prev.map((c) =>
          c.name === catalogName
            ? { ...c, schemas: c.schemas.map((s) => (s.name === schemaName ? updater(s) : s)) }
            : c,
        ),
      );
    };
    const cat = catalogs.find((c) => c.name === catalogName);
    const sch = cat?.schemas.find((s) => s.name === schemaName);
    if (!sch) return;
    const isStale = !sch.fetchedAt || Date.now() - sch.fetchedAt > STALE_THRESHOLD_MS;
    const hasFreshData = sch.tables.length > 0 && !isStale;
    if (hasFreshData) {
      updateSchema((s) => ({ ...s, expanded: !s.expanded }));
      return;
    }
    updateSchema((s) => ({ ...s, expanded: true, loading: true, error: null }));
    try {
      const res = await fetch(
        `/api/metadata?type=tables&catalog=${encodeURIComponent(catalogName)}&schema=${encodeURIComponent(schemaName)}`,
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? "Failed to fetch tables");
      }
      const data = await res.json();
      const tables: TableNode[] = (data.tables ?? []).map(
        (t: { tableName: string; fqn: string; comment: string | null; tableType: string }) => ({
          name: t.tableName,
          fqn: t.fqn,
          comment: t.comment,
          tableType: t.tableType,
        }),
      );
      updateSchema((s) => ({ ...s, loading: false, fetchedAt: Date.now(), tables }));
    } catch (err) {
      updateSchema((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load tables",
      }));
    }
  };

  // ── Search filter ──────────────────────────────────────────────────────
  const searchLower = search.toLowerCase();
  const filteredCatalogs = useMemo(() => {
    if (!searchLower) return catalogs;
    return catalogs.filter((c) => {
      if (c.name.toLowerCase().includes(searchLower)) return true;
      if (
        c.schemas.some((s) => {
          if (s.name.toLowerCase().includes(searchLower)) return true;
          if (s.tables.some((t) => t.name.toLowerCase().includes(searchLower))) return true;
          return false;
        })
      )
        return true;
      return false;
    });
  }, [catalogs, searchLower]);

  // ── Selection helpers ──────────────────────────────────────────────────
  const isSelected = (source: string) => selectedSources.includes(source);
  const isExcludedExplicit = (source: string) => excludedSources.includes(source);

  const isPatternExcluded = useCallback(
    (path: string) => {
      if (exclusionPatterns.length === 0) return false;
      const segments = path.split(".");
      return exclusionPatterns.some((p) => segments.some((seg) => globMatch(p, seg)));
    },
    [exclusionPatterns],
  );

  const isAnyExcluded = useCallback(
    (path: string) => isExcludedExplicit(path) || isPatternExcluded(path),
    [excludedSources, exclusionPatterns, isPatternExcluded], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const addSource = (source: string) => {
    if (!isSelected(source)) {
      const newExcluded = excludedSources.filter((e) => e !== source);
      if (selectionMode === "schema") {
        emitChange([source], newExcluded, exclusionPatterns);
      } else {
        emitChange([...selectedSources, source], newExcluded, exclusionPatterns);
      }
    }
  };

  const removeSource = (source: string) => {
    emitChange(
      selectedSources.filter((s) => s !== source),
      excludedSources,
      exclusionPatterns,
    );
  };

  const excludeSource = (source: string) => {
    if (!isExcludedExplicit(source)) {
      emitChange(selectedSources, [...excludedSources, source], exclusionPatterns);
    }
  };

  const restoreExcluded = (source: string) => {
    emitChange(
      selectedSources,
      excludedSources.filter((e) => e !== source),
      exclusionPatterns,
    );
  };

  const isCoveredBy = (path: string) => {
    const parts = path.split(".");
    if (parts.length === 3) {
      return isSelected(parts[0]) || isSelected(`${parts[0]}.${parts[1]}`);
    }
    if (parts.length === 2) {
      return isSelected(parts[0]);
    }
    return false;
  };

  // ── Pattern handlers ───────────────────────────────────────────────────
  const addPattern = () => {
    const trimmed = patternInput.trim();
    if (!trimmed) return;
    const err = validateExclusionPattern(trimmed);
    if (err) {
      setPatternError(err);
      return;
    }
    if (exclusionPatterns.includes(trimmed)) {
      setPatternError("Pattern already added");
      return;
    }
    setPatternError(null);
    setPatternInput("");
    emitChange(selectedSources, excludedSources, [...exclusionPatterns, trimmed]);
  };

  const removePattern = (pattern: string) => {
    emitChange(
      selectedSources,
      excludedSources,
      exclusionPatterns.filter((p) => p !== pattern),
    );
  };

  // Count how many loaded tree nodes match a pattern (best-effort preview)
  const patternMatchCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of exclusionPatterns) {
      let count = 0;
      for (const c of catalogs) {
        if (globMatch(p, c.name)) count++;
        for (const s of c.schemas) {
          if (globMatch(p, s.name)) count++;
          for (const t of s.tables) {
            if (globMatch(p, t.name)) count++;
          }
        }
      }
      counts[p] = count;
    }
    return counts;
  }, [catalogs, exclusionPatterns]);

  // ── Render: pre-ready states ───────────────────────────────────────────

  if (phase === "warming-up") {
    return (
      <div className="space-y-3 rounded-md border p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Zap className="h-4 w-4 animate-pulse text-amber-500" />
          <span className="font-medium">{t("starting_warehouse")}</span>
        </div>
        {warmupElapsed >= 3 && (
          <p className="text-xs text-muted-foreground">
            The warehouse is waking up. This can take up to a few minutes on first use.
            <span className="ml-1 tabular-nums text-muted-foreground/70">({warmupElapsed}s)</span>
          </p>
        )}
        <div className="space-y-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      </div>
    );
  }

  if (phase === "loading") {
    return (
      <div className="space-y-2 rounded-md border p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          Loading catalogs...
        </div>
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-5 w-2/3" />
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-6 text-center">
        {errorCode === "INSUFFICIENT_PERMISSIONS" ? (
          <ShieldAlert className="h-5 w-5 text-destructive" />
        ) : (
          <AlertCircle className="h-5 w-5 text-destructive" />
        )}
        <p className="text-sm text-destructive">
          {errorCode === "WAREHOUSE_UNAVAILABLE"
            ? t("warehouse_unavailable")
            : errorCode === "INSUFFICIENT_PERMISSIONS"
              ? t("insufficient_permissions")
              : (error ?? t("load_failed"))}
        </p>
        {error && errorCode !== "INSUFFICIENT_PERMISSIONS" && (
          <p className="max-w-md text-xs text-muted-foreground">{error}</p>
        )}
        <Button variant="outline" size="sm" onClick={fullRetry}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          {t("retry")}
        </Button>
      </div>
    );
  }

  if (catalogs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-dashed p-6 text-center">
        <Database className="h-5 w-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t("no_catalogs")}</p>
        <p className="max-w-sm text-xs text-muted-foreground/70">{t("no_catalogs_hint")}</p>
        <Button variant="outline" size="sm" onClick={refreshCatalogs}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          {t("refresh")}
        </Button>
      </div>
    );
  }

  // ── Render: ready ──────────────────────────────────────────────────────
  const hasExclusions = excludedSources.length > 0 || exclusionPatterns.length > 0;

  return (
    <div className="space-y-3">
      {/* Tree browser */}
      <div className="rounded-md border">
        <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t("search_placeholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 pl-7 text-xs"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1 text-xs"
            onClick={refreshCatalogs}
          >
            <RefreshCw className="h-3 w-3" />
            {t("refresh")}
          </Button>
        </div>

        <div className="h-[300px] overflow-y-auto">
          <div className="p-1">
            {filteredCatalogs.length === 0 && search ? (
              <div className="flex flex-col items-center gap-1 py-8 text-center text-xs text-muted-foreground">
                <Search className="h-4 w-4" />
                {t("no_results", { query: search })}
              </div>
            ) : (
              filteredCatalogs.map((catalog) => (
                <CatalogRow
                  key={catalog.name}
                  catalog={catalog}
                  onToggleCatalog={() => toggleCatalog(catalog.name)}
                  onToggleSchema={(schema) => toggleSchema(catalog.name, schema)}
                  onRefreshCatalog={() => refreshCatalogSchemas(catalog.name)}
                  onRefreshSchema={(schema) => refreshSchemaTables(catalog.name, schema)}
                  isSelected={isSelected}
                  isExcluded={isAnyExcluded}
                  isExcludedExplicit={isExcludedExplicit}
                  isCoveredBy={isCoveredBy}
                  onAdd={addSource}
                  onRemove={removeSource}
                  onExclude={excludeSource}
                  onRestore={restoreExcluded}
                  searchFilter={searchLower}
                  selectionMode={selectionMode}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Exclusion pattern input (hidden in schema mode) */}
      {selectionMode === "table" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Filter className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder={t("exclude_placeholder")}
                value={patternInput}
                onChange={(e) => {
                  setPatternInput(e.target.value);
                  setPatternError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addPattern();
                  }
                }}
                className="h-7 pl-7 text-xs"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-1 text-xs"
              onClick={addPattern}
              disabled={!patternInput.trim()}
            >
              <Ban className="h-3 w-3" />
              {t("exclude")}
            </Button>
          </div>
          {patternError && <p className="text-xs text-destructive">{patternError}</p>}

          {exclusionPatterns.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {exclusionPatterns.map((pattern) => (
                <Badge
                  key={pattern}
                  variant="outline"
                  className="gap-1 border-red-200 bg-red-50 pr-1 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400"
                >
                  <Filter className="h-3 w-3" />
                  {pattern}
                  {patternMatchCounts[pattern] != null && patternMatchCounts[pattern] > 0 && (
                    <span className="text-[9px] text-red-400 dark:text-red-500">
                      ~{patternMatchCounts[pattern]}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removePattern(pattern)}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-red-200/50 dark:hover:bg-red-800/50"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Scope summary (hidden in schema mode) */}
      {selectionMode === "table" && (selectedSources.length > 0 || hasExclusions) && (
        <div className="space-y-2">
          {/* Included */}
          {selectedSources.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                {t("included", { count: selectedSources.length })}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {selectedSources.map((source) => {
                  const depth = source.split(".").length;
                  const Icon = depth === 1 ? Database : depth === 2 ? Layers : TableProperties;
                  return (
                    <Badge
                      key={source}
                      variant="outline"
                      className="max-w-[250px] gap-1 border-emerald-200 bg-emerald-50 pr-1 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400"
                      title={source}
                    >
                      <Icon className="h-3 w-3 shrink-0" />
                      <span className="truncate">{source}</span>
                      <button
                        type="button"
                        onClick={() => removeSource(source)}
                        className="ml-0.5 rounded-full p-0.5 hover:bg-emerald-200/50 dark:hover:bg-emerald-800/50"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}

          {/* Excluded */}
          {hasExclusions && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                {t("excluded", { count: excludedSources.length + exclusionPatterns.length })}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {excludedSources.map((source) => {
                  const depth = source.split(".").length;
                  const Icon = depth === 1 ? Database : depth === 2 ? Layers : TableProperties;
                  return (
                    <Badge
                      key={source}
                      variant="outline"
                      className="max-w-[250px] gap-1 border-red-200 bg-red-50 pr-1 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400"
                      title={source}
                    >
                      <Icon className="h-3 w-3 shrink-0" />
                      <span className="truncate line-through">{source}</span>
                      <button
                        type="button"
                        onClick={() => restoreExcluded(source)}
                        className="ml-0.5 rounded-full p-0.5 hover:bg-red-200/50 dark:hover:bg-red-800/50"
                        title="Restore"
                      >
                        <Undo2 className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
                {exclusionPatterns.map((pattern) => (
                  <Badge
                    key={`pattern-${pattern}`}
                    variant="outline"
                    className="gap-1 border-red-200 bg-red-50 pr-1 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400"
                  >
                    <Filter className="h-3 w-3" />
                    {pattern}
                    <button
                      type="button"
                      onClick={() => removePattern(pattern)}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-red-200/50 dark:hover:bg-red-800/50"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Catalog row
// ---------------------------------------------------------------------------

function CatalogRow({
  catalog,
  onToggleCatalog,
  onToggleSchema,
  onRefreshCatalog,
  onRefreshSchema,
  isSelected,
  isExcluded,
  isExcludedExplicit,
  isCoveredBy,
  onAdd,
  onRemove,
  onExclude,
  onRestore,
  searchFilter,
  selectionMode = "table",
}: {
  catalog: CatalogNode;
  onToggleCatalog: () => void;
  onToggleSchema: (schema: string) => void;
  onRefreshCatalog: () => void;
  onRefreshSchema: (schema: string) => void;
  isSelected: (source: string) => boolean;
  isExcluded: (source: string) => boolean;
  isExcludedExplicit: (source: string) => boolean;
  isCoveredBy: (path: string) => boolean;
  onAdd: (source: string) => void;
  onRemove: (source: string) => void;
  onExclude: (source: string) => void;
  onRestore: (source: string) => void;
  searchFilter?: string;
  selectionMode?: "table" | "schema";
}) {
  const catalogSelected = isSelected(catalog.name);
  const catalogExcluded = isExcluded(catalog.name);
  const hasSearch = !!searchFilter;
  const catalogNameMatches = hasSearch && catalog.name.toLowerCase().includes(searchFilter);

  const filteredSchemas = useMemo(() => {
    if (!hasSearch || catalogNameMatches) return catalog.schemas;
    return catalog.schemas.filter((s) => {
      if (s.name.toLowerCase().includes(searchFilter)) return true;
      if (s.tables.some((t) => t.name.toLowerCase().includes(searchFilter))) return true;
      return false;
    });
  }, [catalog.schemas, hasSearch, catalogNameMatches, searchFilter]);

  const showExpanded =
    catalog.expanded || (hasSearch && filteredSchemas.length > 0 && catalog.schemas.length > 0);

  return (
    <div>
      <div
        className={`group flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-muted/50 ${
          catalogExcluded ? "opacity-50" : ""
        }`}
      >
        <button
          type="button"
          onClick={onToggleCatalog}
          className="flex shrink-0 items-center gap-1"
        >
          {showExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <Database className={`h-4 w-4 ${catalogExcluded ? "text-red-400" : "text-orange-500"}`} />
        </button>

        <button
          type="button"
          onClick={onToggleCatalog}
          className={`min-w-0 flex-1 truncate text-left text-sm font-medium ${catalogExcluded ? "line-through text-muted-foreground" : ""}`}
          title={catalog.name}
        >
          <HighlightMatch text={catalog.name} query={searchFilter} />
        </button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 w-6 shrink-0 p-0 opacity-0 group-hover:opacity-60 hover:!opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onRefreshCatalog();
          }}
          title="Refresh schemas"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>

        {selectionMode === "table" && (
          <>
            {catalogExcluded && isExcludedExplicit(catalog.name) ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs text-red-600"
                onClick={() => onRestore(catalog.name)}
              >
                <Undo2 className="h-3 w-3" />
                Restore
              </Button>
            ) : catalogSelected ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs text-green-600"
                onClick={() => onRemove(catalog.name)}
              >
                <Check className="h-3 w-3" />
                Added
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs opacity-0 group-hover:opacity-100"
                onClick={() => onAdd(catalog.name)}
              >
                <Plus className="h-3 w-3" />
                Add all
              </Button>
            )}
          </>
        )}

        {selectionMode === "schema" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-xs opacity-0 group-hover:opacity-100"
            onClick={() => onAdd(catalog.name)}
          >
            <Plus className="h-3 w-3" />
            Select
          </Button>
        )}
      </div>

      {showExpanded && (
        <div className="ml-5 border-l pl-2">
          {catalog.loading && (
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Loading schemas...
            </div>
          )}
          {catalog.error && (
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-destructive">
              <AlertCircle className="h-3 w-3" />
              {catalog.error}
              <button
                type="button"
                onClick={onRefreshCatalog}
                className="ml-1 underline hover:no-underline"
              >
                Retry
              </button>
            </div>
          )}
          {!catalog.loading && !catalog.error && catalog.schemas.length === 0 && (
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
              No schemas found
              <button
                type="button"
                onClick={onRefreshCatalog}
                className="underline hover:no-underline"
              >
                Retry
              </button>
            </div>
          )}
          {filteredSchemas.map((schema) => (
            <SchemaRow
              key={schema.name}
              schema={schema}
              catalogName={catalog.name}
              onToggle={() => onToggleSchema(schema.name)}
              onRefresh={() => onRefreshSchema(schema.name)}
              isSelected={isSelected}
              isExcluded={isExcluded}
              isExcludedExplicit={isExcludedExplicit}
              isCoveredBy={isCoveredBy}
              onAdd={onAdd}
              onRemove={onRemove}
              onExclude={onExclude}
              onRestore={onRestore}
              searchFilter={searchFilter}
              selectionMode={selectionMode}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schema row
// ---------------------------------------------------------------------------

function SchemaRow({
  schema,
  catalogName,
  onToggle,
  onRefresh,
  isSelected,
  isExcluded,
  isExcludedExplicit,
  isCoveredBy,
  onAdd,
  onRemove,
  onExclude,
  onRestore,
  searchFilter,
  selectionMode = "table",
}: {
  schema: SchemaNode;
  catalogName: string;
  onToggle: () => void;
  onRefresh: () => void;
  isSelected: (source: string) => boolean;
  isExcluded: (source: string) => boolean;
  isExcludedExplicit: (source: string) => boolean;
  isCoveredBy: (path: string) => boolean;
  onAdd: (source: string) => void;
  onRemove: (source: string) => void;
  onExclude: (source: string) => void;
  onRestore: (source: string) => void;
  searchFilter?: string;
  selectionMode?: "table" | "schema";
}) {
  const schemaPath = `${catalogName}.${schema.name}`;
  const schemaSelected = isSelected(schemaPath);
  const schemaCovered = isCoveredBy(schemaPath);
  const schemaExcluded = isExcluded(schemaPath);
  const parentCatalogExcluded = isExcluded(catalogName);

  const hasSearch = !!searchFilter;
  const catalogNameMatches = hasSearch && catalogName.toLowerCase().includes(searchFilter ?? "");
  const schemaNameMatches = hasSearch && schema.name.toLowerCase().includes(searchFilter ?? "");
  const tablesToShow =
    !hasSearch || catalogNameMatches || schemaNameMatches
      ? schema.tables
      : schema.tables.filter((t) => t.name.toLowerCase().includes(searchFilter ?? ""));

  const isOpen = schema.expanded || schema.tables.length > 0;
  const isSchemaMode = selectionMode === "schema";

  const handleSchemaClick = () => {
    if (isSchemaMode) {
      if (schemaSelected) onRemove(schemaPath);
      else onAdd(schemaPath);
    } else {
      onToggle();
    }
  };

  const effectivelyExcluded = schemaExcluded || parentCatalogExcluded;

  return (
    <div>
      <div
        className={`group/schema flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted/50 ${
          isSchemaMode && schemaSelected ? "bg-violet-50 dark:bg-violet-950/30" : ""
        } ${effectivelyExcluded ? "opacity-50" : ""}`}
      >
        <button
          type="button"
          onClick={handleSchemaClick}
          className="flex shrink-0 items-center gap-1"
        >
          {isSchemaMode ? (
            schemaSelected ? (
              <Check className="h-3.5 w-3.5 text-green-600" />
            ) : (
              <Layers className="h-3.5 w-3.5 text-blue-500" />
            )
          ) : isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {!isSchemaMode && (
            <Layers
              className={`h-3.5 w-3.5 ${effectivelyExcluded ? "text-red-400" : "text-blue-500"}`}
            />
          )}
        </button>

        <button
          type="button"
          onClick={handleSchemaClick}
          className={`min-w-0 flex-1 truncate text-left text-sm ${
            effectivelyExcluded
              ? "line-through text-muted-foreground"
              : schemaCovered && !schemaSelected
                ? "text-muted-foreground"
                : ""
          } ${isSchemaMode && schemaSelected ? "font-medium text-violet-700 dark:text-violet-400" : ""}`}
          title={schema.name}
        >
          <HighlightMatch text={schema.name} query={searchFilter} />
          {!isSchemaMode && schema.tables.length > 0 && (
            <span className="ml-1.5 text-[10px] text-muted-foreground/60">
              ({schema.tables.length})
            </span>
          )}
          {!isSchemaMode && schemaCovered && !schemaSelected && !effectivelyExcluded && (
            <span className="ml-1.5 text-[10px] text-muted-foreground/60">
              (included via catalog)
            </span>
          )}
          {effectivelyExcluded && (
            <span className="ml-1.5 text-[10px] text-red-500/70">(excluded)</span>
          )}
        </button>

        {!isSchemaMode && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 w-5 shrink-0 p-0 opacity-0 group-hover/schema:opacity-60 hover:!opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onRefresh();
            }}
            title="Refresh tables"
          >
            <RefreshCw className="h-2.5 w-2.5" />
          </Button>
        )}

        {isSchemaMode ? (
          schemaSelected ? (
            <Badge variant="outline" className="text-[9px] text-green-600 border-green-200">
              Selected
            </Badge>
          ) : null
        ) : effectivelyExcluded && isExcludedExplicit(schemaPath) ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 gap-1 px-1.5 text-[11px] text-red-600"
            onClick={() => onRestore(schemaPath)}
          >
            <Undo2 className="h-2.5 w-2.5" />
            Restore
          </Button>
        ) : schemaSelected ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 gap-1 px-1.5 text-[11px] text-green-600"
            onClick={() => onRemove(schemaPath)}
          >
            <Check className="h-2.5 w-2.5" />
            Added
          </Button>
        ) : schemaCovered && !effectivelyExcluded ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 gap-1 px-1.5 text-[11px] text-red-600 opacity-0 group-hover/schema:opacity-100"
            onClick={() => onExclude(schemaPath)}
            title="Exclude this schema"
          >
            <Ban className="h-2.5 w-2.5" />
            Exclude
          </Button>
        ) : !schemaCovered ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 gap-1 px-1.5 text-[11px] opacity-0 group-hover/schema:opacity-100"
            onClick={() => onAdd(schemaPath)}
          >
            <Plus className="h-2.5 w-2.5" />
            Add
          </Button>
        ) : null}
      </div>

      {!isSchemaMode && isOpen && (
        <div className="ml-5 border-l pl-2">
          {schema.loading && (
            <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Loading tables...
            </div>
          )}
          {schema.error && (
            <div className="flex items-center gap-2 px-2 py-1 text-xs text-destructive">
              <AlertCircle className="h-3 w-3" />
              {schema.error}
              <button
                type="button"
                onClick={onRefresh}
                className="ml-1 underline hover:no-underline"
              >
                Retry
              </button>
            </div>
          )}
          {!schema.loading && !schema.error && schema.tables.length === 0 && (
            <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
              No tables found
              <button type="button" onClick={onRefresh} className="underline hover:no-underline">
                Retry
              </button>
            </div>
          )}
          {tablesToShow.map((table, idx) => {
            const tablePath = `${catalogName}.${schema.name}.${table.name}`;
            const tableSelected = isSelected(tablePath);
            const tableCovered = isCoveredBy(tablePath);
            const tableExcluded = isExcluded(tablePath) || effectivelyExcluded;
            const displayName = table.name || table.fqn.split(".").pop() || `table-${idx}`;

            return (
              <div
                key={`${catalogName}.${schema.name}.${displayName}.${idx}`}
                className={`group/table flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-muted/50 ${
                  tableExcluded ? "opacity-50" : ""
                }`}
              >
                <TableProperties
                  className={`h-3.5 w-3.5 shrink-0 ${tableExcluded ? "text-red-400" : "text-emerald-500"}`}
                />
                <span
                  className={`flex-1 truncate text-xs ${
                    tableExcluded
                      ? "line-through text-muted-foreground"
                      : tableCovered && !tableSelected
                        ? "text-muted-foreground"
                        : ""
                  }`}
                  title={table.fqn}
                >
                  {displayName}
                </span>

                {tableExcluded && isExcludedExplicit(tablePath) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-5 gap-0.5 px-1.5 text-[10px] text-red-600"
                    onClick={() => onRestore(tablePath)}
                  >
                    <Undo2 className="h-2.5 w-2.5" />
                    Restore
                  </Button>
                ) : tableSelected ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-5 gap-0.5 px-1.5 text-[10px] text-green-600"
                    onClick={() => onRemove(tablePath)}
                  >
                    <Check className="h-2.5 w-2.5" />
                    Added
                  </Button>
                ) : tableCovered && !tableExcluded ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-5 gap-0.5 px-1.5 text-[10px] text-red-600 opacity-0 group-hover/table:opacity-100"
                    onClick={() => onExclude(tablePath)}
                    title="Exclude this table"
                  >
                    <Ban className="h-2.5 w-2.5" />
                    Exclude
                  </Button>
                ) : !tableCovered && !tableExcluded ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-5 gap-0.5 px-1.5 text-[10px] opacity-0 group-hover/table:opacity-100"
                    onClick={() => onAdd(tablePath)}
                  >
                    <Plus className="h-2.5 w-2.5" />
                    Add
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Highlight matching text
// ---------------------------------------------------------------------------

function HighlightMatch({ text, query }: { text: string; query?: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-yellow-200/60 px-0.5 dark:bg-yellow-500/30">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}
