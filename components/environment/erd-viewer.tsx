"use client";

/**
 * Interactive ERD Viewer using React Flow (@xyflow/react).
 *
 * Renders tables as nodes with domain/tier badges, and three types of edges:
 *   - Solid blue: explicit FKs
 *   - Dashed orange: LLM-discovered implicit relationships
 *   - Dotted grey: lineage data flows
 *
 * Auto-layout via dagre, with drag-and-drop override.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  type Node,
  type Edge,
  type NodeTypes,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  MarkerType,
  BackgroundVariant,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { ERDGraph } from "@/lib/domain/types";

// Helpers for compact display in ERD nodes
function humanizeCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function humanizeBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// Table node component
// ---------------------------------------------------------------------------

interface TableNodeData {
  label: string;
  tableFqn: string;
  description: string | null;
  domain: string | null;
  tier: string | null;
  hasPII: boolean;
  columnCount: number;
  rowCount: number | null;
  size: number | null;
  columns: Array<{
    name: string;
    type: string;
    description: string | null;
    isPK: boolean;
    isFK: boolean;
  }>;
  expanded: boolean;
  onToggle: () => void;
  [key: string]: unknown;
}

function TableNode({ data }: { data: TableNodeData }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative rounded-lg border bg-card text-card-foreground shadow-sm min-w-[200px] max-w-[300px]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Handle type="target" position={Position.Left} className="!bg-blue-500" />
      <Handle type="source" position={Position.Right} className="!bg-blue-500" />

      <div
        className="px-3 py-2 border-b cursor-pointer flex items-center gap-2 flex-wrap"
        onClick={data.onToggle}
      >
        <span className="font-semibold text-sm truncate flex-1">{data.label}</span>
        {data.domain && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {data.domain}
          </Badge>
        )}
        {data.tier && (
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 ${
              data.tier === "gold"
                ? "border-yellow-500 text-yellow-700"
                : data.tier === "silver"
                  ? "border-gray-400 text-gray-600"
                  : data.tier === "bronze"
                    ? "border-orange-500 text-orange-700"
                    : "border-blue-400 text-blue-600"
            }`}
          >
            {data.tier}
          </Badge>
        )}
        {data.hasPII && (
          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
            PII
          </Badge>
        )}
      </div>

      {data.expanded ? (
        <div className="px-3 py-2 text-xs space-y-0.5 max-h-[280px] overflow-y-auto">
          {data.columns.slice(0, 20).map((col) => (
            <div key={col.name} className="text-muted-foreground">
              <div className="flex items-center gap-1">
                {col.isPK && <span className="text-yellow-600 font-bold">PK</span>}
                {col.isFK && <span className="text-blue-600 font-bold">FK</span>}
                <span className="truncate">{col.name}</span>
                <span className="ml-auto text-[10px] opacity-60 shrink-0">{col.type}</span>
              </div>
              {col.description && (
                <p className="pl-4 text-[10px] opacity-50 truncate">{col.description}</p>
              )}
            </div>
          ))}
          {data.columns.length > 20 && (
            <div className="text-muted-foreground opacity-60">+{data.columns.length - 20} more</div>
          )}
        </div>
      ) : (
        <div className="px-3 py-1.5 text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
          <span>{data.columnCount} cols</span>
          {data.rowCount != null && data.rowCount > 0 && (
            <span className="tabular-nums">{humanizeCount(data.rowCount)} rows</span>
          )}
          {data.size != null && data.size > 0 && (
            <span className="tabular-nums">{humanizeBytes(data.size)}</span>
          )}
        </div>
      )}

      {/* Hover tooltip: columns first, then truncated description */}
      {hovered && !data.expanded && (data.description || data.columns.length > 0) && (
        <div className="absolute z-50 left-full top-0 ml-2 w-[320px] max-h-[400px] overflow-y-auto rounded-lg border bg-popover text-popover-foreground shadow-lg p-3 text-xs">
          {/* FQN */}
          <p className="font-mono text-[10px] text-muted-foreground mb-1 break-all">
            {data.tableFqn}
          </p>

          {/* Stats row */}
          <div className="flex items-center gap-3 text-muted-foreground mb-2 flex-wrap">
            <span>{data.columnCount} columns</span>
            {data.rowCount != null && data.rowCount > 0 && (
              <span>{humanizeCount(data.rowCount)} rows</span>
            )}
            {data.size != null && data.size > 0 && <span>{humanizeBytes(data.size)}</span>}
          </div>

          {/* Column list (shown first so it's always visible) */}
          {data.columns.length > 0 && (
            <div className="border-t pt-2 space-y-1">
              {data.columns.slice(0, 30).map((col) => (
                <div key={col.name} className="py-0.5">
                  <div className="flex items-center gap-1">
                    {col.isPK && <span className="text-yellow-600 font-bold text-[10px]">PK</span>}
                    {col.isFK && <span className="text-blue-600 font-bold text-[10px]">FK</span>}
                    <span className="font-mono text-foreground truncate">{col.name}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground/70 shrink-0">
                      {col.type}
                    </span>
                  </div>
                  {col.description && (
                    <p className="pl-4 text-[10px] text-muted-foreground/60 leading-snug">
                      {col.description}
                    </p>
                  )}
                </div>
              ))}
              {data.columns.length > 30 && (
                <p className="text-muted-foreground/60 pt-1">
                  +{data.columns.length - 30} more columns
                </p>
              )}
            </div>
          )}

          {/* Description (truncated, shown after columns) */}
          {data.description && (
            <p className="border-t mt-2 pt-2 text-[11px] text-muted-foreground leading-relaxed">
              {data.description.length > 200
                ? data.description.slice(0, 200) + "\u2026"
                : data.description}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: "LR" | "TB" = "LR",
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 80, ranksep: 150 });

  for (const node of nodes) {
    g.setNode(node.id, { width: 250, height: 120 });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: { x: pos.x - 125, y: pos.y - 60 },
    };
  });

  return { nodes: layoutedNodes, edges };
}

