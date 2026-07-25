"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ChevronDown,
  ChevronRight,
  Columns3,
  FileCheck,
  Minus,
  Pencil,
  Plus,
  Table2,
  MessageSquare,
  Link2,
  BarChart3,
  Filter,
  Code,
  FlaskConical,
  FileText,
} from "lucide-react";
import type { SerializedSpace } from "@/lib/genie/types";

interface FixChange {
  section: string;
  description: string;
  added: number;
  modified: number;
}

interface SpaceDiffViewerProps {
  currentSerializedSpace: string;
  updatedSerializedSpace: string;
  changes: FixChange[];
}

function safeParse(raw: string): SerializedSpace | null {
  try {
    return JSON.parse(raw) as SerializedSpace;
  } catch {
    return null;
  }
}

function flattenStringArray(arr?: string[]): string {
  if (!arr || arr.length === 0) return "";
  return arr.join("");
}

function tableName(identifier: string): string {
  const parts = identifier.split(".");
  return parts[parts.length - 1];
}

// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------

interface ListDiff<T> {
  added: T[];
  removed: T[];
  unchanged: number;
}

function diffByKey<T>(oldItems: T[], newItems: T[], keyFn: (item: T) => string): ListDiff<T> {
  const oldKeys = new Set(oldItems.map(keyFn));
  const newKeys = new Set(newItems.map(keyFn));
  return {
    added: newItems.filter((item) => !oldKeys.has(keyFn(item))),
    removed: oldItems.filter((item) => !newKeys.has(keyFn(item))),
    unchanged: [...oldKeys].filter((k) => newKeys.has(k)).length,
  };
}

// ---------------------------------------------------------------------------
// Column config diff (detects changes within existing tables)
// ---------------------------------------------------------------------------

interface ColumnConfigChange {
  tableName: string;
  columnName: string;
  status: "added" | "removed" | "modified";
  detail?: string;
}

function colConfigKey(c: Record<string, unknown>): string {
  return String(c.column_name ?? c.name ?? "");
}

function diffColumnConfigs(
  oldSpace: SerializedSpace,
  newSpace: SerializedSpace,
): ColumnConfigChange[] {
  const changes: ColumnConfigChange[] = [];
  const oldTableMap = new Map((oldSpace.data_sources?.tables ?? []).map((t) => [t.identifier, t]));
  for (const newTable of newSpace.data_sources?.tables ?? []) {
    const oldTable = oldTableMap.get(newTable.identifier);
    if (!oldTable) continue;
    const oldCols = new Map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((oldTable.column_configs ?? []) as any[]).map((c: Record<string, unknown>) => [
        colConfigKey(c),
        c,
      ]),
    );
    const newCols = new Map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((newTable.column_configs ?? []) as any[]).map((c: Record<string, unknown>) => [
        colConfigKey(c),
        c,
      ]),
    );
    for (const [name, newCol] of newCols) {
      if (!name) continue;
      const oldCol = oldCols.get(name);
      if (!oldCol) {
        changes.push({
          tableName: newTable.identifier,
          columnName: name,
          status: "added",
          detail: String(newCol.description ?? ""),
        });
      } else if (JSON.stringify(oldCol) !== JSON.stringify(newCol)) {
        changes.push({
          tableName: newTable.identifier,
          columnName: name,
          status: "modified",
          detail: String(newCol.description ?? ""),
        });
      }
    }
    for (const [name] of oldCols) {
      if (name && !newCols.has(name)) {
        changes.push({
          tableName: newTable.identifier,
          columnName: name,
          status: "removed",
        });
      }
    }
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Section components
// ---------------------------------------------------------------------------

