"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TableDetailTabs } from "@/components/environment/table-detail-tabs";
import { ArrowLeft, Table2, Clock, HardDrive, Rows3, FileStack, AlertCircle } from "lucide-react";
import Link from "next/link";

interface TableDetailData {
  detail: {
    tableFqn: string;
    catalog: string;
    schema: string;
    tableName: string;
    tableType?: string;
    comment?: string;
    generatedDescription?: string;
    format?: string;
    owner?: string;
    sizeInBytes?: string;
    numRows?: string;
    numFiles?: number;
    lastModified?: string;
    dataDomain?: string;
    dataSubdomain?: string;
    dataTier?: string;
    sensitivityLevel?: string;
    governanceScore?: number;
    autoOptimize?: boolean;
    cdfEnabled?: boolean;
  };
  columns: Array<{
    name: string;
    type_name?: string;
    data_type?: string;
    comment?: string;
    nullable?: boolean;
    is_pii?: boolean;
  }>;
  history: {
    totalWriteOps: number;
    totalStreamingOps: number;
    totalOptimizeOps: number;
    totalVacuumOps: number;
    totalMergeOps: number;
    lastWriteTimestamp?: string;
    lastWriteOperation?: string;
    lastOptimizeTimestamp?: string;
    lastVacuumTimestamp?: string;
    hasStreamingWrites: boolean;
    historyDays: number;
    healthScore?: number;
    issuesJson?: string;
    recommendationsJson?: string;
  } | null;
  lineage: {
    upstream: Array<{ sourceTableFqn: string; targetTableFqn: string; eventCount?: number }>;
    downstream: Array<{ sourceTableFqn: string; targetTableFqn: string; eventCount?: number }>;
  };
  insights: Array<{ insightType: string; payloadJson: string; severity: string }>;
  useCases: Array<{
    id: string;
    name: string;
    domain: string;
    type: string;
    overallScore: number | null;
    runId: string;
  }>;
}

function freshnessIndicator(lastModified?: string): { color: string; label: string } {
  if (!lastModified) return { color: "text-muted-foreground", label: "Unknown" };
  const days = Math.floor((Date.now() - new Date(lastModified).getTime()) / 86400000);
  if (days < 7) return { color: "text-green-600", label: `${days}d ago` };
  if (days < 30) return { color: "text-amber-600", label: `${days}d ago` };
  return { color: "text-red-600", label: `${days}d ago` };
}

function formatBytes(bytes?: string): string {
  if (!bytes) return "—";
  const n = Number(bytes);
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default function TableDetailPage() {
  const params = useParams();
  const fqn = decodeURIComponent(params?.fqn as string);
  const [data, setData] = React.useState<TableDetailData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<string>("schema");

  React.useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const tabParam = searchParams.get("tab");
    if (tabParam) setTab(tabParam);
  }, []);

  React.useEffect(() => {
    async function load() {
      try {
        const resp = await fetch(`/api/environment/table/${encodeURIComponent(fqn)}`);
        if (!resp.ok) {
          setError(resp.status === 404 ? "Table not found" : "Failed to load");
          return;
        }
        const json = await resp.json();
        setData(json);
      } catch {
        setError("Failed to load table detail");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [fqn]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16">
        <AlertCircle className="size-12 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">{error || "Table not found"}</p>
        <Button variant="outline" size="sm" asChild>
          <Link href="/environment">Back to Environment</Link>
        </Button>
      </div>
    );
  }

  const { detail } = data;
  const freshness = freshnessIndicator(detail.lastModified ?? undefined);

  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" asChild>
          <Link href="/environment">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Table2 className="size-5 text-blue-500" />
            <h1 className="truncate text-lg font-semibold">{detail.tableFqn}</h1>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {detail.dataDomain && (
              <Badge variant="secondary" className="text-xs">
                {detail.dataDomain}
              </Badge>
            )}
            {detail.dataTier && (
              <Badge variant="outline" className="text-xs">
                {detail.dataTier}
              </Badge>
            )}
            {detail.sensitivityLevel && detail.sensitivityLevel !== "none" && (
              <Badge variant="destructive" className="text-xs">
                {detail.sensitivityLevel}
              </Badge>
            )}
            {detail.format && (
              <Badge variant="outline" className="text-xs">
                {detail.format}
              </Badge>
            )}
            {detail.tableType && (
              <Badge variant="outline" className="text-xs">
                {detail.tableType}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {(detail.comment || detail.generatedDescription) && (
        <p className="text-sm text-muted-foreground">
          {detail.comment || detail.generatedDescription}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-md border p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className={`size-3.5 ${freshness.color}`} />
            Freshness
          </div>
          <p className={`mt-1 text-sm font-medium ${freshness.color}`}>{freshness.label}</p>
        </div>
        <div className="rounded-md border p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Rows3 className="size-3.5" />
            Rows
          </div>
          <p className="mt-1 text-sm font-medium">
            {detail.numRows ? Number(detail.numRows).toLocaleString() : "—"}
          </p>
        </div>
        <div className="rounded-md border p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <HardDrive className="size-3.5" />
            Size
          </div>
          <p className="mt-1 text-sm font-medium">{formatBytes(detail.sizeInBytes ?? undefined)}</p>
        </div>
        <div className="rounded-md border p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileStack className="size-3.5" />
            Files
          </div>
          <p className="mt-1 text-sm font-medium">
            {detail.numFiles != null ? detail.numFiles.toLocaleString() : "—"}
          </p>
        </div>
      </div>

      {detail.owner && <p className="text-xs text-muted-foreground">Owner: {detail.owner}</p>}

      <TableDetailTabs
        columns={data.columns}
        history={data.history}
        lineage={data.lineage}
        insights={data.insights}
        useCases={data.useCases}
        defaultTab={tab}
      />
    </div>
  );
}
