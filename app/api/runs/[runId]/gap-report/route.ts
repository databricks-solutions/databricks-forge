/**
 * API: /api/runs/[runId]/gap-report  (legacy)
 *
 * The v1 industry-coverage Excel report has been superseded by the v2 Data
 * Gap export, which combines onboarding plan, asset coverage, value-at-risk,
 * use-case mapping and summary in a single workbook grounded in the Master
 * Repository v2 + lineage-derived source systems.
 *
 * We keep this path live for any bookmarks / outbound links and return a
 * 301 to the new endpoint so the client downloads the v2 workbook instead.
 */

import { NextRequest, NextResponse } from "next/server";

export function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  return params.then(({ runId }) => {
    const target = new URL(`/api/runs/${runId}/data-gap/export`, request.url);
    return NextResponse.redirect(target, 301);
  });
}
