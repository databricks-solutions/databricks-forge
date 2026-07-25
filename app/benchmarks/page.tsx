"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { loadSettings } from "@/lib/settings";

interface BenchmarkRow {
  benchmarkId: string;
  kind: string;
  title: string;
  summary: string;
  sourceType: string;
  sourceUrl: string;
  publisher: string;
  publishedAt: string | null;
  industry: string | null;
  lifecycleStatus: "draft" | "reviewed" | "published" | "deprecated";
  confidence: number;
  ttlDays: number;
  sourceFetchStatus: "pending" | "fetched" | "failed" | "manual";
  sourceChunkCount: number;
  updatedAt: string;
}

function isSourceOutdated(row: BenchmarkRow): boolean {
  if (!row.publishedAt) return false;
  const freshUntil = new Date(row.publishedAt).getTime() + row.ttlDays * 86_400_000;
  return freshUntil < Date.now();
}

const LIFECYCLE_OPTIONS: Array<BenchmarkRow["lifecycleStatus"]> = [
  "draft",
  "reviewed",
  "published",
  "deprecated",
];

function fetchStatusStyle(row: BenchmarkRow): {
  variant: "secondary" | "outline" | "default" | "destructive";
  label: string;
} {
  if (row.sourceFetchStatus === "fetched") return { variant: "secondary", label: "Source fetched" };
  if (row.sourceFetchStatus === "manual") return { variant: "secondary", label: "Manual paste" };
  if (row.sourceFetchStatus === "failed" && row.sourceChunkCount > 0) {
    return { variant: "outline", label: "Embedded from summary" };
  }
  if (row.sourceFetchStatus === "failed") return { variant: "destructive", label: "Fetch failed" };
  return { variant: "outline", label: "Not fetched" };
}

export default function BenchmarksPage() {
  const [enabled] = useState(() => loadSettings().benchmarksEnabled);

  if (!enabled) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Benchmark Catalog</h1>
        <p className="max-w-md text-muted-foreground">
          The benchmark catalog is currently disabled. Enable it in Settings to manage industry
          benchmarks for pipeline prompt enrichment.
        </p>
        <Link href="/settings">
          <Button>Open Settings</Button>
        </Link>
      </div>
    );
  }

  return <BenchmarksContent />;
}

