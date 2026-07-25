"use client";

import { Fragment, useState, useMemo, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import { ChevronDown, ChevronRight, Layers, Clock } from "lucide-react";
import { VoteButton } from "@/components/business-value/vote-button";
import type { PortfolioUseCase } from "@/lib/lakebase/portfolio";

type GroupMode = "domain" | "phase";

const PHASE_LABELS: Record<string, { label: string; time: string }> = {
  quick_wins: { label: "Quick Wins", time: "0–3 months" },
  foundation: { label: "Foundation", time: "3–9 months" },
  transformation: { label: "Transformation", time: "9–18 months" },
};

const EFFORT_LABELS: Record<string, string> = {
  xs: "XS",
  s: "Small",
  m: "Medium",
  l: "Large",
  xl: "XL",
};

function hasRationale(uc: PortfolioUseCase): boolean {
  return (
    Boolean(uc.rationale) ||
    uc.assumptions.length > 0 ||
    Boolean(uc.industryBenchmark) ||
    Boolean(uc.economicFormulaVars) ||
    Boolean(uc.phaseRationale) ||
    uc.enablers.length > 0 ||
    uc.dependencies.length > 0
  );
}

const VALUE_TYPE_LABELS: Record<string, string> = {
  cost_savings: "Cost savings",
  revenue_uplift: "Revenue uplift",
  risk_reduction: "Risk reduction",
  efficiency_gain: "Efficiency gain",
};

const CONFIDENCE_BADGE: Record<string, string> = {
  low: "border-red-500/30 text-red-700 dark:text-red-400",
  medium: "border-amber-500/30 text-amber-700 dark:text-amber-400",
  high: "border-emerald-500/30 text-emerald-700 dark:text-emerald-400",
};

export function PortfolioDrillDown({
  useCases,
  runId,
}: {
  useCases: PortfolioUseCase[];
  runId?: string;
}) {
  const [mode, setMode] = useState<GroupMode>("domain");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedUseCase, setExpandedUseCase] = useState<string | null>(null);
  const [votes, setVotes] = useState<Record<string, { total: number; voters: string[] }>>({});

  const useCaseNameById = useMemo(
    () => new Map(useCases.map((uc) => [uc.id, uc.name])),
    [useCases],
  );

  useEffect(() => {
    if (!runId) return;
    fetch(`/api/business-value/vote?runId=${runId}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then(setVotes)
      .catch(() => {});
  }, [runId]);

  const groups = useMemo(() => {
    const map = new Map<string, PortfolioUseCase[]>();
    for (const uc of useCases) {
      const key = mode === "domain" ? uc.domain : (uc.phase ?? "unassigned");
      const arr = map.get(key) ?? [];
      arr.push(uc);
      map.set(key, arr);
    }
    return Array.from(map.entries())
      .map(([key, ucs]) => ({
        key,
        label: mode === "phase" ? (PHASE_LABELS[key]?.label ?? "Unassigned") : key,
        subtitle: mode === "phase" ? (PHASE_LABELS[key]?.time ?? "") : "",
        useCases: ucs.sort((a, b) => b.overallScore - a.overallScore),
        totalValue: ucs.reduce((s, u) => s + u.valueMid, 0),
        count: ucs.length,
      }))
      .sort((a, b) => b.totalValue - a.totalValue || b.count - a.count);
  }, [useCases, mode]);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          {mode === "domain" ? (
            <Layers className="h-4 w-4 text-primary" />
          ) : (
            <Clock className="h-4 w-4 text-primary" />
          )}
          Use Case Explorer
        </h2>
        <div className="flex gap-1 rounded-lg border p-0.5">
          <Button
            variant={mode === "domain" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              setMode("domain");
              setExpanded(null);
            }}
          >
            By Domain
          </Button>
          <Button
            variant={mode === "phase" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              setMode("phase");
              setExpanded(null);
            }}
          >
            By Phase
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {groups.map((g) => {
          const isOpen = expanded === g.key;
          return (
            <Card key={g.key} className="overflow-hidden">
              <button
                type="button"
                className={`flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-muted/30 ${isOpen ? "bg-muted/20" : ""}`}
                onClick={() => setExpanded(isOpen ? null : g.key)}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`h-2 w-2 rounded-full transition-colors ${isOpen ? "bg-primary" : "bg-muted-foreground/30"}`}
                  />
                  <span className="text-sm font-semibold">{g.label}</span>
                  {g.subtitle && (
                    <span className="text-xs text-muted-foreground">{g.subtitle}</span>
                  )}
                  <Badge variant="secondary" className="text-[10px]">
                    {g.count} use case{g.count !== 1 ? "s" : ""}
                  </Badge>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium tabular-nums">
                    {formatCurrency(g.totalValue)}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                  />
                </div>
              </button>
              {isOpen && (
                <CardContent className="border-t p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-6" />
                        <TableHead>Use Case</TableHead>
                        <TableHead>Type</TableHead>
                        {mode === "domain" && <TableHead>Phase</TableHead>}
                        {mode === "phase" && <TableHead>Domain</TableHead>}
                        <TableHead className="text-right">Score</TableHead>
                        <TableHead className="text-right">Feasibility</TableHead>
                        <TableHead>Effort</TableHead>
                        <TableHead className="text-right">Est. Value</TableHead>
                        {runId && <TableHead className="text-center">Vote</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.useCases.map((uc) => {
                        const expandable = hasRationale(uc);
                        const isUcOpen = expandedUseCase === uc.id;
                        const colSpan = 7 + (mode === "domain" || mode === "phase" ? 1 : 0) + (runId ? 1 : 0);
                        return (
                          <Fragment key={uc.id}>
                            <TableRow
                              className={expandable ? "cursor-pointer hover:bg-muted/30" : ""}
                              onClick={() => {
                                if (!expandable) return;
                                setExpandedUseCase(isUcOpen ? null : uc.id);
                              }}
                            >
                              <TableCell className="w-6">
                                {expandable ? (
                                  <ChevronRight
                                    className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isUcOpen ? "rotate-90" : ""}`}
                                  />
                                ) : null}
                              </TableCell>
                              <TableCell>
                                <div>
                                  <p className="text-sm font-medium">{uc.name}</p>
                                  <p className="max-w-[400px] truncate text-xs text-muted-foreground">
                                    {uc.businessValue}
                                  </p>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-[10px]">
                                  {uc.type}
                                </Badge>
                              </TableCell>
                              {mode === "domain" && (
                                <TableCell>
                                  <span className="text-xs">
                                    {uc.phase ? (PHASE_LABELS[uc.phase]?.label ?? uc.phase) : "—"}
                                  </span>
                                </TableCell>
                              )}
                              {mode === "phase" && (
                                <TableCell>
                                  <span className="text-xs">{uc.domain}</span>
                                </TableCell>
                              )}
                              <TableCell className="text-right tabular-nums">
                                {(uc.overallScore * 100).toFixed(0)}%
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {(uc.feasibilityScore * 100).toFixed(0)}%
                              </TableCell>
                              <TableCell>
                                <span className="text-xs">
                                  {uc.effortEstimate
                                    ? (EFFORT_LABELS[uc.effortEstimate] ?? uc.effortEstimate)
                                    : "—"}
                                </span>
                              </TableCell>
                              <TableCell className="text-right font-medium tabular-nums">
                                {formatCurrency(uc.valueMid)}
                              </TableCell>
                              {runId && (
                                <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                                  <VoteButton
                                    runId={runId}
                                    useCaseId={uc.id}
                                    initialCount={votes[uc.id]?.total ?? 0}
                                    compact
                                  />
                                </TableCell>
                              )}
                            </TableRow>
                            {expandable && isUcOpen && (
                              <TableRow className="bg-muted/20 hover:bg-muted/20">
                                <TableCell />
                                <TableCell colSpan={colSpan - 1} className="py-3">
                                  <UseCaseRationale uc={uc} useCaseNameById={useCaseNameById} />
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </section>
  );
}

export function UseCaseRationale({
  uc,
  useCaseNameById,
}: {
  uc: PortfolioUseCase;
  useCaseNameById: Map<string, string>;
}) {
  const formulaEntries = uc.economicFormulaVars
    ? Object.entries(uc.economicFormulaVars)
    : [];
  const valueTypeLabel = uc.valueType
    ? (VALUE_TYPE_LABELS[uc.valueType] ?? uc.valueType)
    : null;
  const dependencyNames = uc.dependencies
    .map((depId) => useCaseNameById.get(depId) ?? depId)
    .filter(Boolean);

  return (
    <div className="space-y-3 text-xs">
      {/* Value framing chips */}
      <div className="flex flex-wrap gap-2">
        {valueTypeLabel && (
          <Badge variant="outline" className="text-[10px]">
            {valueTypeLabel}
          </Badge>
        )}
        {uc.economicPatternName && (
          <Badge variant="outline" className="text-[10px]">
            {uc.economicPatternName}
          </Badge>
        )}
        {uc.economicImpactCategory && (
          <Badge variant="secondary" className="text-[10px]">
            {uc.economicImpactCategory}
          </Badge>
        )}
        {uc.confidence && (
          <Badge
            variant="outline"
            className={`text-[10px] ${CONFIDENCE_BADGE[uc.confidence] ?? ""}`}
          >
            {uc.confidence} confidence
          </Badge>
        )}
        {uc.valueLow !== null && uc.valueHigh !== null && (
          <Badge variant="outline" className="text-[10px] tabular-nums">
            {formatCurrency(uc.valueLow)} – {formatCurrency(uc.valueHigh)}
          </Badge>
        )}
      </div>

      {uc.rationale && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Value rationale
          </p>
          <p className="leading-relaxed text-foreground">{uc.rationale}</p>
        </div>
      )}

      {uc.industryBenchmark && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Industry benchmark
          </p>
          <p className="leading-relaxed text-foreground">{uc.industryBenchmark}</p>
        </div>
      )}

      {formulaEntries.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Formula inputs
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
            {formulaEntries.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{k}</span>
                <span className="tabular-nums font-medium">{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {uc.assumptions.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Assumptions
          </p>
          <ul className="list-disc space-y-0.5 pl-4 leading-relaxed text-foreground">
            {uc.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {(uc.phaseRationale || uc.enablers.length > 0 || dependencyNames.length > 0) && (
        <div className="space-y-2 rounded-md border border-dashed bg-background/50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Delivery phase notes
          </p>
          {uc.phaseRationale && (
            <p className="leading-relaxed text-foreground">{uc.phaseRationale}</p>
          )}
          {uc.enablers.length > 0 && (
            <div>
              <p className="mb-0.5 text-[10px] font-medium text-muted-foreground">Enablers</p>
              <div className="flex flex-wrap gap-1">
                {uc.enablers.map((e, i) => (
                  <Badge key={i} variant="outline" className="text-[10px]">
                    {e}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {dependencyNames.length > 0 && (
            <div>
              <p className="mb-0.5 text-[10px] font-medium text-muted-foreground">Depends on</p>
              <div className="flex flex-wrap gap-1">
                {dependencyNames.map((name, i) => (
                  <Badge key={i} variant="secondary" className="text-[10px]">
                    {name}
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

export function hasUseCaseRationale(uc: PortfolioUseCase): boolean {
  return hasRationale(uc);
}
