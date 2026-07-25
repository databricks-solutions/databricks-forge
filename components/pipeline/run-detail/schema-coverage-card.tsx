"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Database } from "lucide-react";
import type { UseCase } from "@/lib/domain/types";

export function SchemaCoverageCard({
  useCases,
  lineageDiscoveredFqns = [],
}: {
  useCases: UseCase[];
  lineageDiscoveredFqns?: string[];
}) {
  const lineageFqnSet = new Set(lineageDiscoveredFqns);
  const allReferencedTables = new Set<string>();
  for (const uc of useCases) {
    for (const fqn of uc.tablesInvolved) {
      allReferencedTables.add(fqn.replace(/`/g, ""));
    }
  }

  const tableCounts = new Map<string, number>();
  for (const uc of useCases) {
    for (const fqn of uc.tablesInvolved) {
      const clean = fqn.replace(/`/g, "");
      tableCounts.set(clean, (tableCounts.get(clean) ?? 0) + 1);
    }
  }

  const topTables = [...tableCounts.entries()].sort(([, a], [, b]) => b - a).slice(0, 10);

  if (allReferencedTables.size === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Database className="h-4 w-4 text-emerald-500" />
          Schema Coverage
        </CardTitle>
        <CardDescription>
          Tables referenced by generated use cases -- most-referenced tables represent your
          highest-value data assets
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Tables Referenced</p>
            <p className="text-lg font-bold">{allReferencedTables.size}</p>
            {lineageDiscoveredFqns.length > 0 &&
              (() => {
                const selectedCount = [...allReferencedTables].filter(
                  (fqn) => !lineageFqnSet.has(fqn),
                ).length;
                const lineageCount = [...allReferencedTables].filter((fqn) =>
                  lineageFqnSet.has(fqn),
                ).length;
                return lineageCount > 0 ? (
                  <p className="text-[10px] text-muted-foreground">
                    {selectedCount} selected + {lineageCount} via lineage
                  </p>
                ) : null;
              })()}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Via Lineage</p>
            <p className="text-lg font-bold">
              {[...allReferencedTables].filter((fqn) => lineageFqnSet.has(fqn)).length}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Unique Table-UC Links</p>
            <p className="text-lg font-bold">
              {[...tableCounts.values()].reduce((s, v) => s + v, 0)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Avg Use Cases per Table</p>
            <p className="text-lg font-bold">
              {allReferencedTables.size > 0
                ? (
                    [...tableCounts.values()].reduce((s, v) => s + v, 0) / allReferencedTables.size
                  ).toFixed(1)
                : "0"}
            </p>
          </div>
        </div>

        <Separator />

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Most-Referenced Tables (highest-value data assets)
          </p>
          <div className="space-y-1.5">
            {topTables.map(([fqn, count]) => {
              const isLineage = lineageFqnSet.has(fqn);
              return (
                <div
                  key={fqn}
                  className={`flex items-center justify-between rounded-md border px-3 py-1.5 ${isLineage ? "border-dashed border-blue-400/60" : ""}`}
                >
                  <span className="truncate font-mono text-xs">{fqn}</span>
                  <div className="ml-2 flex shrink-0 items-center gap-1.5">
                    {isLineage && (
                      <Badge
                        variant="outline"
                        className="border-blue-400/60 text-[10px] text-blue-500"
                      >
                        via lineage
                      </Badge>
                    )}
                    <Badge variant="secondary">
                      {count} use case{count !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
