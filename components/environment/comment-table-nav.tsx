"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Database, CheckCircle2, XCircle, Clock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TableSummary {
  tableFqn: string;
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  applied: number;
  failed: number;
}

interface CommentTableNavProps {
  tables: TableSummary[];
  selectedTable: string | null;
  onSelectTable: (fqn: string) => void;
}

function getTableStatus(t: TableSummary) {
  if (t.applied > 0 && t.applied === t.total) return "applied";
  if (t.failed > 0) return "failed";
  if (t.accepted > 0 && t.accepted + t.rejected === t.total) return "accepted";
  if (t.rejected > 0 && t.rejected === t.total) return "rejected";
  if (t.accepted > 0 || t.rejected > 0) return "mixed";
  return "pending";
}

const STATUS_CONFIG = {
  pending: { icon: Clock, color: "text-muted-foreground", bg: "bg-muted/50" },
  accepted: {
    icon: CheckCircle2,
    color: "text-green-600 dark:text-green-400",
    bg: "bg-green-50 dark:bg-green-950/20",
  },
  rejected: { icon: XCircle, color: "text-red-500", bg: "bg-red-50 dark:bg-red-950/20" },
  applied: {
    icon: CheckCircle2,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-950/20",
  },
  failed: { icon: AlertCircle, color: "text-destructive", bg: "bg-destructive/5" },
  mixed: {
    icon: Clock,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/20",
  },
} as const;

export function CommentTableNav({ tables, selectedTable, onSelectTable }: CommentTableNavProps) {
  const [search, setSearch] = useState("");

  const grouped = useMemo(() => {
    const filtered = search
      ? tables.filter((t) => t.tableFqn.toLowerCase().includes(search.toLowerCase()))
      : tables;

    const map = new Map<string, { schema: string; tables: TableSummary[] }>();
    for (const t of filtered) {
      const parts = t.tableFqn.split(".");
      const schemaKey = parts.length >= 2 ? `${parts[0]}.${parts[1]}` : parts[0];
      if (!map.has(schemaKey)) map.set(schemaKey, { schema: schemaKey, tables: [] });
      map.get(schemaKey)!.tables.push(t);
    }
    return Array.from(map.values());
  }, [tables, search]);

  const reviewed = tables.filter((t) => t.accepted + t.rejected + t.applied === t.total).length;

  return (
    <div className="flex h-full flex-col border-r">
      {/* Header */}
      <div className="border-b px-3 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Database className="h-4 w-4 text-muted-foreground" />
          Tables
          <Badge variant="secondary" className="ml-auto text-[10px]">
            {reviewed}/{tables.length} reviewed
          </Badge>
        </div>
        <div className="relative mt-2">
          <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Filter tables..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>

      {/* Table list */}
      <ScrollArea className="flex-1">
        <div className="p-1">
          {grouped.map(({ schema, tables: schemaTables }) => (
            <div key={schema} className="mb-2">
              <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {schema}
              </div>
              {schemaTables.map((t) => {
                const status = getTableStatus(t);
                const cfg = STATUS_CONFIG[status];
                const Icon = cfg.icon;
                const shortName = t.tableFqn.split(".").pop() ?? t.tableFqn;

                return (
                  <button
                    key={t.tableFqn}
                    onClick={() => onSelectTable(t.tableFqn)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                      selectedTable === t.tableFqn
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted/50",
                    )}
                  >
                    <Icon className={cn("h-3.5 w-3.5 shrink-0", cfg.color)} />
                    <span className="truncate font-mono">{shortName}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                      {t.total}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          {grouped.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              {search ? "No matching tables" : "No tables to review"}
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
