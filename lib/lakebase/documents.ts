/**
 * CRUD operations for the knowledge base document table (forge_documents).
 *
 * Documents are uploaded by customers (PDF, Markdown, plain text) and
 * chunked + embedded for RAG retrieval and semantic search.
 */

import { withPrisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocumentRecord {
  id: string;
  filename: string;
  mimeType: string;
  category: string;
  chunkCount: number;
  sizeBytes: number;
  status: string;
  uploadedBy: string | null;
  ownerEmail: string | null;
  createdAt: Date;
}

export type DocumentCategory =
  | "strategy"
  | "data_dictionary"
  | "governance_policy"
  | "architecture"
  | "other";

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createDocument(opts: {
  id: string;
  filename: string;
  mimeType: string;
  category: string;
  sizeBytes: number;
  uploadedBy?: string | null;
  ownerEmail?: string | null;
}): Promise<DocumentRecord> {
  return withPrisma(async (prisma) => {
    const owner = opts.ownerEmail ? opts.ownerEmail.toLowerCase().trim() : null;
    const row = await prisma.forgeDocument.create({
      data: {
        id: opts.id,
        filename: opts.filename,
        mimeType: opts.mimeType,
        category: opts.category,
        sizeBytes: opts.sizeBytes,
        uploadedBy: opts.uploadedBy ?? null,
        ownerEmail: owner,
        status: "processing",
      },
    });
    return toRecord(row);
  });
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function listDocuments(opts?: {
  userEmail?: string;
  viewMode?: "owned" | "shared" | "all";
  sharedIds?: string[];
}): Promise<DocumentRecord[]> {
  return withPrisma(async (prisma) => {
    const where: Record<string, unknown> = {};
    if (opts?.userEmail) {
      const sharedIds = opts.sharedIds ?? [];
      const viewMode = opts.viewMode ?? "all";
      if (viewMode === "owned") {
        where.ownerEmail = opts.userEmail;
      } else if (viewMode === "shared") {
        where.id = { in: sharedIds };
      } else {
        where.OR = [{ ownerEmail: opts.userEmail }, { id: { in: sharedIds } }];
      }
    }
    const rows = await prisma.forgeDocument.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toRecord);
  });
}

export async function getDocument(id: string): Promise<DocumentRecord | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeDocument.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  });
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateDocumentStatus(
  id: string,
  status: string,
  chunkCount?: number,
): Promise<void> {
  await withPrisma(async (prisma) => {
    const data: Record<string, unknown> = { status };
    if (chunkCount !== undefined) data.chunkCount = chunkCount;
    await prisma.forgeDocument.update({ where: { id }, data });
  });
}

export async function updateDocumentCategory(id: string, category: string): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeDocument.update({
      where: { id },
      data: { category },
    });
  });
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteDocument(id: string): Promise<boolean> {
  // Delete vector embeddings for this document
  try {
    const { deleteEmbeddingsBySource } = await import("@/lib/embeddings/store");
    await deleteEmbeddingsBySource(id);
  } catch {
    // best-effort
  }

  return withPrisma(async (prisma) => {
    try {
      await prisma.forgeDocument.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function toRecord(row: {
  id: string;
  filename: string;
  mimeType: string;
  category: string;
  chunkCount: number;
  sizeBytes: number;
  status: string;
  uploadedBy: string | null;
  ownerEmail?: string | null;
  createdAt: Date;
}): DocumentRecord {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    category: row.category,
    chunkCount: row.chunkCount,
    sizeBytes: row.sizeBytes,
    status: row.status,
    uploadedBy: row.uploadedBy,
    ownerEmail: row.ownerEmail ?? null,
    createdAt: row.createdAt,
  };
}
