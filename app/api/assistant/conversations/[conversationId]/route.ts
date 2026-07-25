/**
 * GET    /api/assistant/conversations/:id -- load conversation with messages
 * PATCH  /api/assistant/conversations/:id -- rename conversation
 * DELETE /api/assistant/conversations/:id -- delete conversation + logs
 */

import { NextRequest } from "next/server";
import { getCurrentUserEmail } from "@/lib/dbx/client";
import {
  getConversationWithMessages,
  updateConversationTitle,
  deleteConversation,
} from "@/lib/lakebase/conversations";
import { logger } from "@/lib/logger";

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const { conversationId } = await ctx.params;
    const userId = await getCurrentUserEmail();
    if (!userId) {
      return Response.json({ error: "User identity required" }, { status: 401 });
    }

    const conversation = await getConversationWithMessages(conversationId, userId);
    if (!conversation) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }

    return Response.json(conversation);
  } catch (err) {
    logger.error("[api/conversations] Get error", { error: String(err) });
    return Response.json({ error: "Failed to load conversation" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const { conversationId } = await ctx.params;
    const userId = await getCurrentUserEmail();
    if (!userId) {
      return Response.json({ error: "User identity required" }, { status: 401 });
    }

    const body = await req.json();
    const title = body.title as string;
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return Response.json({ error: "Title is required" }, { status: 400 });
    }

    const ok = await updateConversationTitle(conversationId, userId, title.trim());
    if (!ok) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }

    return Response.json({ ok: true });
  } catch (err) {
    logger.error("[api/conversations] Rename error", { error: String(err) });
    return Response.json({ error: "Failed to rename conversation" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const { conversationId } = await ctx.params;
    const userId = await getCurrentUserEmail();
    if (!userId) {
      return Response.json({ error: "User identity required" }, { status: 401 });
    }

    const ok = await deleteConversation(conversationId, userId);
    if (!ok) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }

    return Response.json({ ok: true });
  } catch (err) {
    logger.error("[api/conversations] Delete error", { error: String(err) });
    return Response.json({ error: "Failed to delete conversation" }, { status: 500 });
  }
}
