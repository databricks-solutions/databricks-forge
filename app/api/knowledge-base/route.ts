/**
 * API: /api/knowledge-base
 *
 * GET    -- List all uploaded documents
 * DELETE -- Delete a document by ID (query param: id)
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { listDocuments, deleteDocument, getDocument } from "@/lib/lakebase/documents";
import { isEmbeddingEnabled } from "@/lib/embeddings/config";
import { logger } from "@/lib/logger";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { listAccessibleIds, clearAclForResource } from "@/lib/lakebase/acl";
import { loadResourceOrRespond } from "@/lib/auth/route-guards";

export async function GET(request: NextRequest) {
  try {
    const enabled = isEmbeddingEnabled();
    if (!enabled) {
      return NextResponse.json({ documents: [], enabled: false });
    }

    const user = await requireUser(request);
    const sharedIds = await listAccessibleIds(user.email, "document");
    const documents = await listDocuments({ userEmail: user.email, sharedIds });
    return NextResponse.json(
      { documents, enabled: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof ForgeAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error("[api/knowledge-base] GET failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to list documents" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Document ID required" }, { status: 400 });
    }

    const guard = await loadResourceOrRespond({
      request,
      resourceType: "document",
      resourceId: id,
      fetchOwner: async () => {
        const doc = await getDocument(id);
        return doc ? doc.ownerEmail : undefined;
      },
      mode: "edit",
    });
    if (!guard.ok) return guard.response;
    if (guard.permission !== "owner") {
      return NextResponse.json(
        { error: "Only the owner can delete a document." },
        { status: 403 },
      );
    }

    const deleted = await deleteDocument(id);
    if (!deleted) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    await clearAclForResource("document", id);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("[api/knowledge-base] DELETE failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
