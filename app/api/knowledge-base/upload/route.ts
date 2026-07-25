/**
 * API: /api/knowledge-base/upload
 *
 * POST -- Upload a document (PDF, Markdown, or plain text) for embedding.
 *
 * Accepts multipart/form-data with:
 *   file      (required)  The document file
 *   category  (optional)  strategy | data_dictionary | governance_policy | architecture | other
 *
 * Processing pipeline:
 *   1. Parse file contents (PDF via pdf-parse, MD/TXT natively)
 *   2. Chunk into 512-token windows with 64-token overlap
 *   3. Embed chunks via databricks-qwen3-embedding-0-6b
 *   4. Store in forge_embeddings as document_chunk kind
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { safeErrorMessage } from "@/lib/error-utils";
import { createDocument, updateDocumentStatus } from "@/lib/lakebase/documents";
import { chunkText } from "@/lib/embeddings/chunker";
import { composeDocumentChunk } from "@/lib/embeddings/compose";
import { generateEmbeddings } from "@/lib/embeddings/client";
import { insertEmbeddings, deleteEmbeddingsBySource } from "@/lib/embeddings/store";
import type { EmbeddingInput } from "@/lib/embeddings/types";
import { isEmbeddingEnabled } from "@/lib/embeddings/config";
import { logger } from "@/lib/logger";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "text/markdown",
  "text/plain",
  "text/x-markdown",
]);

export async function POST(request: NextRequest) {
  try {
    if (!isEmbeddingEnabled()) {
      return NextResponse.json(
        {
          error:
            "Knowledge base uploads require the embedding endpoint (serving-endpoint-embedding) to be configured.",
        },
        { status: 503 },
      );
    }

    const user = await requireUser(request);
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const category = (formData.get("category") as string) || "other";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (
      !ALLOWED_TYPES.has(file.type) &&
      !file.name.endsWith(".md") &&
      !file.name.endsWith(".txt")
    ) {
      return NextResponse.json(
        { error: "Unsupported file type. Allowed: PDF, Markdown, plain text" },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 },
      );
    }

    const docId = randomUUID();

    await createDocument({
      id: docId,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      category,
      sizeBytes: file.size,
      uploadedBy: user.email,
      ownerEmail: user.email,
    });

    // Extract text
    let text: string;
    const buffer = Buffer.from(await file.arrayBuffer());

    if (file.type === "application/pdf") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ text: string }>;
        const pdfData = await pdfParse(buffer);
        text = pdfData.text;
      } catch (err) {
        await updateDocumentStatus(docId, "failed");
        logger.error("[knowledge-base/upload] PDF parsing failed", {
          docId,
          filename: file.name,
          error: err instanceof Error ? err.message : String(err),
        });
        return NextResponse.json({ error: "Failed to parse PDF" }, { status: 422 });
      }
    } else {
      text = buffer.toString("utf-8");
    }

    if (!text || text.trim().length === 0) {
      await updateDocumentStatus(docId, "empty");
      return NextResponse.json({ error: "Document contains no extractable text" }, { status: 422 });
    }

    // Chunk and embed (async, non-blocking for large docs)
    processDocumentChunks(docId, file.name, category, text).catch((err) => {
      logger.error("[knowledge-base/upload] Background processing failed", {
        docId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return NextResponse.json({
      id: docId,
      filename: file.name,
      category,
      sizeBytes: file.size,
      status: "processing",
    });
  } catch (error) {
    if (error instanceof ForgeAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error("[knowledge-base/upload] POST failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

async function processDocumentChunks(
  docId: string,
  filename: string,
  category: string,
  text: string,
): Promise<void> {
  try {
    const chunks = chunkText(text);

    if (chunks.length === 0) {
      await updateDocumentStatus(docId, "empty", 0);
      return;
    }

    const composedTexts = chunks.map((c) =>
      composeDocumentChunk(c.text, filename, category, c.index),
    );

    const embeddings = await generateEmbeddings(composedTexts);

    const inputs: EmbeddingInput[] = chunks.map((c, i) => ({
      kind: "document_chunk" as const,
      sourceId: docId,
      contentText: composedTexts[i],
      metadataJson: {
        filename,
        category,
        chunkIndex: c.index,
        startChar: c.startChar,
        endChar: c.endChar,
      },
      embedding: embeddings[i],
    }));

    await deleteEmbeddingsBySource(docId);
    await insertEmbeddings(inputs);
    await updateDocumentStatus(docId, "ready", chunks.length);

    logger.info("[knowledge-base/upload] Document embedded", {
      docId,
      filename,
      chunks: chunks.length,
    });
  } catch (err) {
    await updateDocumentStatus(docId, "failed");
    throw err;
  }
}
