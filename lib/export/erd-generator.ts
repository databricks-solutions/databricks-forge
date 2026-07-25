/**
 * ERD Graph Builder and Mermaid Renderer.
 *
 * Builds a unified entity-relationship graph from three sources:
 *   1. Explicit FKs (from information_schema) -- solid lines
 *   2. Implicit relationships (from LLM) -- dashed lines
 *   3. Lineage edges (from system.access.table_lineage) -- dotted lines
 *
 * Outputs:
 *   - ERDGraph JSON for the interactive React Flow viewer
 *   - Mermaid ERD syntax for schema relationships
 *   - Mermaid flowchart syntax for lineage data flows
 */

import type { ERDGraph, ERDNode, ERDEdge } from "@/lib/domain/types";
import { fromStoredLineageEntityType } from "@/lib/domain/lineage-entity-type";

// ---------------------------------------------------------------------------
// Types for scan data (Prisma models)
// ---------------------------------------------------------------------------

interface ScanData {
  details: Array<{
    tableFqn: string;
    catalog: string;
    schema: string;
    tableName: string;
    dataDomain: string | null;
    dataTier: string | null;
    sensitivityLevel: string | null;
    sizeInBytes: bigint | null;
    numRows: bigint | null;
    partitionColumns: string | null;
    clusteringColumns: string | null;
    columnsJson: string | null;
    comment: string | null;
    generatedDescription: string | null;
  }>;
  lineage: Array<{
    sourceTableFqn: string;
    targetTableFqn: string;
    sourceType: string | null;
    targetType: string | null;
    entityType: string | null;
    lastEventTime: string | null;
    eventCount: number;
  }>;
  insights: Array<{
    insightType: string;
    tableFqn: string | null;
    payloadJson: string;
  }>;
}

interface BuildOptions {
  includeFKs?: boolean;
  includeImplicit?: boolean;
  includeLineage?: boolean;
  domain?: string;
}

// ---------------------------------------------------------------------------
// Graph builder
// ---------------------------------------------------------------------------

/**
 * Build an ERDGraph from scan data.
 */
export function buildERDGraph(scan: ScanData, options: BuildOptions = {}): ERDGraph {
  const { includeFKs = true, includeImplicit = true, includeLineage = true, domain } = options;

  // Filter details by domain if specified
  let filteredDetails = scan.details;
  if (domain) {
    filteredDetails = filteredDetails.filter((d) => d.dataDomain === domain);
  }

  const tableFqnSet = new Set(filteredDetails.map((d) => d.tableFqn));

  // Build nodes
  const nodes: ERDNode[] = filteredDetails.map((d, idx) => {
    // Parse columns from JSON if available
    let columns: ERDNode["columns"] = [];
    if (d.columnsJson) {
      try {
        const parsed: Array<{
          name: string;
          type: string;
          nullable?: boolean;
          comment?: string | null;
        }> = JSON.parse(d.columnsJson);
        columns = parsed.map((c) => ({
          name: c.name,
          type: c.type,
          description: c.comment ?? null,
          isPK: false,
          isFK: false,
        }));
      } catch {
        /* malformed JSON — skip */
      }
    }

    return {
      tableFqn: d.tableFqn,
      displayName: d.tableName,
      description: d.generatedDescription || d.comment || null,
      columns,
      domain: d.dataDomain,
      tier: (d.dataTier as ERDNode["tier"]) ?? null,
      hasPII: d.sensitivityLevel === "confidential" || d.sensitivityLevel === "restricted",
      size: d.sizeInBytes != null ? Number(d.sizeInBytes) : null,
      rowCount: d.numRows != null ? Number(d.numRows) : null,
      x: (idx % 6) * 300,
      y: Math.floor(idx / 6) * 200,
    };
  });

  const edges: ERDEdge[] = [];
  let edgeId = 0;

  // Extract explicit FK relationships from insights
  if (includeFKs) {
    const fkInsights = scan.insights.filter((i) => i.insightType === "foreign_key");
    for (const insight of fkInsights) {
      try {
        const fk = JSON.parse(insight.payloadJson);
        const sourceFqn = fk.tableFqn ?? fk.sourceTableFqn;
        const targetFqn = fk.referencedTableFqn ?? fk.targetTableFqn;
        if (sourceFqn && targetFqn && tableFqnSet.has(sourceFqn) && tableFqnSet.has(targetFqn)) {
          // Mark columns as FK in nodes
          const sourceNode = nodes.find((n) => n.tableFqn === sourceFqn);
          if (sourceNode) {
            const col = sourceNode.columns.find((c) => c.name === fk.columnName);
            if (col) col.isFK = true;
          }
          const targetNode = nodes.find((n) => n.tableFqn === targetFqn);
          if (targetNode) {
            const col = targetNode.columns.find((c) => c.name === fk.referencedColumnName);
            if (col) col.isPK = true;
          }

          edges.push({
            id: `fk-${edgeId++}`,
            source: sourceFqn,
            target: targetFqn,
            edgeType: "fk",
            sourceColumn: fk.columnName,
            targetColumn: fk.referencedColumnName,
            label: `${fk.columnName} → ${fk.referencedColumnName}`,
          });
        }
      } catch {
        // Skip malformed FK insights
      }
    }
  }

  // Extract implicit relationships from insights
  if (includeImplicit) {
    const implicitInsights = scan.insights.filter((i) => i.insightType === "implicit_relationship");
    for (const insight of implicitInsights) {
      try {
        const rel = JSON.parse(insight.payloadJson);
        if (tableFqnSet.has(rel.sourceTableFqn) && tableFqnSet.has(rel.targetTableFqn)) {
          edges.push({
            id: `implicit-${edgeId++}`,
            source: rel.sourceTableFqn,
            target: rel.targetTableFqn,
            edgeType: "implicit",
            sourceColumn: rel.sourceColumn,
            targetColumn: rel.targetColumn,
            label: `${rel.sourceColumn} → ${rel.targetColumn}`,
            confidence: rel.confidence,
          });
        }
      } catch {
        // Skip malformed insights
      }
    }
  }

  // Add lineage edges
  if (includeLineage) {
    for (const edge of scan.lineage) {
      if (tableFqnSet.has(edge.sourceTableFqn) && tableFqnSet.has(edge.targetTableFqn)) {
        const entityType = fromStoredLineageEntityType(edge.entityType);
        edges.push({
          id: `lineage-${edgeId++}`,
          source: edge.sourceTableFqn,
          target: edge.targetTableFqn,
          edgeType: "lineage",
          label: entityType ?? "data flow",
          entityType: entityType ?? undefined,
        });
      }
    }
  }

  // Collect domains
  const domains = [
    ...new Set(filteredDetails.map((d) => d.dataDomain).filter(Boolean) as string[]),
  ];

  return {
    nodes,
    edges,
    domains,
    stats: {
      fkCount: edges.filter((e) => e.edgeType === "fk").length,
      implicitCount: edges.filter((e) => e.edgeType === "implicit").length,
      lineageCount: edges.filter((e) => e.edgeType === "lineage").length,
    },
  };
}