// ---------------------------------------------------------------------------
// Edge styling
// ---------------------------------------------------------------------------

function edgeTypeToStyle(edgeType: string): Partial<Edge> {
  switch (edgeType) {
    case "fk":
      return {
        style: { stroke: "#3b82f6", strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#3b82f6" },
        animated: false,
      };
    case "implicit":
      return {
        style: { stroke: "#f97316", strokeWidth: 2, strokeDasharray: "8,4" },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#f97316" },
        animated: false,
      };
    case "lineage":
      return {
        style: { stroke: "#9ca3af", strokeWidth: 1.5, strokeDasharray: "4,4" },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#9ca3af" },
        animated: true,
      };
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ERDViewerProps {
  graph: ERDGraph;
}

export function ERDViewer({ graph }: ERDViewerProps) {
  const [showFK, setShowFK] = useState(true);
  const [showImplicit, setShowImplicit] = useState(true);
  const [showLineage, setShowLineage] = useState(true);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [domainFilter, setDomainFilter] = useState<string | null>(null);

  const toggleNode = useCallback((id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Build React Flow nodes from ERDGraph
  const rfNodes = useMemo<Node[]>(() => {
    let filtered = graph.nodes;
    if (domainFilter) {
      filtered = filtered.filter((n) => n.domain === domainFilter);
    }

    return filtered.map((n) => ({
      id: n.tableFqn,
      type: "tableNode",
      position: { x: n.x, y: n.y },
      data: {
        label: n.displayName,
        tableFqn: n.tableFqn,
        description: n.description,
        domain: n.domain,
        tier: n.tier,
        hasPII: n.hasPII,
        columnCount: n.columns.length,
        rowCount: n.rowCount,
        size: n.size,
        columns: n.columns,
        expanded: expandedNodes.has(n.tableFqn),
        onToggle: () => toggleNode(n.tableFqn),
      } satisfies TableNodeData,
    }));
  }, [graph.nodes, expandedNodes, domainFilter, toggleNode]);

  // Build React Flow edges from ERDGraph
  const rfEdges = useMemo<Edge[]>(() => {
    const nodeIds = new Set(rfNodes.map((n) => n.id));
    return graph.edges
      .filter((e) => {
        if (e.edgeType === "fk" && !showFK) return false;
        if (e.edgeType === "implicit" && !showImplicit) return false;
        if (e.edgeType === "lineage" && !showLineage) return false;
        return nodeIds.has(e.source) && nodeIds.has(e.target);
      })
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        labelStyle: { fontSize: 10 },
        ...edgeTypeToStyle(e.edgeType),
      }));
  }, [graph.edges, showFK, showImplicit, showLineage, rfNodes]);

  // Apply auto-layout
  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(
    () => getLayoutedElements(rfNodes, rfEdges),
    [rfNodes, rfEdges],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  useEffect(() => {
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges]);

  const nodeTypes: NodeTypes = useMemo(() => ({ tableNode: TableNode }), []);

  const handleCopyMermaid = useCallback(async () => {
    try {
      const resp = await fetch(
        `/api/environment-scan/${encodeURIComponent("")}/erd?format=mermaid`,
      );
      const data = await resp.json();
      await navigator.clipboard.writeText(data.erd + "\n\n" + data.lineage);
    } catch {
      // Silently fail
    }
  }, []);

  return (
    <div className="flex flex-col h-[700px]">
      {/* Controls bar */}
      <div className="flex items-center gap-4 p-3 border-b bg-muted/50 flex-wrap">
        <div className="flex items-center gap-2">
          <Checkbox id="showFK" checked={showFK} onCheckedChange={(v) => setShowFK(!!v)} />
          <Label htmlFor="showFK" className="text-sm">
            <span className="inline-block w-4 h-0.5 bg-blue-500 mr-1 align-middle" /> FKs (
            {graph.stats.fkCount})
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="showImplicit"
            checked={showImplicit}
            onCheckedChange={(v) => setShowImplicit(!!v)}
          />
          <Label htmlFor="showImplicit" className="text-sm">
            <span className="inline-block w-4 h-0.5 border-t-2 border-orange-500 border-dashed mr-1 align-middle" />{" "}
            Implicit ({graph.stats.implicitCount})
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="showLineage"
            checked={showLineage}
            onCheckedChange={(v) => setShowLineage(!!v)}
          />
          <Label htmlFor="showLineage" className="text-sm">
            <span className="inline-block w-4 h-0.5 border-t-2 border-gray-400 border-dotted mr-1 align-middle" />{" "}
            Lineage ({graph.stats.lineageCount})
          </Label>
        </div>

        {graph.domains.length > 0 && (
          <select
            className="text-sm border rounded px-2 py-1"
            value={domainFilter ?? ""}
            onChange={(e) => setDomainFilter(e.target.value || null)}
          >
            <option value="">All domains</option>
            {graph.domains.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}

        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCopyMermaid}>
            Copy Mermaid
          </Button>
        </div>
      </div>

      {/* React Flow canvas */}
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.1}
          maxZoom={2}
          defaultEdgeOptions={{ type: "smoothstep" }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls />
          <MiniMap nodeStrokeWidth={3} zoomable pannable />
        </ReactFlow>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 p-2 border-t text-xs text-muted-foreground">
        <span>{graph.nodes.length} tables</span>
        <span>{graph.edges.length} relationships</span>
        <span>{graph.domains.length} domains</span>
      </div>
    </div>
  );
}
