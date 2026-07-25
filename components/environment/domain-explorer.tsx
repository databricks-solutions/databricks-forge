"use client";

/**
 * Estate Domain Explorer.
 *
 * Progressive-zoom view of the estate's structure: domain → subdomain → table.
 * The first click on a domain bubble zooms *into* that domain (a bubble map of
 * its subdomains) rather than dumping a flat list; a second click zooms to the
 * domain's tables; clicking a table opens its detail. A breadcrumb + Back walk
 * back up, and a Map ⇄ List toggle is available at every level.
 *
 * All levels are derived client-side from the `TableDetailRow[]` the estate
 * view already holds (see lib/environment/domain-explorer.ts for the pure
 * grouping + packing logic). Phase 3 layers manual remap/evict on top via the
 * optional `scanId` + `editable` props.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Boxes, ChevronRight, LayoutGrid, List as ListIcon } from "lucide-react";
import type { TableDetailRow } from "@/app/environment/types";
import {
  buildDomains,
  buildSubdomains,
  tablesIn,
  metricValue,
  packCircles,
  colorMap,
  catalogOf,
  schemaOf,
  shortName,
  toNum,
  fitCircleLabel,
  tableStorageFeatures,
  TIER_COLOR,
  PALETTE,
  type Metric,
  type ColorBy,
  type ExplorerLevel,
  type GroupNode,
} from "@/lib/environment/domain-explorer";
import {
  DomainOverrideMenu,
  AdjustmentsButton,
} from "@/components/environment/domain-override-menu";
import type { DomainOverride } from "@/lib/environment/domain-overrides";
import { useL10n } from "@/i18n/format";

const VIEW_W = 820;
const VIEW_H = 460;

/**
 * Activate an interactive element on Enter/Space, mirroring native button
 * behaviour for non-button controls (SVG `<g>` bubbles, table rows). Keeps the
 * page from scrolling on Space.
 */
function onActivateKey(action: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      action();
    }
  };
}

/** Focus-visible outline shared by the keyboard-operable SVG bubbles. */
const BUBBLE_FOCUS =
  "cursor-pointer outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Cap the map to a fraction of the viewport so the whole card (header +
 * breadcrumb + map + legend) fits without a vertical scrollbar, and let the
 * SVG scale-to-fit (`preserveAspectRatio` meet) inside that box instead of
 * forcing its intrinsic 820×460 aspect height.
 */
const MAP_CLASS = "mx-auto block h-[44vh] min-h-[240px] max-h-[480px] w-full";

type View = "map" | "list";

interface ExplorerProps {
  details: TableDetailRow[];
  humanNumber: (value: string | number | null) => string;
  humanSize: (bytes: string | number | null) => string;
  /** Scan the overrides write against. When set with `editable`, remap/evict is enabled. */
  scanId?: string;
  editable?: boolean;
}

