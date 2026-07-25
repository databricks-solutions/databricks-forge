/**
 * API: /api/embeddings/backfill
 *
 * POST -- Generate embeddings for all existing data.
 *
 * Used after enabling the embedding endpoint on a deployment that
 * already has scans, runs, Genie recommendations, outcome maps,
 * or uploaded documents.  Re-embeds everything from scratch.
 *
 * This is a long-running request (minutes on large estates).
 * The response streams progress as JSON objects.
 */

import { NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { isEmbeddingEnabled } from "@/lib/embeddings/config";
import { apiLogger } from "@/lib/logger";

export async function POST() {
  const log = apiLogger("/api/embeddings/backfill", "POST");

  if (!isEmbeddingEnabled()) {
    return NextResponse.json(
      {
        error: "Embedding endpoint not configured (serving-endpoint-embedding resource not bound)",
      },
      { status: 503 },
    );
  }

  const results = {
    scans: { total: 0, embedded: 0, failed: 0 },
    runs: { total: 0, embedded: 0, failed: 0 },
    genieRecs: { total: 0, embedded: 0, failed: 0 },
    outcomeMaps: { total: 0, embedded: 0, failed: 0 },
    documents: { total: 0, embedded: 0, failed: 0 },
    benchmarks: { total: 0, embedded: 0, failed: 0 },
    fabricScans: { total: 0, embedded: 0, failed: 0 },
  };

  try {
    // Ensure pgvector schema exists
    await ensurePgvectorSchema();

    // 1. Embed all environment scans
    await backfillScans(results, log);

    // 2. Embed all pipeline runs (use cases + business context)
    await backfillRuns(results, log);

    // 3. Embed all Genie recommendations
    await backfillGenieRecs(results, log);

    // 4. Embed all outcome maps
    await backfillOutcomeMaps(results, log);

    // 5. Re-embed all uploaded documents
    await backfillDocuments(results, log);

    // 6. Embed benchmark context records
    await backfillBenchmarks(results, log);

    // 7. Embed Fabric/Power BI scans
    await backfillFabricScans(results, log);

    log.info("Embedding backfill complete", results);
    return NextResponse.json({ success: true, results });
  } catch (error) {
    log.error("Backfill failed", {
      error: error instanceof Error ? error.message : String(error),
      results,
      errorCategory: "internal_error",
    });
    return NextResponse.json(
      { error: safeErrorMessage(error), partialResults: results },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// pgvector schema bootstrap
// ---------------------------------------------------------------------------

async function ensurePgvectorSchema(): Promise<void> {
  const { ensureEmbeddingSchema } = await import("@/lib/embeddings/schema");
  await ensureEmbeddingSchema();
}

// ---------------------------------------------------------------------------
// Backfill: Environment Scans
// ---------------------------------------------------------------------------

async function backfillScans(
  results: { scans: { total: number; embedded: number; failed: number } },
  log: ReturnType<typeof apiLogger>,
): Promise<void> {
  const { listEnvironmentScans, getEnvironmentScan } =
    await import("@/lib/lakebase/environment-scans");
  const { embedScanResults } = await import("@/lib/embeddings/embed-estate");

  const scans = await listEnvironmentScans(500, 0);
  results.scans.total = scans.length;

  for (const scan of scans) {
    try {
      const full = await getEnvironmentScan(scan.scanId);
      if (!full) continue;

      const columns = extractColumnsFromDetails(full.details);

      await embedScanResults(
        scan.scanId,
        full.details,
        full.histories,
        full.lineage,
        full.insights,
        columns,
      );
      results.scans.embedded++;
      log.debug("Scan embedded", { scanId: scan.scanId });
    } catch (err) {
      results.scans.failed++;
      log.warn("Scan embedding failed", {
        scanId: scan.scanId,
        error: err instanceof Error ? err.message : String(err),
        errorCategory: "embedding_failed",
      });
    }
  }
}

interface ColumnFromJson {
  name?: string;
  data_type?: string;
  comment?: string;
  is_nullable?: boolean;
}

function extractColumnsFromDetails(
  details: Array<{ tableFqn: string; columnsJson?: string | null }>,
): Array<{
  tableFqn: string;
  columnName: string;
  dataType: string;
  comment?: string;
  isNullable?: boolean;
}> {
  const columns: Array<{
    tableFqn: string;
    columnName: string;
    dataType: string;
    comment?: string;
    isNullable?: boolean;
  }> = [];

  for (const d of details) {
    if (!d.columnsJson) continue;
    try {
      const parsed: ColumnFromJson[] = JSON.parse(d.columnsJson);
      for (const col of parsed) {
        if (!col.name) continue;
        columns.push({
          tableFqn: d.tableFqn,
          columnName: col.name,
          dataType: col.data_type ?? "STRING",
          comment: col.comment ?? undefined,
          isNullable: col.is_nullable,
        });
      }
    } catch {
      // malformed JSON
    }
  }

  return columns;
}

// ---------------------------------------------------------------------------
// Backfill: Pipeline Runs
// ---------------------------------------------------------------------------

async function backfillRuns(
  results: { runs: { total: number; embedded: number; failed: number } },
  log: ReturnType<typeof apiLogger>,
): Promise<void> {
  const { listRuns, getRunById } = await import("@/lib/lakebase/runs");
  const { getUseCasesByRunId } = await import("@/lib/lakebase/usecases");
  const { embedRunResults } = await import("@/lib/embeddings/embed-pipeline");

  const runs = await listRuns(500, 0);
  const completedRuns = runs.filter((r) => r.status === "completed");
  results.runs.total = completedRuns.length;

  for (const run of completedRuns) {
    try {
      const full = await getRunById(run.runId);
      if (!full) continue;

      const useCases = await getUseCasesByRunId(run.runId);
      const bcJson = full.businessContext ? JSON.stringify(full.businessContext) : null;

      await embedRunResults(run.runId, useCases, bcJson, full.config.businessName);
      results.runs.embedded++;
      log.debug("Run embedded", { runId: run.runId });
    } catch (err) {
      results.runs.failed++;
      log.warn("Run embedding failed", {
        runId: run.runId,
        error: err instanceof Error ? err.message : String(err),
        errorCategory: "embedding_failed",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Backfill: Genie Recommendations
// ---------------------------------------------------------------------------

async function backfillGenieRecs(
  results: { genieRecs: { total: number; embedded: number; failed: number } },
  log: ReturnType<typeof apiLogger>,
): Promise<void> {
  const { listRuns } = await import("@/lib/lakebase/runs");
  const { getGenieRecommendationsByRunId } = await import("@/lib/lakebase/genie-recommendations");
  const { embedGenieRecommendations } = await import("@/lib/embeddings/embed-pipeline");

  const runs = await listRuns(500, 0);
  const completedRuns = runs.filter((r) => r.status === "completed");

  for (const run of completedRuns) {
    try {
      const recs = await getGenieRecommendationsByRunId(run.runId);
      if (recs.length === 0) continue;

      results.genieRecs.total += recs.length;

      await embedGenieRecommendations(run.runId, recs);
      results.genieRecs.embedded += recs.length;
      log.debug("Genie recs embedded", { runId: run.runId, count: recs.length });
    } catch (err) {
      results.genieRecs.failed++;
      log.warn("Genie recs embedding failed", {
        runId: run.runId,
        error: err instanceof Error ? err.message : String(err),
        errorCategory: "embedding_failed",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Backfill: Outcome Maps
// ---------------------------------------------------------------------------

async function backfillOutcomeMaps(
  results: { outcomeMaps: { total: number; embedded: number; failed: number } },
  log: ReturnType<typeof apiLogger>,
): Promise<void> {
  const { listOutcomeMaps, getOutcomeMap } = await import("@/lib/lakebase/outcome-maps");
  const { embedOutcomeMap } = await import("@/lib/embeddings/embed-pipeline");

  const maps = await listOutcomeMaps();
  results.outcomeMaps.total = maps.length;

  for (const summary of maps) {
    try {
      const full = await getOutcomeMap(summary.id);
      if (!full || !full.parsedOutcome) continue;

      await embedOutcomeMap({ ...full.parsedOutcome, id: full.id });
      results.outcomeMaps.embedded++;
    } catch (err) {
      results.outcomeMaps.failed++;
      log.warn("Outcome map embedding failed", {
        id: summary.id,
        error: err instanceof Error ? err.message : String(err),
        errorCategory: "embedding_failed",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Backfill: Documents
// ---------------------------------------------------------------------------

async function backfillDocuments(
  results: { documents: { total: number; embedded: number; failed: number } },
  log: ReturnType<typeof apiLogger>,
): Promise<void> {
  const { listDocuments } = await import("@/lib/lakebase/documents");
  const { countEmbeddings } = await import("@/lib/embeddings/store");

  const docs = await listDocuments();
  results.documents.total = docs.length;

  for (const doc of docs) {
    try {
      if (doc.status !== "ready") continue;

      const existingCount = await countEmbeddings("document_chunk", doc.id);
      if (existingCount > 0) {
        results.documents.embedded++;
        continue;
      }

      // Document text is not stored in the DB, only metadata.
      // We can't re-embed without the original file, so we skip
      // documents that don't already have embeddings.
      log.debug("Skipping document (no stored text, needs re-upload)", {
        id: doc.id,
        filename: doc.filename,
      });
    } catch (err) {
      results.documents.failed++;
      log.warn("Document check failed", {
        id: doc.id,
        error: err instanceof Error ? err.message : String(err),
        errorCategory: "embedding_failed",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Backfill: Benchmark records
// ---------------------------------------------------------------------------

async function backfillBenchmarks(
  results: { benchmarks: { total: number; embedded: number; failed: number } },
  log: ReturnType<typeof apiLogger>,
): Promise<void> {
  const { isBenchmarksEnabled } = await import("@/lib/benchmarks/config");
  if (!isBenchmarksEnabled()) return;

  const { listBenchmarkRecords } = await import("@/lib/lakebase/benchmarks");
  const { embedBenchmarkRecords } = await import("@/lib/embeddings/embed-pipeline");

  const rows = await listBenchmarkRecords({
    lifecycleStatus: "published",
    limit: 2000,
  });
  results.benchmarks.total = rows.length;
  if (rows.length === 0) return;
  try {
    await embedBenchmarkRecords(
      rows.map((r) => ({
        benchmarkId: r.benchmarkId,
        kind: r.kind,
        title: r.title,
        summary: r.summary,
        sourceUrl: r.sourceUrl,
        publisher: r.publisher,
        industry: r.industry,
        region: r.region,
        publishedAt: r.publishedAt,
        ttlDays: r.ttlDays,
        sourceContent: r.sourceContent,
      })),
    );
    results.benchmarks.embedded = rows.length;
  } catch (err) {
    results.benchmarks.failed = rows.length;
    log.warn("Benchmark embedding failed", {
      error: err instanceof Error ? err.message : String(err),
      errorCategory: "embedding_failed",
    });
  }
}

// ---------------------------------------------------------------------------
// Backfill: Fabric/Power BI Scans
// ---------------------------------------------------------------------------

async function backfillFabricScans(
  results: { fabricScans: { total: number; embedded: number; failed: number } },
  log: ReturnType<typeof apiLogger>,
): Promise<void> {
  let scans: Array<{ id: string; status: string }>;
  try {
    const { listFabricScans } = await import("@/lib/lakebase/fabric-scans");
    scans = await listFabricScans();
  } catch {
    return;
  }

  const completedScans = scans.filter((s) => s.status === "completed");
  results.fabricScans.total = completedScans.length;

  const { getFabricScanDetail } = await import("@/lib/lakebase/fabric-scans");
  const { deleteEmbeddingsByScan } = await import("@/lib/embeddings/store");
  const { embedFabricScan } = await import("@/lib/embeddings/embed-pipeline");

  for (const scan of completedScans) {
    try {
      const detail = await getFabricScanDetail(scan.id);
      if (!detail) continue;

      await deleteEmbeddingsByScan(scan.id);

      const wsNameMap = new Map(detail.workspaces.map((ws) => [ws.workspaceId, ws.name]));

      await embedFabricScan(scan.id, {
        datasets: detail.datasets.map((ds) => ({
          datasetId: ds.datasetId,
          name: ds.name,
          workspaceName: wsNameMap.get(ds.workspaceId),
          tables: ds.tables.map((t) => ({
            name: t.name,
            columns: t.columns.map((c) => ({ name: c.name, dataType: c.dataType })),
            measures: (t.measures ?? []).map((m) => ({
              name: m.name,
              expression: m.expression,
              description: m.description,
            })),
          })),
          relationships: ds.relationships.map((r) => ({
            fromTable: r.fromTable,
            fromColumn: r.fromColumn,
            toTable: r.toTable,
            toColumn: r.toColumn,
          })),
          sensitivityLabel: ds.sensitivityLabel,
        })),
        reports: detail.reports.map((r) => ({
          reportId: r.reportId,
          name: r.name,
          reportType: r.reportType,
          datasetName: detail.datasets.find((ds) => ds.datasetId === r.datasetId)?.name,
          workspaceName: wsNameMap.get(r.workspaceId),
          tiles: r.tiles.map((t) => ({ title: t.title })),
          sensitivityLabel: r.sensitivityLabel,
        })),
        artifacts: detail.artifacts.map((a) => ({
          artifactId: a.artifactId,
          name: a.name,
          artifactType: a.artifactType,
          workspaceName: wsNameMap.get(a.workspaceId),
          metadata: a.metadata,
        })),
      });

      results.fabricScans.embedded++;
      log.debug("Fabric scan embedded", { scanId: scan.id });
    } catch (err) {
      results.fabricScans.failed++;
      log.warn("Fabric scan embedding failed", {
        scanId: scan.id,
        error: err instanceof Error ? err.message : String(err),
        errorCategory: "embedding_failed",
      });
    }
  }
}