// ---------------------------------------------------------------------------
// Mermaid ERD renderer
// ---------------------------------------------------------------------------

/**
 * Generate Mermaid ERD syntax for schema relationships.
 * FKs use solid lines, implicit use dotted lines.
 */
export function generateMermaidERD(graph: ERDGraph): string {
  const schemaEdges = graph.edges.filter((e) => e.edgeType === "fk" || e.edgeType === "implicit");

  if (graph.nodes.length === 0) return "erDiagram\n  %% No tables found";

  const lines: string[] = ["erDiagram"];

  // Add table entities
  for (const node of graph.nodes) {
    const safeName = sanitizeMermaidId(node.tableFqn);
    lines.push(`    ${safeName} {`);
    if (node.columns.length > 0) {
      for (const col of node.columns.slice(0, 10)) {
        const pkLabel = col.isPK ? " PK" : col.isFK ? " FK" : "";
        lines.push(`        ${col.type} ${col.name}${pkLabel}`);
      }
      if (node.columns.length > 10) {
        lines.push(`        string _and_${node.columns.length - 10}_more`);
      }
    }
    lines.push("    }");
  }

  // Add relationships
  for (const edge of schemaEdges) {
    const source = sanitizeMermaidId(edge.source);
    const target = sanitizeMermaidId(edge.target);
    const label = edge.label || "";

    if (edge.edgeType === "fk") {
      lines.push(`    ${source} ||--o{ ${target} : "${label}"`);
    } else {
      // implicit: dotted
      lines.push(`    ${source} }o..o{ ${target} : "${label} (${edge.confidence ?? "inferred"})"`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Mermaid lineage flowchart renderer
// ---------------------------------------------------------------------------

/**
 * Generate Mermaid flowchart showing lineage data flows.
 */
export function generateMermaidLineageFlow(graph: ERDGraph): string {
  const lineageEdges = graph.edges.filter((e) => e.edgeType === "lineage");

  if (lineageEdges.length === 0) return "flowchart LR\n  %% No lineage edges found";

  const lines: string[] = ["flowchart LR"];

  // Collect unique tables referenced in lineage
  const tableSet = new Set<string>();
  for (const edge of lineageEdges) {
    tableSet.add(edge.source);
    tableSet.add(edge.target);
  }

  // Add node definitions with short names
  for (const fqn of tableSet) {
    const id = sanitizeMermaidId(fqn);
    const shortName = fqn.split(".").pop() ?? fqn;
    const node = graph.nodes.find((n) => n.tableFqn === fqn);
    const tierLabel = node?.tier ? ` [${node.tier}]` : "";
    lines.push(`    ${id}["${shortName}${tierLabel}"]`);
  }

  // Add edges
  for (const edge of lineageEdges) {
    const source = sanitizeMermaidId(edge.source);
    const target = sanitizeMermaidId(edge.target);
    const label = edge.entityType ?? "flow";
    lines.push(`    ${source} -.->|"${label}"| ${target}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize a table FQN for use as a Mermaid node ID.
 * Mermaid IDs cannot contain dots or special characters.
 */
function sanitizeMermaidId(fqn: string): string {
  return fqn.replace(/[^a-zA-Z0-9_]/g, "_");
}
