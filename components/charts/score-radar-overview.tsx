"use client";

import { useState, useMemo } from "react";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Filter } from "lucide-react";
import type { UseCase } from "@/lib/domain/types";
import { effectiveScores } from "@/lib/domain/scoring";

/**
 * Palette of distinguishable colours for overlaying multiple use cases.
 * Using oklch for perceptual uniformity with high chroma.
 */
const PALETTE = [
  "oklch(0.65 0.22 160)", // teal-green
  "oklch(0.65 0.22 280)", // violet
  "oklch(0.70 0.20 40)", // orange
  "oklch(0.60 0.22 330)", // magenta-pink
  "oklch(0.70 0.18 200)", // sky-blue
  "oklch(0.68 0.20 90)", // lime-gold
  "oklch(0.58 0.18 250)", // indigo
  "oklch(0.72 0.16 15)", // coral
  "oklch(0.62 0.20 140)", // emerald
  "oklch(0.66 0.22 310)", // purple-rose
];

type ViewMode = "top10" | "domain-avg" | "all";

interface ScoreRadarOverviewProps {
  useCases: UseCase[];
}

export function ScoreRadarOverview({ useCases }: ScoreRadarOverviewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(useCases.length <= 10 ? "all" : "top10");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);

  const toggleUseCase = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleLegendClick = (key: string) => {
    if (viewMode === "domain-avg") return;
    setSelectedIds((prev) => {
      if (prev.size === 1 && prev.has(key)) {
        return new Set();
      }
      return new Set([key]);
    });
  };

  // Sorted use cases for the filter picker list
  const sortedUseCases = useMemo(
    () => [...useCases].sort((a, b) => effectiveScores(b).overall - effectiveScores(a).overall),
    [useCases],
  );

  // Single memo: series, filtered series, and colour map derived together
  // so the React Compiler can preserve memoization without cross-memo deps.
  const { series, filteredSeries, seriesColorMap } = useMemo(() => {
    // Domain averages
    const domainMap = new Map<string, { sum: number[]; count: number }>();
    for (const uc of useCases) {
      const eff = effectiveScores(uc);
      const entry = domainMap.get(uc.domain) ?? { sum: [0, 0, 0, 0], count: 0 };
      entry.sum[0] += eff.priority;
      entry.sum[1] += eff.feasibility;
      entry.sum[2] += eff.impact;
      entry.sum[3] += eff.overall;
      entry.count++;
      domainMap.set(uc.domain, entry);
    }
    const domainAverages = [...domainMap.entries()]
      .map(([domain, { sum, count }]) => ({
        label: domain,
        priority: Math.round((sum[0] / count) * 100),
        feasibility: Math.round((sum[1] / count) * 100),
        impact: Math.round((sum[2] / count) * 100),
        overall: Math.round((sum[3] / count) * 100),
        count,
      }))
      .sort((a, b) => b.overall - a.overall);

    // Series based on view mode
    let allSeries: {
      key: string;
      label: string;
      priority: number;
      feasibility: number;
      impact: number;
      overall: number;
    }[];
    if (viewMode === "domain-avg") {
      allSeries = domainAverages.slice(0, 10).map((d) => ({
        key: d.label,
        label: `${d.label} (${d.count})`,
        priority: d.priority,
        feasibility: d.feasibility,
        impact: d.impact,
        overall: d.overall,
      }));
    } else {
      const sorted = [...useCases].sort(
        (a, b) => effectiveScores(b).overall - effectiveScores(a).overall,
      );
      const subset = viewMode === "top10" ? sorted.slice(0, 10) : sorted;
      allSeries = subset.map((uc) => {
        const eff = effectiveScores(uc);
        return {
          key: uc.id,
          label: uc.name,
          priority: Math.round(eff.priority * 100),
          feasibility: Math.round(eff.feasibility * 100),
          impact: Math.round(eff.impact * 100),
          overall: Math.round(eff.overall * 100),
        };
      });
    }

    // Filtered series (skip for domain averages or when nothing is selected)
    const filtered =
      viewMode === "domain-avg" || selectedIds.size === 0
        ? allSeries
        : allSeries.filter((s) => selectedIds.has(s.key));

    // Stable colour assignment based on position in the unfiltered series
    const colorMap = new Map<string, string>();
    allSeries.forEach((s, i) => colorMap.set(s.key, PALETTE[i % PALETTE.length]));

    return { series: allSeries, filteredSeries: filtered, seriesColorMap: colorMap };
  }, [viewMode, useCases, selectedIds]);

  // Build radar data
  const metrics = ["Priority", "Feasibility", "Impact", "Overall"] as const;
  const radarData = metrics.map((metric) => {
    const row: Record<string, string | number> = { metric };
    for (const s of filteredSeries) {
      const fieldMap: Record<string, keyof typeof s> = {
        Priority: "priority",
        Feasibility: "feasibility",
        Impact: "impact",
        Overall: "overall",
      };
      row[s.key] = s[fieldMap[metric]];
    }
    return row;
  });

  // Limit to 10 series maximum for readability
  const displaySeries = filteredSeries.slice(0, 10);
  const isTruncated = filteredSeries.length > 10;

  if (useCases.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-sm font-medium">Score Landscape</CardTitle>
          <CardDescription>
            Compare score profiles across {viewMode === "domain-avg" ? "domains" : "use cases"}
            {isTruncated && <span className="text-muted-foreground"> (top 10 shown)</span>}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {viewMode !== "domain-avg" && (
            <Popover open={filterOpen} onOpenChange={setFilterOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-1.5">
                  <Filter className="size-3.5" />
                  Filter
                  {selectedIds.size > 0 && (
                    <Badge variant="secondary" className="ml-0.5 h-5 px-1.5 text-[10px]">
                      {selectedIds.size}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[280px] p-0" align="end">
                <Command>
                  <CommandInput placeholder="Search use cases..." />
                  <div className="flex items-center justify-between border-b px-3 py-1.5">
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setSelectedIds(new Set(useCases.map((uc) => uc.id)))}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setSelectedIds(new Set())}
                    >
                      Clear
                    </button>
                  </div>
                  <CommandList>
                    <CommandEmpty>No use cases found.</CommandEmpty>
                    {sortedUseCases.map((uc) => (
                      <CommandItem
                        key={uc.id}
                        value={uc.name}
                        onSelect={() => toggleUseCase(uc.id)}
                        className="gap-2"
                      >
                        <Checkbox
                          checked={selectedIds.has(uc.id)}
                          className="pointer-events-none"
                        />
                        <span className="flex-1 truncate text-xs">{uc.name}</span>
                        <Badge
                          variant="outline"
                          className="ml-auto shrink-0 text-[10px] font-normal"
                        >
                          {uc.domain}
                        </Badge>
                      </CommandItem>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          )}
          <Select value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="top10">Top 10 Use Cases</SelectItem>
              <SelectItem value="domain-avg">Domain Averages</SelectItem>
              {useCases.length <= 20 && <SelectItem value="all">All Use Cases</SelectItem>}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-6">
          {/* Chart area */}
          <div className="min-w-0 flex-[3]">
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                <PolarGrid stroke="var(--color-border)" strokeOpacity={0.5} />
                <PolarAngleAxis
                  dataKey="metric"
                  tick={{ fontSize: 12, fontWeight: 600, fill: "var(--color-foreground)" }}
                />
                <PolarRadiusAxis
                  angle={90}
                  domain={[0, 100]}
                  tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
                  tickCount={5}
                  axisLine={false}
                />
                {displaySeries.map((s) => {
                  const color = seriesColorMap.get(s.key) ?? PALETTE[0];
                  return (
                    <Radar
                      key={s.key}
                      name={s.label}
                      dataKey={s.key}
                      stroke={color}
                      fill={color}
                      fillOpacity={0.05}
                      strokeWidth={2}
                      dot={displaySeries.length <= 5}
                      isAnimationActive={false}
                    />
                  );
                })}
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--color-card)",
                    borderColor: "var(--color-border)",
                    borderRadius: "var(--radius)",
                    fontSize: 12,
                    maxWidth: 260,
                  }}
                  itemStyle={{ color: "var(--color-card-foreground)" }}
                  labelStyle={{ color: "var(--color-card-foreground)" }}
                  formatter={(value) => [`${value ?? 0}%`, undefined]}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Legend sidebar */}
          <div className="flex-[2] overflow-y-auto" style={{ maxHeight: 280 }}>
            <div className="flex flex-col gap-1.5">
              {series.slice(0, 10).map((s) => {
                const color = seriesColorMap.get(s.key) ?? PALETTE[0];
                const isActive = selectedIds.size === 0 || selectedIds.has(s.key);
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => handleLegendClick(s.key)}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-normal transition-opacity ${
                      isActive ? "opacity-100" : "opacity-40"
                    } ${viewMode !== "domain-avg" ? "cursor-pointer hover:opacity-80" : ""}`}
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="truncate text-left" title={s.label}>
                      {s.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
