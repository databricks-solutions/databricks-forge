"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, ChevronDown, ChevronUp, CheckCircle2, AlertCircle } from "lucide-react";

interface EmbeddingStats {
  enabled: boolean;
  tableExists: boolean;
  totalRecords: number;
  byScope?: Record<string, number>;
  byKind?: Record<string, number>;
}

export function EmbeddingStatus() {
  const [stats, setStats] = React.useState<EmbeddingStats | null>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  const fetchStats = React.useCallback(async () => {
    try {
      const [statusResp, statsResp] = await Promise.all([
        fetch("/api/embeddings/status"),
        fetch("/api/search/stats").catch(() => null),
      ]);
      const statusData = await statusResp.json();
      const statsData = statsResp?.ok ? await statsResp.json() : null;

      setStats({
        enabled: statusData.enabled ?? false,
        tableExists: statusData.tableExists ?? false,
        totalRecords: statusData.totalRecords ?? 0,
        byScope: statusData.byScope ?? {},
        byKind: statsData?.byKind ?? statusData.byKind ?? {},
      });
    } catch {
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading) return null;

  if (!stats?.enabled) {
    return (
      <div className="flex items-center gap-2 border-b bg-amber-50/80 px-4 py-1.5 dark:bg-amber-950/30">
        <AlertCircle className="size-3.5 text-amber-600 dark:text-amber-400" />
        <span className="text-xs text-amber-700 dark:text-amber-300">
          Embedding endpoint not configured — enable semantic search for best results.
        </span>
      </div>
    );
  }

  return (
    <div className="border-b">
      <div className="flex items-center justify-between px-4 py-1.5">
        <div className="flex items-center gap-2">
          {stats.totalRecords > 0 ? (
            <>
              <CheckCircle2 className="size-3.5 text-green-500" />
              <span className="text-xs text-muted-foreground">
                Grounded in{" "}
                <span className="font-medium text-foreground/80">
                  {stats.totalRecords.toLocaleString()}
                </span>{" "}
                knowledge sources
              </span>
            </>
          ) : (
            <>
              <AlertCircle className="size-3.5 text-amber-500" />
              <span className="text-xs text-muted-foreground">
                No knowledge sources indexed yet
              </span>
            </>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="ml-1 text-muted-foreground/60 transition-colors hover:text-foreground"
          >
            {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 text-[10px] text-muted-foreground"
          onClick={() => fetchStats()}
        >
          <RefreshCw className="size-3" />
          Refresh
        </Button>
      </div>

      {expanded && stats && (
        <div className="border-t px-4 py-3">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {stats.byScope &&
              Object.entries(stats.byScope).map(([scope, count]) => (
                <ScopeStat key={scope} scope={scope} count={count as number} />
              ))}
          </div>

          {stats.byKind && Object.keys(stats.byKind).length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-[10px] font-medium text-muted-foreground">By Kind</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(stats.byKind).map(([kind, count]) => (
                  <Badge key={kind} variant="outline" className="gap-1 text-[10px]">
                    {kind.replace(/_/g, " ")}
                    <span className="font-semibold">{(count as number).toLocaleString()}</span>
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

function ScopeStat({ scope, count }: { scope: string; count: number }) {
  const labels: Record<string, string> = {
    estate: "Estate",
    pipeline: "Pipeline",
    genie: "Genie",
    documents: "Documents",
    usecases: "Use Cases",
    insights: "Insights",
  };

  return (
    <div className="text-xs">
      <p className="text-muted-foreground">{labels[scope] ?? scope}</p>
      <p className="text-lg font-semibold">{count.toLocaleString()}</p>
    </div>
  );
}