export function DomainExplorer({
  details,
  humanNumber,
  humanSize,
  scanId,
  editable = false,
}: ExplorerProps) {
  const t = useTranslations("estate_explorer.domain");
  const [level, setLevel] = useState<ExplorerLevel>("domains");
  const [domain, setDomain] = useState<string | null>(null);
  const [subdomain, setSubdomain] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("rows");
  const [colorBy, setColorBy] = useState<ColorBy>("tier");
  const [view, setView] = useState<View>("map");
  const [detailTable, setDetailTable] = useState<TableDetailRow | null>(null);

  // ---- Phase 3: overrides ------------------------------------------------
  const [overrides, setOverrides] = useState<DomainOverride[]>([]);
  const canEdit = editable && !!scanId;

  const loadOverrides = useCallback(async () => {
    if (!scanId || !editable) return;
    try {
      const resp = await fetch(`/api/environment/${scanId}/overrides`);
      if (!resp.ok) return;
      const body = await resp.json();
      setOverrides((body.overrides ?? []) as DomainOverride[]);
    } catch {
      /* non-fatal */
    }
  }, [scanId, editable]);

  useEffect(() => {
    if (!scanId || !editable) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`/api/environment/${scanId}/overrides`);
        if (!resp.ok || cancelled) return;
        const body = await resp.json();
        if (!cancelled) setOverrides((body.overrides ?? []) as DomainOverride[]);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scanId, editable]);

  // Overrides are applied by the parent via the API + a re-fetch of details in
  // most flows; here we apply them client-side for an immediate response.
  const effectiveDetails = useMemo(
    () => applyOverridesClient(details, overrides),
    [details, overrides],
  );

  const domains = useMemo(() => buildDomains(effectiveDetails), [effectiveDetails]);
  const domainColors = useMemo(() => colorMap(domains.map((d) => d.name)), [domains]);

  const subdomains = useMemo(
    () => (domain ? buildSubdomains(effectiveDetails, domain) : []),
    [effectiveDetails, domain],
  );
  const subColors = useMemo(() => colorMap(subdomains.map((s) => s.name)), [subdomains]);

  const leafTables = useMemo(
    () => (domain ? tablesIn(effectiveDetails, domain, level === "tables" ? subdomain : null) : []),
    [effectiveDetails, domain, subdomain, level],
  );

  // ---- Navigation --------------------------------------------------------
  const goDomains = useCallback(() => {
    setLevel("domains");
    setDomain(null);
    setSubdomain(null);
  }, []);
  const openDomain = useCallback((name: string) => {
    setDomain(name);
    setSubdomain(null);
    setLevel("subdomains");
  }, []);
  const openSubdomain = useCallback((name: string) => {
    setSubdomain(name);
    setLevel("tables");
  }, []);

  if (domains.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Boxes aria-hidden="true" className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <h3 className="text-lg font-semibold">{t("emptyTitle")}</h3>
          <p className="mt-2 max-w-md text-muted-foreground">{t("emptyDescription")}</p>
        </CardContent>
      </Card>
    );
  }

  // What are we drawing at this level?
  const groupNodes: GroupNode[] =
    level === "domains" ? domains : level === "subdomains" ? subdomains : [];
  const groupColors = level === "domains" ? domainColors : subColors;
  // At table level the metric "tables" is meaningless for a single table; size by rows then size.
  const leafMetric: Metric = metric === "tables" ? "rows" : metric;

  const metricLabel = (m: Metric) => t(`metric.${m}`);

  const formatGroup = (n: GroupNode): string => {
    if (metric === "rows") return t("rowsCount", { count: n.totalRows });
    if (metric === "size") return humanSize(n.totalBytes);
    return t("tablesCount", { count: n.tableCount });
  };

  const onApplied = () => {
    loadOverrides();
  };

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <CardTitle>{t("title")}</CardTitle>
            <CardDescription>
              {level === "domains" && (
                <>{t("domainsDescription", { metric: metricLabel(metric) })}</>
              )}
              {level === "subdomains" && (
                <>
                  {t("subdomainsDescription", {
                    domain: domain ?? "",
                    metric: metricLabel(metric),
                  })}
                </>
              )}
              {level === "tables" && (
                <>
                  {t("tablesDescription", {
                    group: `${domain}${subdomain ? ` › ${subdomain}` : ""}`,
                  })}
                </>
              )}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <AdjustmentsButton
                count={overrides.length}
                overrides={overrides}
                scanId={scanId!}
                onChanged={onApplied}
              />
            )}
            {/* View toggle */}
            <div className="flex shrink-0 rounded-md border p-0.5">
              <Button
                size="sm"
                variant={view === "map" ? "secondary" : "ghost"}
                className="min-h-11 min-w-11 px-2 text-xs"
                onClick={() => setView("map")}
                aria-label={t("mapView")}
              >
                <LayoutGrid aria-hidden="true" className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant={view === "list" ? "secondary" : "ghost"}
                className="min-h-11 min-w-11 px-2 text-xs"
                onClick={() => setView("list")}
                aria-label={t("listView")}
              >
                <ListIcon aria-hidden="true" className="h-3.5 w-3.5" />
              </Button>
            </div>
            {/* Metric toggle */}
            <div className="flex shrink-0 rounded-md border p-0.5">
              {(["rows", "tables", "size"] as Metric[]).map((m) => (
                <Button
                  key={m}
                  size="sm"
                  variant={metric === m ? "secondary" : "ghost"}
                  className="min-h-11 px-3 text-xs"
                  onClick={() => setMetric(m)}
                >
                  {t(`metricControl.${m}`)}
                </Button>
              ))}
            </div>
            {/* Colour toggle (table level only) */}
            {level === "tables" && (
              <div className="flex shrink-0 rounded-md border p-0.5">
                {(["tier", "catalog"] as ColorBy[]).map((c) => (
                  <Button
                    key={c}
                    size="sm"
                    variant={colorBy === c ? "secondary" : "ghost"}
                    className="min-h-11 px-3 text-xs"
                    onClick={() => setColorBy(c)}
                  >
                    {t(`color.${c}`)}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-1 text-sm" aria-label={t("breadcrumb")}>
          <button
            type="button"
            onClick={goDomains}
            className={`min-h-11 rounded px-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${level === "domains" ? "font-semibold" : "text-muted-foreground"}`}
          >
            {t("estate")}
          </button>
          {domain && (
            <>
              <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
              <button
                type="button"
                onClick={() => openDomain(domain)}
                className={`min-h-11 rounded px-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${level === "subdomains" ? "font-semibold" : "text-muted-foreground"}`}
              >
                {domain}
              </button>
            </>
          )}
          {level === "tables" && subdomain && (
            <>
              <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="px-1.5 py-0.5 font-semibold">{subdomain}</span>
            </>
          )}
        </nav>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ---- Map view ---- */}
        {view === "map" && level !== "tables" && (
          <GroupBubbles
            nodes={groupNodes}
            colors={groupColors}
            metric={metric}
            formatGroup={formatGroup}
            onOpen={(name) => (level === "domains" ? openDomain(name) : openSubdomain(name))}
          />
        )}
        {view === "map" && level === "tables" && (
          <TableBubbles
            tables={leafTables}
            metric={leafMetric}
            colorBy={colorBy}
            humanNumber={humanNumber}
            humanSize={humanSize}
            onOpen={setDetailTable}
          />
        )}

        {/* ---- List view ---- */}
        {view === "list" && level !== "tables" && (
          <GroupList
            nodes={groupNodes}
            colors={groupColors}
            metric={metric}
            formatGroup={formatGroup}
            onOpen={(name) => (level === "domains" ? openDomain(name) : openSubdomain(name))}
          />
        )}
        {view === "list" && level === "tables" && (
          <TableList
            tables={leafTables}
            humanNumber={humanNumber}
            humanSize={humanSize}
            onOpen={setDetailTable}
          />
        )}

        {/* Legend at group levels (also drills small bubbles) */}
        {level !== "tables" && view === "map" && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[...groupNodes]
              .sort((a, b) => metricValue(b, metric) - metricValue(a, metric))
              .map((n) => (
                <button
                  key={n.key}
                  type="button"
                  onClick={() => (level === "domains" ? openDomain(n.name) : openSubdomain(n.name))}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: groupColors.get(n.name) }}
                    />
                    <span className="truncate font-medium">{n.name}</span>
                  </span>
                  <span className="shrink-0 text-muted-foreground">{formatGroup(n)}</span>
                </button>
              ))}
          </div>
        )}
      </CardContent>

      <TableDetailSheet
        table={detailTable}
        onClose={() => setDetailTable(null)}
        humanNumber={humanNumber}
        humanSize={humanSize}
        scanId={scanId}
        canEdit={canEdit}
        domains={domains.map((d) => d.name)}
        currentDomain={domain}
        onApplied={onApplied}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Map: group bubbles (domains / subdomains)
