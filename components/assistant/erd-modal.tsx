"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Loader2, Network, Minus, Plus, Maximize2 } from "lucide-react";
import type { ERDGraph, ERDEdge } from "@/lib/domain/types";

interface ErdModalProps {
  tableFqns: string[];
  onClose: () => void;
}

function filterGraphByHops(fullGraph: ERDGraph, seedFqns: string[], hops: number): ERDGraph {
  const nodeLookup = new Map<string, string>();
  for (const n of fullGraph.nodes) nodeLookup.set(n.tableFqn.toLowerCase(), n.tableFqn);

  const relevant = new Set<string>();
  for (const fqn of seedFqns) {
    const canonical = nodeLookup.get(fqn.toLowerCase());
    if (canonical) relevant.add(canonical);
  }

  for (let hop = 0; hop < hops; hop++) {
    const frontier = new Set<string>();
    for (const edge of fullGraph.edges) {
      if (relevant.has(edge.source) && !relevant.has(edge.target)) {
        frontier.add(edge.target);
      }
      if (relevant.has(edge.target) && !relevant.has(edge.source)) {
        frontier.add(edge.source);
      }
    }
    for (const fqn of frontier) relevant.add(fqn);
  }

  const filteredEdges: ERDEdge[] = fullGraph.edges.filter(
    (e) => relevant.has(e.source) && relevant.has(e.target),
  );

  return {
    nodes: fullGraph.nodes.filter((n) => relevant.has(n.tableFqn)),
    edges: filteredEdges,
    domains: [
      ...new Set(
        fullGraph.nodes.filter((n) => relevant.has(n.tableFqn) && n.domain).map((n) => n.domain!),
      ),
    ],
    stats: {
      fkCount: filteredEdges.filter((e) => e.edgeType === "fk").length,
      implicitCount: filteredEdges.filter((e) => e.edgeType === "implicit").length,
      lineageCount: filteredEdges.filter((e) => e.edgeType === "lineage").length,
    },
  };
}

export function ErdModal({ tableFqns, onClose }: ErdModalProps) {
  const router = useRouter();
  const [fullGraph, setFullGraph] = React.useState<ERDGraph | null>(null);
  const [graph, setGraph] = React.useState<ERDGraph | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [hopDepth, setHopDepth] = React.useState(0);
  const [ERDViewer, setERDViewer] = React.useState<React.ComponentType<{ graph: ERDGraph }> | null>(
    null,
  );

  React.useEffect(() => {
    import("@/components/environment/erd-viewer").then((m) => setERDViewer(() => m.ERDViewer));
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    async function fetchERD() {
      try {
        const resp = await fetch("/api/environment/aggregate/erd?format=json&includeLineage=true");
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data: ERDGraph = await resp.json();
        if (!cancelled) {
          setFullGraph(data);
          setGraph(filterGraphByHops(data, tableFqns, 0));
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load ERD");
          setLoading(false);
        }
      }
    }

    fetchERD();
    return () => {
      cancelled = true;
    };
  }, [tableFqns]);

  React.useEffect(() => {
    if (fullGraph) {
      setGraph(filterGraphByHops(fullGraph, tableFqns, hopDepth));
    }
  }, [hopDepth, fullGraph, tableFqns]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const maxHops = 3;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-7xl flex-col rounded-xl border bg-background shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Network className="size-5 text-primary" />
            <h2 className="text-base font-semibold">Entity Relationship Diagram</h2>
            {graph && (
              <span className="text-sm text-muted-foreground">
                {graph.nodes.length} tables, {graph.edges.length} relationships
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Hop depth controls */}
            {!loading && !error && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Lineage depth</span>
                <div className="flex items-center gap-0.5 rounded-md border bg-muted/30 p-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    disabled={hopDepth <= 0}
                    onClick={() => setHopDepth((d) => Math.max(0, d - 1))}
                  >
                    <Minus className="size-3" />
                  </Button>
                  <Badge variant="secondary" className="min-w-[2rem] justify-center text-[10px]">
                    {hopDepth === 0 ? "Seed only" : `${hopDepth} hop${hopDepth > 1 ? "s" : ""}`}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    disabled={hopDepth >= maxHops}
                    onClick={() => setHopDepth((d) => Math.min(maxHops, d + 1))}
                  >
                    <Plus className="size-3" />
                  </Button>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs text-muted-foreground"
                  onClick={() => {
                    router.push("/environment?tab=erd");
                    onClose();
                  }}
                >
                  <Maximize2 className="size-3" />
                  Full ERD
                </Button>
              </div>
            )}

            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-[500px] flex-1 overflow-hidden">
          {loading && (
            <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              <span>Loading ERD...</span>
            </div>
          )}

          {error && (
            <div className="flex h-full items-center justify-center text-sm text-destructive">
              {error}
            </div>
          )}

          {!loading && !error && graph && graph.nodes.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <Network className="size-8 text-muted-foreground/30" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">
                  {fullGraph && fullGraph.nodes.length === 0
                    ? "No estate scan data available"
                    : "Referenced tables not found in estate scan data"}
                </p>
                <p className="max-w-sm text-xs text-muted-foreground/70">
                  {fullGraph && fullGraph.nodes.length === 0
                    ? "Run an estate scan from the Environment page to generate ERD data for your schemas."
                    : "The referenced tables were not included in any estate scan. Run a scan covering these schemas, or increase the lineage depth above."}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-1 gap-1.5 text-xs"
                onClick={() => {
                  router.push("/environment?tab=erd");
                  onClose();
                }}
              >
                <Maximize2 className="size-3" />
                Go to Environment
              </Button>
            </div>
          )}

          {!loading && !error && graph && graph.nodes.length > 0 && ERDViewer && (
            <ERDViewer graph={graph} />
          )}

          {!loading && !error && graph && graph.nodes.length > 0 && !ERDViewer && (
            <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              <span>Loading viewer...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
