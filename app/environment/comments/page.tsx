"use client";

/**
 * AI Comments page -- /environment/comments
 *
 * States:
 * 1. Jobs list  -- default landing (shows all jobs + "New Job" button)
 * 2. Generating -- progress card (inline, after modal closes)
 * 3. Review     -- three-panel table-by-table review with inline editing
 *
 * The scope selection + industry picker lives in a Dialog triggered by "New Job".
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Sparkles,
  Loader2,
  MessageSquare,
  ChevronRight,
  Plus,
  Trash2,
  ArrowLeft,
  Building2,
  Languages,
} from "lucide-react";
import Link from "next/link";
import {
  loadSettings,
  COMMENT_OUTPUT_LANGUAGES,
  DEFAULT_COMMENT_OUTPUT_LANGUAGE,
  type CommentOutputLanguage,
} from "@/lib/settings";
import { CatalogBrowser } from "@/components/pipeline/catalog-browser";
import { CommentTableNav, type TableSummary } from "@/components/environment/comment-table-nav";
import { CommentReviewPanel, type Proposal } from "@/components/environment/comment-review-panel";
import { CommentActionBar } from "@/components/environment/comment-action-bar";
import {
  CommentProgressCard,
  type CommentProgressData,
} from "@/components/environment/comment-progress-card";

type PageState = "jobs" | "generating" | "review";

interface CommentJob {
  id: string;
  status: string;
  tableCount: number;
  columnCount: number;
  appliedCount: number;
  industryId: string | null;
  outputLanguage: CommentOutputLanguage;
  createdAt: string;
}

const LANGUAGE_NATIVE_LABELS: Record<CommentOutputLanguage, string> = {
  en: "English",
  "pt-BR": "Português (Brasil)",
  es: "Español",
};

export default function AICommentsPage() {
  const tPage = useTranslations("comments.page");
  const tEmpty = useTranslations("comments.empty");
  const tJobs = useTranslations("comments.jobs");
  const tReview = useTranslations("comments.review");
  const tDialog = useTranslations("comments.dialog");
  const tToasts = useTranslations("comments.toasts");

  // -- State --
  const [pageState, setPageState] = useState<PageState>("jobs");
  const [jobs, setJobs] = useState<CommentJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [tableSummary, setTableSummary] = useState<TableSummary[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Record<string, { canModify: boolean }>>({});
  const [applying, setApplying] = useState(false);
  const [loading, setLoading] = useState(true);

  // New-job modal state
  const [newJobOpen, setNewJobOpen] = useState(false);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [excludedSources, setExcludedSources] = useState<string[]>([]);
  const [exclusionPatterns, setExclusionPatterns] = useState<string[]>([]);
  const [industries, setIndustries] = useState<Array<{ id: string; name: string }>>([]);
  const settingsIndustry = typeof window !== "undefined" ? loadSettings().industry : "";
  const settingsAiCommentLanguage =
    typeof window !== "undefined"
      ? loadSettings().aiCommentLanguage
      : DEFAULT_COMMENT_OUTPUT_LANGUAGE;
  const [selectedIndustry, setSelectedIndustry] = useState<string>(
    settingsIndustry || "none",
  );
  const [selectedLanguage, setSelectedLanguage] = useState<CommentOutputLanguage>(
    settingsAiCommentLanguage,
  );
  const [genProgress, setGenProgress] = useState<CommentProgressData | null>(null);
  const [pollTimerRef, setPollTimerRef] = useState<ReturnType<typeof setInterval> | null>(null);

  // -- Load existing jobs + industries on mount --
  useEffect(() => {
    Promise.all([
      fetch("/api/environment/comments").then((r) => (r.ok ? r.json() : { jobs: [] })),
      fetch("/api/industries").then((r) => (r.ok ? r.json() : { industries: [] })),
    ]).then(([jobsData, indData]) => {
      setJobs(jobsData.jobs ?? []);
      setIndustries(indData.industries ?? []);
      setLoading(false);

      // Auto-resume: if a job is generating, resume polling. If ready, go to review.
      const generating = (jobsData.jobs ?? []).find((j: CommentJob) => j.status === "generating");
      if (generating) {
        setActiveJobId(generating.id);
        setPageState("generating");
        startProgressPolling(generating.id);
      } else {
        const ready = (jobsData.jobs ?? []).find((j: CommentJob) => j.status === "ready");
        if (ready) {
          setActiveJobId(ready.id);
          loadJobData(ready.id);
          setPageState("review");
        }
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // -- Load job data --
  const loadJobData = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/environment/comments/${jobId}`);
      if (!res.ok) throw new Error("Failed to load job");
      const data = await res.json();
      setProposals(data.proposals ?? []);
      setTableSummary(data.tableSummary ?? []);

      if (data.tableSummary?.length > 0) {
        setSelectedTable((prev) => prev ?? data.tableSummary[0].tableFqn);
      }

      const fqns = (data.tableSummary ?? []).map((t: TableSummary) => t.tableFqn);
      if (fqns.length > 0) {
        fetch("/api/environment/comments/check-permissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tableFqns: fqns }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data?.permissions) setPermissions(data.permissions);
          })
          .catch(() => {});
      }
    } catch {
      toast.error(tToasts("load_failed"));
    }
  }, [tToasts]);

  // -- Generate comments (from modal) --
  const handleGenerate = useCallback(async () => {
    if (selectedSources.length === 0) {
      toast.error(tToasts("select_scope"));
      return;
    }

    const catalogs = new Set<string>();
    const schemas: string[] = [];
    const tables: string[] = [];
    for (const src of selectedSources) {
      const parts = src.replace(/`/g, "").split(".");
      if (parts.length === 1) {
        catalogs.add(parts[0]);
      } else if (parts.length === 2) {
        catalogs.add(parts[0]);
        schemas.push(parts[1]);
      } else if (parts.length >= 3) {
        catalogs.add(parts[0]);
        tables.push(src);
      }
    }

    const exSchemas: string[] = [];
    const exTables: string[] = [];
    for (const ex of excludedSources) {
      const parts = ex.replace(/`/g, "").split(".");
      if (parts.length === 2) exSchemas.push(ex);
      else if (parts.length >= 3) exTables.push(ex);
    }

    setNewJobOpen(false);
    setPageState("generating");
    setGenProgress(null);

    try {
      const res = await fetch("/api/environment/comments/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catalogs: Array.from(catalogs),
          schemas: schemas.length > 0 ? schemas : undefined,
          tables: tables.length > 0 ? tables : undefined,
          excludedSchemas: exSchemas.length > 0 ? exSchemas : undefined,
          excludedTables: exTables.length > 0 ? exTables : undefined,
          exclusionPatterns: exclusionPatterns.length > 0 ? exclusionPatterns : undefined,
          industryId: selectedIndustry === "none" ? undefined : selectedIndustry,
          outputLanguage: selectedLanguage,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to start generation");
      }

      const { jobId: newJobId } = await res.json();
      setActiveJobId(newJobId);
      startProgressPolling(newJobId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tToasts("generation_failed"));
      setPageState("jobs");
    }
  }, [selectedSources, selectedIndustry, selectedLanguage, tToasts]); // eslint-disable-line react-hooks/exhaustive-deps

  // -- Poll progress --
  const startProgressPolling = useCallback(
    (jobId: string) => {
      if (pollTimerRef) clearInterval(pollTimerRef);

      let consecutiveMisses = 0;
      const maxConsecutiveMisses = 10;

      const timer = setInterval(async () => {
        try {
          const res = await fetch(`/api/environment/comments/${jobId}/progress`);
          if (!res.ok) {
            consecutiveMisses++;
            if (consecutiveMisses >= maxConsecutiveMisses) {
              clearInterval(timer);
              setPollTimerRef(null);
              toast.error(tToasts("lost_contact"));
              setPageState("jobs");
              reloadJobs();
            }
            return;
          }

          consecutiveMisses = 0;
          const prog: CommentProgressData = await res.json();
          setGenProgress(prog);

          if (prog.phase === "complete") {
            clearInterval(timer);
            setPollTimerRef(null);
            setActiveJobId(jobId);
            await loadJobData(jobId);
            setPageState("review");
            reloadJobs();
            toast.success(tToasts("generation_complete"), {
              description: tToasts("generation_summary", {
                tables: prog.tablesGenerated ?? 0,
                columns: prog.columnsGenerated ?? 0,
              }),
            });
          } else if (prog.phase === "failed") {
            clearInterval(timer);
            setPollTimerRef(null);
            toast.error(prog.message || tToasts("generation_failed"));
            setPageState("jobs");
            reloadJobs();
          }
        } catch {
          consecutiveMisses++;
        }
      }, 2_000);

      setPollTimerRef(timer);
    },
    [loadJobData, pollTimerRef, tToasts], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    return () => {
      if (pollTimerRef) clearInterval(pollTimerRef);
    };
  }, [pollTimerRef]);

  // -- Refresh the jobs list --
  const reloadJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/environment/comments");
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs ?? []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // -- Update proposals --
  const handleUpdateProposals = useCallback(
    async (updates: Array<{ id: string; status: string; editedComment?: string | null }>) => {
      if (!activeJobId) return;
      try {
        const res = await fetch(`/api/environment/comments/${activeJobId}/proposals`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proposals: updates }),
        });
        if (!res.ok) throw new Error("Failed to update");

        setProposals((prev) =>
          prev.map((p) => {
            const upd = updates.find((u) => u.id === p.id);
            if (!upd) return p;
            return {
              ...p,
              status: upd.status,
              editedComment:
                upd.editedComment !== undefined ? (upd.editedComment ?? null) : p.editedComment,
            };
          }),
        );

        await loadJobData(activeJobId);
      } catch {
        toast.error(tToasts("update_failed"));
      }
    },
    [activeJobId, loadJobData, tToasts],
  );

  // -- Apply --
  const handleApplyAll = useCallback(async () => {
    if (!activeJobId) return;
    setApplying(true);
    try {
      const res = await fetch(`/api/environment/comments/${activeJobId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? tToasts("apply_failed"));

      toast.success(tToasts("applied_count", { count: data.applied }), {
        description:
          data.failed > 0 ? tToasts("applied_failed_suffix", { count: data.failed }) : undefined,
      });
      await loadJobData(activeJobId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tToasts("apply_failed"));
    } finally {
      setApplying(false);
    }
  }, [activeJobId, loadJobData, tToasts]);

  const handleApplyTable = useCallback(
    async (tableFqn: string) => {
      if (!activeJobId) return;
      const tableProposals = proposals.filter(
        (p) => p.tableFqn === tableFqn && p.status === "accepted",
      );
      if (tableProposals.length === 0) return;

      try {
        const res = await fetch(`/api/environment/comments/${activeJobId}/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proposalIds: tableProposals.map((p) => p.id) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? tToasts("apply_failed"));

        toast.success(
          tToasts("applied_for_table", {
            count: data.applied,
            table: tableFqn.split(".").pop() ?? tableFqn,
          }),
        );
        await loadJobData(activeJobId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : tToasts("apply_failed"));
      }
    },
    [activeJobId, proposals, loadJobData, tToasts],
  );

  // -- Undo --
  const handleUndoAll = useCallback(async () => {
    if (!activeJobId) return;
    try {
      const res = await fetch(`/api/environment/comments/${activeJobId}/undo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? tToasts("undo_failed"));

      toast.success(tToasts("undone_count", { count: data.undone }));
      await loadJobData(activeJobId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tToasts("undo_failed"));
    }
  }, [activeJobId, loadJobData, tToasts]);

  const handleUndoTable = useCallback(
    async (tableFqn: string) => {
      if (!activeJobId) return;
      const applied = proposals.filter((p) => p.tableFqn === tableFqn && p.status === "applied");
      if (applied.length === 0) return;

      try {
        const res = await fetch(`/api/environment/comments/${activeJobId}/undo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proposalIds: applied.map((p) => p.id) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? tToasts("undo_failed"));

        toast.success(tToasts("undone_count", { count: data.undone }));
        await loadJobData(activeJobId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : tToasts("undo_failed"));
      }
    },
    [activeJobId, proposals, loadJobData, tToasts],
  );

  // -- Resync table --
  const handleResyncTable = useCallback(
    async (tableFqn: string) => {
      if (!activeJobId) return;
      try {
        const res = await fetch(`/api/environment/comments/${activeJobId}/resync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tableFqn }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? tToasts("resync_failed"));

        toast.success(
          tToasts("resync_success", {
            count: data.updated,
            table: tableFqn.split(".").pop() ?? tableFqn,
          }),
        );
        await loadJobData(activeJobId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : tToasts("resync_failed"));
      }
    },
    [activeJobId, loadJobData, tToasts],
  );

  // -- Next table --
  const handleNextTable = useCallback(() => {
    if (!selectedTable) return;
    const idx = tableSummary.findIndex((t) => t.tableFqn === selectedTable);
    const nextIdx = idx + 1 < tableSummary.length ? idx + 1 : 0;
    setSelectedTable(tableSummary[nextIdx].tableFqn);
  }, [selectedTable, tableSummary]);

  // -- Open a job for review --
  const handleOpenJob = useCallback(
    async (jobId: string) => {
      setActiveJobId(jobId);
      setSelectedTable(null);
      await loadJobData(jobId);
      setPageState("review");
    },
    [loadJobData],
  );

  // -- Delete job --
  const handleDeleteJob = useCallback(async (jobId: string) => {
    try {
      await fetch(`/api/environment/comments/${jobId}`, { method: "DELETE" });
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      toast.success(tToasts("job_deleted"));
    } catch {
      toast.error(tToasts("delete_failed"));
    }
  }, [tToasts]);

  // -- Derived state --
  const currentTableProposals = useMemo(
    () => (selectedTable ? proposals.filter((p) => p.tableFqn === selectedTable) : []),
    [proposals, selectedTable],
  );

  const globalCounts = useMemo(() => {
    const c = { accepted: 0, applied: 0, failed: 0, total: proposals.length };
    for (const p of proposals) {
      if (p.status === "accepted") c.accepted++;
      else if (p.status === "applied") c.applied++;
      else if (p.status === "failed") c.failed++;
    }
    return c;
  }, [proposals]);

  // -- Render --
  return (
    <div className="mx-auto max-w-[1400px]">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{tPage("title")}</h1>
          <p className="mt-1 text-muted-foreground">{tPage("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {pageState === "review" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPageState("jobs");
                setActiveJobId(null);
                setProposals([]);
                setTableSummary([]);
                setSelectedTable(null);
              }}
            >
              <ArrowLeft className="mr-1 h-3.5 w-3.5" />
              {tPage("all_jobs")}
            </Button>
          )}
          {pageState !== "generating" && (
            <Button
              size="sm"
              onClick={() => {
                setSelectedSources([]);
                setSelectedIndustry("none");
                setSelectedLanguage(settingsAiCommentLanguage);
                setNewJobOpen(true);
              }}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {tPage("new_job")}
            </Button>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* State: Jobs list (default landing)                                */}
      {/* ---------------------------------------------------------------- */}
      {pageState === "jobs" && !loading && (
        <div>
          {jobs.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <MessageSquare className="mx-auto h-10 w-10 text-muted-foreground/50" />
                <p className="mt-4 font-medium">{tEmpty("title")}</p>
                <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
                  {tEmpty("description")}
                </p>
                <Button
                  className="mt-6"
                  onClick={() => {
                    setSelectedSources([]);
                    setSelectedIndustry("none");
                    setNewJobOpen(true);
                  }}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  {tEmpty("create_first")}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {jobs.map((job) => (
                <Card
                  key={job.id}
                  className="transition-colors hover:border-foreground/20 cursor-pointer"
                  onClick={() => handleOpenJob(job.id)}
                >
                  <CardContent className="flex items-center gap-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {new Date(job.createdAt).toLocaleDateString()}{" "}
                          {new Date(job.createdAt).toLocaleTimeString()}
                        </span>
                        <Badge
                          variant={
                            job.status === "completed"
                              ? "default"
                              : job.status === "failed"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {job.status}
                        </Badge>
                        {job.industryId && <Badge variant="outline">{job.industryId}</Badge>}
                        {job.outputLanguage && job.outputLanguage !== "en" && (
                          <Badge variant="outline" className="gap-1">
                            <Languages className="h-3 w-3" />
                            {LANGUAGE_NATIVE_LABELS[job.outputLanguage]}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {tJobs("tables_columns", {
                          tables: job.tableCount,
                          columns: job.columnCount,
                        })}
                        {job.appliedCount > 0 &&
                          tJobs("applied_suffix", { applied: job.appliedCount })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenJob(job.id);
                        }}
                      >
                        <ChevronRight className="mr-1 h-3.5 w-3.5" />
                        {tPage("open")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteJob(job.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* State: Generating                                                 */}
      {/* ---------------------------------------------------------------- */}
      {pageState === "generating" && (
        <div className="max-w-2xl mx-auto space-y-4">
          {genProgress ? (
            <CommentProgressCard progress={genProgress} />
          ) : (
            <Card className="border-blue-200 bg-blue-50/30 dark:border-blue-900 dark:bg-blue-950/10">
              <CardContent className="py-8 flex items-center justify-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                <span className="text-sm text-muted-foreground">{tReview("starting_generation")}</span>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* State: Review (three-panel)                                       */}
      {/* ---------------------------------------------------------------- */}
      {pageState === "review" && (
        <div className="flex flex-col" style={{ height: "calc(100vh - 200px)" }}>
          <div className="flex flex-1 overflow-hidden rounded-lg border">
            <div className="w-64 shrink-0">
              <CommentTableNav
                tables={tableSummary}
                selectedTable={selectedTable}
                onSelectTable={setSelectedTable}
              />
            </div>
            <div className="flex-1 overflow-hidden">
              {selectedTable && currentTableProposals.length > 0 ? (
                <CommentReviewPanel
                  tableFqn={selectedTable}
                  proposals={currentTableProposals}
                  permissions={permissions}
                  onUpdateProposals={handleUpdateProposals}
                  onApplyTable={handleApplyTable}
                  onUndoTable={handleUndoTable}
                  onResyncTable={handleResyncTable}
                  onNextTable={handleNextTable}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  {tableSummary.length > 0
                    ? tReview("select_table")
                    : tReview("no_proposals")}
                </div>
              )}
            </div>
          </div>
          <CommentActionBar
            acceptedCount={globalCounts.accepted}
            appliedCount={globalCounts.applied}
            failedCount={globalCounts.failed}
            totalCount={globalCounts.total}
            applying={applying}
            onApplyAll={handleApplyAll}
            onUndoAll={handleUndoAll}
          />
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <Card>
          <CardContent className="py-8 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* New Job Dialog                                                    */}
      {/* ---------------------------------------------------------------- */}
      <Dialog open={newJobOpen} onOpenChange={setNewJobOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{tDialog("title")}</DialogTitle>
            <DialogDescription>{tDialog("description")}</DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-6 pt-2">
            <div>
              <h3 className="text-sm font-medium mb-2">{tDialog("scope_title")}</h3>
              <p className="text-xs text-muted-foreground mb-3">
                {tDialog("scope_description")}
              </p>
              <CatalogBrowser
                selectedSources={selectedSources}
                excludedSources={excludedSources}
                exclusionPatterns={exclusionPatterns}
                onSelectionChange={(sources, excluded, patterns) => {
                  setSelectedSources(sources);
                  setExcludedSources(excluded);
                  setExclusionPatterns(patterns);
                }}
              />
            </div>

            <div>
              <h3 className="text-sm font-medium mb-2">{tDialog("industry_title")}</h3>
              <p className="text-xs text-muted-foreground mb-3">
                {tDialog("industry_description")}
              </p>
              {settingsIndustry ? (
                <>
                  <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm w-[300px]">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <span>
                      {industries.find((i) => i.id === settingsIndustry)?.name ?? settingsIndustry}
                    </span>
                    <Badge variant="secondary" className="ml-auto text-[10px]">
                      {tDialog("industry_from_settings")}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {tDialog("industry_set_globally_pre")}{" "}
                    <Link
                      href="/settings"
                      className="underline text-primary hover:text-primary/80"
                    >
                      {tDialog("industry_set_globally_settings")}
                    </Link>
                    .
                  </p>
                </>
              ) : (
                <Select value={selectedIndustry} onValueChange={setSelectedIndustry}>
                  <SelectTrigger className="w-[300px]">
                    <SelectValue placeholder={tDialog("industry_placeholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{tDialog("industry_none")}</SelectItem>
                    {industries.map((ind) => (
                      <SelectItem key={ind.id} value={ind.id}>
                        {ind.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div>
              <h3 className="text-sm font-medium mb-2">{tDialog("language_title")}</h3>
              <p className="text-xs text-muted-foreground mb-3">
                {tDialog("language_description_pre")}{" "}
                <Link href="/settings" className="underline text-primary hover:text-primary/80">
                  {tDialog("language_description_settings")}
                </Link>
                .
              </p>
              <Select
                value={selectedLanguage}
                onValueChange={(v) => setSelectedLanguage(v as CommentOutputLanguage)}
              >
                <SelectTrigger className="w-[300px]">
                  <div className="flex items-center gap-2">
                    <Languages className="h-4 w-4 text-muted-foreground" />
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {COMMENT_OUTPUT_LANGUAGES.map((lang) => (
                    <SelectItem key={lang} value={lang}>
                      {LANGUAGE_NATIVE_LABELS[lang]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setNewJobOpen(false)}>
                {tDialog("cancel")}
              </Button>
              <Button onClick={handleGenerate} disabled={selectedSources.length === 0}>
                <Sparkles className="mr-2 h-4 w-4" />
                {tDialog("generate")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
