"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowUpDown,
  FlaskConical,
  Loader2,
  Search,
  Sparkles,
  Table2,
  Wrench,
  Zap,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { parseErrorResponse } from "@/lib/error-utils";

interface SpaceRow {
  spaceId: string;
  title: string;
  description?: string;
  domain?: string;
  tableCount?: number;
  grade?: string;
  overallScore?: number;
  fixableCount?: number;
  benchmarkCount?: number;
}

type SortKey = "score" | "title" | "fixable";

export default function ImproveExistingPage() {
  const router = useRouter();
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [autoImproving, setAutoImproving] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const discoveredRef = useRef(new Set<string>());

  const loadSpaces = useCallback(async () => {
    try {
      const res = await fetch("/api/genie-spaces");
      if (!res.ok) throw new Error("Failed to load spaces");
      const data = await res.json();

      const cachedSpaces: Array<{
        spaceId: string;
        title: string;
        description?: string;
        tableCount?: number;
        healthScore?: number;
        healthReportJson?: string;
        permissionDenied?: boolean;
      }> = data.spaces ?? [];
      const tracked: Array<{ spaceId: string; title: string; domain?: string; status: string }> =
        data.tracked ?? [];

      const trackedMap = new Map(tracked.map((t) => [t.spaceId, t]));
      const rows: SpaceRow[] = [];

      for (const c of cachedSpaces) {
        if (c.permissionDenied) continue;
        const t = trackedMap.get(c.spaceId);
        if (t?.status === "trashed") continue;

        let grade: string | undefined;
        let overallScore: number | undefined;
        let fixableCount: number | undefined;
        let benchmarkCount: number | undefined;

        if (c.healthReportJson) {
          try {
            const report = JSON.parse(c.healthReportJson);
            grade = report.grade;
            overallScore = report.overallScore;
            fixableCount = report.fixableCount;
          } catch {
            /* invalid JSON */
          }
        }

        rows.push({
          spaceId: c.spaceId,
          title: t?.title ?? c.title,
          description: c.description,
          domain: t?.domain,
          tableCount: c.tableCount,
          grade,
          overallScore,
          fixableCount,
          benchmarkCount,
        });
      }

      // Include tracked spaces not yet in cache
      for (const t of tracked) {
        if (t.status === "trashed") continue;
        if (cachedSpaces.some((c) => c.spaceId === t.spaceId)) continue;
        rows.push({ spaceId: t.spaceId, title: t.title, domain: t.domain });
      }

      setSpaces(rows);
    } catch {
      toast.error("Failed to load spaces");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSpaces();
  }, [loadSpaces]);

  // Discover health for spaces missing scores
  useEffect(() => {
    if (loading || discovering) return;
    const missing = spaces
      .filter((s) => s.overallScore === undefined && !discoveredRef.current.has(s.spaceId))
      .map((s) => s.spaceId);
    if (missing.length === 0) return;
    for (const id of missing) discoveredRef.current.add(id);
    setDiscovering(true);

    const BATCH = 50;
    (async () => {
      try {
        for (let i = 0; i < missing.length; i += BATCH) {
          const chunk = missing.slice(i, i + BATCH);
          const res = await fetch("/api/genie-spaces/discover", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ spaceIds: chunk }),
          });
          if (!res.ok) continue;
          const data: Record<
            string,
            {
              metadata: { tableCount?: number } | null;
              healthReport: { grade?: string; overallScore?: number; fixableCount?: number } | null;
              permissionDenied?: boolean;
            }
          > = await res.json();

          setSpaces((prev) =>
            prev.map((s) => {
              const d = data[s.spaceId];
              if (!d) return s;
              return {
                ...s,
                tableCount: d.metadata?.tableCount ?? s.tableCount,
                grade: d.healthReport?.grade ?? s.grade,
                overallScore: d.healthReport?.overallScore ?? s.overallScore,
                fixableCount: d.healthReport?.fixableCount ?? s.fixableCount,
              };
            }),
          );
        }
      } catch {
        // Discovery is non-critical
      } finally {
        setDiscovering(false);
      }
    })();
  }, [loading, discovering, spaces]);

  const handleAutoImprove = async (spaceId: string) => {
    setAutoImproving(spaceId);
    try {
      const res = await fetch("/api/genie-spaces/auto-improve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId, targetScore: 80, maxIterations: 5 }),
      });
      if (!res.ok) {
        throw new Error(await parseErrorResponse(res, "Auto-improve failed"));
      }
      const data = await res.json();
      const autoJobId = data.jobId ?? "";
      toast.success("Auto-improve started");
      router.push(`/genie/${spaceId}?tab=benchmarks&autoImprove=${autoJobId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Auto-improve failed");
    } finally {
      setAutoImproving(null);
    }
  };

  const filtered = spaces
    .filter((s) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        s.title.toLowerCase().includes(q) ||
        (s.domain?.toLowerCase().includes(q) ?? false) ||
        (s.description?.toLowerCase().includes(q) ?? false)
      );
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === "score") {
        const aHas = a.overallScore != null;
        const bHas = b.overallScore != null;
        if (aHas && bHas) cmp = b.overallScore! - a.overallScore!;
        else if (aHas !== bHas) cmp = aHas ? -1 : 1;
      } else if (sortKey === "fixable") {
        cmp = (b.fixableCount ?? 0) - (a.fixableCount ?? 0);
      } else {
        cmp = a.title.localeCompare(b.title);
      }
      return cmp !== 0 ? cmp : a.title.localeCompare(b.title);
    });

  const gradeColor = (grade?: string) => {
    if (!grade) return "bg-muted text-muted-foreground";
    if (grade === "A" || grade === "B")
      return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400";
    if (grade === "C")
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400";
    return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400";
  };

  return (
    <div className="mx-auto max-w-[1000px] space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/genie">
            <ArrowLeft className="mr-1 size-4" />
            Genie Studio
          </Link>
        </Button>
      </div>

      <PageHeader
        title="Improve Existing Spaces"
        subtitle="Select a space to run benchmarks, review health, and apply auto-fixes."
      />

      {/* Search and sort controls */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by title or domain..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Sort:</span>
          {(["score", "fixable", "title"] as SortKey[]).map((key) => (
            <Button
              key={key}
              variant={sortKey === key ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setSortKey(key)}
            >
              {key === "score" && "Health Score"}
              {key === "fixable" && "Fixable Issues"}
              {key === "title" && "Name"}
              {sortKey === key && <ArrowUpDown className="ml-1 size-3" />}
            </Button>
          ))}
          {loading && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Loading...
            </span>
          )}
        </div>
      </div>

      {/* Space list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {spaces.length === 0
                ? "No active Genie Spaces found. Create a space first."
                : "No spaces match your search."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((space) => (
            <Card
              key={space.spaceId}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => router.push(`/genie/${space.spaceId}?tab=benchmarks`)}
            >
              <CardContent className="flex items-center gap-4 py-4">
                {/* Health grade */}
                <div
                  className={`flex size-10 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${gradeColor(space.grade)}`}
                >
                  {space.grade ?? "–"}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{space.title}</span>
                    {space.domain && (
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        <Sparkles className="mr-1 size-3" />
                        {space.domain}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    {space.overallScore !== undefined && (
                      <span>Score: {space.overallScore}/100</span>
                    )}
                    {space.tableCount !== undefined && (
                      <span className="flex items-center gap-1">
                        <Table2 className="size-3" />
                        {space.tableCount} tables
                      </span>
                    )}
                    {space.benchmarkCount !== undefined && space.benchmarkCount > 0 && (
                      <span className="flex items-center gap-1">
                        <FlaskConical className="size-3" />
                        {space.benchmarkCount} benchmarks
                      </span>
                    )}
                    {space.fixableCount !== undefined && space.fixableCount > 0 && (
                      <span className="flex items-center gap-1 text-amber-600">
                        <Wrench className="size-3" />
                        {space.fixableCount} fixable
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div
                  className="flex shrink-0 items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => router.push(`/genie/${space.spaceId}?tab=benchmarks`)}
                  >
                    <FlaskConical className="mr-1.5 size-3" />
                    Test
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    disabled={autoImproving === space.spaceId}
                    onClick={() => handleAutoImprove(space.spaceId)}
                  >
                    {autoImproving === space.spaceId ? (
                      <Loader2 className="mr-1.5 size-3 animate-spin" />
                    ) : (
                      <Zap className="mr-1.5 size-3" />
                    )}
                    Auto-Improve
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
