"use client";

import { Fragment, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import { ChevronDown, ChevronRight, Zap, Wrench, Rocket } from "lucide-react";
import {
  UseCaseRationale,
  hasUseCaseRationale,
} from "@/components/business-value/portfolio-drill-down";
import type { PortfolioUseCase } from "@/lib/lakebase/portfolio";
import type { RoadmapPhase } from "@/lib/domain/types";

const PHASE_ICONS: Record<RoadmapPhase, typeof Zap> = {
  quick_wins: Zap,
  foundation: Wrench,
  transformation: Rocket,
};

const PHASE_ICON_BG: Record<RoadmapPhase, string> = {
  quick_wins: "bg-amber-500/15",
  foundation: "bg-blue-500/15",
  transformation: "bg-violet-500/15",
};

const PHASE_ICON_TEXT: Record<RoadmapPhase, string> = {
  quick_wins: "text-amber-500",
  foundation: "text-blue-500",
  transformation: "text-violet-500",
};

type PhaseGroup = {
  phase: RoadmapPhase;
  config: { label: string; timeframe: string; description: string };
  useCases: PortfolioUseCase[];
  totalValue: number;
};

export function RoadmapPhaseDetail({
  phases,
  effortLabels,
}: {
  phases: PhaseGroup[];
  effortLabels: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState<RoadmapPhase | null>(
    phases.find((p) => p.useCases.length > 0)?.phase ?? null,
  );
  const [expandedUseCase, setExpandedUseCase] = useState<string | null>(null);

  const useCaseNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of phases) for (const uc of p.useCases) m.set(uc.id, uc.name);
    return m;
  }, [phases]);

  return (
    <div className="space-y-3">
      {phases.map((p) => {
        const Icon = PHASE_ICONS[p.phase];
        const isOpen = expanded === p.phase;
        const domains = [...new Set(p.useCases.map((u) => u.domain))];

        return (
          <Card key={p.phase} className="overflow-hidden">
            <button
              type="button"
              className={`flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-muted/30 ${isOpen ? "bg-muted/20" : ""}`}
              onClick={() => setExpanded(isOpen ? null : p.phase)}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${PHASE_ICON_BG[p.phase]}`}
                >
                  <Icon className={`h-4 w-4 ${PHASE_ICON_TEXT[p.phase]}`} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{p.config.label}</span>
                    <span className="text-xs text-muted-foreground">{p.config.timeframe}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {p.useCases.length} use case{p.useCases.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{p.config.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium tabular-nums">
                  {formatCurrency(p.totalValue)}
                </span>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                />
              </div>
            </button>

            {isOpen && p.useCases.length > 0 && (
              <CardContent className="border-t p-0">
                {domains.length > 1 && (
                  <div className="flex flex-wrap gap-1.5 border-b px-5 py-3">
                    {domains.map((d) => (
                      <Badge key={d} variant="outline" className="text-[10px]">
                        {d}
                      </Badge>
                    ))}
                  </div>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-6" />
                      <TableHead>Use Case</TableHead>
                      <TableHead>Domain</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead className="text-right">Feasibility</TableHead>
                      <TableHead>Effort</TableHead>
                      <TableHead className="text-right">Est. Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {p.useCases.map((uc) => {
                      const expandable = hasUseCaseRationale(uc);
                      const isUcOpen = expandedUseCase === uc.id;
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
                                <p className="max-w-[350px] truncate text-xs text-muted-foreground">
                                  {uc.businessValue}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs">{uc.domain}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px]">
                                {uc.type}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {(uc.overallScore * 100).toFixed(0)}%
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {(uc.feasibilityScore * 100).toFixed(0)}%
                            </TableCell>
                            <TableCell>
                              <span className="text-xs">
                                {uc.effortEstimate
                                  ? (effortLabels[uc.effortEstimate] ?? uc.effortEstimate)
                                  : "—"}
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {formatCurrency(uc.valueMid)}
                            </TableCell>
                          </TableRow>
                          {expandable && isUcOpen && (
                            <TableRow className="bg-muted/20 hover:bg-muted/20">
                              <TableCell />
                              <TableCell colSpan={7} className="py-3">
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

            {isOpen && p.useCases.length === 0 && (
              <CardContent className="border-t py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  No use cases assigned to this phase yet.
                </p>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
