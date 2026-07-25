/**
 * Estate scan embedding orchestrator.
 *
 * Called after a standalone scan completes to embed all estate data:
 * table details, column profiles, environment insights, table health,
 * lineage context, and data products.
 *
 * Embedding is best-effort — failures are logged but do not fail the scan.
 */

import { generateEmbeddings } from "./client";
import { insertEmbeddings, deleteEmbeddingsByScan } from "./store";
import {
  composeTableDetail,
  tableDetailMetadata,
  composeColumnProfile,
  composeEnvironmentInsight,
  composeTableHealth,
  composeLineageContext,
} from "./compose";
import type { EmbeddingInput } from "./types";
import { isEmbeddingEnabled } from "./config";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types (loose, to avoid tight coupling to Prisma)
// ---------------------------------------------------------------------------

interface TableDetailLike {
  /** Prisma uses tableFqn, domain type uses fqn */
  tableFqn?: string;
  fqn?: string;
  catalog: string;
  schema: string;
  tableName: string;
  tableType?: string | null;
  comment?: string | null;
  generatedDescription?: string | null;
  format?: string | null;
  owner?: string | null;
  dataDomain?: string | null;
  dataSubdomain?: string | null;
  dataTier?: string | null;
  sensitivityLevel?: string | null;
  partitionColumns?: string | string[] | null;
  clusteringColumns?: string | string[] | null;
  columnsJson?: string | null;
  tagsJson?: string | null;
  sizeInBytes?: bigint | number | null;
  numRows?: bigint | number | null;
}

interface HistoryHealthLike {
  tableFqn: string;
  healthScore?: number | null;
  issuesJson?: string | null;
  recommendationsJson?: string | null;
  totalWriteOps?: number;
  totalOptimizeOps?: number;
  totalVacuumOps?: number;
  hasStreamingWrites?: boolean;
}

interface LineageEdgeLike {
  sourceTableFqn: string;
  targetTableFqn: string;
  sourceType?: string | null;
  targetType?: string | null;
  entityType?: string | null;
  eventCount?: number;
}

interface InsightLike {
  insightType: string;
  tableFqn?: string | null;
  payloadJson: string;
}

interface ColumnLike {
  tableFqn: string;
  columnName: string;
  dataType: string;
  comment?: string | null;
  isNullable?: boolean;
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Embed all estate scan results. Call after saveEnvironmentScan().
 * Deletes existing embeddings for the scan first, then inserts fresh ones.
 */
export async function embedScanResults(
  scanId: string,
  details: TableDetailLike[],
  histories: HistoryHealthLike[],
  lineageEdges: LineageEdgeLike[],
  insights: InsightLike[],
  columns: ColumnLike[],
): Promise<void> {
  if (!isEmbeddingEnabled()) {
    logger.debug("[embed-estate] Embedding disabled, skipping scan embedding");
    return;
  }

  const startTime = Date.now();

  try {
    await deleteEmbeddingsByScan(scanId);

    const inputs: EmbeddingInput[] = [];
    const texts: string[] = [];

    // 1. Table details
    for (const t of details) {
      const fqn = t.tableFqn || t.fqn || `${t.catalog}.${t.schema}.${t.tableName}`;
      const input = { ...t, tableFqn: fqn };
      const text = composeTableDetail(input);
      texts.push(text);
      inputs.push({
        kind: "table_detail",
        sourceId: fqn,
        scanId,
        contentText: text,
        metadataJson: tableDetailMetadata(input),
        embedding: [], // filled after batch embedding
      });
    }

    // 2. Table health (from histories)
    for (const h of histories) {
      if (h.healthScore == null) continue;
      const text = composeTableHealth(h);
      texts.push(text);
      inputs.push({
        kind: "table_health",
        sourceId: h.tableFqn,
        scanId,
        contentText: text,
        metadataJson: { tableFqn: h.tableFqn },
        embedding: [],
      });
    }

    // 3. Environment insights (PII, redundancy, governance, relationships, data products)
    for (const ins of insights) {
      if (ins.insightType === "foreign_key") continue; // structural, not semantic
      const kind =
        ins.insightType === "data_product"
          ? ("data_product" as const)
          : ("environment_insight" as const);
      const text = composeEnvironmentInsight(ins);
      texts.push(text);
      inputs.push({
        kind,
        sourceId: `${scanId}:${ins.insightType}:${ins.tableFqn || "global"}`,
        scanId,
        contentText: text,
        metadataJson: {
          insightType: ins.insightType,
          tableFqn: ins.tableFqn,
        },
        embedding: [],
      });
    }

    // 4. Lineage context
    for (const edge of lineageEdges) {
      const text = composeLineageContext(edge);
      texts.push(text);
      inputs.push({
        kind: "lineage_context",
        sourceId: `${edge.sourceTableFqn}→${edge.targetTableFqn}`,
        scanId,
        contentText: text,
        metadataJson: {
          source: edge.sourceTableFqn,
          target: edge.targetTableFqn,
        },
        embedding: [],
      });
    }

    // 5. Column profiles (batch per table to keep volume manageable)
    const colsByTable = new Map<string, ColumnLike[]>();
    for (const col of columns) {
      const arr = colsByTable.get(col.tableFqn) ?? [];
      arr.push(col);
      colsByTable.set(col.tableFqn, arr);
    }
    for (const [tableFqn, tableCols] of colsByTable) {
      const colText = tableCols
        .map((c) =>
          composeColumnProfile(tableFqn, {
            tableFqn,
            name: c.columnName,
            dataType: c.dataType,
            comment: c.comment,
            nullable: c.isNullable,
          }),
        )
        .join("\n");
      texts.push(colText);
      inputs.push({
        kind: "column_profile",
        sourceId: tableFqn,
        scanId,
        contentText: colText,
        metadataJson: { tableFqn, columnCount: tableCols.length },
        embedding: [],
      });
    }

    if (texts.length === 0) {
      logger.info("[embed-estate] No content to embed", { scanId });
      return;
    }

    // Generate all embeddings in batches
    const embeddings = await generateEmbeddings(texts);

    for (let i = 0; i < inputs.length; i++) {
      inputs[i].embedding = embeddings[i];
    }

    await insertEmbeddings(inputs);

    logger.info("[embed-estate] Scan embedding complete", {
      scanId,
      totalRecords: inputs.length,
      durationMs: Date.now() - startTime,
    });
  } catch (err) {
    logger.warn("[embed-estate] Embedding failed (non-fatal)", {
      scanId,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    });
  }
}
