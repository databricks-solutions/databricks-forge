"use client";

import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Scan,
  Database,
  FileBarChart,
  Layers,
  ChevronRight,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Zap,
} from "lucide-react";
import type { ConnectionSummary } from "@/lib/connections/types";
import type { FabricScanSummary, FabricScanProgress } from "@/lib/fabric/types";

const STATUS_CONFIG: Record<string, { color: string; icon: typeof CheckCircle2; label: string }> = {
  completed: { color: "text-green-600", icon: CheckCircle2, label: "Completed" },
  scanning: { color: "text-blue-600", icon: Loader2, label: "Scanning..." },
  pending: { color: "text-yellow-600", icon: Clock, label: "Pending" },
  failed: { color: "text-red-600", icon: AlertTriangle, label: "Failed" },
};

export default function FabricHubPage() {
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [scans, setScans] = useState<FabricScanSummary[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [activeScanProgress, setActiveScanProgress] = useState<FabricScanProgress | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [connRes, scanRes] = await Promise.all([
        fetch("/api/connections"),
        fetch("/api/fabric/scan"),
      ]);
      if (connRes.ok) {
        const conns: ConnectionSummary[] = await connRes.json();
        setConnections(conns.filter((c) => c.connectorType === "fabric"));
      }
      if (scanRes.ok) setScans(await scanRes.json());
    } catch {
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (
      !activeScanProgress ||
      activeScanProgress.status === "completed" ||
      activeScanProgress.status === "failed"
    )
      return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/fabric/scan/${activeScanProgress.scanId}?mode=progress`);
        if (res.ok) {
          const progress: FabricScanProgress = await res.json();
          setActiveScanProgress(progress);
          if (progress.status === "completed" || progress.status === "failed") {
            fetchData();
            if (progress.status === "completed") toast.success("Scan completed!");
            else toast.error(`Scan failed: ${progress.message}`);
          }
        }
      } catch {
        /* polling failure is non-fatal */
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [activeScanProgress, fetchData]);

  const handleScan = async (incremental?: boolean) => {
    if (!selectedConnectionId) {
      toast.error("Select a connection first");
      return;
    }
    setScanning(true);
    try {
      const res = await fetch("/api/fabric/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: selectedConnectionId, incremental }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to start scan");
      }
      const { scanId } = await res.json();
      setActiveScanProgress({
        scanId,
        status: "scanning",
        message: "Starting...",
        percent: 5,
        phase: "init",
      });
      toast.success(incremental ? "Incremental scan started" : "Full scan started");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start scan");
    } finally {
      setScanning(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-8">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      <PageHeader
        title="Fabric / Power BI"
        subtitle="Scan your Microsoft Fabric and Power BI estate, then migrate to Databricks-native artifacts."
      />

      {/* Scan trigger */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New Scan</CardTitle>
          <CardDescription>
            Select a connection and scan the Power BI tenant for workspaces, datasets, reports, and
            measures.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {connections.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No Fabric connections configured.{" "}
              <Link href="/connections" className="text-primary underline">
                Add one first
              </Link>
              .
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Select value={selectedConnectionId} onValueChange={setSelectedConnectionId}>
                <SelectTrigger className="w-72">
                  <SelectValue placeholder="Select connection" />
                </SelectTrigger>
                <SelectContent>
                  {connections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      <Badge variant="outline" className="ml-2 text-xs capitalize">
                        {c.accessLevel}
                      </Badge>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={() => handleScan(false)}
                disabled={!selectedConnectionId || scanning}
              >
                {scanning ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Scan className="h-4 w-4 mr-2" />
                )}
                Full Scan
              </Button>
              {(() => {
                const conn = connections.find((c) => c.id === selectedConnectionId);
                return conn?.accessLevel === "admin" && conn.lastScanCompletedAt ? (
                  <Button
                    variant="outline"
                    onClick={() => handleScan(true)}
                    disabled={!selectedConnectionId || scanning}
                  >
                    {scanning ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Zap className="h-4 w-4 mr-2" />
                    )}
                    Quick Scan (changes only)
                  </Button>
                ) : null;
              })()}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active scan progress */}
      {activeScanProgress && activeScanProgress.status === "scanning" && (
        <Card className="border-blue-200 dark:border-blue-800">
          <CardContent className="pt-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  {activeScanProgress.message}
                </span>
                <span className="text-muted-foreground">{activeScanProgress.percent}%</span>
              </div>
              <Progress value={activeScanProgress.percent} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Scan history */}
      {scans.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Scan History</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {scans.map((scan) => {
              const cfg = STATUS_CONFIG[scan.status] ?? STATUS_CONFIG.pending;
              const Icon = cfg.icon;
              return (
                <Link key={scan.id} href={`/fabric/${scan.id}`}>
                  <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Icon
                            className={`h-4 w-4 ${cfg.color} ${scan.status === "scanning" ? "animate-spin" : ""}`}
                          />
                          {cfg.label}
                          {scan.scanMode === "incremental" && (
                            <Badge variant="secondary" className="text-[10px]">
                              Incremental
                            </Badge>
                          )}
                        </CardTitle>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <CardDescription className="text-xs">
                        {new Date(scan.createdAt).toLocaleString()}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex items-center gap-1.5">
                          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{scan.workspaceCount} workspaces</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Database className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{scan.datasetCount} datasets</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <FileBarChart className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{scan.reportCount} reports</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground font-mono">Σ</span>
                          <span>{scan.measureCount} measures</span>
                        </div>
                      </div>
                      {scan.errorMessage && (
                        <p
                          className="text-xs text-destructive mt-2 truncate"
                          title={scan.errorMessage}
                        >
                          {scan.errorMessage}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
