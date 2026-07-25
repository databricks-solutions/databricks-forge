/**
 * POST /api/business-value/vote   -- cast or toggle a vote on a use case
 * GET  /api/business-value/vote   -- get vote counts for a run
 *
 * Votes are stored in the `notes` JSON column of ForgeUseCaseTracking entries,
 * under a `__votes` key to avoid schema changes. Format:
 *   { text: "__votes", votes: { [voter: string]: number } }
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withPrisma } from "@/lib/prisma";
import { loadRunOrRespond } from "@/lib/auth/route-guards";

export const dynamic = "force-dynamic";

interface NoteEntry {
  text: string;
  author?: string;
  createdAt: string;
  votes?: Record<string, number>;
}

function parseNotes(raw: unknown): NoteEntry[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) return raw as NoteEntry[];
  return [];
}

export async function GET(req: NextRequest) {
  try {
    const runId = req.nextUrl.searchParams.get("runId");
    if (!runId) {
      return NextResponse.json({ error: "runId required" }, { status: 400 });
    }

    const guard = await loadRunOrRespond(req, runId, "read");
    if (!guard.ok) return guard.response;

    const entries = await withPrisma((prisma) =>
      prisma.forgeUseCaseTracking.findMany({
        where: { runId },
        select: { useCaseId: true, notes: true },
      }),
    );

    const votes: Record<string, { total: number; voters: string[] }> = {};
    for (const e of entries) {
      const notes = parseNotes(e.notes);
      const voteNote = notes.find((n) => n.text === "__votes");
      if (voteNote?.votes) {
        const total = Object.values(voteNote.votes).reduce((s, v) => s + v, 0);
        votes[e.useCaseId] = {
          total,
          voters: Object.keys(voteNote.votes),
        };
      }
    }

    return NextResponse.json(votes);
  } catch (err) {
    logger.error("[api/business-value/vote] GET failed", { error: String(err) });
    return NextResponse.json({ error: "Failed to load votes" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { runId, useCaseId, value } = (await req.json()) as {
      runId: string;
      useCaseId: string;
      value?: number;
    };

    if (!runId || !useCaseId) {
      return NextResponse.json({ error: "runId and useCaseId required" }, { status: 400 });
    }

    const guard = await loadRunOrRespond(req, runId, "read");
    if (!guard.ok) return guard.response;

    const voter = guard.user.email;
    const voteValue = value ?? 1;

    const updated = await withPrisma(async (prisma) => {
      const existing = await prisma.forgeUseCaseTracking.findUnique({
        where: { runId_useCaseId: { runId, useCaseId } },
        select: { notes: true },
      });

      const notes = parseNotes(existing?.notes);
      let voteNote = notes.find((n) => n.text === "__votes");

      if (!voteNote) {
        voteNote = { text: "__votes", createdAt: new Date().toISOString(), votes: {} };
        notes.push(voteNote);
      }
      if (!voteNote.votes) voteNote.votes = {};

      if (voteNote.votes[voter] === voteValue) {
        delete voteNote.votes[voter];
      } else {
        voteNote.votes[voter] = voteValue;
      }

      return prisma.forgeUseCaseTracking.upsert({
        where: { runId_useCaseId: { runId, useCaseId } },
        update: { notes: JSON.stringify(notes) },
        create: {
          runId,
          useCaseId,
          stage: "discovered",
          notes: JSON.stringify(notes),
        },
        select: { useCaseId: true, notes: true },
      });
    });

    const finalNotes = parseNotes(updated.notes);
    const vn = finalNotes.find((n) => n.text === "__votes");
    const total = vn?.votes ? Object.values(vn.votes).reduce((s, v) => s + v, 0) : 0;

    return NextResponse.json({ useCaseId, total, voted: voteValue });
  } catch (err) {
    logger.error("[api/business-value/vote] POST failed", { error: String(err) });
    return NextResponse.json({ error: "Failed to record vote" }, { status: 500 });
  }
}
