"use client";

import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Database,
  GitBranch,
  ShieldCheck,
  Link2,
  History,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Column {
  name: string;
  type_name?: string;
  data_type?: string;
  comment?: string;
  nullable?: boolean;
  is_pii?: boolean;
}

interface LineageEdge {
  sourceTableFqn: string;
  targetTableFqn: string;
  sourceType?: string;
  targetType?: string;
  eventCount?: number;
}

interface HistoryData {
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
}

interface Insight {
  insightType: string;
  payloadJson: string;
  severity: string;
}

interface RelatedUseCase {
  id: string;
  name: string;
  domain: string;
  type: string;
  overallScore: number | null;
  runId: string;
}

interface TableDetailTabsProps {
  columns: Column[];
  history: HistoryData | null;
  lineage: { upstream: LineageEdge[]; downstream: LineageEdge[] };
  insights: Insight[];
  useCases: RelatedUseCase[];
  defaultTab?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TableDetailTabs({
  columns,
  history,
  lineage,
  insights,
  useCases,
  defaultTab = "schema",
}: TableDetailTabsProps) {
  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList className="w-full justify-start">
        <TabsTrigger value="schema" className="gap-1.5 text-xs">
          <Database className="size-3.5" />
          Schema ({columns.length})
        </TabsTrigger>
        <TabsTrigger value="lineage" className="gap-1.5 text-xs">
          <GitBranch className="size-3.5" />
          Lineage ({lineage.upstream.length + lineage.downstream.length})
        </TabsTrigger>
        <TabsTrigger value="quality" className="gap-1.5 text-xs">
          <ShieldCheck className="size-3.5" />
          Quality ({insights.length})
        </TabsTrigger>
        <TabsTrigger value="related" className="gap-1.5 text-xs">
          <Link2 className="size-3.5" />
          Related ({useCases.length})
        </TabsTrigger>
        <TabsTrigger value="history" className="gap-1.5 text-xs">
          <History className="size-3.5" />
          History
        </TabsTrigger>
      </TabsList>

      <TabsContent value="schema" className="mt-4">
        <SchemaTab columns={columns} />
      </TabsContent>

      <TabsContent value="lineage" className="mt-4">
        <LineageTab lineage={lineage} />
      </TabsContent>

      <TabsContent value="quality" className="mt-4">
        <QualityTab history={history} insights={insights} />
      </TabsContent>

      <TabsContent value="related" className="mt-4">
        <RelatedTab useCases={useCases} />
      </TabsContent>

      <TabsContent value="history" className="mt-4">
        <HistoryTab history={history} />
      </TabsContent>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Schema tab
// ---------------------------------------------------------------------------

function SchemaTab({ columns }: { columns: Column[] }) {
  if (columns.length === 0) {
    return <p className="text-sm text-muted-foreground">No column information available.</p>;
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Column</TableHead>
            <TableHead className="text-xs">Type</TableHead>
            <TableHead className="text-xs">Nullable</TableHead>
            <TableHead className="text-xs">Description</TableHead>
            <TableHead className="text-xs">Flags</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {columns.map((col) => (
            <TableRow key={col.name}>
              <TableCell className="font-mono text-xs">{col.name}</TableCell>
              <TableCell className="text-xs">{col.type_name || col.data_type || "—"}</TableCell>
              <TableCell className="text-xs">{col.nullable !== false ? "Yes" : "No"}</TableCell>
              <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                {col.comment || "—"}
              </TableCell>
              <TableCell>
                {col.is_pii && (
                  <Badge variant="destructive" className="text-[9px]">
                    PII
                  </Badge>
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
// Lineage tab
// ---------------------------------------------------------------------------

function LineageTab({
  lineage,
}: {
  lineage: { upstream: LineageEdge[]; downstream: LineageEdge[] };
}) {
  const total = lineage.upstream.length + lineage.downstream.length;
  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground">No lineage data discovered for this table.</p>
    );
  }

  return (
    <div className="space-y-4">
      {lineage.upstream.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium">Upstream ({lineage.upstream.length})</h4>
          <div className="space-y-1">
            {lineage.upstream.map((edge, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md border p-2 text-xs">
                <Badge variant="secondary" className="text-[9px]">
                  Source
                </Badge>
                <span className="font-mono">{edge.sourceTableFqn}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-mono text-muted-foreground">{edge.targetTableFqn}</span>
                {edge.eventCount && edge.eventCount > 1 && (
                  <Badge variant="outline" className="ml-auto text-[9px]">
                    {edge.eventCount} events
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {lineage.downstream.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium">Downstream ({lineage.downstream.length})</h4>
          <div className="space-y-1">
            {lineage.downstream.map((edge, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md border p-2 text-xs">
                <span className="font-mono text-muted-foreground">{edge.sourceTableFqn}</span>
                <span className="text-muted-foreground">→</span>
                <Badge variant="secondary" className="text-[9px]">
                  Target
                </Badge>
                <span className="font-mono">{edge.targetTableFqn}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quality tab
// ---------------------------------------------------------------------------

function QualityTab({ history, insights }: { history: HistoryData | null; insights: Insight[] }) {
  const healthScore = history?.healthScore;
  const issues: string[] = history?.issuesJson ? JSON.parse(history.issuesJson) : [];
  const recommendations: string[] = history?.recommendationsJson
    ? JSON.parse(history.recommendationsJson)
    : [];

  return (
    <div className="space-y-4">
      {healthScore != null && (
        <div className="flex items-center gap-3">
          <div
            className={`flex size-12 items-center justify-center rounded-full text-lg font-bold ${
              healthScore >= 80
                ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                : healthScore >= 60
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                  : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
            }`}
          >
            {Math.round(healthScore)}
          </div>
          <div>
            <p className="text-sm font-medium">Health Score</p>
            <p className="text-xs text-muted-foreground">
              {healthScore >= 80
                ? "Healthy"
                : healthScore >= 60
                  ? "Needs attention"
                  : "Critical issues"}
            </p>
          </div>
        </div>
      )}

      {issues.length > 0 && (
        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <AlertTriangle className="size-3.5 text-amber-500" />
            Issues ({issues.length})
          </h4>
          <ul className="space-y-1">
            {issues.map((issue, i) => (
              <li key={i} className="text-xs text-muted-foreground">
                • {issue}
              </li>
            ))}
          </ul>
        </div>
      )}

      {recommendations.length > 0 && (
        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <CheckCircle className="size-3.5 text-green-500" />
            Recommendations ({recommendations.length})
          </h4>
          <ul className="space-y-1">
            {recommendations.map((rec, i) => (
              <li key={i} className="text-xs text-muted-foreground">
                • {rec}
              </li>
            ))}
          </ul>
        </div>
      )}

      {insights.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium">Insights ({insights.length})</h4>
          <div className="space-y-2">
            {insights.map((insight) => {
              const payload = JSON.parse(insight.payloadJson);
              return (
                <div key={insight.insightType} className="rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={insight.severity === "high" ? "destructive" : "secondary"}
                      className="text-[9px]"
                    >
                      {insight.severity}
                    </Badge>
                    <span className="text-xs font-medium">{insight.insightType}</span>
                  </div>
                  {payload.description && (
                    <p className="mt-1 text-xs text-muted-foreground">{payload.description}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!healthScore && issues.length === 0 && insights.length === 0 && (
        <p className="text-sm text-muted-foreground">No quality data available for this table.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Related tab
// ---------------------------------------------------------------------------

function RelatedTab({ useCases }: { useCases: RelatedUseCase[] }) {
  if (useCases.length === 0) {
    return <p className="text-sm text-muted-foreground">No use cases reference this table.</p>;
  }

  return (
    <div className="space-y-2">
      {useCases.map((uc) => (
        <a
          key={uc.id}
          href={`/runs/${uc.runId}`}
          className="flex items-center gap-2 rounded-md border p-3 text-sm transition-colors hover:bg-muted/50"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{uc.name || "Unnamed use case"}</p>
            <p className="text-xs text-muted-foreground">
              {[uc.domain, uc.type].filter(Boolean).join(" · ")}
            </p>
          </div>
          {uc.overallScore != null && (
            <Badge variant="outline" className="text-xs">
              {(uc.overallScore * 100).toFixed(0)}%
            </Badge>
          )}
        </a>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History tab
// ---------------------------------------------------------------------------

function HistoryTab({ history }: { history: HistoryData | null }) {
  if (!history) {
    return (
      <p className="text-sm text-muted-foreground">No history data available for this table.</p>
    );
  }

  const stats = [
    { label: "Write Operations", value: history.totalWriteOps },
    { label: "Streaming Operations", value: history.totalStreamingOps },
    { label: "OPTIMIZE Operations", value: history.totalOptimizeOps },
    { label: "VACUUM Operations", value: history.totalVacuumOps },
    { label: "MERGE Operations", value: history.totalMergeOps },
    { label: "History Span (days)", value: history.historyDays },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-md border p-3">
            <p className="text-lg font-bold">{s.value.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {history.lastWriteTimestamp && (
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Last Write</span>
            <span>
              {history.lastWriteOperation} · {history.lastWriteTimestamp}
            </span>
          </div>
        )}
        {history.lastOptimizeTimestamp && (
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Last OPTIMIZE</span>
            <span>{history.lastOptimizeTimestamp}</span>
          </div>
        )}
        {history.lastVacuumTimestamp && (
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Last VACUUM</span>
            <span>{history.lastVacuumTimestamp}</span>
          </div>
        )}
        {history.hasStreamingWrites && (
          <Badge variant="secondary" className="text-xs">
            Streaming Writes Active
          </Badge>
        )}
      </div>
    </div>
  );
}