function BenchmarksContent() {
  const [rows, setRows] = useState<BenchmarkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [fetchingIds, setFetchingIds] = useState<Set<string>>(new Set());
  const [transitionKey, setTransitionKey] = useState<string | null>(null);
  const [pasteId, setPasteId] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/benchmarks?includeExpired=true");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load benchmarks");
      setRows(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load benchmarks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (kind !== "all" && r.kind !== kind) return false;
      if (status !== "all" && r.lifecycleStatus !== status) return false;
      if (!q.trim()) return true;
      const needle = q.toLowerCase();
      return (
        r.title.toLowerCase().includes(needle) ||
        r.summary.toLowerCase().includes(needle) ||
        (r.industry ?? "").toLowerCase().includes(needle)
      );
    });
  }, [rows, q, kind, status]);

  async function transition(row: BenchmarkRow, lifecycleStatus: BenchmarkRow["lifecycleStatus"]) {
    const key = `${row.benchmarkId}:${lifecycleStatus}`;
    setTransitionKey(key);
    try {
      const res = await fetch(`/api/benchmarks/${row.benchmarkId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lifecycle_status: lifecycleStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      setRows((prev) =>
        prev.map((r) => (r.benchmarkId === row.benchmarkId ? { ...r, ...data } : r)),
      );
    } finally {
      setTransitionKey(null);
    }
  }

  async function fetchSource(row: BenchmarkRow) {
    setFetchingIds((prev) => new Set(prev).add(row.benchmarkId));
    try {
      const res = await fetch(`/api/benchmarks/${row.benchmarkId}/fetch-source`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.record) {
        setRows((prev) =>
          prev.map((r) => (r.benchmarkId === row.benchmarkId ? { ...r, ...data.record } : r)),
        );
      } else {
        setRows((prev) =>
          prev.map((r) =>
            r.benchmarkId === row.benchmarkId
              ? { ...r, sourceFetchStatus: data.sourceFetchStatus ?? "failed" }
              : r,
          ),
        );
      }
      if (data.success) {
        toast.success(`Source fetched (${(data.contentLength / 1024).toFixed(0)} KB)`);
      } else {
        toast.error(data.message || "Fetch failed. Use paste instead.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Fetch failed");
    } finally {
      setFetchingIds((prev) => {
        const next = new Set(prev);
        next.delete(row.benchmarkId);
        return next;
      });
    }
  }

  async function saveManualPaste(benchmarkId: string) {
    if (pasteText.trim().length < 50) {
      toast.error("Content must be at least 50 characters");
      return;
    }
    try {
      const res = await fetch(`/api/benchmarks/${benchmarkId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_content: pasteText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setRows((prev) => prev.map((r) => (r.benchmarkId === benchmarkId ? { ...r, ...data } : r)));
      setPasteId(null);
      setPasteText("");
      toast.success("Source content saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      <PageHeader
        title="Benchmark Catalog"
        subtitle="Public-source benchmark governance with lifecycle states: draft, reviewed, published, deprecated."
      />

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Search and moderate benchmark records.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, summary, industry..."
          />
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger>
              <SelectValue placeholder="Kind" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              <SelectItem value="kpi">KPI</SelectItem>
              <SelectItem value="benchmark_principle">Benchmark Principle</SelectItem>
              <SelectItem value="advisory_theme">Advisory Theme</SelectItem>
              <SelectItem value="platform_best_practice">Platform Best Practice</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {LIFECYCLE_OPTIONS.map((s) => (
                <SelectItem value={s} key={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{loading ? "Loading..." : `${filtered.length} Records`}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {filtered.map((row) => {
            const fetchInfo = fetchStatusStyle(row);
            const isFetching = fetchingIds.has(row.benchmarkId);
            const showPaste = pasteId === row.benchmarkId;

            return (
              <div key={row.benchmarkId} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{row.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.kind} • {row.publisher} • {row.industry || "global"} • confidence{" "}
                      {(row.confidence * 100).toFixed(0)}%
                    </p>
                  </div>
                  <Badge variant="secondary">{row.lifecycleStatus}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{row.summary}</p>

                {/* Source info row */}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <a
                    href={row.sourceUrl}
                    className="text-xs text-blue-600 underline underline-offset-2"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Source
                  </a>
                  {isSourceOutdated(row) && (
                    <Badge
                      variant="outline"
                      className="border-amber-500 text-amber-600 text-[10px] px-1.5 py-0"
                    >
                      Source outdated
                    </Badge>
                  )}
                  <Badge variant={fetchInfo.variant} className="text-[10px] px-1.5 py-0">
                    {fetchInfo.label}
                  </Badge>
                  {row.sourceChunkCount > 0 && row.lifecycleStatus === "published" && (
                    <span className="text-[10px] text-muted-foreground">
                      {row.sourceChunkCount} chunks embedded
                    </span>
                  )}
                </div>

                {/* Source actions */}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isFetching}
                    onClick={() => fetchSource(row)}
                  >
                    {isFetching ? "Fetching..." : "Fetch source"}
                  </Button>
                  {(row.sourceFetchStatus === "failed" || row.sourceFetchStatus === "pending") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (showPaste) {
                          setPasteId(null);
                          setPasteText("");
                        } else {
                          setPasteId(row.benchmarkId);
                          setPasteText("");
                        }
                      }}
                    >
                      {showPaste ? "Cancel paste" : "Paste content"}
                    </Button>
                  )}
                </div>

                {/* Paste textarea */}
                {showPaste && (
                  <div className="mt-2 space-y-2">
                    <Textarea
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      placeholder="Paste the article/report content here (markdown or plain text, min 50 chars)..."
                      rows={6}
                    />
                    <Button
                      size="sm"
                      onClick={() => saveManualPaste(row.benchmarkId)}
                      disabled={pasteText.trim().length < 50}
                    >
                      Save content
                    </Button>
                  </div>
                )}

                {/* Lifecycle controls */}
                <div className="mt-2 flex justify-end gap-2">
                  {LIFECYCLE_OPTIONS.map((s) => {
                    const thisKey = `${row.benchmarkId}:${s}`;
                    const isThisTransitioning = transitionKey === thisKey;
                    const isAnyTransitioning = transitionKey !== null;
                    return (
                      <Button
                        key={s}
                        size="sm"
                        variant={row.lifecycleStatus === s ? "default" : "outline"}
                        disabled={isAnyTransitioning}
                        onClick={async () => {
                          try {
                            await transition(row, s);
                            toast.success(`Status updated to ${s}`);
                          } catch (err) {
                            toast.error(
                              err instanceof Error ? err.message : "Status update failed",
                            );
                          }
                        }}
                      >
                        {isThisTransitioning ? "Saving..." : s}
                      </Button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {!loading && filtered.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No benchmark records found for the selected filters.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
