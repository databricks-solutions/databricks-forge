"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  ArrowLeft,
  Database,
  FileBarChart,
  Layers,
  Table2,
  Columns3,
  Calculator,
  ArrowRight,
  ShieldAlert,
  GitFork,
  Package,
} from "lucide-react";
import type {
  FabricScanDetail,
  FabricDataset,
  FabricTable,
  FabricMeasure,
} from "@/lib/fabric/types";

interface PageProps {
  params: Promise<{ scanId: string }>;
}

export default function ScanDetailPage({ params }: PageProps) {
  const { scanId } = use(params);
  const [scan, setScan] = useState<FabricScanDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/fabric/scan/${scanId}`)
      .then(async (res) => {
        if (res.ok) setScan(await res.json());
        else toast.error("Failed to load scan");
      })
      .catch(() => toast.error("Failed to load scan"))
      .finally(() => setLoading(false));
  }, [scanId]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">Scan not found.</p>
        <Link href="/fabric">
          <Button variant="outline">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link href="/fabric">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold tracking-tight">Scan Detail</h1>
            <Badge
              variant={
                scan.status === "completed"
                  ? "default"
                  : scan.status === "failed"
                    ? "destructive"
                    : "secondary"
              }
            >
              {scan.status}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {new Date(scan.createdAt).toLocaleString()}
            {scan.accessLevel === "admin" ? " · Admin Scanner" : " · Per-Workspace"}
          </p>
        </div>
        {scan.status === "completed" && (
          <Link href={`/fabric/migrate?scanId=${scan.id}`}>
            <Button>
              <ArrowRight className="h-4 w-4 mr-2" />
              Start Migration
            </Button>
          </Link>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Layers} label="Workspaces" value={scan.workspaceCount} />
        <StatCard icon={Database} label="Datasets" value={scan.datasetCount} />
        <StatCard icon={FileBarChart} label="Reports" value={scan.reportCount} />
        <StatCard icon={Calculator} label="Measures" value={scan.measureCount} />
      </div>

      {scan.errorMessage && (
        <Card className="border-destructive">
          <CardContent className="pt-4">
            <p className="text-sm text-destructive">{scan.errorMessage}</p>
          </CardContent>
        </Card>
      )}

      {/* Workspaces tree */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workspaces</CardTitle>
          <CardDescription>
            Explore discovered workspaces, datasets, tables, measures, and reports.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {scan.workspaces.length === 0 ? (
            <p className="text-sm text-muted-foreground">No workspaces discovered.</p>
          ) : (
            <Accordion type="multiple" className="w-full">
              {scan.workspaces.map((ws) => {
                const wsDatasets = scan.datasets.filter((d) => d.workspaceId === ws.workspaceId);
                const wsReports = scan.reports.filter((r) => r.workspaceId === ws.workspaceId);
                const wsArtifacts = scan.artifacts.filter((a) => a.workspaceId === ws.workspaceId);
                return (
                  <AccordionItem key={ws.workspaceId} value={ws.workspaceId}>
                    <AccordionTrigger className="text-sm">
                      <div className="flex items-center gap-2">
                        <Layers className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{ws.name}</span>
                        <Badge variant="outline" className="text-xs ml-2">
                          {wsDatasets.length} datasets · {wsReports.length} reports
                        </Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-4 pl-6">
                        {/* Datasets */}
                        {wsDatasets.map((ds) => (
                          <DatasetTree key={ds.datasetId} dataset={ds} />
                        ))}
                        {/* Reports */}
                        {wsReports.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Reports
                            </h4>
                            {wsReports.map((r) => (
                              <div key={r.reportId} className="flex items-center gap-2 text-sm">
                                <FileBarChart className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>{r.name}</span>
                                {r.reportType && (
                                  <Badge variant="outline" className="text-xs">
                                    {r.reportType}
                                  </Badge>
                                )}
                                {r.sensitivityLabel && (
                                  <Badge variant="secondary" className="text-xs">
                                    <ShieldAlert className="h-3 w-3 mr-1" />
                                    {r.sensitivityLabel}
                                  </Badge>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Fabric artifacts */}
                        {wsArtifacts.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Fabric Artifacts
                            </h4>
                            {wsArtifacts.map((a) => (
                              <div key={a.artifactId} className="flex items-center gap-2 text-sm">
                                <Package className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>{a.name}</span>
                                <Badge variant="outline" className="text-xs">
                                  {a.artifactType}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Layers;
  label: string;
  value: number;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-3">
          <Icon className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DatasetTree({ dataset: ds }: { dataset: FabricDataset }) {
  return (
    <Accordion type="multiple" className="w-full">
      <AccordionItem value={ds.datasetId}>
        <AccordionTrigger className="text-sm">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-blue-500" />
            <span className="font-medium">{ds.name}</span>
            {ds.sensitivityLabel && (
              <Badge variant="secondary" className="text-xs">
                <ShieldAlert className="h-3 w-3 mr-1" />
                {ds.sensitivityLabel}
              </Badge>
            )}
            <Badge variant="outline" className="text-xs">
              {ds.tables.length} tables · {ds.measures.length} measures
            </Badge>
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-3 pl-6">
            {/* Tables */}
            {ds.tables.map((t: FabricTable) => (
              <div key={t.name} className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Table2 className="h-3.5 w-3.5 text-muted-foreground" />
                  {t.name}
                  {t.isHidden && (
                    <Badge variant="outline" className="text-xs">
                      hidden
                    </Badge>
                  )}
                </div>
                <div className="pl-5 space-y-0.5">
                  {t.columns.map((c) => (
                    <div
                      key={c.name}
                      className="flex items-center gap-2 text-xs text-muted-foreground"
                    >
                      <Columns3 className="h-3 w-3" />
                      <span>{c.name}</span>
                      <span className="text-muted-foreground/60">{c.dataType}</span>
                    </div>
                  ))}
                  {t.measures.map((m: FabricMeasure) => (
                    <div
                      key={m.name}
                      className="flex items-center gap-2 text-xs text-orange-600 dark:text-orange-400"
                    >
                      <Calculator className="h-3 w-3" />
                      <span>{m.name}</span>
                      <span className="text-muted-foreground/60 font-mono text-[10px] truncate max-w-[200px]">
                        {m.expression}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {/* Relationships */}
            {ds.relationships.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                  <GitFork className="h-3 w-3" /> Relationships
                </p>
                {ds.relationships.map((rel, i) => (
                  <p key={i} className="text-xs text-muted-foreground pl-4">
                    {rel.fromTable}.{rel.fromColumn} → {rel.toTable}.{rel.toColumn}
                  </p>
                ))}
              </div>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
