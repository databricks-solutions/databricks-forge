"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sparkles, LayoutDashboard, Search, ChevronRight, ExternalLink } from "lucide-react";

interface DiscoveredSpace {
  spaceId: string;
  title: string;
  description?: string | null;
  tables: string[];
  metricViews: string[];
  sampleQuestionCount: number;
  measureCount: number;
  filterCount: number;
}

interface DiscoveredDash {
  dashboardId: string;
  displayName: string;
  tables: string[];
  isPublished: boolean;
  datasetCount: number;
  widgetCount: number;
  parentPath?: string;
}

interface CoverageData {
  allTables: string[];
  uncoveredTables: string[];
  coveragePercent: number;
  genieSpaceCount: number;
  dashboardCount: number;
  metricViewCount: number;
}

interface DiscoveryData {
  genieSpaces: DiscoveredSpace[];
  dashboards: DiscoveredDash[];
  coverage: CoverageData | null;
  databricksHost: string | null;
}

function buildGenieUrl(host: string, spaceId: string): string {
  return `${host.replace(/\/$/, "")}/genie/rooms/${spaceId}`;
}

function buildDashboardUrl(host: string, dashboardId: string): string {
  return `${host.replace(/\/$/, "")}/sql/dashboardsv3/${dashboardId}`;
}

export function ExistingAssetsTab({ runId }: { runId: string }) {
  const [data, setData] = useState<DiscoveryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/runs/${runId}/discovery`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [runId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!data || (data.genieSpaces.length === 0 && data.dashboards.length === 0 && !data.coverage)) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <Search className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          No existing assets discovered for this run. Enable Asset Discovery in settings to scan for
          existing Genie spaces, dashboards, and metric views.
        </p>
      </div>
    );
  }

  const { coverage, databricksHost } = data;

  return (
    <div className="space-y-6">
      {coverage && (
        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard
            label="Table Coverage"
            value={`${coverage.coveragePercent}%`}
            sub={`${coverage.allTables.length - coverage.uncoveredTables.length} of ${coverage.allTables.length} tables`}
          />
          <StatCard label="Genie Spaces" value={String(coverage.genieSpaceCount)} />
          <StatCard label="Dashboards" value={String(coverage.dashboardCount)} />
          <StatCard label="Metric Views" value={String(coverage.metricViewCount)} />
        </div>
      )}

      {coverage && coverage.uncoveredTables.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Uncovered Tables</CardTitle>
            <CardDescription>
              Tables not referenced by any existing Genie space, dashboard, or metric view
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {coverage.uncoveredTables.slice(0, 30).map((t) => (
                <Badge key={t} variant="outline" className="text-[10px] font-mono">
                  {t}
                </Badge>
              ))}
              {coverage.uncoveredTables.length > 30 && (
                <Badge variant="secondary" className="text-[10px]">
                  +{coverage.uncoveredTables.length - 30} more
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {data.genieSpaces.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4" />
              Existing Genie Spaces ({data.genieSpaces.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.genieSpaces.map((s) => (
                <SpaceRow key={s.spaceId} space={s} host={databricksHost} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {data.dashboards.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <LayoutDashboard className="h-4 w-4" />
              Existing Dashboards ({data.dashboards.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.dashboards.map((d) => (
                <DashboardRow key={d.dashboardId} dashboard={d} host={databricksHost} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SpaceRow({ space, host }: { space: DiscoveredSpace; host: string | null }) {
  const [open, setOpen] = useState(false);
  const url = host ? buildGenieUrl(host, space.spaceId) : null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border">
        <CollapsibleTrigger asChild>
          <button className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-muted/50 transition-colors">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <ChevronRight
                  className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
                />
                <p className="text-sm font-medium truncate" title={space.title}>
                  {space.title}
                </p>
              </div>
              <div className="ml-5.5 mt-1 flex flex-wrap gap-1.5">
                <Badge variant="secondary" className="text-[10px]">
                  {space.tables.length} tables
                </Badge>
                {space.measureCount > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    {space.measureCount} measures
                  </Badge>
                )}
                {space.filterCount > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    {space.filterCount} filters
                  </Badge>
                )}
                {space.sampleQuestionCount > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    {space.sampleQuestionCount} questions
                  </Badge>
                )}
                {space.metricViews.length > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    {space.metricViews.length} metric views
                  </Badge>
                )}
              </div>
            </div>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="ml-2 inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-violet-600 transition-colors hover:bg-violet-500/10"
                title="Open in Databricks"
              >
                Open
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t px-3 py-3 space-y-3">
            {space.description && (
              <p className="text-xs text-muted-foreground">{space.description}</p>
            )}
            {space.tables.length > 0 && (
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Tables
                </p>
                <div className="flex flex-wrap gap-1">
                  {space.tables.map((t) => (
                    <Badge key={t} variant="outline" className="text-[10px] font-mono">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {space.metricViews.length > 0 && (
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Metric Views
                </p>
                <div className="flex flex-wrap gap-1">
                  {space.metricViews.map((m) => (
                    <Badge key={m} variant="outline" className="text-[10px] font-mono">
                      {m}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function DashboardRow({ dashboard, host }: { dashboard: DiscoveredDash; host: string | null }) {
  const [open, setOpen] = useState(false);
  const url = host ? buildDashboardUrl(host, dashboard.dashboardId) : null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border">
        <CollapsibleTrigger asChild>
          <button className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-muted/50 transition-colors">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <ChevronRight
                  className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
                />
                <p className="text-sm font-medium truncate" title={dashboard.displayName}>
                  {dashboard.displayName}
                </p>
                {dashboard.isPublished && (
                  <Badge className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
                    Published
                  </Badge>
                )}
              </div>
              <div className="ml-5.5 mt-1 flex flex-wrap gap-1.5">
                <Badge variant="secondary" className="text-[10px]">
                  {dashboard.datasetCount} datasets
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  {dashboard.widgetCount} widgets
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  {dashboard.tables.length} tables
                </Badge>
              </div>
            </div>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="ml-2 inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-violet-600 transition-colors hover:bg-violet-500/10"
                title="Open in Databricks"
              >
                Open
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t px-3 py-3 space-y-3">
            {dashboard.parentPath && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Path:</span> {dashboard.parentPath}
              </p>
            )}
            {dashboard.tables.length > 0 && (
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Tables
                </p>
                <div className="flex flex-wrap gap-1">
                  {dashboard.tables.map((t) => (
                    <Badge key={t} variant="outline" className="text-[10px] font-mono">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
