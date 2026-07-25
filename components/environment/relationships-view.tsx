"use client";

/**
 * Estate Relationships view.
 *
 * Surfaces table-to-table relationships (lineage + ontology-inferred) for a
 * scan and highlights the ones that cross a boundary — catalog, schema, or
 * business domain. Cross-boundary edges are the architecturally interesting
 * ones: hidden coupling, undocumented dependencies, domains that leak.
 *
 * Summary stat cards + a filterable edge list. Data comes from
 * /api/environment/[scanId]/relationships (see lib/environment/relationships.ts
 * for the pure flagging logic).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Workflow, ArrowRight } from "lucide-react";
import { shortName } from "@/lib/environment/domain-explorer";
import type { DerivedEdge, RelationshipSummary } from "@/lib/environment/relationships";
import { useL10n } from "@/i18n/format";

type Filter = "all" | "crossDomain" | "crossCatalog" | "crossSchema";

interface RelationshipsResponse {
  summary: RelationshipSummary;
  edges: DerivedEdge[];
  truncated: boolean;
}

/**
 * Renders the estate Relationships view for either a single scan (`scanId`) or
 * an entire estate program (`programId`). When `programId` is given the data is
 * aggregated across ALL of the program's completed member scans (never just the
 * latest/diagnosis scan).
 */
export function RelationshipsView({
  scanId,
  programId,
}: {
  scanId?: string;
  programId?: string;
}) {
  const t = useTranslations("estate_explorer.relationships");
  const l10n = useL10n();
  const [data, setData] = useState<RelationshipsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  const endpoint = programId
    ? `/api/estate-programs/${programId}/relationships`
    : scanId
      ? `/api/environment/${scanId}/relationships`
      : null;

  const load = useCallback(async () => {
    if (!endpoint) return;
    setLoading(true);
    setError(false);
    try {
      const resp = await fetch(endpoint);
      if (!resp.ok) throw new Error("failed");
      setData(await resp.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (filter === "all") return data.edges;
    return data.edges.filter((e) => e[filter]);
  }, [data, filter]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-dashed" role="alert">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Workflow aria-hidden="true" className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <h3 className="text-lg font-semibold">{t("errorTitle")}</h3>
          <p className="mt-2 max-w-md text-muted-foreground">{t("errorDescription")}</p>
          <Button className="mt-6" variant="outline" onClick={load}>
            {t("retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.summary.total === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Workflow aria-hidden="true" className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <h3 className="text-lg font-semibold">{t("emptyTitle")}</h3>
          <p className="mt-2 max-w-md text-muted-foreground">{t("emptyDescription")}</p>
        </CardContent>
      </Card>
    );
  }

  const { summary } = data;
  const stats: Array<{ key: Filter; label: string; value: number; hint: string }> = [
    { key: "all", label: t("stats.all"), value: summary.total, hint: t("connectedTables", { count: summary.connectedTables }) },
    { key: "crossDomain", label: t("stats.crossDomain"), value: summary.crossDomain, hint: t("hints.crossDomain") },
    { key: "crossCatalog", label: t("stats.crossCatalog"), value: summary.crossCatalog, hint: t("hints.crossCatalog") },
    { key: "crossSchema", label: t("stats.crossSchema"), value: summary.crossSchema, hint: t("hints.crossSchema") },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setFilter(s.key)}
            aria-pressed={filter === s.key}
            className={`min-h-11 rounded-lg border p-4 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              filter === s.key ? "border-primary bg-primary/5" : ""
            }`}
          >
            <div className="text-2xl font-bold tabular-nums">{l10n.integer(s.value)}</div>
            <div className="text-sm font-medium">{s.label}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{s.hint}</div>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {filter === "all" ? t("allRelationships") : stats.find((s) => s.key === filter)?.label}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {t("shown", { count: filtered.length, capped: data.truncated ? "yes" : "no" })}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.source")}</TableHead>
                  <TableHead className="w-8" />
                  <TableHead>{t("columns.target")}</TableHead>
                  <TableHead>{t("columns.via")}</TableHead>
                  <TableHead>{t("columns.boundaries")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, 200).map((e, i) => (
                  <TableRow key={`${e.source}->${e.target}-${i}`}>
                    <TableCell className="font-mono text-xs">
                      <div className="truncate max-w-[220px]" title={e.source}>
                        {shortName(e.source)}
                      </div>
                      {e.sourceDomain && (
                        <div className="text-[10px] text-muted-foreground">{e.sourceDomain}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <div className="truncate max-w-[220px]" title={e.target}>
                        {shortName(e.target)}
                      </div>
                      {e.targetDomain && (
                        <div className="text-[10px] text-muted-foreground">{e.targetDomain}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {t(`via.${e.via}` as "via.lineage")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {e.crossDomain && (
                          <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[10px]">
                            {t("boundary.domain")}
                          </Badge>
                        )}
                        {e.crossCatalog && (
                          <Badge className="bg-violet-500/15 text-violet-700 dark:text-violet-400 text-[10px]">
                            {t("boundary.catalog")}
                          </Badge>
                        )}
                        {e.crossSchema && !e.crossCatalog && (
                          <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-400 text-[10px]">
                            {t("boundary.schema")}
                          </Badge>
                        )}
                        {!e.crossSchema && !e.crossCatalog && !e.crossDomain && (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      {t("noMatches")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {filtered.length > 200 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("showingLimit", { shown: 200, total: filtered.length })}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
