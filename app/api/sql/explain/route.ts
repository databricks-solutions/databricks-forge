/**
 * POST /api/sql/explain -- Validate SQL via EXPLAIN (dry-run).
 *
 * Returns { valid: true } on success, or { valid: false, error: "..." } on failure.
 */

import { NextRequest } from "next/server";
import { validateSql } from "@/lib/assistant/sql-proposer";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sql = body.sql as string;

    if (!sql || typeof sql !== "string" || sql.trim().length < 5) {
      return Response.json(
        { valid: false, error: "SQL statement is required (minimum 5 characters)" },
        { status: 400 },
      );
    }

    const error = await validateSql(sql.trim());

    if (error) {
      return Response.json({ valid: false, error });
    }

    return Response.json({ valid: true });
  } catch (err) {
    logger.error("[api/sql/explain] Error", { error: String(err) });
    return Response.json({ valid: false, error: "Failed to validate SQL" }, { status: 500 });
  }
}
