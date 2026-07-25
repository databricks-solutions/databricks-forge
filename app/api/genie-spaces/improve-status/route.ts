/**
 * API: /api/genie-spaces/improve-status
 *
 * GET -- Returns all active (or recently completed) improvement jobs.
 *        Used by the list page to show status badges on SpaceCards.
 */

import { NextResponse } from "next/server";
import { getAllActiveImproveJobs } from "@/lib/genie/improve-jobs";

export async function GET() {
  const all = getAllActiveImproveJobs();

  const jobs: Record<string, { status: string; percent: number; message: string }> = {};
  for (const [spaceId, job] of Object.entries(all)) {
    jobs[spaceId] = {
      status: job.status,
      percent: job.percent,
      message: job.message,
    };
  }

  return NextResponse.json({ jobs });
}
