/**
 * POST /api/sql/execute -- Execute SQL against the configured warehouse.
 *
 * Used by the Ask Forge assistant's "Run this SQL" action card.
 * Wraps the existing executeSQL infrastructure with request validation.
 */

import { NextRequest } from "next/server";
import { executeSql, validateSql } from "@/lib/assistant/sql-proposer";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sql = body.sql as string;

    if (!sql || typeof sql !== "string" || sql.trim().length < 5) {
      return Response.json(
        { error: "SQL statement is required (minimum 5 characters)" },
        { status: 400 },
      );
    }

    const statement = sql.trim();
    const validationError = await validateSql(statement);
    if (validationError) {
      return Response.json(
        { success: false, error: `SQL validation failed: ${validationError}` },
        { status: 400 },
      );
    }

    const result = await executeSql(statement);

    return Response.json(result);
  } catch (err) {
    logger.error("[api/sql/execute] Error", { error: String(err) });
    return Response.json({ error: "Failed to execute SQL" }, { status: 500 });
  }
}
