"use client";

/**
 * Semantic overlap section for the compare page.
 *
 * Fetches /api/runs/compare/semantic and displays use case pairs
 * categorised by embedding similarity.
 */

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, ArrowRight, Loader2 } from "lucide-react";

interface OverlapPair {
  useCaseA: { id: string; name: string };
  useCaseB: { id: string; name: string } | null;
  similarity: number;
  category: "near-duplicate" | "related" | "unique";
}

interface SemanticOverlapProps {
  runA: string;
  runB: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  "near-duplicate": "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  related: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  unique: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

export function SemanticOverlap({ runA, runB }: SemanticOverlapProps) {
  const [pairs, setPairs] = React.useState<OverlapPair[]>([]);
  const [stats, setStats] = React.useState<{
    nearDuplicate: number;
    related: number;
    unique: number;
  } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [enabled, setEnabled] = React.useState(true);
  const [filter, setFilter] = React.useState<string>("all");

  React.useEffect(() => {
    if (!runA || !runB) return;

    setLoading(true);
    fetch(`/api/runs/compare/semantic?runA=${runA}&runB=${runB}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.enabled === false) {
          setEnabled(false);
          return;
        }
        setPairs(data.pairs ?? []);
        setStats(data.stats ?? null);
      })
      .catch(() => setEnabled(false))
      .finally(() => setLoading(false));
  }, [runA, runB]);

  if (!enabled) return null;

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-purple-500" />
            Semantic Overlap
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Analyzing use case similarity...
          </div>
          <div className="mt-3 space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (pairs.length === 0) return null;

  const filtered = filter === "all" ? pairs : pairs.filter((p) => p.category === filter);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-purple-500" />
            Semantic Overlap
          </CardTitle>
          {stats && (
            <div className="flex gap-2">
              <button onClick={() => setFilter("all")}>
                <Badge
                  variant={filter === "all" ? "default" : "outline"}
                  className="cursor-pointer text-[10px]"
                >
                  All ({pairs.length})
                </Badge>
              </button>
              <button onClick={() => setFilter("near-duplicate")}>
                <Badge
                  variant={filter === "near-duplicate" ? "default" : "outline"}
                  className="cursor-pointer text-[10px]"
                >
                  Near-duplicate ({stats.nearDuplicate})
                </Badge>
              </button>
              <button onClick={() => setFilter("related")}>
                <Badge
                  variant={filter === "related" ? "default" : "outline"}
                  className="cursor-pointer text-[10px]"
                >
                  Related ({stats.related})
                </Badge>
              </button>
              <button onClick={() => setFilter("unique")}>
                <Badge
                  variant={filter === "unique" ? "default" : "outline"}
                  className="cursor-pointer text-[10px]"
                >
                  Unique ({stats.unique})
                </Badge>
              </button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {filtered.map((pair, i) => (
            <div key={i} className="flex items-center gap-2 rounded-md border p-2 text-xs">
              <Badge className={`shrink-0 text-[9px] ${CATEGORY_COLORS[pair.category] ?? ""}`}>
                {pair.category}
              </Badge>
              <span className="min-w-0 flex-1 truncate">{pair.useCaseA.name}</span>
              <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {pair.useCaseB?.name ?? "—"}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {(pair.similarity * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
