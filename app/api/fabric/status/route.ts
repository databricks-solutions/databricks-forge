/**
 * API: /api/fabric/status
 *
 * GET -- Returns whether the Fabric / Power BI feature is enabled server-side.
 *
 * Used by the sidebar to decide whether Fabric-dependent nav items
 * (Migrate, Fabric / PBI, Connections) should be visible.
 */

import { NextResponse } from "next/server";
import { isFabricEnabled } from "@/lib/fabric/config";

export async function GET() {
  return NextResponse.json({ enabled: isFabricEnabled() });
}
