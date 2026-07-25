/**
 * POST /api/assistant -- Streaming conversational AI endpoint.
 *
 * Accepts a user question and optional conversation history, runs the
 * assistant engine (intent detection, RAG, LLM streaming), and returns
 * an SSE stream followed by a final JSON payload with metadata.
 *
 * SSE format:
 *   data: {"type":"chunk","content":"..."}
 *   data: {"type":"done","answer":"...","intent":{...},"sources":[...],"actions":[...],"tables":[...],"sqlBlocks":[...],"dashboardProposal":null,"tokenUsage":{...},"durationMs":1234}
 */

import { NextRequest } from "next/server";
import { runAssistantEngine, type ConversationTurn } from "@/lib/assistant/engine";
import { type AssistantPersona, VALID_PERSONAS } from "@/lib/assistant/prompts";
import { getCurrentUserEmail } from "@/lib/dbx/client";
import {
  createConversation,
  findConversationBySession,
  touchConversation,
} from "@/lib/lakebase/conversations";
import { apiLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const log = apiLogger("/api/assistant", "POST");
  try {
    const body = await req.json();
    const question = body.question as string;
    const history = (body.history ?? []) as ConversationTurn[];
    const sessionId = (body.sessionId as string) ?? crypto.randomUUID();
    const raw = body.persona as string;
    const persona: AssistantPersona = VALID_PERSONAS.has(raw as AssistantPersona)
      ? (raw as AssistantPersona)
      : "business";

    if (!question || typeof question !== "string" || question.trim().length < 2) {
      return Response.json(
        { error: "Question is required (minimum 2 characters)" },
        { status: 400 },
      );
    }

    const userEmail = await getCurrentUserEmail();

    let conversationId: string | null = null;
    if (userEmail) {
      try {
        const existingId = await findConversationBySession(sessionId);
        if (existingId) {
          conversationId = existingId;
          await touchConversation(sessionId);
        } else {
          const title = question.trim().slice(0, 100);
          conversationId = await createConversation(userEmail, title, sessionId, persona);
        }
      } catch (err) {
        log.warn("Conversation tracking failed", { error: String(err), errorCategory: "db" });
      }
    }

    const abortController = new AbortController();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const result = await runAssistantEngine(
            question.trim(),
            history,
            (chunk: string) => {
              const event = `data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`;
              controller.enqueue(encoder.encode(event));
            },
            sessionId,
            userEmail,
            persona,
            abortController.signal,
          );

          const doneEvent = `data: ${JSON.stringify({
            type: "done",
            answer: result.answer,
            intent: result.intent,
            sources: result.sources,
            actions: result.actions,
            tables: result.tables,
            chatMentionedTables: result.chatMentionedTables,
            tableEnrichments: result.tableEnrichments,
            sqlBlocks: result.sqlBlocks,
            dashboardProposal: result.dashboardProposal,
            existingDashboards: result.existingDashboards,
            tokenUsage: result.tokenUsage,
            durationMs: result.durationMs,
            logId: result.logId,
            conversationId,
          })}\n\n`;
          controller.enqueue(encoder.encode(doneEvent));
          controller.close();
        } catch (err) {
          if (abortController.signal.aborted) {
            log.info("Client disconnected, aborting engine");
            controller.close();
            return;
          }
          log.error("Engine error", { error: String(err), errorCategory: "engine_error" });
          const errorEvent = `data: ${JSON.stringify({
            type: "error",
            error: err instanceof Error ? err.message : "An unexpected error occurred",
          })}\n\n`;
          controller.enqueue(encoder.encode(errorEvent));
          controller.close();
        }
      },
      cancel() {
        abortController.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    log.error("Request error", { error: String(err), errorCategory: "internal_error" });
    return Response.json({ error: "Failed to process request" }, { status: 500 });
  }
}
