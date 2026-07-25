"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { resilientFetchJson, fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Trash2, Search, ChevronLeft, ChevronRight, ArrowUpDown, Square, Users } from "lucide-react";
import { LabelWithTip } from "@/components/ui/info-tip";
import { RUNS_LIST } from "@/lib/help-text";
import type { PipelineRunSummary } from "@/lib/lakebase/runs";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { hasActiveRunStatuses } from "@/components/runs/active-status";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  queued: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  running: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  cancelled: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
};

const PAGE_SIZE = 15;

export function RunsContent({
  initialRuns,
  initialError,
}: {
  initialRuns: PipelineRunSummary[];
  initialError: string | null;
}) {
  const router = useRouter();
  const { email: currentEmail } = useCurrentUser();
  const [runs, setRuns] = useState<PipelineRunSummary[]>(initialRuns);
  const [error, setError] = useState<string | null>(initialError);
  const abortRef = useRef<AbortController | null>(null);
  const fetchingRef = useRef(false);
  // `hasLoadedRef` lets the fetch closure decide whether to surface an
  // error to the user without needing `runs` in its dependency list.
  // Once we have ever loaded a non-empty list, transient poll failures
  // are swallowed silently (the user keeps seeing their previous data).
  const hasLoadedRef = useRef(initialRuns.length > 0);
  // Ref-backed callback so the polling effect can call the latest version
  // without re-running every time `fetchRuns` would be re-created. This is
  // the same pattern used by `lib/hooks/use-run-detail.ts`.
  const fetchRunsRef = useRef<() => Promise<void>>(async () => {});

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [ownershipFilter, setOwnershipFilter] = useState<"all" | "mine" | "shared">("all");
  const [sortBy, setSortBy] = useState<"date" | "name">("date");
  const [page, setPage] = useState(0);

  const fetchRuns = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // `fields=summary` keeps the payload tiny -- only the columns the
      // table renders, no `businessContext` / `synthesisJson` / `stepLog`.
      const data = await resilientFetchJson<{ runs: PipelineRunSummary[] }>(
        "/api/runs?fields=summary&limit=200",
        { signal: controller.signal },
      );
      setRuns(data.runs);
      if (data.runs.length > 0) hasLoadedRef.current = true;
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (!hasLoadedRef.current) {
        setError(err instanceof Error ? err.message : "Failed to load runs");
      }
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchRunsRef.current = fetchRuns;
  }, [fetchRuns]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Derived primitive flag so the polling effect's dep is a stable boolean,
  // not the `runs` array reference. Without this the effect would tear down
  // and rebuild the interval on every poll, multiplying load and -- with
  // the old heavy payload -- pushing the RSC serializer over its recursion
  // ceiling.
  const hasActiveRuns = useMemo(() => hasActiveRunStatuses(runs), [runs]);

  useEffect(() => {
    if (!hasActiveRuns) return;
    const interval = setInterval(() => {
      void fetchRunsRef.current();
    }, 5000);
    return () => clearInterval(interval);
  }, [hasActiveRuns]);

  async function handleDelete(runId: string, businessName: string) {
    try {
      await fetchJson(`/api/runs/${runId}`, { method: "DELETE" });
      setRuns((prev) => prev.filter((r) => r.runId !== runId));
      toast.success(`Deleted run for "${businessName}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete run");
    }
  }

  async function handleStopPipeline(runId: string) {
    try {
      const res = await fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Cancel failed");
      }
      toast.success("Pipeline cancellation requested");
      fetchRuns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel pipeline");
    }
  }

  const filtered = runs
    .filter((run) => {
      if (statusFilter !== "all" && run.status !== statusFilter) return false;
      if (ownershipFilter !== "all" && currentEmail) {
        const owner = run.ownerEmail?.toLowerCase() ?? null;
        const isMine = owner === currentEmail;
        if (ownershipFilter === "mine" && !isMine) return false;
        if (ownershipFilter === "shared" && (isMine || owner == null)) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        return (
          run.config.businessName.toLowerCase().includes(q) ||
          run.config.ucMetadata.toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "name") return a.config.businessName.localeCompare(b.config.businessName);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  if (error) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
        <p className="text-muted-foreground">No runs yet</p>
        <Button asChild className="mt-4">
          <Link href="/configure">Start Your First Discovery</Link>
        </Button>
      </div>
    );
  }

  const hasCompareableRuns = runs.filter((r) => r.status === "completed").length >= 2;

  return (
    <>
      {hasCompareableRuns && (
        <div className="flex justify-end -mt-4">
          <Button variant="outline" asChild>
            <Link href="/runs/compare">Compare Runs</Link>
          </Button>
        </div>
      )}
      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by business name..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="pl-9"
          />
        </div>
        <Select
          value={ownershipFilter}
          onValueChange={(v) => {
            setOwnershipFilter(v as typeof ownershipFilter);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Visibility" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Visible</SelectItem>
            <SelectItem value="mine">My Runs</SelectItem>
            <SelectItem value="shared">Shared With Me</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="queued">Queued</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
          <SelectTrigger className="w-[140px]">
            <ArrowUpDown className="mr-2 h-3 w-3" />
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date">Newest First</SelectItem>
            <SelectItem value="name">Name A-Z</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {filtered.length} run{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No runs match your filters</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => {
              setSearch("");
              setStatusFilter("all");
            }}
          >
            Clear Filters
          </Button>
        </div>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <LabelWithTip label="Business Name" tip={RUNS_LIST.businessName} />
                  </TableHead>
                  <TableHead>
                    <LabelWithTip label="UC Metadata" tip={RUNS_LIST.ucMetadata} />
                  </TableHead>
                  <TableHead>
                    <LabelWithTip label="Status" tip={RUNS_LIST.status} />
                  </TableHead>
                  <TableHead>
                    <LabelWithTip label="Progress" tip={RUNS_LIST.progress} />
                  </TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead>
                    <LabelWithTip label="Created" tip={RUNS_LIST.created} />
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((run) => (
                  <TableRow
                    key={run.runId}
                    className="cursor-pointer transition-colors hover:bg-row-hover"
                    onClick={() => router.push(`/runs/${run.runId}`)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span
                          className="block max-w-[180px] truncate"
                          title={run.config.businessName}
                        >
                          {run.config.businessName}
                        </span>
                        {currentEmail &&
                          run.ownerEmail &&
                          run.ownerEmail.toLowerCase() !== currentEmail && (
                            <Badge
                              variant="outline"
                              className="border-violet-300 px-1.5 py-0 text-[10px] text-violet-700 dark:border-violet-500/50 dark:text-violet-300"
                              title={`Shared by ${run.ownerEmail}`}
                            >
                              <Users className="mr-0.5 h-2.5 w-2.5" />
                              Shared
                            </Badge>
                          )}
                      </div>
                    </TableCell>
                    <TableCell
                      className="max-w-[200px] truncate font-mono text-xs"
                      title={run.config.ucMetadata}
                    >
                      {run.config.ucMetadata}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={STATUS_STYLES[run.status] ?? ""}>
                        {run.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="w-[140px]">
                      <div className="flex items-center gap-2">
                        <Progress
                          value={run.progressPct}
                          className="h-2 flex-1"
                          indicatorClassName={
                            run.status === "completed"
                              ? "bg-green-500"
                              : run.status === "failed"
                                ? "bg-red-500"
                                : run.status === "cancelled"
                                  ? "bg-amber-500"
                                  : run.status === "running"
                                    ? "bg-blue-500"
                                    : undefined
                          }
                        />
                        <span className="text-xs text-muted-foreground">{run.progressPct}%</span>
                      </div>
                    </TableCell>
                    <TableCell
                      className="max-w-[220px] truncate text-xs text-muted-foreground"
                      title={run.statusMessage ?? "\u2014"}
                    >
                      {run.statusMessage ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(run.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        {run.status === "running" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-amber-600"
                            onClick={() => handleStopPipeline(run.runId)}
                          >
                            <Square className="h-4 w-4" />
                            <span className="sr-only">Stop</span>
                          </Button>
                        )}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground hover:text-destructive"
                              disabled={
                                run.status === "running" ||
                                (currentEmail != null &&
                                  run.ownerEmail != null &&
                                  run.ownerEmail.toLowerCase() !== currentEmail)
                              }
                              title={
                                currentEmail != null &&
                                run.ownerEmail != null &&
                                run.ownerEmail.toLowerCase() !== currentEmail
                                  ? "Only the owner can delete this run"
                                  : undefined
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                              <span className="sr-only">Delete</span>
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this run?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete the pipeline run for{" "}
                                <strong>{run.config.businessName}</strong> and all associated use
                                cases and exports. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => handleDelete(run.runId, run.config.businessName)}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {currentPage + 1} of {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages - 1}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
