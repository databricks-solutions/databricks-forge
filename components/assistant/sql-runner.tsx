"use client";

import * as React from "react";
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
import {
  Play,
  Copy,
  Check,
  Download,
  AlertCircle,
  Clock,
  Square,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
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

interface SqlRunnerProps {
  sql: string;
  onRequestFix?: (sql: string, error: string) => void;
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
    if (table) {
      const d = new Date();
      return `forge_${table}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.csv`;
    }
  }
  const d = new Date();
  return `forge_query_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.csv`;
}

function p(n: number): string {
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

export function SqlRunner({ sql, onRequestFix }: SqlRunnerProps) {
  const [currentSql, setCurrentSql] = React.useState(sql);
  const [editing, setEditing] = React.useState(false);
  const [running, setRunning] = React.useState(false);
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

  // Cancel
  const abortRef = React.useRef<AbortController | null>(null);

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
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

  // Sorted + paginated rows
  const sortedRows = React.useMemo(() => {
    const r = result?.result?.rows ?? [];
    if (sortCol === null) return r;
    return [...r].sort((a, b) => compareValues(a[sortCol], b[sortCol], sortAsc));
  }, [result?.result?.rows, sortCol, sortAsc]);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const pagedRows = sortedRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const lineCount = currentSql.split("\n").length;
  const editorHeight = Math.min(20, lineCount + 2) * 20;

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">SQL Query</p>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={handleCopy}>
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => setEditing(!editing)}
          >
            {editing ? "Done" : "Edit"}
          </Button>
          {running ? (
            <Button
              size="sm"
              variant="destructive"
              className="h-7 gap-1 text-xs"
              onClick={handleCancel}
            >
              <Square className="size-3" />
              Cancel
            </Button>
          ) : (
            <Button size="sm" className="h-7 gap-1 text-xs" onClick={handleRun}>
              <Play className="size-3" />
              Run
            </Button>
          )}
        </div>
      </div>

      <div style={{ height: `${editorHeight}px`, minHeight: "80px", maxHeight: "400px" }}>
        <SqlEditor
          value={currentSql}
          onChange={editing ? setCurrentSql : undefined}
          readOnly={!editing}
          onRun={handleRun}
          className="h-full"
        />
      </div>

      {result && !result.success && result.error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-destructive">Execution Error</p>
            <p className="mt-1 break-words text-xs text-muted-foreground">{result.error}</p>
            {onRequestFix && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 h-7 text-xs"
                onClick={() => onRequestFix(currentSql, result.error!)}
              >
                Ask Forge to fix
              </Button>
            )}
          </div>
        </div>
      )}

      {result?.success && result.result && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1 text-xs">
              <Clock className="size-3" />
              {result.durationMs}ms
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {result.result.totalRowCount} row{result.result.totalRowCount !== 1 ? "s" : ""}
            </Badge>
            <div className="flex-1" />
            {totalPages > 1 && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="size-3" />
                </Button>
                <span>
                  {page + 1}/{totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="size-3" />
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
              CSV
            </Button>
          </div>

          <div className="max-h-[300px] overflow-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted">
                <TableRow>
                  <TableHead className="w-8 text-center text-[10px] text-muted-foreground">
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
                    <TableCell className="w-8 text-center text-[10px] text-muted-foreground">
                      {page * PAGE_SIZE + ri + 1}
                    </TableCell>
                    {row.map((cell, ci) => (
                      <TableCell
                        key={ci}
                        className="max-w-[200px] cursor-pointer truncate text-xs hover:bg-accent/50"
                        onClick={() =>
                          setInspectedCell({ col: result.result!.columns[ci], value: cell })
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
        </div>
      )}

      {/* Cell inspector */}
      {inspectedCell && (
        <div className="rounded-md border bg-popover p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">{inspectedCell.col.name}</span>
              <Badge variant="secondary" className="text-[10px]">
                {inspectedCell.col.typeName}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px]"
              onClick={() => setInspectedCell(null)}
            >
              Close
            </Button>
          </div>
          <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs break-words">
            {inspectedCell.value === null || inspectedCell.value === undefined ? (
              <span className="italic text-muted-foreground">null</span>
            ) : (
              inspectedCell.value
            )}
          </pre>
        </div>
      )}
    </div>
  );
}
