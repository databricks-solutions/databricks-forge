/**
 * API: /api/prompt-templates
 *
 * GET -- fetch prompt template text by version hash(es).
 * Query params: ?hashes=abc123,def456
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getPromptTemplatesBatch } from "@/lib/lakebase/prompt-templates";
import { ensureMigrated } from "@/lib/lakebase/schema";

export async function GET(request: NextRequest) {
  try {
    await ensureMigrated();
    const { searchParams } = new URL(request.url);
    const hashesParam = searchParams.get("hashes");

    if (!hashesParam) {
      return NextResponse.json(
        { error: "hashes query param is required (comma-separated)" },
        { status: 400 },
      );
    }

    const hashes = hashesParam
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);

    if (hashes.length === 0 || hashes.length > 50) {
      return NextResponse.json({ error: "Provide 1-50 comma-separated hashes" }, { status: 400 });
    }

    const templates = await getPromptTemplatesBatch(hashes);

    const result: Record<string, { promptKey: string; templateText: string }> = {};
    for (const [hash, data] of templates) {
      result[hash] = data;
    }

    return NextResponse.json({ templates: result });
  } catch (error) {
    logger.error("Failed to fetch prompt templates", {
      error: error instanceof Error ? error.message : String(error),
      route: "/api/prompt-templates",
    });
    return NextResponse.json({ error: "Failed to fetch prompt templates" }, { status: 500 });
  }
}
