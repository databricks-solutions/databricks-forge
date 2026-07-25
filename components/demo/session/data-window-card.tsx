"use client";

import { Calendar, Database, AlertTriangle } from "lucide-react";
import type { DemoDateWindow } from "@/lib/demo/data-engine/date-window";
import type { ValidationResult, TableDesign } from "@/lib/demo/types";

interface DataWindowCardProps {
  dateWindow: DemoDateWindow | null;
  validationResults: ValidationResult[] | null;
  tableDesigns: TableDesign[] | null;
}

/** Days of staleness for the per-table MAX(date) badge. */
const STALE_MAX_DAYS = 60;

function formatDate(iso: string): string {
  try {
    return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return iso;
  }
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso + "T00:00:00Z");
  const to = Date.parse(toIso + "T00:00:00Z");
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

export function DataWindowCard({
  dateWindow,
  validationResults,
  tableDesigns,
}: DataWindowCardProps) {
  if (!dateWindow) return null;

  const factTableNames = new Set(
    (tableDesigns ?? []).filter((t) => t.tableType === "fact").map((t) => t.name),
  );

  const coverageRows = (validationResults ?? [])
    .filter((r) => r.dateCoverage && factTableNames.has(r.tableName))
    .sort((a, b) => a.tableName.localeCompare(b.tableName));

  return (
    <section
      className="rounded-lg border bg-card p-4"
      aria-label="Demo data window"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-medium">Data window</h2>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full border bg-muted/50 px-2.5 py-1 font-medium">
            {dateWindow.fyLabel}
          </span>
          <span className="text-muted-foreground">
            {formatDate(dateWindow.startDate)} &rarr; {formatDate(dateWindow.endDate)}
          </span>
          <span className="text-muted-foreground/80">
            ({dateWindow.dateRangeDays} days)
          </span>
        </div>
      </header>

      {coverageRows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="px-2 py-1 font-medium">Fact table</th>
                <th className="px-2 py-1 font-medium">Date column</th>
                <th className="px-2 py-1 font-medium">MIN &rarr; MAX</th>
                <th className="px-2 py-1 font-medium">Last 90d</th>
                <th className="px-2 py-1 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {coverageRows.map((row) => {
                const dc = row.dateCoverage!;
                const ageDays = daysBetween(dc.maxDate, dateWindow.endDate);
                const stale = dc.stale || ageDays > STALE_MAX_DAYS;
                return (
                  <tr key={row.tableName} className="border-t">
                    <td className="px-2 py-1.5 font-mono">{row.tableName}</td>
                    <td className="px-2 py-1.5 font-mono text-muted-foreground">
                      {dc.columnName}
                    </td>
                    <td className="px-2 py-1.5 font-mono">
                      {formatDate(dc.minDate)} &rarr; {formatDate(dc.maxDate)}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {dc.rowsLast90d.toLocaleString()}
                    </td>
                    <td className="px-2 py-1.5">
                      {stale ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                          Stale ({ageDays}d old)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                          <Database className="h-3 w-3" aria-hidden="true" />
                          Fresh
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {coverageRows.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Per-table date coverage not recorded for this session.
        </p>
      )}
    </section>
  );
}
