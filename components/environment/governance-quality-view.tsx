"use client";

import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/environment/stat-card";
import type { GovernanceQualityStats, TableDetailRow, InsightRow } from "@/app/environment/types";
import type { GovernanceGap } from "@/lib/domain/types";
import { BarChart3, Clock, Search, ShieldAlert } from "lucide-react";

function pctOrNA(value: number | null | undefined): string {
  if (value == null) return "N/A";
  return `${Math.round(value * 100)}%`;
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-green-600";
  if (score >= 40) return "text-amber-600";
  return "text-red-600";
}

const GAP_CATEGORY_LABEL: Record<string, string> = {
  documentation: "Documentation",
  ownership: "Ownership",
  sensitivity: "Sensitivity labelling",
  access_control: "Access control",
  maintenance: "Maintenance",
  lineage: "Lineage",
  tagging: "Tagging",
};

export interface GovernanceQualityViewProps {
  quality: GovernanceQualityStats | null;
  /** Aggregate table details — used for the corrected estate governance score. */
  details?: TableDetailRow[];
  /** Aggregate insights — `governance_gap` rows surface the real gaps. */
  insights?: InsightRow[];
}

export function GovernanceQualityView({ quality, details, insights }: GovernanceQualityViewProps) {
  // Corrected estate governance score: average of the LLM-derived per-table
  // governance scores (ForgeTableDetail.governanceScore now holds
  // GovernanceGap.overallScore), plus a simple readiness distribution.
  const governance = useMemo(() => {
    const scored = (details ?? []).filter((d) => d.governanceScore != null);
    if (scored.length === 0) return null;
    const sum = scored.reduce((s, d) => s + (d.governanceScore ?? 0), 0);
    const avg = Math.round(sum / scored.length);
    const strong = scored.filter((d) => (d.governanceScore ?? 0) >= 70).length;
    const moderate = scored.filter(
      (d) => (d.governanceScore ?? 0) >= 40 && (d.governanceScore ?? 0) < 70,
    ).length;
    const weak = scored.filter((d) => (d.governanceScore ?? 0) < 40).length;
    return { avg, strong, moderate, weak, total: scored.length };
  }, [details]);

  // Real governance gaps parsed from the persisted `governance_gap` insights.
  const gaps = useMemo(() => {
    const rows = (insights ?? []).filter((i) => i.insightType === "governance_gap");
    const byCategory = new Map<string, { count: number; critical: number }>();
    const worst: Array<{ fqn: string; score: number; topGap: string }> = [];
    for (const row of rows) {
      let parsed: GovernanceGap | null = null;
      try {
        parsed = JSON.parse(row.payloadJson) as GovernanceGap;
      } catch {
        continue;
      }
      if (!parsed) continue;
      for (const g of parsed.gaps ?? []) {
        const entry = byCategory.get(g.category) ?? { count: 0, critical: 0 };
        entry.count += 1;
        if (g.severity === "critical") entry.critical += 1;
        byCategory.set(g.category, entry);
      }
      const topGap = (parsed.gaps ?? [])[0];
      worst.push({
        fqn: parsed.tableFqn ?? row.tableFqn ?? "—",
        score: parsed.overallScore ?? 0,
        topGap: topGap
          ? `${GAP_CATEGORY_LABEL[topGap.category] ?? topGap.category}: ${topGap.detail}`
          : "",
      });
    }
    worst.sort((a, b) => a.score - b.score);
    const categories = [...byCategory.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.count - a.count);
    return { categories, worst: worst.slice(0, 10), total: rows.length };
  }, [insights]);

  return (
    <div className="space-y-4">
      {/* Corrected estate governance score */}
      {governance && (
        <Card>
          <CardHeader>
            <CardTitle>Estate Governance Score</CardTitle>
            <CardDescription>
              Average of the AI-derived per-table governance scores across {governance.total} scored
              tables.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-6">
              <div className="flex items-baseline gap-1">
                <span className={`text-5xl font-bold ${scoreColor(governance.avg)}`}>
                  {governance.avg}
                </span>
                <span className="text-sm text-muted-foreground">/ 100</span>
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="outline" className="border-green-500 text-green-700">
                  Strong ({governance.strong})
                </Badge>
                <Badge variant="outline" className="border-amber-500 text-amber-700">
                  Moderate ({governance.moderate})
                </Badge>
                <Badge variant="outline" className="border-red-500 text-red-700">
                  Weak ({governance.weak})
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Real governance gaps */}
      {gaps.total > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Gaps by category</CardTitle>
              <CardDescription>Where governance is weakest across the estate.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {gaps.categories.map((c) => (
                <div key={c.category} className="flex items-center justify-between text-sm">
                  <span>{GAP_CATEGORY_LABEL[c.category] ?? c.category}</span>
                  <div className="flex items-center gap-2">
                    {c.critical > 0 && (
                      <Badge variant="destructive" className="text-[10px]">
                        {c.critical} critical
                      </Badge>
                    )}
                    <Badge variant="secondary">{c.count}</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lowest-scoring tables</CardTitle>
              <CardDescription>Prioritise these for remediation.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {gaps.worst.map((w) => (
                <div key={w.fqn} className="border-b pb-1.5 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs" title={w.fqn}>
                      {w.fqn}
                    </span>
                    <span className={`shrink-0 text-xs font-semibold ${scoreColor(w.score)}`}>
                      {w.score}
                    </span>
                  </div>
                  {w.topGap && (
                    <p
                      className="mt-0.5 truncate text-[11px] text-muted-foreground"
                      title={w.topGap}
                    >
                      {w.topGap}
                    </p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Governance Quality</CardTitle>
          <CardDescription>
            Quality and governance KPIs across completed runs and benchmarks.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              title="Consultant Readiness"
              value={pctOrNA(quality?.avgConsultantReadiness)}
              icon={<BarChart3 className="h-4 w-4" />}
              tooltip="30-day average consultant-readiness across completed runs."
            />
            <StatCard
              title="Assistant Quality"
              value={pctOrNA(quality?.avgAssistantScore)}
              icon={<Search className="h-4 w-4" />}
              tooltip="30-day average assistant response quality score."
            />
            <StatCard
              title="Gate Pass Rate"
              value={pctOrNA(quality?.releaseGatePassRate)}
              icon={<ShieldAlert className="h-4 w-4" />}
              tooltip="Share of runs passing consultant-readiness release gates."
            />
            <StatCard
              title="Benchmark Freshness"
              value={pctOrNA(quality?.benchmarkFreshnessRate)}
              icon={<Clock className="h-4 w-4" />}
              tooltip="Share of published benchmarks still within freshness TTL."
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Benchmark industry coverage: {quality?.benchmarkIndustryCoverage ?? 0} industries.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
