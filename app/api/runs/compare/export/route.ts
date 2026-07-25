/**
 * API: /api/runs/compare/export
 *
 * GET -- export a comparison of two runs as Excel.
 * Query params: ?runA=<uuid>&runB=<uuid>
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";
import { compareRuns } from "@/lib/lakebase/run-comparison";
import { generateComparisonExcel } from "@/lib/export/comparison-excel";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { isValidUUID } from "@/lib/validation";
import { loadRunOrRespond } from "@/lib/auth/route-guards";

export async function GET(request: NextRequest) {
  try {
    await ensureMigrated();
    const { searchParams } = new URL(request.url);
    const runAId = searchParams.get("runA");
    const runBId = searchParams.get("runB");

    if (!runAId || !runBId || !isValidUUID(runAId) || !isValidUUID(runBId)) {
      return NextResponse.json(
        { error: "Both runA and runB query params (valid UUIDs) are required" },
        { status: 400 },
      );
    }

    const guardA = await loadRunOrRespond(request, runAId, "read");
    if (!guardA.ok) return guardA.response;
    const guardB = await loadRunOrRespond(request, runBId, "read");
    if (!guardB.ok) return guardB.response;

    const comparison = await compareRuns(runAId, runBId);
    const buffer = await generateComparisonExcel(comparison);

    const nameA = comparison.runA.run.config.businessName.replace(/\s+/g, "_");
    const nameB = comparison.runB.run.config.businessName.replace(/\s+/g, "_");

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="forge_comparison_${nameA}_vs_${nameB}.xlsx"`,
      },
    });
  } catch (error) {
    logger.error("Failed to export comparison", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
