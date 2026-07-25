"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Network, Search } from "lucide-react";

export function EnvironmentScanCard({ runId }: { runId: string }) {
  const [scan, setScan] = useState<{
    tableCount: number;
    domainCount: number;
    piiTablesCount: number;
    avgGovernanceScore: number;
    lineageDiscoveredCount: number;
    scanDurationMs: number | null;
    genieSpaceCount?: number;
    dashboardCount?: number;
    metricViewCount?: number;
    analyticsCoveragePercent?: number;
  } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch("/api/environment-scan");
        if (!resp.ok) return;
        const data = await resp.json();
        const linked = data.scans?.find((s: { runId?: string }) => s.runId === runId);
        if (linked) setScan(linked);
      } catch {
        // Non-critical
      }
    })();
  }, [runId]);

  if (!scan) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Network className="h-4 w-4" />
          Environment Intelligence
        </CardTitle>
        <CardDescription>Metadata enrichment scan linked to this run</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-5">
          <div>
            <p className="text-xs text-muted-foreground">Tables Scanned</p>
            <p className="text-lg font-bold">{scan.tableCount}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Domains Found</p>
            <p className="text-lg font-bold">{scan.domainCount}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Via Lineage</p>
            <p className="text-lg font-bold">{scan.lineageDiscoveredCount}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">PII Tables</p>
            <p className="text-lg font-bold">{scan.piiTablesCount}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Avg Governance</p>
            <p className="text-lg font-bold">
              {scan.avgGovernanceScore?.toFixed(0) ?? "\u2014"}/100
            </p>
          </div>
        </div>
        {(scan.genieSpaceCount ?? 0) + (scan.dashboardCount ?? 0) + (scan.metricViewCount ?? 0) >
          0 && (
          <>
            <div className="mt-4 mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Search className="h-3.5 w-3.5" />
              Asset Discovery
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Genie Spaces</p>
                <p className="text-lg font-bold">{scan.genieSpaceCount ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Dashboards</p>
                <p className="text-lg font-bold">{scan.dashboardCount ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Metric Views</p>
                <p className="text-lg font-bold">{scan.metricViewCount ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Table Coverage</p>
                <p className="text-lg font-bold">
                  {scan.analyticsCoveragePercent?.toFixed(0) ?? 0}%
                </p>
              </div>
            </div>
          </>
        )}
        {scan.scanDurationMs && (
          <p className="mt-2 text-xs text-muted-foreground">
            Scan completed in {(scan.scanDurationMs / 1000).toFixed(1)}s
          </p>
        )}
      </CardContent>
    </Card>
  );
}
