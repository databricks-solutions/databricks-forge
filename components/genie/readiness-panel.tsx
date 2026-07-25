"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, XCircle, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { parseErrorResponse, safeJsonParse } from "@/lib/error-utils";

export type ReadinessVerdict = "answerable" | "partial" | "not_answerable";

export interface ReadinessQuestionResult {
  id?: string;
  question: string;
  verdict: ReadinessVerdict;
  rationale: string;
  requiredTables?: string[];
}

export interface ReadinessReport {
  scope: string;
  results: ReadinessQuestionResult[];
  summary: {
    answerable: number;
    partial: number;
    notAnswerable: number;
  };
  ready: boolean;
}

interface ReadinessPanelProps {
  catalog: string;
  schema?: string;
  tables: Array<{
    fqn: string;
    description?: string | null;
    columnNames?: string[];
    columnDescriptions?: Record<string, string>;
  }>;
  questions: string[];
  /**
   * Optional title override. Defaults to "Readiness Check".
   */
  title?: string;
  /**
   * Called once a report has been computed. Lets the parent gate the
   * "Generate" CTA on the readiness verdict if it wants to.
   */
  onReport?: (report: ReadinessReport) => void;
  /**
   * If true, automatically run on mount. When false, the panel renders
   * a "Run Readiness Check" button (default).
   */
  autoRun?: boolean;
}

/**
 * Pre-flight readiness panel. Calls `/api/genie-spaces/readiness` and
 * shows a per-question verdict with rationale.
 */
export function ReadinessPanel(props: ReadinessPanelProps) {
  const { catalog, schema, tables, questions, title = "Readiness Check", onReport } = props;
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ReadinessReport | null>(null);

  const run = useCallback(async () => {
    if (questions.length === 0) {
      toast.error("Add at least one example question to run a readiness check.");
      return;
    }
    if (tables.length === 0) {
      toast.error("Select at least one table to run a readiness check.");
      return;
    }
    setRunning(true);
    try {
      const res = await fetch("/api/genie-spaces/readiness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catalog,
          schema,
          tables,
          questions: questions.map((q, i) => ({ id: `q-${i}`, question: q })),
        }),
      });
      if (!res.ok) {
        throw new Error(await parseErrorResponse(res, "Readiness check failed"));
      }
      const r = await safeJsonParse<ReadinessReport>(res);
      if (!r) throw new Error("Empty response");
      setReport(r);
      onReport?.(r);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Readiness check failed");
    } finally {
      setRunning(false);
    }
  }, [catalog, schema, tables, questions, onReport]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4" />
              {title}
            </CardTitle>
            <CardDescription>
              Pre-flight check that estimates whether the proposed tables can answer your example
              questions before kicking off a generation run.
            </CardDescription>
          </div>
          <Button onClick={run} disabled={running} variant="outline" size="sm">
            {running ? (
              <>
                <Loader2 className="mr-2 size-3.5 animate-spin" />
                Checking...
              </>
            ) : (
              "Run Check"
            )}
          </Button>
        </div>
      </CardHeader>
      {report && (
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <SummaryBadge verdict="answerable" count={report.summary.answerable} />
            <SummaryBadge verdict="partial" count={report.summary.partial} />
            <SummaryBadge verdict="not_answerable" count={report.summary.notAnswerable} />
            <span className={`ml-auto font-medium ${report.ready ? "text-emerald-600" : "text-amber-600"}`}>
              {report.ready ? "Ready to generate" : "Some gaps detected"}
            </span>
          </div>
          <ul className="space-y-2">
            {report.results.map((r, i) => (
              <li key={r.id ?? i} className="rounded-md border bg-card/50 p-2.5 text-xs">
                <div className="flex items-start gap-2">
                  <VerdictIcon verdict={r.verdict} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium leading-snug">{r.question}</p>
                    <p className="mt-1 text-muted-foreground">{r.rationale}</p>
                    {r.requiredTables && r.requiredTables.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {r.requiredTables.map((t) => (
                          <Badge key={t} variant="outline" className="font-mono text-[10px]">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

function VerdictIcon({ verdict }: { verdict: ReadinessVerdict }) {
  if (verdict === "answerable") return <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />;
  if (verdict === "partial") return <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />;
  return <XCircle className="mt-0.5 size-3.5 shrink-0 text-red-500" />;
}

function SummaryBadge({ verdict, count }: { verdict: ReadinessVerdict; count: number }) {
  const label =
    verdict === "answerable" ? "Answerable" : verdict === "partial" ? "Partial" : "Not answerable";
  const color =
    verdict === "answerable"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : verdict === "partial"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "bg-red-500/10 text-red-700 dark:text-red-400";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 ${color}`}>
      <span className="font-semibold">{count}</span>
      <span>{label}</span>
    </span>
  );
}
