"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CoverageTableRow } from "@/app/environment/types";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

const COVERAGE_PAGE_SIZE = 25;

export function TableCoverageView() {
  const [data, setData] = useState<{
    tables: CoverageTableRow[];
    stats: {
      totalTables: number;
      coveredTables: number;
      uncoveredTables: number;
      coveragePct: number;
    };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "covered" | "uncovered">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/environment/table-coverage");
        if (!res.ok) throw new Error("Failed to load");
        const json = await res.json();
        if (json.hasEstateData) {
          setData({ tables: json.tables, stats: json.stats });
        }
      } catch {
        // Silently handle
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (!data || data.tables.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center text-muted-foreground">
          No estate data available. Run an environment scan first.
        </CardContent>
      </Card>
    );
  }

  const filtered = data.tables.filter((t) => {
    if (filter === "covered" && t.useCases.length === 0) return false;
    if (filter === "uncovered" && t.useCases.length > 0) return false;
    if (search && !t.tableFqn.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalPages = Math.ceil(filtered.length / COVERAGE_PAGE_SIZE);
  const safePage = Math.min(page, Math.max(0, totalPages - 1));
  const paged = filtered.slice(safePage * COVERAGE_PAGE_SIZE, (safePage + 1) * COVERAGE_PAGE_SIZE);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Table Coverage Analysis</CardTitle>
          <CardDescription>
            Links estate tables with discovered use cases. Uncovered tables are expansion signals.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Total Tables</p>
              <p className="text-xl font-bold">{data.stats.totalTables}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">With Use Cases</p>
              <p className="text-xl font-bold text-emerald-600">{data.stats.coveredTables}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Untapped (Expansion Signal)</p>
              <p className="text-xl font-bold text-orange-600">{data.stats.uncoveredTables}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Coverage</p>
              <p className="text-xl font-bold">{data.stats.coveragePct}%</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tables..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="pl-8"
          />
        </div>
        <Button
          variant={filter === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setFilter("all");
            setPage(0);
          }}
        >
          All
        </Button>
        <Button
          variant={filter === "covered" ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setFilter("covered");
            setPage(0);
          }}
        >
          With Use Cases
        </Button>
        <Button
          variant={filter === "uncovered" ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setFilter("uncovered");
            setPage(0);
          }}
        >
          Untapped
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[300px]">Table</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Governance</TableHead>
              <TableHead>Use Cases</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map((t) => (
              <TableRow key={t.tableFqn}>
                <TableCell className="font-mono text-xs">
                  <span className="block truncate max-w-[300px]" title={t.tableFqn}>
                    {t.tableFqn}
                  </span>
                  {t.sensitivityLevel === "confidential" || t.sensitivityLevel === "restricted" ? (
                    <Badge variant="destructive" className="ml-1 text-[10px]">
                      PII
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-xs">{t.domain ?? "—"}</TableCell>
                <TableCell className="text-xs">{t.tier ?? "—"}</TableCell>
                <TableCell className="text-xs">
                  {t.governanceScore != null ? `${t.governanceScore}/100` : "—"}
                </TableCell>
                <TableCell>
                  {t.useCases.length > 0 ? (
                    <div className="space-y-0.5">
                      {t.useCases.slice(0, 3).map((uc) => (
                        <div key={uc.id} className="flex items-center gap-1">
                          <Badge variant="secondary" className="text-[10px]">
                            {uc.type}
                          </Badge>
                          <span className="truncate text-xs" title={uc.name}>
                            {uc.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {Math.round(uc.overallScore * 100)}%
                          </span>
                        </div>
                      ))}
                      {t.useCases.length > 3 && (
                        <span className="text-[10px] text-muted-foreground">
                          +{t.useCases.length - 3} more
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">No use cases</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-2">
            <p className="text-sm text-muted-foreground">
              Showing {safePage * COVERAGE_PAGE_SIZE + 1}–
              {Math.min((safePage + 1) * COVERAGE_PAGE_SIZE, filtered.length)} of {filtered.length}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-2 text-sm text-muted-foreground">
                {safePage + 1} / {totalPages}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={safePage >= totalPages - 1}
                onClick={() => setPage(safePage + 1)}
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
