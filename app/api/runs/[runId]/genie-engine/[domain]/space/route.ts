/**
 * API: /api/runs/[runId]/genie-engine/[domain]/space
 *
 * PATCH -- Inline edit a specific element of a domain's serialized space.
 *          Accepts a JSON body with { path, value } to update a specific
 *          element (measure, filter, dimension, instruction, question).
 */

import { NextRequest, NextResponse } from "next/server";
import { loadRunOrRespond } from "@/lib/auth/route-guards";
import { safeErrorMessage } from "@/lib/error-utils";
import { withPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isValidUUID } from "@/lib/validation";
import { SpaceEditBodySchema } from "@/lib/metadata-genie/schemas";

export async function PATCH(
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

    const raw = await request.json();
    const parsed = SpaceEditBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Missing type or id" },
        { status: 400 },
      );
    }
    const body = parsed.data;

    const result = await withPrisma(async (prisma) => {
      const rec = await prisma.forgeGenieRecommendation.findFirst({
        where: { runId, domain: decodedDomain },
      });

      if (!rec) {
        return {
          error: `No recommendation found for domain "${decodedDomain}"`,
          status: 404,
        } as const;
      }

      let space: Record<string, unknown>;
      try {
        space = JSON.parse(rec.serializedSpace);
      } catch {
        return { error: "Invalid serialized space", status: 500 } as const;
      }

      const instructions = space.instructions as Record<string, unknown> | undefined;
      const config = space.config as Record<string, unknown> | undefined;
      const snippets = (instructions?.sql_snippets ?? {}) as Record<string, unknown[]>;

      let modified = false;

      switch (body.type) {
        case "update_measure":
          modified = updateInArray(snippets.measures, body.id, {
            alias: body.alias as string | undefined,
            sql: body.sql as string[] | undefined,
          });
          break;
        case "update_filter":
          modified = updateInArray(snippets.filters, body.id, {
            display_name: body.display_name as string | undefined,
            sql: body.sql as string[] | undefined,
          });
          break;
        case "update_expression":
          modified = updateInArray(snippets.expressions, body.id, {
            alias: body.alias as string | undefined,
            sql: body.sql as string[] | undefined,
          });
          break;
        case "update_instruction":
          modified = updateInArray((instructions?.text_instructions ?? []) as unknown[], body.id, {
            content: body.content as string[] | undefined,
          });
          break;
        case "update_question":
          modified = updateInArray((config?.sample_questions ?? []) as unknown[], body.id, {
            question: body.question as string[] | undefined,
          });
          break;
        case "remove_measure":
          modified = removeFromArray(snippets, "measures", body.id);
          break;
        case "remove_filter":
          modified = removeFromArray(snippets, "filters", body.id);
          break;
        case "remove_expression":
          modified = removeFromArray(snippets, "expressions", body.id);
          break;
        case "remove_instruction":
          modified = removeFromObject(instructions, "text_instructions", body.id);
          break;
        case "remove_question":
          modified = removeFromObject(config, "sample_questions", body.id);
          break;
        default:
          return { error: `Unknown edit type: ${body.type}`, status: 400 } as const;
      }

      if (!modified) {
        return { error: "Element not found", status: 404 } as const;
      }

      await prisma.forgeGenieRecommendation.update({
        where: { id: rec.id },
        data: { serializedSpace: JSON.stringify(space) },
      });

      return null;
    });

    if (result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    logger.info("Genie space inline edit applied", {
      runId,
      domain: decodedDomain,
      editType: body.type,
      elementId: body.id,
    });

    return NextResponse.json({ success: true, domain: decodedDomain });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

function updateInArray(
  arr: unknown[] | undefined,
  id: string,
  updates: Record<string, unknown>,
): boolean {
  if (!Array.isArray(arr)) return false;
  const item = arr.find((el) => (el as Record<string, unknown>).id === id) as
    | Record<string, unknown>
    | undefined;
  if (!item) return false;
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) item[key] = value;
  }
  return true;
}

function removeFromArray(
  parent: Record<string, unknown[]> | undefined,
  key: string,
  id: string,
): boolean {
  if (!parent || !Array.isArray(parent[key])) return false;
  const before = parent[key].length;
  parent[key] = parent[key].filter((el) => (el as Record<string, unknown>).id !== id);
  return parent[key].length < before;
}

function removeFromObject(
  parent: Record<string, unknown> | undefined,
  key: string,
  id: string,
): boolean {
  if (!parent || !Array.isArray(parent[key])) return false;
  const arr = parent[key] as unknown[];
  const before = arr.length;
  parent[key] = arr.filter((el) => (el as Record<string, unknown>).id !== id);
  return (parent[key] as unknown[]).length < before;
}
