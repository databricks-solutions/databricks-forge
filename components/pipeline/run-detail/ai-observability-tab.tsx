"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { StepDurationChart } from "@/components/charts/lazy";
import {
  Activity,
  Clock,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Loader2,
} from "lucide-react";
import type { StepLogEntry } from "@/lib/domain/types";

export interface PromptLogEntry {
  logId: string;
  runId: string;
  step: string;
  promptKey: string;
  promptVersion: string;
  model: string;
  temperature: number;
  renderedPrompt: string;
  rawResponse: string | null;
  honestyScore: number | null;
  durationMs: number | null;
  success: boolean;
  errorMessage: string | null;
}

export interface PromptLogStats {
  totalCalls: number;
  successCount: number;
  failureCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
}

export function AIObservabilityTab({
  logs,
  stats,
  loading,
  stepLog,
  promptVersionsNode,
  onRerun,
  isRerunning,
}: {
  logs: PromptLogEntry[];
  stats: PromptLogStats | null;
  loading: boolean;
  stepLog: StepLogEntry[];
  promptVersionsNode?: React.ReactNode;
  onRerun?: () => void;
  isRerunning?: boolean;
}) {
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (logs.length === 0 && !promptVersionsNode) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <p className="text-muted-foreground">
            No prompt logs available for this run. Logs are captured automatically for runs executed
            after the audit logging feature was enabled.
          </p>
        </CardContent>
      </Card>
    );
  }

  const stepGroups: Record<string, PromptLogEntry[]> = {};
  for (const log of logs) {
    if (!stepGroups[log.step]) stepGroups[log.step] = [];
    stepGroups[log.step].push(log);
  }

  return (
    <>
      {promptVersionsNode}

      {stats && (
        <div className="grid gap-4 md:grid-cols-5">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-blue-500" />
                <p className="text-xs text-muted-foreground">Total LLM Calls</p>
              </div>
              <p className="mt-1 text-2xl font-bold">{stats.totalCalls}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <p className="text-xs text-muted-foreground">Success Rate</p>
              </div>
              <p className="mt-1 text-2xl font-bold">
                {stats.totalCalls > 0
                  ? `${Math.round((stats.successCount / stats.totalCalls) * 100)}%`
                  : "N/A"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 text-red-500" />
                <p className="text-xs text-muted-foreground">Failures</p>
              </div>
              <p className="mt-1 text-2xl font-bold">{stats.failureCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-500" />
                <p className="text-xs text-muted-foreground">Avg Duration</p>
              </div>
              <p className="mt-1 text-2xl font-bold">
                {stats.avgDurationMs > 0 ? `${(stats.avgDurationMs / 1000).toFixed(1)}s` : "N/A"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-violet-500" />
                <p className="text-xs text-muted-foreground">Total Duration</p>
              </div>
              <p className="mt-1 text-2xl font-bold">
                {stats.totalDurationMs > 0 ? `${Math.round(stats.totalDurationMs / 1000)}s` : "N/A"}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {stepLog.length > 0 && <StepDurationChart steps={stepLog} />}

      {logs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              LLM Call Log ({logs.length} calls)
            </CardTitle>
            <CardDescription>
              Every AI query call with prompt, response, timing, and honesty scores
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(stepGroups).map(([step, stepLogs]) => (
                <div key={step}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {step} ({stepLogs.length} calls)
                  </p>
                  <div className="space-y-1">
                    {stepLogs.map((log) => (
                      <div key={log.logId} className="rounded-md border">
                        <button
                          className="flex w-full items-center justify-between p-3 text-left transition-colors hover:bg-muted/50"
                          onClick={() =>
                            setExpandedLog(expandedLog === log.logId ? null : log.logId)
                          }
                        >
                          <div className="flex items-center gap-3">
                            {log.success ? (
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                            ) : (
                              <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                            )}
                            <div>
                              <p className="text-sm font-medium">{log.promptKey}</p>
                              <p className="text-xs text-muted-foreground">
                                {log.model} &middot; temp {log.temperature}
                                {log.durationMs != null &&
                                  ` \u2022 ${(log.durationMs / 1000).toFixed(1)}s`}
                                {log.honestyScore != null &&
                                  ` \u2022 honesty: ${Math.round(log.honestyScore * 100)}%`}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {log.honestyScore != null && (
                              <Badge
                                variant="outline"
                                className={
                                  log.honestyScore >= 0.7
                                    ? "border-green-200 text-green-700"
                                    : log.honestyScore >= 0.3
                                      ? "border-amber-200 text-amber-700"
                                      : "border-red-200 text-red-700"
                                }
                              >
                                {Math.round(log.honestyScore * 100)}%
                              </Badge>
                            )}
                            {expandedLog === log.logId ? (
                              <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                        </button>
                        {expandedLog === log.logId && (
                          <div className="border-t p-3 text-xs">
                            <div className="space-y-3">
                              <div>
                                <p className="mb-1 font-semibold text-muted-foreground">
                                  Rendered Prompt
                                </p>
                                <pre className="max-h-48 overflow-auto rounded-md bg-muted/50 p-2 font-mono leading-relaxed">
                                  {log.renderedPrompt.length > 2000
                                    ? log.renderedPrompt.slice(0, 2000) + "\n... (truncated)"
                                    : log.renderedPrompt}
                                </pre>
                              </div>
                              {log.rawResponse && (
                                <div>
                                  <p className="mb-1 font-semibold text-muted-foreground">
                                    Raw Response
                                  </p>
                                  <pre className="max-h-48 overflow-auto rounded-md bg-muted/50 p-2 font-mono leading-relaxed">
                                    {log.rawResponse.length > 2000
                                      ? log.rawResponse.slice(0, 2000) + "\n... (truncated)"
                                      : log.rawResponse}
                                  </pre>
                                </div>
                              )}
                              {log.errorMessage && (
                                <div>
                                  <p className="mb-1 font-semibold text-destructive">Error</p>
                                  <p className="text-destructive">{log.errorMessage}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <Separator className="my-3" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {onRerun && (
        <Card>
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-sm font-medium">Rerun Pipeline</p>
              <p className="text-xs text-muted-foreground">
                Create a new run with the exact same configuration and start it immediately
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={isRerunning}>
                  {isRerunning ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {isRerunning ? "Starting..." : "Rerun Pipeline"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Rerun this pipeline?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will create a new pipeline run using the same configuration and start it
                    immediately. The run will consume LLM and SQL Warehouse resources.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onRerun}>Rerun</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
    </>
  );
}
