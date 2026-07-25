import { NextRequest, NextResponse } from "next/server";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { getCurrentUserEmail } from "@/lib/dbx/client";
import { getBenchmarkById, updateBenchmarkSourceContent } from "@/lib/lakebase/benchmarks";
import { fetchAndConvertSource } from "@/lib/benchmarks/source-fetcher";
import { isBenchmarkAdmin } from "@/lib/benchmarks/admin-guard";
import { isBenchmarksEnabled } from "@/lib/benchmarks/config";
import { logger } from "@/lib/logger";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ benchmarkId: string }> },
) {
  if (!isBenchmarksEnabled()) {
    return NextResponse.json({ error: "Benchmark catalog is disabled" }, { status: 404 });
  }

  let benchmarkId: string | undefined;
  try {
    const userEmail = await getCurrentUserEmail();
    if (!isBenchmarkAdmin(userEmail)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    ({ benchmarkId } = await params);
    await ensureMigrated();

    const record = await getBenchmarkById(benchmarkId);
    if (!record) {
      return NextResponse.json({ error: "Benchmark not found" }, { status: 404 });
    }
    const markdown = await fetchAndConvertSource(record.sourceUrl);

    if (markdown) {
      const updated = await updateBenchmarkSourceContent(benchmarkId, {
        sourceContent: markdown,
        sourceFetchStatus: "fetched",
      });
      return NextResponse.json({
        success: true,
        sourceFetchStatus: "fetched",
        contentLength: markdown.length,
        record: updated,
      });
    }

    await updateBenchmarkSourceContent(benchmarkId, {
      sourceFetchStatus: "failed",
    });

    return NextResponse.json({
      success: false,
      sourceFetchStatus: "failed",
      message:
        "Could not fetch source URL. The page may require JavaScript or authentication. Use manual paste instead.",
    });
  } catch (err) {
    logger.warn("[fetch-source] Unexpected error", {
      benchmarkId,
      error: err instanceof Error ? err.message : String(err),
    });

    if (benchmarkId) {
      await updateBenchmarkSourceContent(benchmarkId, {
        sourceFetchStatus: "failed",
      }).catch((e) =>
        logger.warn("[fetch-source] Failed to mark source as failed", {
          benchmarkId,
          error: String(e),
        }),
      );
    }

    return NextResponse.json({ error: "Source fetch failed unexpectedly" }, { status: 500 });
  }
}
