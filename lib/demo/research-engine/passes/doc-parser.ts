/**
 * Pass 3: Document Parsing
 *
 * Processes user-uploaded documents and pasted text into a combined
 * source text block for the analytical passes.
 */

import type { Logger } from "@/lib/ports/logger";
import type { ParsedDocument, ResearchSource } from "../../types";
import { fromUrl, fromTextBody } from "../date-extraction";

export function runDocParsing(
  uploadedDocuments: ParsedDocument[] | undefined,
  pastedContext: string | undefined,
  opts: {
    logger: Logger;
    onSourceReady?: (source: ResearchSource) => void;
  },
): { text: string; sources: ResearchSource[] } {
  const { logger: log, onSourceReady } = opts;
  const sources: ResearchSource[] = [];
  const texts: string[] = [];

  if (uploadedDocuments?.length) {
    for (const doc of uploadedDocuments) {
      const source: ResearchSource = {
        type: "upload",
        title: doc.filename,
        charCount: doc.charCount,
        status: "ready",
      };
      applyDocDateSignals(source, doc);
      sources.push(source);
      texts.push(`[UPLOADED: ${doc.filename} (${doc.category})]\n${doc.text}`);
      onSourceReady?.(source);
    }

    log.info("Uploaded documents processed", {
      count: uploadedDocuments.length,
      totalChars: uploadedDocuments.reduce((sum, d) => sum + d.charCount, 0),
    });
  }

  if (pastedContext?.trim()) {
    const source: ResearchSource = {
      type: "paste",
      title: "Pasted context",
      charCount: pastedContext.length,
      status: "ready",
    };
    const fromPasteBody = fromTextBody(pastedContext);
    if (fromPasteBody) {
      source.publishedAt = fromPasteBody.publishedAt;
      source.publishedYear = fromPasteBody.publishedYear;
      source.dateConfidence = fromPasteBody.dateConfidence;
    } else {
      source.dateConfidence = "unknown";
    }
    sources.push(source);
    texts.push(`[PASTED]\n${pastedContext}`);
    onSourceReady?.(source);

    log.info("Pasted context added", { chars: pastedContext.length });
  }

  return { text: texts.join("\n\n---\n\n"), sources };
}

/**
 * Attribute a publication year to an uploaded document.
 * Priority: filename year regex (medium) > text body scan (low).
 */
function applyDocDateSignals(source: ResearchSource, doc: ParsedDocument): void {
  const fromFilename = fromUrl(doc.filename);
  if (fromFilename) {
    source.publishedAt = fromFilename.publishedAt;
    source.publishedYear = fromFilename.publishedYear;
    source.dateConfidence = fromFilename.dateConfidence;
    return;
  }
  const fromBody = fromTextBody(doc.text);
  if (fromBody) {
    source.publishedAt = fromBody.publishedAt;
    source.publishedYear = fromBody.publishedYear;
    source.dateConfidence = fromBody.dateConfidence;
    return;
  }
  source.dateConfidence = "unknown";
}
