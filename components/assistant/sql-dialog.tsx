"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import {
  Play,
  Copy,
  Check,
  Download,
  AlertCircle,
  Clock,
  Loader2,
  BookOpen,
  Pencil,
  Square,
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  History,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import dynamic from "next/dynamic";

const SqlEditor = dynamic(() => import("./sql-editor").then((m) => m.SqlEditor), {
  ssr: false,
  loading: () => <div className="h-48 w-full animate-pulse rounded-md bg-muted" />,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SqlColumn {
  name: string;
  typeName: string;
}

interface SqlExecutionResult {
  success: boolean;
  result?: { columns: SqlColumn[]; rows: string[][]; totalRowCount: number };
  error?: string;
  durationMs: number;
}

interface QueryHistoryEntry {
  sql: string;
  timestamp: number;
  durationMs: number;
  rowCount: number | null;
  success: boolean;
}

interface SqlDialogProps {
  open: boolean;
  sqlBlocks: string[];
  initialIndex?: number;
  onOpenChange: (open: boolean) => void;
  onRequestFix?: (sql: string, error: string) => void;
  onDeployNotebook?: (sql: string) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveFilename(sql: string): string {
  const match = sql.match(/\bFROM\s+([`"]?[\w.]+[`"]?)/i);
  if (match) {
    const table = match[1].replace(/[`"]/g, "").split(".").pop();
    if (table) return `forge_${table}_${formatTimestamp()}.csv`;
  }
  return `forge_query_${formatTimestamp()}.csv`;
}

function formatTimestamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function compareValues(a: string | null, b: string | null, asc: boolean): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return asc ? 1 : -1;
  if (b === null || b === undefined) return asc ? -1 : 1;
  const na = Number(a);
  const nb = Number(b);
  if (!isNaN(na) && !isNaN(nb)) return asc ? na - nb : nb - na;
  return asc ? a.localeCompare(b) : b.localeCompare(a);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SqlDialog({
  open,
  sqlBlocks,
  initialIndex = 0,
  onOpenChange,
  onRequestFix,
  onDeployNotebook,
}: SqlDialogProps) {
  const [blockIndex, setBlockIndex] = React.useState(initialIndex);
  const activeSqlBlock = sqlBlocks[blockIndex] ?? sqlBlocks[0] ?? "";
  const [currentSql, setCurrentSql] = React.useState(activeSqlBlock);
  const [editing, setEditing] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [explaining, setExplaining] = React.useState(false);
  const [explainResult, setExplainResult] = React.useState<{
    valid: boolean;
    error?: string;
  } | null>(null);
  const [result, setResult] = React.useState<SqlExecutionResult | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [inspectedCell, setInspectedCell] = React.useState<{
    col: SqlColumn;
    value: string | null;
  } | null>(null);

  // Pagination
  const [page, setPage] = React.useState(0);

  // Sorting
  const [sortCol, setSortCol] = React.useState<number | null>(null);
  const [sortAsc, setSortAsc] = React.useState(true);

  // Query history (session-level)
  const [history, setHistory] = React.useState<QueryHistoryEntry[]>([]);

  // Cancel support
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    if (open) {
      const idx = Math.min(initialIndex, sqlBlocks.length - 1);
      setBlockIndex(Math.max(0, idx));
      setCurrentSql(sqlBlocks[Math.max(0, idx)] ?? "");
      setEditing(false);
      setResult(null);
      setExplainResult(null);
      setPage(0);
      setSortCol(null);
    }
  }, [sqlBlocks, initialIndex, open]);

  const navigateBlock = (newIndex: number) => {
    if (newIndex < 0 || newIndex >= sqlBlocks.length) return;
    setBlockIndex(newIndex);
    setCurrentSql(sqlBlocks[newIndex]);
    setEditing(false);
    setResult(null);
    setExplainResult(null);
    setPage(0);
    setSortCol(null);
  };

  // Keyboard shortcut: Cmd/Ctrl+Enter to run (handled by SqlEditor for the editor itself)
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (!running) handleRun();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, running, currentSql]);

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    setExplainResult(null);
    setPage(0);
    setSortCol(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const resp = await fetch("/api/sql/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: currentSql }),
        signal: controller.signal,
      });
      const data = await resp.json();
      setResult(data);
      setHistory((prev) => [
        {
          sql: currentSql,
          timestamp: Date.now(),
          durationMs: data.durationMs ?? 0,
          rowCount: data.result?.totalRowCount ?? null,
          success: !!data.success,
        },
        ...prev.slice(0, 19),
      ]);
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setResult({ success: false, error: "Query cancelled", durationMs: 0 });
      } else {
        setResult({ success: false, error: "Network error", durationMs: 0 });
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const handleExplain = async () => {
    setExplaining(true);
    setExplainResult(null);
    try {
      const resp = await fetch("/api/sql/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: currentSql }),
      });
      const data = await resp.json();
      setExplainResult(data);
    } catch {
      setExplainResult({ valid: false, error: "Network error" });
    } finally {
      setExplaining(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(currentSql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportCsv = () => {
    if (!result?.result) return;
    const { columns, rows } = result.result;
    const header = columns.map((c) => c.name).join(",");
    const body = rows
      .map((row) => row.map((cell) => `"${(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const csv = `${header}\n${body}`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = deriveFilename(currentSql);
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSort = (colIndex: number) => {
    if (sortCol === colIndex) {
      setSortAsc((prev) => !prev);
    } else {
      setSortCol(colIndex);
      setSortAsc(true);
    }
    setPage(0);
  };

  const handleHistorySelect = (entry: QueryHistoryEntry) => {
    setCurrentSql(entry.sql);
    setEditing(false);
    setResult(null);
    setExplainResult(null);
    setPage(0);
    setSortCol(null);
  };

  // Sorted + paginated rows
  const sortedRows = React.useMemo(() => {
    const r = result?.result?.rows ?? [];
    if (sortCol === null) return r;
    return [...r].sort((a, b) => compareValues(a[sortCol], b[sortCol], sortAsc));
  }, [result?.result?.rows, sortCol, sortAsc]);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const pagedRows = sortedRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const hasResults = result?.success && result.result;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[85vh] w-full max-w-6xl flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="flex items-center gap-2">
            SQL Query
            <Badge variant="secondary" className="text-[10px]">
              Executable
            </Badge>
            {sqlBlocks.length > 1 && (
              <div className="ml-2 flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  disabled={blockIndex === 0}
                  onClick={() => navigateBlock(blockIndex - 1)}
                >
                  <ChevronLeft className="size-3.5" />
                </Button>
                <span className="text-xs font-normal text-muted-foreground">
                  {blockIndex + 1} / {sqlBlocks.length}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  disabled={blockIndex >= sqlBlocks.length - 1}
                  onClick={() => navigateBlock(blockIndex + 1)}
                >
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            )}
          </DialogTitle>
          <DialogDescription>
            Review, edit, and execute this SQL against your warehouse.
          </DialogDescription>
        </DialogHeader>

        {/* Toolbar */}
        <TooltipProvider>
          <div className="flex items-center gap-2 border-b px-5 pb-3">
            {running ? (
              <Button
                size="sm"
                variant="destructive"
                className="h-8 gap-1.5 text-xs"
                onClick={handleCancel}
              >
                <Square className="size-3.5" />
                Cancel
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={handleRun}>
                    <Play className="size-3.5" />
                    Run Query
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Run Query ({navigator?.platform?.includes("Mac") ? "⌘" : "Ctrl"}+Enter)
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={handleExplain}
                  disabled={explaining || running}
                >
                  {explaining ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Search className="size-3.5" />
                  )}
                  Explain
                </Button>
              </TooltipTrigger>
              <TooltipContent>Validate SQL without executing (EXPLAIN)</TooltipContent>
            </Tooltip>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={handleCopy}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setEditing(!editing)}
            >
              <Pencil className="size-3.5" />
              {editing ? "Done" : "Edit"}
            </Button>
            {history.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                    <History className="size-3.5" />
                    History
                    <Badge variant="secondary" className="ml-0.5 h-4 min-w-4 px-1 text-[10px]">
                      {history.length}
                    </Badge>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="max-h-[300px] w-96 overflow-y-auto p-2">
                  <div className="space-y-1">
                    {history.map((entry, i) => (
                      <button
                        key={i}
                        className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                        onClick={() => handleHistorySelect(entry)}
                      >
                        {entry.success ? (
                          <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-500" />
                        ) : (
                          <XCircle className="mt-0.5 size-3 shrink-0 text-destructive" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-[11px]">{entry.sql.slice(0, 80)}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {entry.durationMs}ms
                            {entry.rowCount !== null && ` · ${entry.rowCount} rows`}
                            {" · "}
                            {new Date(entry.timestamp).toLocaleTimeString()}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
            <div className="flex-1" />
            {onDeployNotebook && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => onDeployNotebook(currentSql)}
              >
                <BookOpen className="size-3.5" />
                Deploy as Notebook
              </Button>
            )}
          </div>
        </TooltipProvider>

        {/* Explain result */}
        {explainResult && (
          <div
            className={`mx-5 mt-3 flex items-start gap-2 rounded-md border p-2 text-xs ${explainResult.valid ? "border-emerald-500/30 bg-emerald-500/10" : "border-destructive/50 bg-destructive/10"}`}
          >
            {explainResult.valid ? (
              <>
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                <span className="text-emerald-700 dark:text-emerald-400">SQL is valid</span>
              </>
            ) : (
              <>
                <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                <span className="text-destructive">{explainResult.error}</span>
              </>
            )}
          </div>
        )}

        {/* Main content: split pane */}
        <div className="min-h-0 flex-1">
          <ResizablePanelGroup orientation="vertical" className="h-full">
            {/* SQL Editor panel */}
            <ResizablePanel defaultSize={result ? 35 : 50} minSize={15}>
              <div className="h-full overflow-hidden p-3 pb-0">
                <SqlEditor
                  value={currentSql}
                  onChange={editing ? setCurrentSql : undefined}
                  readOnly={!editing}
                  onRun={handleRun}
                  className="h-full"
                />
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Results panel -- always visible */}
            <ResizablePanel defaultSize={result ? 65 : 50} minSize={20}>
              <div className="flex h-full flex-col overflow-hidden px-3 pb-3">
                {/* Empty state -- no query run yet */}
                {!result && !running && (
                  <div className="flex flex-1 items-center justify-center">
                    <div className="text-center text-muted-foreground">
                      <Play className="mx-auto mb-2 size-8 opacity-20" />
                      <p className="text-sm font-medium">No results yet</p>
                      <p className="mt-1 text-xs">
                        Click <span className="font-medium text-foreground">Run Query</span> or
                        press{" "}
                        <kbd className="rounded border bg-muted px-1 py-0.5 text-[10px] font-mono">
                          {typeof navigator !== "undefined" && navigator?.platform?.includes("Mac")
                            ? "⌘"
                            : "Ctrl"}
                          +Enter
                        </kbd>
                      </p>
                    </div>
                  </div>
                )}

                {/* Error */}
                {result && !result.success && result.error && (
                  <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
                    <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-destructive">Execution Error</p>
                      <p className="mt-1 break-words text-xs text-muted-foreground">
                        {result.error}
                      </p>
                      {onRequestFix && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-2 h-7 text-xs"
                          onClick={() => {
                            onRequestFix(currentSql, result.error!);
                            onOpenChange(false);
                          }}
                        >
                          Ask Forge to fix
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* Success results */}
                {hasResults && result.result && (
                  <>
                    {/* Status bar */}
                    <div className="flex items-center gap-2 py-2">
                      <Badge variant="secondary" className="gap-1 text-xs">
                        <Clock className="size-3" />
                        {result.durationMs}ms
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {result.result.totalRowCount} row
                        {result.result.totalRowCount !== 1 ? "s" : ""}
                      </Badge>
                      <div className="flex-1" />
                      {/* Pagination */}
                      {totalPages > 1 && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            disabled={page === 0}
                            onClick={() => setPage((p) => p - 1)}
                          >
                            <ChevronLeft className="size-3.5" />
                          </Button>
                          <span>
                            Page {page + 1} of {totalPages}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            disabled={page >= totalPages - 1}
                            onClick={() => setPage((p) => p + 1)}
                          >
                            <ChevronRight className="size-3.5" />
                          </Button>
                        </div>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        onClick={handleExportCsv}
                      >
                        <Download className="size-3" />
                        Export CSV
                      </Button>
                    </div>

                    {/* Results table */}
                    <div className="min-h-0 flex-1 overflow-auto rounded-md border">
                      <Table>
                        <TableHeader className="sticky top-0 z-10 bg-muted">
                          <TableRow>
                            <TableHead className="w-10 text-center text-[10px] text-muted-foreground">
                              #
                            </TableHead>
                            {result.result.columns.map((col, ci) => (
                              <TableHead
                                key={col.name}
                                className="cursor-pointer whitespace-nowrap text-xs select-none hover:bg-accent"
                                onClick={() => handleSort(ci)}
                              >
                                <div className="flex items-center gap-1">
                                  <span>{col.name}</span>
                                  <span className="text-[10px] font-normal text-muted-foreground">
                                    {col.typeName}
                                  </span>
                                  {sortCol === ci &&
                                    (sortAsc ? (
                                      <ArrowUp className="size-3 text-primary" />
                                    ) : (
                                      <ArrowDown className="size-3 text-primary" />
                                    ))}
                                </div>
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pagedRows.map((row, ri) => (
                            <TableRow key={ri}>
                              <TableCell className="w-10 text-center text-[10px] text-muted-foreground">
                                {page * PAGE_SIZE + ri + 1}
                              </TableCell>
                              {row.map((cell, ci) => (
                                <TableCell
                                  key={ci}
                                  className="max-w-[300px] cursor-pointer truncate text-xs hover:bg-accent/50"
                                  onClick={() =>
                                    setInspectedCell({
                                      col: result.result!.columns[ci],
                                      value: cell,
                                    })
                                  }
                                >
                                  {cell === null || cell === undefined ? (
                                    <span className="italic text-muted-foreground">null</span>
                                  ) : (
                                    cell
                                  )}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        {/* Running overlay */}
        {running && (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 border-t bg-background/80 px-5 py-2.5 backdrop-blur-sm">
            <Loader2 className="size-4 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Executing query...</span>
          </div>
        )}

        {/* Cell inspector popover */}
        {inspectedCell && (
          <div className="fixed inset-0 z-[60]" onClick={() => setInspectedCell(null)}>
            <div
              className="absolute left-1/2 top-1/2 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-popover p-4 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{inspectedCell.col.name}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {inspectedCell.col.typeName}
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setInspectedCell(null)}
                >
                  Close
                </Button>
              </div>
              <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs break-words">
                {inspectedCell.value === null || inspectedCell.value === undefined ? (
                  <span className="italic text-muted-foreground">null</span>
                ) : (
                  inspectedCell.value
                )}
              </pre>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
