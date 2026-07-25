/**
 * GET /api/assistant/suggestions?persona=business|tech
 *
 * Returns dynamic suggested questions for the Ask Forge empty state,
 * derived from the latest pipeline run, industry outcome map, and
 * environment scan data. Persona controls question style.
 */

import { type NextRequest } from "next/server";
import { buildSuggestedQuestions } from "@/lib/assistant/suggested-questions";
import { type AssistantPersona, VALID_PERSONAS } from "@/lib/assistant/prompts";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("persona") ?? "";
  const persona: AssistantPersona = VALID_PERSONAS.has(raw as AssistantPersona)
    ? (raw as AssistantPersona)
    : "business";
  const questions = await buildSuggestedQuestions(persona);
  return Response.json({ questions });
}
