/**
 * API: /api/genie-spaces/[spaceId]/benchmarks
 *
 * GET -- Fetch benchmark questions from the space's serialized_space.
 */

import { NextRequest, NextResponse } from "next/server";
import { getGenieSpace } from "@/lib/dbx/genie";
import { getSpaceCache, setSpaceCache } from "@/lib/genie/space-cache";
import { loadGenieSpaceBySpaceIdOrRespond } from "@/lib/auth/route-guards";
import { isSafeId } from "@/lib/validation";
import { safeErrorMessage } from "@/lib/error-utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  try {
    const { spaceId } = await params;
    if (!isSafeId(spaceId)) {
      return NextResponse.json({ error: "Invalid spaceId" }, { status: 400 });
    }

    const guard = await loadGenieSpaceBySpaceIdOrRespond(request, spaceId, "read");
    if (!guard.ok) return guard.response;

    let serializedSpace = getSpaceCache(spaceId);
    if (!serializedSpace) {
      const response = await getGenieSpace(spaceId);
      serializedSpace = response.serialized_space ?? "{}";
      setSpaceCache(spaceId, serializedSpace);
    }

    const space = JSON.parse(serializedSpace);
    const questions = (space.benchmarks?.questions ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (q: any) => ({
        id: q.id ?? undefined,
        question: Array.isArray(q.question) ? q.question[0] : String(q.question ?? ""),
        expectedSql: Array.isArray(q.answer?.[0]?.content)
          ? q.answer[0].content.join("\n")
          : (q.answer?.[0]?.content ?? null),
      }),
    );

    return NextResponse.json({
      questions,
      source: questions.length > 0 ? "space" : "none",
      total: questions.length,
    });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
