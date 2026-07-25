"use client";

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import { toast } from "sonner";
import {
  BrainCircuit,
  BarChart3,
  FileText,
  Lightbulb,
  TrendingUp,
  Cpu,
  Users,
  UserCheck,
  Database,
  Code2,
  Layers,
  Tag,
  Target,
  Gauge,
  Zap,
  Trophy,
  Copy,
  Link2,
  Pencil,
  Check,
  X,
  SlidersHorizontal,
  RotateCcw,
  ThumbsUp,
  ThumbsDown,
  ChevronDown,
  ChevronRight,
  Globe,
} from "lucide-react";
import { Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { ScoreRadarChart } from "@/components/charts/lazy";
import { ScoreInsights } from "@/components/pipeline/score-insights";
import { SqlStatusBadge } from "@/components/pipeline/sql-status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { computeOverallScore, effectiveScores } from "@/lib/domain/scoring";
import type { UseCase } from "@/lib/domain/types";

interface UpdateResult {
  ok: boolean;
  error?: string;
}

interface UseCaseTableProps {
  useCases: UseCase[];
  onUpdate?: (updated: UseCase) => Promise<UpdateResult> | void;
  lineageDiscoveredFqns?: string[];
  highlightUseCaseId?: string;
  /** Run id. Required for the SQL retry action to call the regenerate endpoint. */
  runId?: string;
}

export function UseCaseTable({
  useCases,
  onUpdate,
  lineageDiscoveredFqns = [],
  highlightUseCaseId,
  runId,
}: UseCaseTableProps) {
  const [regeneratingSql, setRegeneratingSql] = useState(false);
  const [search, setSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"score" | "name" | "domain">("score");
  const [selectedUseCase, setSelectedUseCase] = useState<UseCase | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(highlightUseCaseId ?? null);

  useEffect(() => {
    if (highlightUseCaseId) {
      requestAnimationFrame(() => {
        const el = document.getElementById(`uc-${highlightUseCaseId}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }, [highlightUseCaseId]);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editStatement, setEditStatement] = useState("");
  const [editTables, setEditTables] = useState("");

  // Score adjustment state
  const [adjustingScores, setAdjustingScores] = useState(false);
  const [adjPriority, setAdjPriority] = useState(0);
  const [adjFeasibility, setAdjFeasibility] = useState(0);
  const [adjImpact, setAdjImpact] = useState(0);

  const domains = useMemo(() => [...new Set(useCases.map((uc) => uc.domain))].sort(), [useCases]);
  const types = useMemo(() => [...new Set(useCases.map((uc) => uc.type))].sort(), [useCases]);

  const filtered = useMemo(() => {
    let result = [...useCases];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (uc) =>
          uc.name.toLowerCase().includes(q) ||
          uc.statement.toLowerCase().includes(q) ||
          uc.domain.toLowerCase().includes(q),
      );
    }

    if (domainFilter !== "all") {
      result = result.filter((uc) => uc.domain === domainFilter);
    }

    if (typeFilter !== "all") {
      result = result.filter((uc) => uc.type === typeFilter);
    }

    switch (sortBy) {
      case "score":
        result.sort((a, b) => effectiveScores(b).overall - effectiveScores(a).overall);
        break;
      case "name":
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "domain":
        result.sort((a, b) => a.domain.localeCompare(b.domain));
        break;
    }

    return result;
  }, [useCases, search, domainFilter, typeFilter, sortBy]);

  // Find related use cases (sharing tables)
  const relatedUseCases = useMemo(() => {
    if (!selectedUseCase) return [];
    const selectedTables = new Set(selectedUseCase.tablesInvolved);
    if (selectedTables.size === 0) return [];
    return useCases
      .filter(
        (uc) =>
          uc.id !== selectedUseCase.id && uc.tablesInvolved.some((t) => selectedTables.has(t)),
      )
      .slice(0, 5);
  }, [selectedUseCase, useCases]);

  // Computed user overall from sliders
  const adjOverall = useMemo(
    () => computeOverallScore(adjPriority / 100, adjFeasibility / 100),
    [adjPriority, adjFeasibility],
  );

  const hasUserScoreChanges = useCallback(
    (uc: UseCase) => {
      if (!adjustingScores) return false;
      const sysPri = Math.round(uc.priorityScore * 100);
      const sysFea = Math.round(uc.feasibilityScore * 100);
      const sysImp = Math.round(uc.impactScore * 100);
      return adjPriority !== sysPri || adjFeasibility !== sysFea || adjImpact !== sysImp;
    },
    [adjustingScores, adjPriority, adjFeasibility, adjImpact],
  );

  // Begin score adjustment mode
  const startAdjusting = (uc: UseCase) => {
    setAdjPriority(Math.round((uc.userPriorityScore ?? uc.priorityScore) * 100));
    setAdjFeasibility(Math.round((uc.userFeasibilityScore ?? uc.feasibilityScore) * 100));
    setAdjImpact(Math.round((uc.userImpactScore ?? uc.impactScore) * 100));
    setAdjustingScores(true);
  };

  // Save adjusted scores
  const saveAdjustedScores = async () => {
    if (!selectedUseCase || !onUpdate) return;
    const updated: UseCase = {
      ...selectedUseCase,
      userPriorityScore: adjPriority / 100,
      userFeasibilityScore: adjFeasibility / 100,
      userImpactScore: adjImpact / 100,
      userOverallScore: adjOverall,
    };
    const result = await onUpdate(updated);
    if (result && !result.ok) {
      toast.error(result.error ?? "Failed to save score adjustments");
      return;
    }
    setSelectedUseCase(updated);
    setAdjustingScores(false);
    toast.success("Scores adjusted");
  };

  // Reset to system scores
  const resetToSystemScores = async () => {
    if (!selectedUseCase || !onUpdate) return;
    const updated: UseCase = {
      ...selectedUseCase,
      userPriorityScore: null,
      userFeasibilityScore: null,
      userImpactScore: null,
      userOverallScore: null,
    };
    const result = await onUpdate(updated);
    if (result && !result.ok) {
      toast.error(result.error ?? "Failed to reset scores");
      return;
    }
    setSelectedUseCase(updated);
    setAdjustingScores(false);
    toast.success("Scores reset to system values");
  };

  const hasAnyUserScore = (uc: UseCase) =>
    uc.userPriorityScore != null ||
    uc.userFeasibilityScore != null ||
    uc.userImpactScore != null ||
    uc.userOverallScore != null;

  const handleRegenerateSql = useCallback(async () => {
    if (!runId || regeneratingSql) return;
    setRegeneratingSql(true);
    try {
      const res = await fetch(`/api/runs/${runId}/sql-engine/generate`, {
        method: "POST",
      });
      if (res.status === 409) {
        toast.info("SQL generation already running");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to start SQL regeneration");
      }
      toast.success("SQL regeneration started — the page will refresh as it lands");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to regenerate SQL");
    } finally {
      setRegeneratingSql(false);
    }
  }, [runId, regeneratingSql]);

  return (
    <>
      <div className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder="Search use cases..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <Select value={domainFilter} onValueChange={setDomainFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Domain" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Domains</SelectItem>
              {domains.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {types.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="score">Score</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="domain">Domain</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            {filtered.length} of {useCases.length}
          </span>
        </div>

        {/* Table */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]">No</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No use cases match your filters
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((uc, idx) => {
                  const isExpanded = expandedId === uc.id;
                  return (
                    <React.Fragment key={uc.id}>
                      <TableRow
                        id={`uc-${uc.id}`}
                        className={`cursor-pointer transition-colors hover:bg-muted/50${highlightUseCaseId === uc.id ? " ring-2 ring-primary ring-offset-2" : ""}`}
                        onClick={() => setExpandedId(isExpanded ? null : uc.id)}
                      >
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                            {idx + 1}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[300px]">
                          <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium" title={uc.name}>
                                {uc.name}
                              </p>
                              {!isExpanded && (
                                <p className="line-clamp-1 text-xs text-muted-foreground">
                                  {uc.statement}
                                </p>
                              )}
                              {(uc.sqlStatus === "pending" ||
                                uc.sqlStatus === "generating" ||
                                uc.sqlStatus === "failed") && (
                                <div className="mt-1">
                                  <SqlStatusBadge status={uc.sqlStatus} />
                                </div>
                              )}
                            </div>
                            {hasAnyUserScore(uc) && (
                              <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <TypeBadge type={uc.type} />
                        </TableCell>
                        <TableCell>
                          <div className="flex min-w-0 items-center gap-1.5">
                            <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate text-sm" title={uc.domain}>
                              {uc.domain}
                            </span>
                            {uc.subdomain && (
                              <span
                                className="truncate text-xs text-muted-foreground"
                                title={uc.subdomain}
                              >
                                / {uc.subdomain}
                              </span>
                            )}
                            {uc.enrichmentTags && uc.enrichmentTags.length > 0 && (
                              <span
                                className="ml-1 flex gap-0.5"
                                title={`Enriched via: ${uc.enrichmentTags.join(", ")}`}
                              >
                                {uc.enrichmentTags.includes("benchmark") && (
                                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                                )}
                                {uc.enrichmentTags.includes("outcome_map") && (
                                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
                                )}
                                {uc.enrichmentTags.includes("document") && (
                                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-purple-500" />
                                )}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <ScoreBadge
                            score={uc.userOverallScore ?? uc.overallScore}
                            isAdjusted={uc.userOverallScore != null}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedUseCase(uc);
                              setAdjustingScores(false);
                              setEditing(false);
                            }}
                          >
                            Details
                          </Button>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell />
                          <TableCell colSpan={5} className="max-w-0 break-words py-4">
                            <div className="space-y-3">
                              <div>
                                <div className="mb-1 flex items-center gap-1.5">
                                  <FileText className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    Statement
                                  </span>
                                </div>
                                <p className="whitespace-normal text-sm leading-relaxed text-foreground/90">
                                  {uc.statement}
                                </p>
                              </div>
                              <div>
                                <div className="mb-1 flex items-center gap-1.5">
                                  <TrendingUp className="h-3.5 w-3.5 shrink-0 text-green-500" />
                                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    Business Value
                                  </span>
                                </div>
                                <p className="whitespace-normal text-sm leading-relaxed text-foreground/90">
                                  {uc.businessValue}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Detail Sheet */}
      <Sheet
        open={!!selectedUseCase}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedUseCase(null);
            setAdjustingScores(false);
            setEditing(false);
          }
        }}
      >
        <SheetContent className="w-full overflow-y-auto px-6 sm:max-w-2xl">
          {selectedUseCase && (
            <>
              <SheetHeader className="pb-2">
                {editing ? (
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="text-lg font-semibold"
                  />
                ) : (
                  <SheetTitle className="text-lg leading-snug">{selectedUseCase.name}</SheetTitle>
                )}
              </SheetHeader>

              {/* Edit / Save / Cancel actions */}
              {onUpdate && (
                <div className="mt-1 flex gap-2">
                  {editing ? (
                    <>
                      <Button
                        size="sm"
                        onClick={async () => {
                          const updated: UseCase = {
                            ...selectedUseCase,
                            name: editName.trim() || selectedUseCase.name,
                            statement: editStatement.trim() || selectedUseCase.statement,
                            tablesInvolved: editTables
                              .split(",")
                              .map((t) => t.trim())
                              .filter(Boolean),
                          };
                          const result = await onUpdate(updated);
                          if (result && !result.ok) {
                            toast.error(result.error ?? "Failed to update use case");
                            return;
                          }
                          setSelectedUseCase(updated);
                          setEditing(false);
                          toast.success("Use case updated");
                        }}
                      >
                        <Check className="mr-1 h-3.5 w-3.5" />
                        Save
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                        <X className="mr-1 h-3.5 w-3.5" />
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditName(selectedUseCase.name);
                        setEditStatement(selectedUseCase.statement);
                        setEditTables(selectedUseCase.tablesInvolved.join(", "));
                        setEditing(true);
                      }}
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      Edit
                    </Button>
                  )}
                </div>
              )}

              {/* Tags row */}
              <div className="mt-3 flex flex-wrap gap-2">
                <TypeBadge type={selectedUseCase.type} />
                <Badge
                  variant="secondary"
                  className="max-w-full gap-1"
                  title={selectedUseCase.domain}
                >
                  <Layers className="h-3 w-3" />
                  {selectedUseCase.domain}
                </Badge>
                {selectedUseCase.subdomain && (
                  <Badge
                    variant="secondary"
                    className="max-w-full gap-1"
                    title={selectedUseCase.subdomain}
                  >
                    <Tag className="h-3 w-3" />
                    {selectedUseCase.subdomain}
                  </Badge>
                )}
                {hasAnyUserScore(selectedUseCase) && (
                  <Badge
                    variant="outline"
                    className="gap-1 border-violet-300 text-violet-700 dark:border-violet-700 dark:text-violet-300"
                  >
                    <SlidersHorizontal className="h-3 w-3" />
                    User Adjusted
                  </Badge>
                )}
              </div>

              <div className="mt-6 space-y-6">
                {/* ── Scores & Feedback ── */}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Score Profile
                  </p>
                  <ScoreRadarChart
                    priority={selectedUseCase.priorityScore}
                    feasibility={selectedUseCase.feasibilityScore}
                    impact={selectedUseCase.impactScore}
                    overall={selectedUseCase.overallScore}
                    userPriority={
                      adjustingScores ? adjPriority / 100 : selectedUseCase.userPriorityScore
                    }
                    userFeasibility={
                      adjustingScores ? adjFeasibility / 100 : selectedUseCase.userFeasibilityScore
                    }
                    userImpact={adjustingScores ? adjImpact / 100 : selectedUseCase.userImpactScore}
                    userOverall={adjustingScores ? adjOverall : selectedUseCase.userOverallScore}
                    size={200}
                  />
                </div>

                <div className="grid grid-cols-4 gap-3">
                  {(() => {
                    const eff = adjustingScores
                      ? {
                          priority: adjPriority / 100,
                          feasibility: adjFeasibility / 100,
                          impact: adjImpact / 100,
                          overall: adjOverall,
                        }
                      : effectiveScores(selectedUseCase);
                    return (
                      <>
                        <ScoreCard
                          icon={<Target className="h-4 w-4" />}
                          label="Priority"
                          score={eff.priority}
                          systemScore={
                            hasAnyUserScore(selectedUseCase) || adjustingScores
                              ? selectedUseCase.priorityScore
                              : undefined
                          }
                        />
                        <ScoreCard
                          icon={<Gauge className="h-4 w-4" />}
                          label="Feasibility"
                          score={eff.feasibility}
                          systemScore={
                            hasAnyUserScore(selectedUseCase) || adjustingScores
                              ? selectedUseCase.feasibilityScore
                              : undefined
                          }
                        />
                        <ScoreCard
                          icon={<Zap className="h-4 w-4" />}
                          label="Impact"
                          score={eff.impact}
                          systemScore={
                            hasAnyUserScore(selectedUseCase) || adjustingScores
                              ? selectedUseCase.impactScore
                              : undefined
                          }
                        />
                        <ScoreCard
                          icon={<Trophy className="h-4 w-4" />}
                          label="Overall"
                          score={eff.overall}
                          systemScore={
                            hasAnyUserScore(selectedUseCase) || adjustingScores
                              ? selectedUseCase.overallScore
                              : undefined
                          }
                        />
                      </>
                    );
                  })()}
                </div>

                {onUpdate &&
                  (!adjustingScores ? (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => startAdjusting(selectedUseCase)}
                      >
                        <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
                        Adjust Scores
                      </Button>
                      {hasAnyUserScore(selectedUseCase) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground"
                          onClick={resetToSystemScores}
                        >
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                          Reset to System
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4 rounded-lg border border-violet-200 bg-violet-50/50 p-4 dark:border-violet-800 dark:bg-violet-950/30">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-violet-900 dark:text-violet-200">
                          Adjust Scores
                        </p>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={saveAdjustedScores}
                            disabled={!hasUserScoreChanges(selectedUseCase)}
                          >
                            <Check className="mr-1 h-3.5 w-3.5" />
                            Apply
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setAdjustingScores(false)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>

                      <ScoreSlider
                        icon={
                          <Target className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                        }
                        label="Priority"
                        value={adjPriority}
                        systemValue={Math.round(selectedUseCase.priorityScore * 100)}
                        onChange={setAdjPriority}
                      />
                      <ScoreSlider
                        icon={
                          <Gauge className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                        }
                        label="Feasibility"
                        value={adjFeasibility}
                        systemValue={Math.round(selectedUseCase.feasibilityScore * 100)}
                        onChange={setAdjFeasibility}
                      />
                      <ScoreSlider
                        icon={<Zap className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />}
                        label="Impact"
                        value={adjImpact}
                        systemValue={Math.round(selectedUseCase.impactScore * 100)}
                        onChange={setAdjImpact}
                      />

                      <div className="flex items-center justify-between rounded-md bg-violet-100 px-3 py-2 dark:bg-violet-900/40">
                        <div className="flex items-center gap-2">
                          <Trophy className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                          <span className="text-sm font-medium text-violet-900 dark:text-violet-200">
                            Computed Overall
                          </span>
                        </div>
                        <span className="text-lg font-bold text-violet-900 dark:text-violet-200">
                          {Math.round(adjOverall * 100)}%
                        </span>
                      </div>

                      <p className="text-[11px] text-violet-700 dark:text-violet-400">
                        Overall = Priority (30%) + Feasibility (20%) + Impact (50%). System scores
                        are preserved and both will appear in exports.
                      </p>

                      {hasAnyUserScore(selectedUseCase) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full text-violet-700 dark:text-violet-300"
                          onClick={resetToSystemScores}
                        >
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                          Reset All to System Scores
                        </Button>
                      )}
                    </div>
                  ))}

                {!adjustingScores && (
                  <ScoreInsights
                    rationale={selectedUseCase.scoreRationale}
                    scorecard={selectedUseCase.consultingScorecard}
                  />
                )}

                {onUpdate && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-muted-foreground mr-1">
                      Feedback:
                    </span>
                    {(["accepted", "rejected", "dismissed"] as const).map((fb) => (
                      <Button
                        key={fb}
                        variant={selectedUseCase.feedback === fb ? "default" : "outline"}
                        size="sm"
                        onClick={async () => {
                          const newFb = selectedUseCase.feedback === fb ? null : fb;
                          const updated = {
                            ...selectedUseCase,
                            feedback: newFb,
                            feedbackAt: newFb ? new Date().toISOString() : null,
                          };
                          const result = await onUpdate(updated);
                          if (result && "ok" in result && result.ok) {
                            setSelectedUseCase(updated);
                          }
                        }}
                      >
                        {fb === "accepted" && <ThumbsUp className="mr-1 h-3.5 w-3.5" />}
                        {fb === "rejected" && <ThumbsDown className="mr-1 h-3.5 w-3.5" />}
                        {fb === "dismissed" && <X className="mr-1 h-3.5 w-3.5" />}
                        {fb.charAt(0).toUpperCase() + fb.slice(1)}
                      </Button>
                    ))}
                  </div>
                )}

                {/* ── Description ── */}
                <DetailSection
                  icon={<FileText className="h-4 w-4 text-blue-500" />}
                  title="Statement"
                  copyText={selectedUseCase.statement}
                >
                  {editing ? (
                    <Textarea
                      value={editStatement}
                      onChange={(e) => setEditStatement(e.target.value)}
                      rows={4}
                      className="mt-1"
                    />
                  ) : (
                    selectedUseCase.statement
                  )}
                </DetailSection>

                <DetailSection
                  icon={<Lightbulb className="h-4 w-4 text-amber-500" />}
                  title="Solution"
                  copyText={selectedUseCase.solution}
                >
                  {selectedUseCase.solution}
                </DetailSection>

                <DetailSection
                  icon={<TrendingUp className="h-4 w-4 text-green-500" />}
                  title="Business Value"
                  copyText={selectedUseCase.businessValue}
                >
                  {selectedUseCase.businessValue}
                </DetailSection>

                {/* ── Technical Details (collapsed) ── */}
                <DisclosureSection
                  title="Technical Details"
                  count={
                    (selectedUseCase.tablesInvolved.length > 0 ? 1 : 0) +
                    (selectedUseCase.sqlCode ||
                    selectedUseCase.sqlStatus === "pending" ||
                    selectedUseCase.sqlStatus === "generating" ||
                    selectedUseCase.sqlStatus === "failed"
                      ? 1
                      : 0) +
                    (selectedUseCase.enrichmentTags?.length ? 1 : 0) +
                    (relatedUseCases.length > 0 ? 1 : 0) +
                    1
                  }
                >
                  <div className="space-y-5">
                    {/* Compact metadata */}
                    <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                      <MetaInline
                        icon={<Cpu className="h-3 w-3 text-violet-500" />}
                        label="Technique"
                        value={selectedUseCase.analyticsTechnique}
                      />
                      <MetaInline
                        icon={<Users className="h-3 w-3 text-sky-500" />}
                        label="Beneficiary"
                        value={selectedUseCase.beneficiary}
                      />
                      <MetaInline
                        icon={<UserCheck className="h-3 w-3 text-emerald-500" />}
                        label="Sponsor"
                        value={selectedUseCase.sponsor}
                      />
                    </div>

                    {/* Enrichment Sources */}
                    {selectedUseCase.enrichmentTags &&
                      selectedUseCase.enrichmentTags.length > 0 && (
                        <div>
                          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                            Enrichment Sources
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {selectedUseCase.enrichmentTags.includes("benchmark") && (
                              <Badge
                                variant="outline"
                                className="max-w-full gap-1 border-amber-400/60 text-amber-700 dark:text-amber-400"
                                title="Benchmark"
                              >
                                <BarChart3 className="h-2.5 w-2.5" />
                                Benchmark
                              </Badge>
                            )}
                            {selectedUseCase.enrichmentTags.includes("outcome_map") && (
                              <Badge
                                variant="outline"
                                className="max-w-full gap-1 border-blue-400/60 text-blue-700 dark:text-blue-400"
                                title="Outcome Map"
                              >
                                <Target className="h-2.5 w-2.5" />
                                Outcome Map
                              </Badge>
                            )}
                            {selectedUseCase.enrichmentTags.includes("document") && (
                              <Badge
                                variant="outline"
                                className="max-w-full gap-1 border-purple-400/60 text-purple-700 dark:text-purple-400"
                                title="Document"
                              >
                                <FileText className="h-2.5 w-2.5" />
                                Document
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}

                    {/* Tables Involved */}
                    {(selectedUseCase.tablesInvolved.length > 0 || editing) && (
                      <DetailSection
                        icon={<Database className="h-4 w-4 text-orange-500" />}
                        title="Tables Involved"
                      >
                        {editing ? (
                          <div className="mt-1">
                            <Input
                              value={editTables}
                              onChange={(e) => setEditTables(e.target.value)}
                              placeholder="catalog.schema.table, ..."
                            />
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              Comma-separated fully-qualified table names
                            </p>
                          </div>
                        ) : (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {selectedUseCase.tablesInvolved.map((t) => {
                              const isLineage = lineageDiscoveredFqns.includes(t);
                              return (
                                <Badge
                                  key={t}
                                  variant="outline"
                                  className={`max-w-full gap-1 font-mono text-[11px] font-normal ${isLineage ? "border-dashed border-blue-400/60" : ""}`}
                                  title={
                                    isLineage
                                      ? "This table was automatically discovered via data lineage — it was not in your original catalog/schema selection."
                                      : t
                                  }
                                >
                                  {isLineage ? (
                                    <Link2 className="h-2.5 w-2.5 shrink-0 text-blue-500" />
                                  ) : (
                                    <Database className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                                  )}
                                  <span className="truncate">{t}</span>
                                  {isLineage && (
                                    <span className="text-[9px] text-blue-500">via lineage</span>
                                  )}
                                </Badge>
                              );
                            })}
                          </div>
                        )}
                      </DetailSection>
                    )}

                    {/* SQL Code — status-aware: skeleton while pending/generating,
                        retry CTA on failure, code block when ready. */}
                    {(selectedUseCase.sqlCode ||
                      selectedUseCase.sqlStatus === "pending" ||
                      selectedUseCase.sqlStatus === "generating" ||
                      selectedUseCase.sqlStatus === "failed") && (
                      <DisclosureSection
                        title="SQL Code"
                        icon={<Code2 className="h-4 w-4 text-pink-500" />}
                        action={
                          selectedUseCase.sqlStatus === "generated" &&
                          selectedUseCase.sqlCode ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(selectedUseCase.sqlCode!);
                                toast.success("SQL copied to clipboard");
                              }}
                            >
                              <Copy className="h-3 w-3" />
                              Copy
                            </Button>
                          ) : null
                        }
                      >
                        {selectedUseCase.sqlStatus === "pending" && (
                          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Queued — will start when the SQL engine picks it up.
                            </div>
                            <Skeleton className="h-3 w-full" />
                            <Skeleton className="h-3 w-5/6" />
                            <Skeleton className="h-3 w-2/3" />
                          </div>
                        )}
                        {selectedUseCase.sqlStatus === "generating" && (
                          <div className="space-y-2 rounded-md border border-blue-500/30 bg-blue-500/5 p-3">
                            <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-300">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Generating SQL…
                            </div>
                            <Skeleton className="h-3 w-full" />
                            <Skeleton className="h-3 w-5/6" />
                            <Skeleton className="h-3 w-3/4" />
                          </div>
                        )}
                        {selectedUseCase.sqlStatus === "failed" && (
                          <div className="space-y-2 rounded-md border border-red-500/40 bg-red-500/5 p-3">
                            <div className="flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
                              <AlertCircle className="h-4 w-4" />
                              SQL generation failed for this use case.
                            </div>
                            <p className="text-xs text-red-600/80 dark:text-red-300/80">
                              You can retry SQL generation for the whole run below. Other use cases
                              that already have SQL will not be re-generated.
                            </p>
                            {runId && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={regeneratingSql}
                                onClick={handleRegenerateSql}
                                className="h-7 gap-1 border-red-500/40 text-xs text-red-700 hover:bg-red-100 hover:text-red-900 dark:text-red-300 dark:hover:bg-red-950"
                              >
                                <RefreshCw
                                  className={`h-3 w-3 ${regeneratingSql ? "animate-spin" : ""}`}
                                />
                                {regeneratingSql ? "Starting…" : "Retry SQL generation"}
                              </Button>
                            )}
                          </div>
                        )}
                        {(selectedUseCase.sqlStatus === "generated" ||
                          (selectedUseCase.sqlStatus == null && selectedUseCase.sqlCode)) &&
                          selectedUseCase.sqlCode && (
                            <pre className="overflow-x-auto rounded-md border bg-muted/50 p-3 font-mono text-xs leading-relaxed">
                              {selectedUseCase.sqlCode}
                            </pre>
                          )}
                      </DisclosureSection>
                    )}

                    {/* Related Use Cases */}
                    {relatedUseCases.length > 0 && (
                      <DisclosureSection
                        title={`Related Use Cases (${relatedUseCases.length})`}
                        icon={<Link2 className="h-4 w-4 text-indigo-500" />}
                      >
                        <div className="space-y-2">
                          {relatedUseCases.map((uc) => (
                            <button
                              key={uc.id}
                              className="flex w-full items-center justify-between rounded-md border p-2 text-left transition-colors hover:bg-muted/50"
                              onClick={() => {
                                setSelectedUseCase(uc);
                                setAdjustingScores(false);
                                setEditing(false);
                              }}
                            >
                              <div>
                                <p className="text-sm font-medium">{uc.name}</p>
                                <p className="text-xs text-muted-foreground">{uc.domain}</p>
                              </div>
                              <ScoreBadge
                                score={uc.userOverallScore ?? uc.overallScore}
                                isAdjusted={uc.userOverallScore != null}
                              />
                            </button>
                          ))}
                        </div>
                      </DisclosureSection>
                    )}
                  </div>
                </DisclosureSection>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------------------
// Score Slider sub-component
// ---------------------------------------------------------------------------

function ScoreSlider({
  icon,
  label,
  value,
  systemValue,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  systemValue: number;
  onChange: (v: number) => void;
}) {
  const changed = value !== systemValue;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium text-violet-900 dark:text-violet-200">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          {changed && (
            <span className="text-xs text-muted-foreground line-through">{systemValue}%</span>
          )}
          <span
            className={`text-sm font-bold ${changed ? "text-violet-700 dark:text-violet-300" : "text-foreground"}`}
          >
            {value}%
          </span>
        </div>
      </div>
      <Slider value={[value]} min={0} max={100} step={1} onValueChange={([v]) => onChange(v)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function TypeBadge({ type }: { type: string }) {
  if (type === "AI") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
      >
        <BrainCircuit className="h-3 w-3" />
        AI
      </Badge>
    );
  }
  if (type === "Geospatial") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
      >
        <Globe className="h-3 w-3" />
        Geospatial
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-700 dark:bg-teal-900/30 dark:text-teal-300"
    >
      <BarChart3 className="h-3 w-3" />
      Statistical
    </Badge>
  );
}

function DetailSection({
  icon,
  title,
  children,
  copyText,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  copyText?: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <p className="text-sm font-semibold">{title}</p>
        </div>
        {copyText && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => {
              navigator.clipboard.writeText(copyText);
              toast.success(`${title} copied to clipboard`);
            }}
          >
            <Copy className="h-3 w-3" />
            Copy
          </Button>
        )}
      </div>
      <div className="pl-6 text-sm leading-relaxed text-foreground/90">{children}</div>
    </div>
  );
}

function MetaInline({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {icon}
      <span className="text-xs text-muted-foreground">{label}:</span>
      <span className="text-xs font-medium">{value}</span>
    </span>
  );
}

function DisclosureSection({
  title,
  icon,
  action,
  count,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  count?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border bg-muted/10">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold hover:bg-muted/30 transition-colors rounded-lg"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
        />
        {icon}
        <span className="flex-1">{title}</span>
        {count != null && !open && (
          <span className="text-xs font-normal text-muted-foreground">{count} items</span>
        )}
        {action && <span onClick={(e) => e.stopPropagation()}>{action}</span>}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function ScoreBadge({ score, isAdjusted }: { score: number; isAdjusted?: boolean }) {
  const pct = Math.round(score * 100);
  const color =
    score >= 0.7
      ? "text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-900/30 dark:border-green-800"
      : score >= 0.4
        ? "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/30 dark:border-amber-800"
        : "text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/30 dark:border-red-800";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${color}`}
    >
      {isAdjusted && <SlidersHorizontal className="h-2.5 w-2.5" />}
      {pct}%
    </span>
  );
}

function ScoreCard({
  icon,
  label,
  score,
  systemScore,
}: {
  icon: React.ReactNode;
  label: string;
  score: number;
  systemScore?: number;
}) {
  const pct = Math.round(score * 100);
  const sysPct = systemScore != null ? Math.round(systemScore * 100) : null;
  const isAdjusted = sysPct != null && sysPct !== pct;

  const colorClasses =
    score >= 0.7
      ? "border-green-200 bg-green-50/50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400"
      : score >= 0.4
        ? "border-amber-200 bg-amber-50/50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400"
        : "border-red-200 bg-red-50/50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400";

  return (
    <div className={`flex flex-col items-center gap-1 rounded-lg border p-3 ${colorClasses}`}>
      <div className="opacity-60">{icon}</div>
      <p className="text-xl font-bold">{pct}%</p>
      {isAdjusted && (
        <p className="text-[10px] text-muted-foreground line-through">System: {sysPct}%</p>
      )}
      <p className="text-[10px] font-medium uppercase tracking-wider opacity-70">{label}</p>
    </div>
  );
}