function DiffSection({
  icon,
  title,
  addedCount,
  removedCount,
  modifiedCount = 0,
  children,
  defaultOpen = false,
}: {
  icon: React.ReactNode;
  title: string;
  addedCount: number;
  removedCount: number;
  modifiedCount?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const hasChanges = addedCount > 0 || removedCount > 0 || modifiedCount > 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/50">
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <span className="flex items-center gap-1.5">
          {icon}
          <span className="font-medium">{title}</span>
        </span>
        {hasChanges ? (
          <span className="ml-auto flex items-center gap-2">
            {addedCount > 0 && (
              <span className="flex items-center gap-0.5 text-green-600">
                <Plus className="size-3" />
                {addedCount}
              </span>
            )}
            {modifiedCount > 0 && (
              <span className="flex items-center gap-0.5 text-amber-600">
                <Pencil className="size-3" />
                {modifiedCount}
              </span>
            )}
            {removedCount > 0 && (
              <span className="flex items-center gap-0.5 text-red-600">
                <Minus className="size-3" />
                {removedCount}
              </span>
            )}
          </span>
        ) : (
          <span className="ml-auto text-[10px] text-muted-foreground">no changes</span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-7 pt-1">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function ItemRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: "added" | "removed" | "modified" | "unchanged";
  detail?: string;
}) {
  const bg =
    status === "added"
      ? "bg-green-50 dark:bg-green-900/15 border-green-200 dark:border-green-800"
      : status === "removed"
        ? "bg-red-50 dark:bg-red-900/15 border-red-200 dark:border-red-800"
        : status === "modified"
          ? "bg-amber-50 dark:bg-amber-900/15 border-amber-200 dark:border-amber-800"
          : "bg-transparent border-transparent";

  return (
    <div className={`rounded border px-2 py-1 text-xs ${bg}`}>
      <div className="flex items-center gap-1.5">
        {status === "added" && <Plus className="size-3 text-green-600" />}
        {status === "removed" && <Minus className="size-3 text-red-600" />}
        {status === "modified" && <Pencil className="size-3 text-amber-600" />}
        <span className="font-medium">{label}</span>
      </div>
      {detail && <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{detail}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Raw JSON viewer (collapsible)
// ---------------------------------------------------------------------------

function formatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SpaceDiffViewer({
  currentSerializedSpace,
  updatedSerializedSpace,
  changes,
}: SpaceDiffViewerProps) {
  const oldSpace = useMemo(() => safeParse(currentSerializedSpace), [currentSerializedSpace]);
  const newSpace = useMemo(() => safeParse(updatedSerializedSpace), [updatedSerializedSpace]);
  const [showRawJson, setShowRawJson] = useState(false);

  const canStructure = oldSpace && newSpace;

  // Compute structured diffs
  const tableDiff = useMemo(() => {
    if (!canStructure) return null;
    return diffByKey(
      oldSpace.data_sources?.tables ?? [],
      newSpace.data_sources?.tables ?? [],
      (t) => t.identifier,
    );
  }, [canStructure, oldSpace, newSpace]);

  const questionDiff = useMemo(() => {
    if (!canStructure) return null;
    return diffByKey(
      oldSpace.config?.sample_questions ?? [],
      newSpace.config?.sample_questions ?? [],
      (q) => flattenStringArray(q.question),
    );
  }, [canStructure, oldSpace, newSpace]);

  const joinDiff = useMemo(() => {
    if (!canStructure) return null;
    const oldJoins = oldSpace.instructions?.join_specs ?? [];
    const newJoins = newSpace.instructions?.join_specs ?? [];
    return diffByKey(oldJoins, newJoins, (j) => `${j.left?.identifier}→${j.right?.identifier}`);
  }, [canStructure, oldSpace, newSpace]);

  const measureDiff = useMemo(() => {
    if (!canStructure) return null;
    const oldM = oldSpace.instructions?.sql_snippets?.measures ?? [];
    const newM = newSpace.instructions?.sql_snippets?.measures ?? [];
    return diffByKey(oldM, newM, (m) => m.display_name ?? m.alias ?? flattenStringArray(m.sql));
  }, [canStructure, oldSpace, newSpace]);

  const filterDiff = useMemo(() => {
    if (!canStructure) return null;
    const oldF = oldSpace.instructions?.sql_snippets?.filters ?? [];
    const newF = newSpace.instructions?.sql_snippets?.filters ?? [];
    return diffByKey(oldF, newF, (f) => f.display_name ?? flattenStringArray(f.sql));
  }, [canStructure, oldSpace, newSpace]);

  const exprDiff = useMemo(() => {
    if (!canStructure) return null;
    const oldE = oldSpace.instructions?.sql_snippets?.expressions ?? [];
    const newE = newSpace.instructions?.sql_snippets?.expressions ?? [];
    return diffByKey(oldE, newE, (e) => e.display_name ?? e.alias ?? flattenStringArray(e.sql));
  }, [canStructure, oldSpace, newSpace]);

  const benchmarkDiff = useMemo(() => {
    if (!canStructure) return null;
    const oldB = oldSpace.benchmarks?.questions ?? [];
    const newB = newSpace.benchmarks?.questions ?? [];
    return diffByKey(oldB, newB, (b) => flattenStringArray(b.question));
  }, [canStructure, oldSpace, newSpace]);

  const exampleSqlDiff = useMemo(() => {
    if (!canStructure) return null;
    const oldQ = oldSpace.instructions?.example_question_sqls ?? [];
    const newQ = newSpace.instructions?.example_question_sqls ?? [];
    return diffByKey(oldQ, newQ, (q) => flattenStringArray(q.question));
  }, [canStructure, oldSpace, newSpace]);

  const colConfigChanges = useMemo(() => {
    if (!canStructure) return [];
    return diffColumnConfigs(oldSpace, newSpace);
  }, [canStructure, oldSpace, newSpace]);

  const colConfigAdded = colConfigChanges.filter((c) => c.status === "added").length;
  const colConfigModified = colConfigChanges.filter((c) => c.status === "modified").length;
  const colConfigRemoved = colConfigChanges.filter((c) => c.status === "removed").length;

  const totalAdded =
    (tableDiff?.added.length ?? 0) +
    (questionDiff?.added.length ?? 0) +
    (joinDiff?.added.length ?? 0) +
    (measureDiff?.added.length ?? 0) +
    (filterDiff?.added.length ?? 0) +
    (exprDiff?.added.length ?? 0) +
    (benchmarkDiff?.added.length ?? 0) +
    (exampleSqlDiff?.added.length ?? 0) +
    colConfigAdded;
  const totalRemoved =
    (tableDiff?.removed.length ?? 0) +
    (questionDiff?.removed.length ?? 0) +
    (joinDiff?.removed.length ?? 0) +
    (measureDiff?.removed.length ?? 0) +
    (filterDiff?.removed.length ?? 0) +
    (exprDiff?.removed.length ?? 0) +
    (benchmarkDiff?.removed.length ?? 0) +
    (exampleSqlDiff?.removed.length ?? 0) +
    colConfigRemoved;
  const totalModified = colConfigModified;

  const noDiff = totalAdded === 0 && totalRemoved === 0 && totalModified === 0 && canStructure;

  if (noDiff) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="flex flex-col items-center py-10 text-center">
            <FileCheck className="mb-3 size-10 text-muted-foreground/50" />
            <h3 className="text-sm font-medium">No Configuration Changes</h3>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              The current and new configurations are identical. The fix strategies ran but did not
              produce any modifications to the space configuration.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Change summary */}
      {changes.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Changes Applied</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {changes.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className="text-[10px]">
                    {c.section}
                  </Badge>
                  <span className="text-muted-foreground">{c.description}</span>
                  {c.added > 0 && (
                    <span className="flex items-center gap-0.5 text-green-600">
                      <Plus className="size-3" />
                      {c.added}
                    </span>
                  )}
                  {c.modified > 0 && <span className="text-amber-600">~{c.modified}</span>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Overall stats */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {totalAdded > 0 && (
          <span className="flex items-center gap-1 text-green-600">
            <Plus className="size-3" />
            {totalAdded} item{totalAdded !== 1 ? "s" : ""} added
          </span>
        )}
        {totalModified > 0 && (
          <span className="flex items-center gap-1 text-amber-600">
            <Pencil className="size-3" />
            {totalModified} item{totalModified !== 1 ? "s" : ""} modified
          </span>
        )}
        {totalRemoved > 0 && (
          <span className="flex items-center gap-1 text-red-600">
            <Minus className="size-3" />
            {totalRemoved} item{totalRemoved !== 1 ? "s" : ""} removed
          </span>
        )}
      </div>

      {/* Structured diff sections */}
      {canStructure && (
        <Card>
          <CardContent className="space-y-1 p-3">
            {/* Tables */}
            {tableDiff && (
              <DiffSection
                icon={<Table2 className="size-3.5 text-blue-500" />}
                title={`Tables (${(newSpace.data_sources?.tables ?? []).length})`}
                addedCount={tableDiff.added.length}
                removedCount={tableDiff.removed.length}
                defaultOpen={tableDiff.added.length > 0 || tableDiff.removed.length > 0}
              >
                <div className="space-y-1">
                  {tableDiff.added.map((t) => (
                    <ItemRow
                      key={t.identifier}
                      label={tableName(t.identifier)}
                      status="added"
                      detail={`${t.column_configs?.length ?? 0} columns configured`}
                    />
                  ))}
                  {tableDiff.removed.map((t) => (
                    <ItemRow key={t.identifier} label={tableName(t.identifier)} status="removed" />
                  ))}
                  {tableDiff.unchanged > 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      {tableDiff.unchanged} table{tableDiff.unchanged !== 1 ? "s" : ""} unchanged
                    </p>
                  )}
                </div>
              </DiffSection>
            )}

            {/* Column Configurations */}
            {colConfigChanges.length > 0 && (
              <DiffSection
                icon={<Columns3 className="size-3.5 text-indigo-500" />}
                title={`Column Configs (${colConfigAdded + colConfigModified + colConfigRemoved} changes)`}
                addedCount={colConfigAdded}
                modifiedCount={colConfigModified}
                removedCount={colConfigRemoved}
                defaultOpen
              >
                <div className="space-y-1">
                  {colConfigChanges.map((c, i) => (
                    <ItemRow
                      key={i}
                      label={`${tableName(c.tableName)}.${c.columnName}`}
                      status={c.status}
                      detail={c.detail || undefined}
                    />
                  ))}
                </div>
              </DiffSection>
            )}

            {/* Sample Questions */}
            {questionDiff && (
              <DiffSection
                icon={<MessageSquare className="size-3.5 text-violet-500" />}
                title={`Sample Questions (${(newSpace.config?.sample_questions ?? []).length})`}
                addedCount={questionDiff.added.length}
                removedCount={questionDiff.removed.length}
              >
                <div className="space-y-1">
                  {questionDiff.added.map((q, i) => (
                    <ItemRow key={i} label={flattenStringArray(q.question)} status="added" />
                  ))}
                  {questionDiff.removed.map((q, i) => (
                    <ItemRow key={i} label={flattenStringArray(q.question)} status="removed" />
                  ))}
                </div>
              </DiffSection>
            )}

            {/* Joins */}
            {joinDiff && (
              <DiffSection
                icon={<Link2 className="size-3.5 text-emerald-500" />}
                title={`Joins (${(newSpace.instructions?.join_specs ?? []).length})`}
                addedCount={joinDiff.added.length}
                removedCount={joinDiff.removed.length}
              >
                <div className="space-y-1">
                  {joinDiff.added.map((j, i) => (
                    <ItemRow
                      key={i}
                      label={`${tableName(j.left?.identifier ?? "")} → ${tableName(j.right?.identifier ?? "")}`}
                      status="added"
                      detail={flattenStringArray(j.sql)}
                    />
                  ))}
                  {joinDiff.removed.map((j, i) => (
                    <ItemRow
                      key={i}
                      label={`${tableName(j.left?.identifier ?? "")} → ${tableName(j.right?.identifier ?? "")}`}
                      status="removed"
                    />
                  ))}
                </div>
              </DiffSection>
            )}

            {/* Measures */}
            {measureDiff && (
              <DiffSection
                icon={<BarChart3 className="size-3.5 text-amber-500" />}
                title={`Measures (${(newSpace.instructions?.sql_snippets?.measures ?? []).length})`}
                addedCount={measureDiff.added.length}
                removedCount={measureDiff.removed.length}
              >
                <div className="space-y-1">
                  {measureDiff.added.map((m, i) => (
                    <ItemRow
                      key={i}
                      label={m.display_name ?? m.alias ?? "Measure"}
                      status="added"
                      detail={flattenStringArray(m.sql)}
                    />
                  ))}
                  {measureDiff.removed.map((m, i) => (
                    <ItemRow
                      key={i}
                      label={m.display_name ?? m.alias ?? "Measure"}
                      status="removed"
                    />
                  ))}
                </div>
              </DiffSection>
            )}

            {/* Filters */}
            {filterDiff && (
              <DiffSection
                icon={<Filter className="size-3.5 text-cyan-500" />}
                title={`Filters (${(newSpace.instructions?.sql_snippets?.filters ?? []).length})`}
                addedCount={filterDiff.added.length}
                removedCount={filterDiff.removed.length}
              >
                <div className="space-y-1">
                  {filterDiff.added.map((f, i) => (
                    <ItemRow
                      key={i}
                      label={f.display_name ?? "Filter"}
                      status="added"
                      detail={flattenStringArray(f.sql)}
                    />
                  ))}
                  {filterDiff.removed.map((f, i) => (
                    <ItemRow key={i} label={f.display_name ?? "Filter"} status="removed" />
                  ))}
                </div>
              </DiffSection>
            )}

            {/* Expressions */}
            {exprDiff && (
              <DiffSection
                icon={<Code className="size-3.5 text-pink-500" />}
                title={`Expressions (${(newSpace.instructions?.sql_snippets?.expressions ?? []).length})`}
                addedCount={exprDiff.added.length}
                removedCount={exprDiff.removed.length}
              >
                <div className="space-y-1">
                  {exprDiff.added.map((e, i) => (
                    <ItemRow
                      key={i}
                      label={e.display_name ?? e.alias ?? "Expression"}
                      status="added"
                      detail={flattenStringArray(e.sql)}
                    />
                  ))}
                  {exprDiff.removed.map((e, i) => (
                    <ItemRow
                      key={i}
                      label={e.display_name ?? e.alias ?? "Expression"}
                      status="removed"
                    />
                  ))}
                </div>
              </DiffSection>
            )}

            {/* Example SQL Queries */}
            {exampleSqlDiff && (
              <DiffSection
                icon={<FileText className="size-3.5 text-orange-500" />}
                title={`Example SQL Queries (${(newSpace.instructions?.example_question_sqls ?? []).length})`}
                addedCount={exampleSqlDiff.added.length}
                removedCount={exampleSqlDiff.removed.length}
              >
                <div className="space-y-1">
                  {exampleSqlDiff.added.map((q, i) => (
                    <ItemRow
                      key={i}
                      label={flattenStringArray(q.question)}
                      status="added"
                      detail={flattenStringArray(q.sql)}
                    />
                  ))}
                  {exampleSqlDiff.removed.map((q, i) => (
                    <ItemRow key={i} label={flattenStringArray(q.question)} status="removed" />
                  ))}
                </div>
              </DiffSection>
            )}

            {/* Benchmarks */}
            {benchmarkDiff && (
              <DiffSection
                icon={<FlaskConical className="size-3.5 text-teal-500" />}
                title={`Benchmarks (${(newSpace.benchmarks?.questions ?? []).length})`}
                addedCount={benchmarkDiff.added.length}
                removedCount={benchmarkDiff.removed.length}
              >
                <div className="space-y-1">
                  {benchmarkDiff.added.map((b, i) => (
                    <ItemRow key={i} label={flattenStringArray(b.question)} status="added" />
                  ))}
                  {benchmarkDiff.removed.map((b, i) => (
                    <ItemRow key={i} label={flattenStringArray(b.question)} status="removed" />
                  ))}
                </div>
              </DiffSection>
            )}
          </CardContent>
        </Card>
      )}

      {/* Raw JSON toggle for power users */}
      <Collapsible open={showRawJson} onOpenChange={setShowRawJson}>
        <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          {showRawJson ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          <span>Advanced: View Raw JSON</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <div className="grid grid-cols-2 gap-0 overflow-hidden rounded border">
            <div className="border-r">
              <div className="border-b bg-muted/50 px-3 py-1.5 text-xs font-medium">
                Current Configuration
              </div>
              <div className="max-h-[400px] overflow-auto">
                <pre className="whitespace-pre-wrap p-3 text-[11px] leading-5 text-muted-foreground">
                  {formatJson(currentSerializedSpace)}
                </pre>
              </div>
            </div>
            <div>
              <div className="border-b bg-muted/50 px-3 py-1.5 text-xs font-medium">
                New Configuration
              </div>
              <div className="max-h-[400px] overflow-auto">
                <pre className="whitespace-pre-wrap p-3 text-[11px] leading-5 text-muted-foreground">
                  {formatJson(updatedSerializedSpace)}
                </pre>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
