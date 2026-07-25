/**
 * API: GET /api/metadata-genie/probe
 *
 * Lightweight endpoint that checks system.information_schema access and
 * returns the list of available catalogs for catalog scope selection.
 */

import { NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { probeSystemInformationSchema } from "@/lib/metadata-genie/probe";

export async function GET() {
  try {
    const probe = await probeSystemInformationSchema();
    return NextResponse.json({
      accessible: probe.accessible,
      lineageAccessible: probe.lineageAccessible,
      catalogs: probe.catalogs ?? [],
      error: probe.error,
    });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
