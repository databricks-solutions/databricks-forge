/**
 * Text chunking for document embedding.
 *
 * Splits text into overlapping windows suitable for embedding.
 * Uses a simple token approximation (4 chars per token) to avoid
 * requiring a full tokenizer dependency.
 */

const CHARS_PER_TOKEN = 4;
const DEFAULT_CHUNK_TOKENS = 512;
const DEFAULT_OVERLAP_TOKENS = 64;

export interface TextChunk {
  text: string;
  index: number;
  startChar: number;
  endChar: number;
}

/**
 * Split text into overlapping chunks using a sliding window.
 *
 * @param text       The full document text
 * @param chunkSize  Target chunk size in tokens (default 512)
 * @param overlap    Overlap between chunks in tokens (default 64)
 */
export function chunkText(
  text: string,
  chunkSize: number = DEFAULT_CHUNK_TOKENS,
  overlap: number = DEFAULT_OVERLAP_TOKENS,
): TextChunk[] {
  if (!text || text.trim().length === 0) return [];

  const chunkChars = chunkSize * CHARS_PER_TOKEN;
  const overlapChars = overlap * CHARS_PER_TOKEN;
  const stepChars = chunkChars - overlapChars;

  if (text.length <= chunkChars) {
    return [{ text: text.trim(), index: 0, startChar: 0, endChar: text.length }];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkChars, text.length);

    // Try to break at a sentence or paragraph boundary
    if (end < text.length) {
      const breakSearch = text.slice(end - 200, end);
      const lastPeriod = breakSearch.lastIndexOf(". ");
      const lastNewline = breakSearch.lastIndexOf("\n");
      const breakPoint = Math.max(lastPeriod, lastNewline);
      if (breakPoint > 0) {
        end = end - 200 + breakPoint + 1;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push({ text: chunk, index, startChar: start, endChar: end });
      index++;
    }

    start += stepChars;
    if (start >= text.length) break;
  }

  return chunks;
}
