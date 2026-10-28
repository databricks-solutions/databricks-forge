/**
 * Shared prompt-injection defense utilities for untrusted catalog metadata,
 * RAG context chunks, uploaded documents, and scraped web content.
 */

const SPOOFED_DELIMITER_RE =
  /---\s*(?:BEGIN|END)\s+(?:USER\s+DATA|USER\s+QUESTION|UNTRUSTED\s+CONTEXT|CONVERSATION\s+HISTORY|SAMPLE\s+DATA)\s*---/gi;

/**
 * Strip any attempt to spoof or prematurely close a Forge prompt delimiter block.
 */
export function stripDelimiterMarkers(value: string): string {
  if (!value) return value;
  return value.replace(SPOOFED_DELIMITER_RE, "");
}

/**
 * Wrap untrusted text inside a labeled delimiter block after stripping any
 * internal delimiter-escape markers.
 */
export function wrapUntrustedBlock(
  label: "USER DATA" | "USER QUESTION" | "UNTRUSTED CONTEXT" | "CONVERSATION HISTORY",
  value: string,
): string {
  const cleaned = stripDelimiterMarkers(value);
  return `---BEGIN ${label}---\n${cleaned}\n---END ${label}---`;
}
