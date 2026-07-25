/**
 * API: /api/runs/[runId]/genie-engine/[domain]/test
 *
 * POST -- Test a deployed Genie Space by running questions via the
 *         Conversation API and reporting results.
 */

import { NextRequest, NextResponse } from "next/server";
import { loadRunOrRespond } from "@/lib/auth/route-guards";
import { safeErrorMessage } from "@/lib/error-utils";
import { isValidUUID } from "@/lib/validation";
import { startConversation, type GenieConversationMessage } from "@/lib/dbx/genie";
import { logger } from "@/lib/logger";

export interface TestResult {
  question: string;
  status: GenieConversationMessage["status"];
  sql?: string;
  textResponse?: string;
  error?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; domain: string }> },
) {
  try {
    const { runId, domain } = await params;
    if (!isValidUUID(runId)) {
      return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
    }
    const decodedDomain = decodeURIComponent(domain);

    const guard = await loadRunOrRespond(request, runId, "edit");
    if (!guard.ok) return guard.response;
    const run = guard.value.run;

    const body = (await request.json()) as {
      spaceId: string;
      questions: string[];
    };

    if (!body.spaceId || !body.questions?.length) {
      return NextResponse.json(
        { error: "Missing required fields: spaceId, questions" },
        { status: 400 },
      );
    }

    const questions = body.questions.slice(0, 10);
    const oboToken = request.headers.get("x-forwarded-access-token") ?? undefined;

    logger.info("Testing Genie Space", {
      runId,
      domain: decodedDomain,
      spaceId: body.spaceId,
      questionCount: questions.length,
    });

    const results: TestResult[] = [];

    for (const question of questions) {
      try {
        const msg = await startConversation(body.spaceId, question, 90_000, oboToken);
        results.push({
          question,
          status: msg.status,
          sql: msg.sql,
          textResponse: msg.textResponse,
          error: msg.error,
        });
      } catch (err) {
        results.push({
          question,
          status: "FAILED",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const passed = results.filter((r) => r.status === "COMPLETED").length;

    logger.info("Genie Space test complete", {
      runId,
      domain: decodedDomain,
      passed,
      total: results.length,
    });

    return NextResponse.json({
      spaceId: body.spaceId,
      domain: decodedDomain,
      results,
      summary: { passed, total: results.length },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Genie Space test failed", { error: message });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
