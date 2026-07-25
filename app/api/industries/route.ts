/**
 * API: /api/industries
 *
 * GET -- List available industries (id + name only, lightweight for client)
 */

import { NextResponse } from "next/server";
import { INDUSTRY_OUTCOMES } from "@/lib/domain/industry-outcomes";

const INDUSTRY_LIST = INDUSTRY_OUTCOMES.map((i) => ({ id: i.id, name: i.name })).sort((a, b) =>
  a.name.localeCompare(b.name),
);

export async function GET() {
  return NextResponse.json({ industries: INDUSTRY_LIST });
}
