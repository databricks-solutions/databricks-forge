"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatCard } from "@/components/environment/stat-card";
import { DataMaturityCard } from "@/components/environment/data-maturity-card";
import { ExecutiveSummary } from "@/components/environment/executive-summary";
import { ScanTrendsPanel } from "@/components/environment/scan-trends-panel";
import { computeDataMaturity } from "@/lib/domain/data-maturity";
import type {
  AggregateStats,
  CoverageEntry,
  InsightRow,
  TableDetailRow,
} from "@/app/environment/types";
import { ChevronDown, Clock, Database, BarChart3, ShieldAlert, Trash2 } from "lucide-react";

export interface AggregateSummaryProps {
  stats: AggregateStats;
  details: TableDetailRow[];
  insights: InsightRow[];
  humanSize: (bytes: string | number | null) => string;
  humanNumber: (value: string | number | null) => string;
  timeAgo: (iso: string) => string;
  onViewScan: (scanId: string) => void;
  onDeleteScan: (scanId: string) => void;
}

export function AggregateSummary({
  stats,
  details,
  insights,
  humanSize,
  humanNumber,
  timeAgo,
  onViewScan,
  onDeleteScan,
}: AggregateSummaryProps) {
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CoverageEntry | null>(null);

  // Prefer the server-computed maturity (real inputs from the full world
  // model). Fall back to a details/insights-only computation for older
  // payloads that predate the server-side field.
  const maturity =
    stats.maturity ??
    computeDataMaturity({
      tableCount: stats.totalTables,
      avgGovernanceScore: stats.avgGovernanceScore,
      piiTablesCount: stats.piiTablesCount,
      tablesWithDescription: details.filter((d) => d.comment || d.generatedDescription).length,
      tablesWithTags: 0,
      tablesWithOwner: details.filter((d) => d.owner).length,
      tablesWithTier: details.filter((d) => d.dataTier).length,
      tierCount: new Set(details.map((d) => d.dataTier).filter(Boolean)).size,
      redundancyPairsCount: insights.filter((i) => i.insightType === "redundancy").length,
      dataProductCount: insights.filter((i) => i.insightType === "data_product").length,
      lineageEdgeCount: 0,
      lineageDiscoveredCount: 0,
      domainCount: stats.domainCount,
      tablesNeedingOptimize: 0,
      tablesNeedingVacuum: 0,
      tablesWithStreaming: 0,
      tablesWithCDF: 0,
      avgHealthScore: 50,
      tablesWithAutoOptimize: 0,
      tablesWithLiquidClustering: 0,
    });

  return (
    <div className="space-y-4">
      {/* Data Maturity Score */}
      <DataMaturityCard maturity={maturity} />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard
          title="Tables"
          value={stats.totalTables}
          icon={<Database className="h-4 w-4" />}
          tooltip="Total number of tables and views discovered across all scans, including tables found by following data lineage beyond your selected scope."
        />
        <StatCard
          title="Total Size"
          value={humanSize(stats.totalSizeBytes)}
          icon={<BarChart3 className="h-4 w-4" />}
          tooltip="Combined on-disk storage of all tables in the estate. Views and tables where size could not be determined show as 0 bytes."
        />
        <StatCard
          title="Total Rows"
          value={humanNumber(stats.totalRows)}
          icon={<BarChart3 className="h-4 w-4" />}
          tooltip="Combined row count across all tables where statistics are available. Sourced from table properties (ANALYZE TABLE) or Delta operation metrics. Tables without computed stats show 0."
        />
        <StatCard
          title="Domains"
          value={stats.domainCount}
          icon={<Database className="h-4 w-4" />}
          tooltip="Number of distinct business domains identified by AI analysis, such as Finance, Customer, Operations, or Marketing. Helps organise your data by business function."
        />
        <StatCard
          title="Avg Governance"
          value={`${stats.avgGovernanceScore.toFixed(0)}/100`}
          icon={<ShieldAlert className="h-4 w-4" />}
          tooltip="Average governance score across all tables (0 to 100). Factors include documentation coverage, ownership, sensitivity tagging, maintenance frequency, and access controls. Higher is better."
        />
        <StatCard
          title="PII Tables"
          value={stats.piiTablesCount}
          icon={<ShieldAlert className="h-4 w-4" />}
          alert={stats.piiTablesCount > 0}
          tooltip="Tables containing personally identifiable information (names, emails, phone numbers, etc.) that may require compliance with regulations like GDPR, CCPA, or HIPAA."
        />
      </div>

      {/* Executive Summary */}
      <ExecutiveSummary stats={stats} details={details} insights={insights} humanSize={humanSize} />

      {stats.newestScanAt && (
        <p className="text-sm text-muted-foreground">
          Last updated {timeAgo(stats.newestScanAt)} &middot; {stats.totalScans} scan
          {stats.totalScans !== 1 ? "s" : ""} contributing
        </p>
      )}

      {/* Scan Trends */}
      {stats.totalScans >= 2 && <ScanTrendsPanel />}

      {/* Coverage panel */}
      <Collapsible open={coverageOpen} onOpenChange={setCoverageOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1">
            <ChevronDown
              className={`h-4 w-4 transition-transform ${coverageOpen ? "rotate-180" : ""}`}
            />
            Scan Coverage ({stats.coverageByScope.length})
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Card className="mt-2">
            <CardContent className="pt-4">
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Scope</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Tables</TableHead>
                      <TableHead>Scanned</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.coverageByScope.map((c) => (
                      <TableRow key={c.scanId}>
                        <TableCell className="font-mono text-xs">
                          <span className="block truncate max-w-[300px]" title={c.ucPath}>
                            {c.ucPath}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={c.runId ? "default" : "secondary"} className="text-xs">
                            {c.runId ? `Run ${c.runId.slice(0, 8)}` : "Standalone"}
                          </Badge>
                        </TableCell>
                        <TableCell>{c.tableCount}</TableCell>
                        <TableCell className="text-xs">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {timeAgo(c.scannedAt)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => onViewScan(c.scanId)}>
                              View
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteTarget(c)}
                              aria-label="Delete scan"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete scan?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete the scan for{" "}
              <span className="font-mono font-medium break-all">{deleteTarget?.ucPath}</span>? This
              permanently removes all table details, history, lineage, and insights for this scan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) onDeleteScan(deleteTarget.scanId);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