// ---------------------------------------------------------------------------

function GroupBubbles({
  nodes,
  colors,
  metric,
  formatGroup,
  onOpen,
}: {
  nodes: GroupNode[];
  colors: Map<string, string>;
  metric: Metric;
  formatGroup: (n: GroupNode) => string;
  onOpen: (name: string) => void;
}) {
  const t = useTranslations("estate_explorer.domain");
  const l10n = useL10n();
  const localizedSize = (bytes: number): string => {
    const units = ["B", "KB", "MB", "GB", "TB"] as const;
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return t("storageSize", { value: l10n.number(0), unit: t("units.B") });
    }
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return t("storageSize", {
      value: l10n.number(bytes / 1024 ** index),
      unit: t(`units.${units[index]}`),
    });
  };
  const byKey = useMemo(() => new Map(nodes.map((n) => [n.key, n])), [nodes]);
  const metricHasSignal = nodes.some((n) => metricValue(n, metric) > 0);
  const circles = useMemo(
    () =>
      packCircles(
        nodes.map((n) => ({
          key: n.key,
          value: metricHasSignal ? metricValue(n, metric) : n.tableCount,
        })),
        VIEW_W,
        VIEW_H,
      ),
    [nodes, metric, metricHasSignal],
  );

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMid meet"
      className={MAP_CLASS}
      role="group"
      aria-label={t("domainBubbleMap")}
    >
      {circles.map((c) => {
        const n = byKey.get(c.key)!;
        const display = n.name.length > 18 ? `${n.name.slice(0, 17)}…` : n.name;
        const approxTextW = display.length * 7.2;
        const showName = c.r >= 26 && c.r * 1.8 >= approxTextW;
        const showValue = showName && c.r >= 46;
        const color = colors.get(n.name) ?? PALETTE[0];
        return (
          <g
            key={c.key}
            transform={`translate(${c.x},${c.y})`}
            className={BUBBLE_FOCUS}
            role="button"
            tabIndex={0}
            aria-label={t("openGroup", {
              name: n.name,
              tables: n.tableCount,
              rows: t("rowsCount", { count: n.totalRows }),
              size: localizedSize(n.totalBytes),
            })}
            onClick={() => onOpen(n.name)}
            onKeyDown={onActivateKey(() => onOpen(n.name))}
          >
            <title>
              {t("groupTooltip", {
                name: n.name,
                tables: n.tableCount,
                rows: n.totalRows,
                size: localizedSize(n.totalBytes),
              })}
            </title>
            <circle
              r={c.r}
              fill={color}
              fillOpacity={0.82}
              stroke={color}
              strokeOpacity={0.95}
              strokeWidth={1.5}
              className="transition-[fill-opacity] hover:[fill-opacity:0.95]"
            />
            {showName && (
              <text
                textAnchor="middle"
                dy={showValue ? "-0.2em" : "0.35em"}
                className="pointer-events-none select-none fill-white text-[13px] font-semibold"
              >
                {display}
              </text>
            )}
            {showValue && (
              <text
                textAnchor="middle"
                dy="1.1em"
                className="pointer-events-none select-none fill-white/85 text-[11px]"
              >
                {formatGroup(n)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Map: table bubbles (leaf level)
// ---------------------------------------------------------------------------

function TableBubbles({
  tables,
  metric,
  colorBy,
  humanNumber,
  humanSize,
  onOpen,
}: {
  tables: TableDetailRow[];
  metric: Metric;
  colorBy: ColorBy;
  humanNumber: (v: string | number | null) => string;
  humanSize: (v: string | number | null) => string;
  onOpen: (t: TableDetailRow) => void;
}) {
  const tr = useTranslations("estate_explorer.domain");
  const byFqn = useMemo(() => new Map(tables.map((t) => [t.tableFqn, t])), [tables]);
  const catalogColors = useMemo(() => colorMap(tables.map((t) => catalogOf(t.tableFqn))), [tables]);
  const value = (t: TableDetailRow) =>
    metric === "size" ? toNum(t.sizeInBytes) : toNum(t.numRows);
  const hasSignal = tables.some((t) => value(t) > 0);
  const colorFor = (t: TableDetailRow): string =>
    colorBy === "tier"
      ? (TIER_COLOR[(t.dataTier ?? "").toLowerCase()] ?? "#64748b")
      : (catalogColors.get(catalogOf(t.tableFqn)) ?? PALETTE[0]);

  const circles = useMemo(
    () =>
      packCircles(
        tables.map((t) => ({ key: t.tableFqn, value: hasSignal ? value(t) : 1 })),
        VIEW_W,
        VIEW_H,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tables, metric, hasSignal],
  );

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ t: TableDetailRow; x: number; y: number } | null>(null);

  const onMove = useCallback((t: TableDetailRow, e: React.MouseEvent) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    setHover({ t, x: e.clientX - box.left, y: e.clientY - box.top });
  }, []);

  if (tables.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{tr("noTables")}</p>;
  }

  return (
    <div ref={wrapRef} className="relative" onMouseLeave={() => setHover(null)}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        className={MAP_CLASS}
        role="group"
        aria-label={tr("tableBubbleMap")}
      >
        {circles.map((c) => {
          const t = byFqn.get(c.key)!;
          const name = shortName(t.tableFqn);
          const fontSize = c.r >= 60 ? 14 : 12;
          const { lines } = fitCircleLabel(name, c.r, fontSize);
          const showName = c.r >= 22;
          const color = colorFor(t);
          const lineH = fontSize + 2;
          const startDy = -((lines.length - 1) * lineH) / 2 + fontSize * 0.34;
          return (
            <g
              key={c.key}
              transform={`translate(${c.x},${c.y})`}
              className={BUBBLE_FOCUS}
              role="button"
              tabIndex={0}
              aria-label={tr("openTable", {
                name,
                rows: humanNumber(t.numRows),
                size: humanSize(t.sizeInBytes),
              })}
              onClick={() => onOpen(t)}
              onKeyDown={onActivateKey(() => onOpen(t))}
              onMouseEnter={(e) => onMove(t, e)}
              onMouseMove={(e) => onMove(t, e)}
            >
              <circle
                r={c.r}
                fill={color}
                fillOpacity={0.82}
                stroke={color}
                strokeOpacity={0.95}
                strokeWidth={1.5}
                className="transition-[fill-opacity] hover:[fill-opacity:0.95]"
              />
              {showName &&
                lines.map((ln, i) => (
                  <text
                    key={i}
                    textAnchor="middle"
                    y={startDy + i * lineH}
                    style={{ fontSize }}
                    className="pointer-events-none select-none fill-white font-semibold"
                  >
                    {ln}
                  </text>
                ))}
            </g>
          );
        })}
      </svg>
      {hover && (
        <TableHoverCard
          table={hover.t}
          x={hover.x}
          y={hover.y}
          humanNumber={humanNumber}
          humanSize={humanSize}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rich hover card for a table bubble
// ---------------------------------------------------------------------------

function TableHoverCard({
  table,
  x,
  y,
  humanNumber,
  humanSize,
}: {
  table: TableDetailRow;
  x: number;
  y: number;
  humanNumber: (v: string | number | null) => string;
  humanSize: (v: string | number | null) => string;
}) {
  const t = useTranslations("estate_explorer.domain");
  const l10n = useL10n();
  const feat = tableStorageFeatures(table);
  const comment = table.comment || table.generatedDescription;
  const updated = table.lastModified
    ? `${l10n.date(table.lastModified)} (${l10n.relative(table.lastModified)})`
    : null;
  // Keep the card inside the right edge; flip above the cursor near the bottom.
  const style: React.CSSProperties = {
    left: Math.min(x + 14, 640),
    top: y + 14,
    maxWidth: 320,
  };
  return (
    <div
      className="pointer-events-none absolute z-50 rounded-md border bg-popover/95 p-3 text-popover-foreground shadow-lg backdrop-blur"
      style={style}
      role="tooltip"
    >
      <p className="truncate text-sm font-semibold">{shortName(table.tableFqn)}</p>
      <p className="mt-0.5 break-all text-[11px] text-muted-foreground">
        {schemaOf(table.tableFqn)}
      </p>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <HoverStat label={t("fields.rows")} value={humanNumber(table.numRows)} />
        <HoverStat label={t("fields.size")} value={humanSize(table.sizeInBytes)} />
        {table.numFiles != null && (
          <HoverStat label={t("fields.files")} value={humanNumber(table.numFiles)} />
        )}
        {table.dataTier && (
          <HoverStat label={t("fields.tier")} value={table.dataTier} className="capitalize" />
        )}
        {table.owner && (
          <HoverStat
            label={t("fields.owner")}
            value={table.owner}
            className="col-span-2 truncate"
          />
        )}
        {updated && (
          <HoverStat label={t("fields.updated")} value={updated} className="col-span-2" />
        )}
        {table.format && <HoverStat label={t("fields.format")} value={table.format} />}
        {table.tableType && (
          <HoverStat label={t("fields.type")} value={table.tableType} className="truncate" />
        )}
      </dl>

      {(feat.liquidClustering || feat.deletionVectors || feat.cdf || feat.autoOptimize) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {feat.liquidClustering && (
            <Badge variant="secondary" className="text-[10px]">
              {t("features.liquidClustering")}
              {feat.clusterKeys.length > 0 ? `: ${feat.clusterKeys.join(", ")}` : ""}
            </Badge>
          )}
          {feat.deletionVectors && (
            <Badge variant="secondary" className="text-[10px]">
              {t("features.deletionVectors")}
            </Badge>
          )}
          {feat.cdf && (
            <Badge variant="secondary" className="text-[10px]">
              CDF
            </Badge>
          )}
          {feat.autoOptimize && (
            <Badge variant="secondary" className="text-[10px]">
              {t("features.autoOptimize")}
            </Badge>
          )}
        </div>
      )}

      {comment && <p className="mt-2 line-clamp-3 text-[11px] text-muted-foreground">{comment}</p>}
    </div>
  );
}

function HoverStat({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List views
// ---------------------------------------------------------------------------

function GroupList({
  nodes,
  colors,
  metric,
  formatGroup,
  onOpen,
}: {
  nodes: GroupNode[];
  colors: Map<string, string>;
  metric: Metric;
  formatGroup: (n: GroupNode) => string;
  onOpen: (name: string) => void;
}) {
  const t = useTranslations("estate_explorer.domain");
  const l10n = useL10n();
  const sorted = [...nodes].sort((a, b) => metricValue(b, metric) - metricValue(a, metric));
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.group")}</TableHead>
            <TableHead className="text-right">{t("columns.tables")}</TableHead>
            <TableHead className="text-right">{t("columns.metric")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((n) => (
            <TableRow
              key={n.key}
              className="cursor-pointer outline-none focus-visible:bg-accent"
              role="button"
              tabIndex={0}
              aria-label={t("openGroupList", { name: n.name, count: n.tableCount })}
              onClick={() => onOpen(n.name)}
              onKeyDown={onActivateKey(() => onOpen(n.name))}
            >
              <TableCell>
                <span className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: colors.get(n.name) }}
                  />
                  <span className="font-medium">{n.name}</span>
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {l10n.integer(n.tableCount)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {formatGroup(n)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TableList({
  tables,
  humanNumber,
  humanSize,
  onOpen,
}: {
  tables: TableDetailRow[];
  humanNumber: (v: string | number | null) => string;
  humanSize: (v: string | number | null) => string;
  onOpen: (t: TableDetailRow) => void;
}) {
  const tr = useTranslations("estate_explorer.domain");
  if (tables.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{tr("noTables")}</p>;
  }
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tr("columns.table")}</TableHead>
            <TableHead className="text-right">{tr("columns.rows")}</TableHead>
            <TableHead className="text-right">{tr("columns.size")}</TableHead>
            <TableHead>{tr("columns.tier")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tables.map((t, i) => (
            <TableRow
              key={t.tableFqn}
              className="cursor-pointer outline-none focus-visible:bg-accent"
              role="button"
              tabIndex={0}
              aria-label={tr("openTableList", { name: shortName(t.tableFqn) })}
              onClick={() => onOpen(t)}
              onKeyDown={onActivateKey(() => onOpen(t))}
            >
              <TableCell className="max-w-[20rem]">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{shortName(t.tableFqn)}</span>
                  {i === 0 && tables.length > 1 && toNum(t.numRows) > 0 && (
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {tr("largest")}
                    </Badge>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">{t.tableFqn}</div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{humanNumber(t.numRows)}</TableCell>
              <TableCell className="text-right tabular-nums">{humanSize(t.sizeInBytes)}</TableCell>
              <TableCell>
                {t.dataTier ? (
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {t.dataTier}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table detail sheet
// ---------------------------------------------------------------------------

function TableDetailSheet({
  table,
  onClose,
  humanNumber,
  humanSize,
  scanId,
  canEdit,
  domains,
  currentDomain,
  onApplied,
}: {
  table: TableDetailRow | null;
  onClose: () => void;
  humanNumber: (v: string | number | null) => string;
  humanSize: (v: string | number | null) => string;
  scanId?: string;
  canEdit: boolean;
  domains: string[];
  currentDomain: string | null;
  onApplied: () => void;
}) {
  const t = useTranslations("estate_explorer.domain");
  const l10n = useL10n();
  return (
    <Sheet open={!!table} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="truncate">{table ? shortName(table.tableFqn) : ""}</SheetTitle>
          <SheetDescription className="break-all">{table?.tableFqn}</SheetDescription>
        </SheetHeader>
        {table && (
          <div className="mt-3 space-y-4 overflow-auto px-1">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Field label={t("fields.domain")} value={table.dataDomain ?? "—"} />
              <Field label={t("fields.subdomain")} value={table.dataSubdomain ?? t("ungrouped")} />
              <Field label={t("fields.tier")} value={table.dataTier ?? "—"} />
              <Field label={t("fields.type")} value={table.tableType ?? "—"} />
              <Field label={t("fields.rows")} value={humanNumber(table.numRows)} />
              <Field label={t("fields.size")} value={humanSize(table.sizeInBytes)} />
              <Field
                label={t("fields.files")}
                value={table.numFiles != null ? humanNumber(table.numFiles) : "—"}
              />
              <Field label={t("fields.format")} value={table.format ?? "—"} />
              <Field label={t("fields.owner")} value={table.owner ?? "—"} />
              <Field label={t("fields.sensitivity")} value={table.sensitivityLevel ?? "—"} />
              <Field
                label={t("fields.lastUpdated")}
                value={
                  table.lastModified
                    ? `${l10n.date(table.lastModified)} (${l10n.relative(table.lastModified)})`
                    : "—"
                }
              />
            </dl>
            <StorageFeatureBadges table={table} />
            {(table.comment || table.generatedDescription) && (
              <p className="text-sm text-muted-foreground">
                {table.comment || table.generatedDescription}
              </p>
            )}
            {canEdit && scanId && (
              <div className="border-t pt-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("adjustGrouping")}
                </p>
                <DomainOverrideMenu
                  scanId={scanId}
                  fqn={table.tableFqn}
                  domains={domains}
                  currentDomain={currentDomain}
                  onApplied={() => {
                    onApplied();
                    onClose();
                  }}
                />
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function StorageFeatureBadges({ table }: { table: TableDetailRow }) {
  const t = useTranslations("estate_explorer.domain");
  const feat = tableStorageFeatures(table);
  if (!feat.liquidClustering && !feat.deletionVectors && !feat.cdf && !feat.autoOptimize) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {feat.liquidClustering && (
        <Badge variant="secondary" className="text-[10px]">
          {t("features.liquidClustering")}
          {feat.clusterKeys.length > 0 ? `: ${feat.clusterKeys.join(", ")}` : ""}
        </Badge>
      )}
      {feat.deletionVectors && (
        <Badge variant="secondary" className="text-[10px]">
          {t("features.deletionVectors")}
        </Badge>
      )}
      {feat.cdf && (
        <Badge variant="secondary" className="text-[10px]">
          {t("features.changeDataFeed")}
        </Badge>
      )}
      {feat.autoOptimize && (
        <Badge variant="secondary" className="text-[10px]">
          {t("features.autoOptimize")}
        </Badge>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Client-side override application (mirrors lib/environment/domain-overrides.ts)
// ---------------------------------------------------------------------------

import { applyDomainOverrides as applyOverridesClient } from "@/lib/environment/domain-overrides";
