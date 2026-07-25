/**
 * POST /api/genie-spaces/readiness
 *
 * Pre-flight readiness assessment used by the Schema Scan and Requirements
 * creation flows. Returns a per-question verdict (`answerable` |
 * `partial` | `not_answerable`) so the UI can warn the user before they
 * trigger a multi-minute engine run.
 *
 * Body:
 *   {
 *     catalog: string,
 *     schema?: string,
 *     tables: Array<{ fqn, description?, columnNames?, columnDescriptions? }>,
 *     questions: Array<{ question: string, id?: string }>,
 *   }
 *
 * Response:
 *   ReadinessReport (see lib/genie/readiness.ts)
 */
import { NextRequest, NextResponse } from "next/server";
import { assessReadiness, type ReadinessQuestion, type ReadinessTableSummary } from "@/lib/genie/readiness";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { logger } from "@/lib/logger";

type ReadinessRequestBody = {
  catalog?: string;
  schema?: string;
  tables?: Array<{
    fqn?: string;
    description?: string | null;
    columnNames?: string[];
    columnDescriptions?: Record<string, string>;
  }>;
  questions?: Array<{ question?: string; id?: string }>;
};

export async function POST(request: NextRequest) {
  try {
    await requireUser(request);
    const body = (await request.json()) as ReadinessRequestBody;

    if (!body.catalog || typeof body.catalog !== "string") {
      return NextResponse.json({ error: "catalog is required" }, { status: 400 });
    }

    const tables: ReadinessTableSummary[] = (body.tables ?? [])
      .filter((t): t is { fqn: string; description?: string | null; columnNames?: string[]; columnDescriptions?: Record<string, string> } =>
        Boolean(t && typeof t.fqn === "string" && t.fqn.trim().length > 0),
      )
      .map((t) => ({
        fqn: t.fqn,
        description: t.description ?? null,
        columnNames: Array.isArray(t.columnNames) ? t.columnNames : undefined,
        columnDescriptions: t.columnDescriptions,
      }));

    const questions: ReadinessQuestion[] = (body.questions ?? [])
      .filter((q): q is { question: string; id?: string } =>
        Boolean(q && typeof q.question === "string" && q.question.trim().length > 0),
      )
      .map((q) => ({ question: q.question, id: q.id }));

    if (tables.length === 0) {
      return NextResponse.json({ error: "tables[] is required" }, { status: 400 });
    }
    if (questions.length === 0) {
      return NextResponse.json({ error: "questions[] is required" }, { status: 400 });
    }

    const report = await assessReadiness({
      catalog: body.catalog,
      schema: body.schema,
      tables,
      questions,
    });

    return NextResponse.json(report);
  } catch (err) {
    if (err instanceof ForgeAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error("[api/readiness] failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Readiness check failed" },
      { status: 500 },
    );
  }
}
