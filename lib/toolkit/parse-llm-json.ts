import { logger } from "@/lib/logger";

/**
 * Safely parse JSON from LLM responses.
 *
 * May be wrapped in
 * markdown code fences, contain preamble/postamble text, or
 * include BOM characters.
 *
 * Multi-strategy approach:
 * 1. Try raw JSON.parse (fast path for well-behaved models)
 * 2. Extract between ```json / ``` fences using indexOf
 * 3. Bracket-match: find first { or [ and last } or ]
 * 4. Repair common LLM JSON errors (missing commas, trailing commas)
 * 5. Throw descriptive error (with raw string logged for diagnostics)
 */
export function parseLLMJson(raw: string, caller?: string): unknown {
  const trimmed = raw.replace(/^\uFEFF/, "").trim();

  // Strategy 1: direct parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  // Strategy 2: extract from markdown code fences (indexOf, not regex)
  const fenced = extractFromFences(trimmed);
  if (fenced !== null) {
    try {
      return JSON.parse(fenced);
    } catch {
      // continue to bracket matching on the fenced content
      const bracketed = extractBrackets(fenced);
      if (bracketed !== null) {
        try {
          return JSON.parse(bracketed);
        } catch {
          // try repair on fenced bracket content
          return tryRepairAndParse(bracketed, caller);
        }
      }
    }
  }

  // Strategy 3: bracket-match on the full string
  const bracketed = extractBrackets(trimmed);
  if (bracketed !== null) {
    try {
      return JSON.parse(bracketed);
    } catch {
      // Strategy 4: repair common LLM JSON errors then re-parse
      return tryRepairAndParse(bracketed, caller);
    }
  }

  logger.warn("parseLLMJson: no JSON structure found in LLM response", {
    caller,
    rawLength: trimmed.length,
    raw: trimmed.slice(0, 4000),
  });
  throw new SyntaxError(
    `parseLLMJson${caller ? ` [${caller}]` : ""}: unable to extract valid JSON from LLM response (${trimmed.length} chars, starts with: ${JSON.stringify(trimmed.slice(0, 60))})`,
  );
}

/**
 * Attempt to repair common JSON errors produced by LLMs and re-parse.
 * If standard repair fails, attempts truncation recovery to salvage
 * complete array elements from output that was cut off mid-generation.
 */
function tryRepairAndParse(text: string, caller?: string): unknown {
  const repaired = repairLlmJson(text);
  try {
    return JSON.parse(repaired);
  } catch {
    // continue to truncation recovery
  }

  // Truncation recovery: try to close open structures to salvage partial output
  const recovered = tryTruncationRecovery(repaired);
  if (recovered !== null) {
    try {
      const result = JSON.parse(recovered);
      logger.warn("parseLLMJson: recovered truncated JSON output", {
        caller,
        rawLength: text.length,
        recoveredLength: recovered.length,
      });
      return result;
    } catch {
      // fall through to final error
    }
  }

  logger.warn("parseLLMJson: all strategies failed, dumping raw LLM output", {
    caller,
    rawLength: text.length,
    raw: text.slice(0, 4000),
    repairedDiff: repaired !== text,
  });
  throw new SyntaxError(
    `parseLLMJson${caller ? ` [${caller}]` : ""}: unable to extract valid JSON from LLM response (${text.length} chars)`,
  );
}

/**
 * Attempt to recover a valid JSON object from truncated LLM output by
 * finding the last complete array element and closing all open structures.
 *
 * Works by scanning backwards from the truncation point to find the last
 * complete JSON value boundary, then appending the necessary closing
 * brackets/braces.
 */
function tryTruncationRecovery(text: string): string | null {
  const trimmed = text.trimEnd();
  if (trimmed.length === 0) return null;

  // Only attempt recovery if the text starts with { or [ (valid JSON root)
  const firstChar = trimmed[0];
  if (firstChar !== "{" && firstChar !== "[") return null;

  // Find the last position where a complete value ends.
  // In JSON, values end at: }, ], ", digits, true/false/null.
  // We look for the last } or ] that could close an array element,
  // or the last complete string/number/boolean value.
  // The safest heuristic: find the last complete object "}" in an array context.

  // Strategy: progressively trim from the end, trying to close the structure.
  // Find the last occurrence of '}' or ']' that might end a complete element.
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const ch = trimmed[i];
    if (ch !== "}" && ch !== "]" && ch !== '"' && !/\d/.test(ch)) continue;

    const candidate = trimmed.slice(0, i + 1);
    const closers = computeClosingBrackets(candidate);
    if (closers === null) continue;

    const attempt = candidate + closers;
    try {
      JSON.parse(attempt);
      return attempt;
    } catch {
      // continue scanning backwards
    }
  }

  return null;
}

/**
 * Given a JSON prefix, compute the sequence of closing brackets/braces
 * needed to make it structurally complete. Returns null if the nesting
 * stack is inconsistent (e.g., mismatched brackets).
 */
function computeClosingBrackets(text: string): string | null {
  const stack: string[] = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (inString) {
      if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      stack.push("}");
    } else if (ch === "[") {
      stack.push("]");
    } else if (ch === "}" || ch === "]") {
      if (stack.length === 0) return null;
      const expected = stack.pop();
      if (expected !== ch) return null;
    }
  }

  // If we're inside an unclosed string, we can't reliably recover
  if (inString) return null;

  return stack.reverse().join("");
}

/**
 * Fix common structural JSON errors in LLM output.
 *
 * In valid JSON, literal newlines only appear between tokens (never inside
 * strings, where they must be escaped as \n). This means patterns like
 * `}\n{` are unambiguously a missing comma between adjacent array elements.
 */
function repairLlmJson(text: string): string {
  let result = text;

  // Fix 1: Missing comma between adjacent objects in arrays — the #1 LLM JSON error.
  //   } <whitespace/newline> {  →  }, {
  //   Also handles same-line  } {  (compact JSON from json_object mode).
  result = result.replace(/\}(\s+)\{/g, "},$1{");

  // Fix 2: Missing comma between a closing bracket/brace and the next element.
  //   ] <whitespace> {  or  } <whitespace> [
  result = result.replace(/\](\s+)\{/g, "],$1{");
  result = result.replace(/\}(\s+)\[/g, "},$1[");

  // Fix 3: Trailing commas before ] or } (common when LLM adds a comma after
  // the last element).
  result = result.replace(/,(\s*[\]}])/g, "$1");

  return result;
}

function extractFromFences(text: string): string | null {
  // Find opening fence: ``` optionally followed by "json" and whitespace
  const openPatterns = ["```json\n", "```json\r\n", "```json ", "```\n", "```\r\n"];
  let openIdx = -1;
  let contentStart = -1;

  for (const pat of openPatterns) {
    const idx = text.indexOf(pat);
    if (idx !== -1 && (openIdx === -1 || idx < openIdx)) {
      openIdx = idx;
      contentStart = idx + pat.length;
    }
  }

  if (openIdx === -1 || contentStart === -1) return null;

  // Find closing fence after the content starts
  const closeIdx = text.indexOf("```", contentStart);
  if (closeIdx === -1) {
    // No closing fence -- take everything after the opening
    return text.slice(contentStart).trim();
  }

  return text.slice(contentStart, closeIdx).trim();
}

function extractBrackets(text: string): string | null {
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");

  let start: number;
  let closeChar: string;

  if (firstBrace === -1 && firstBracket === -1) return null;

  if (firstBrace === -1) {
    start = firstBracket;
    closeChar = "]";
  } else if (firstBracket === -1) {
    start = firstBrace;
    closeChar = "}";
  } else if (firstBracket < firstBrace) {
    start = firstBracket;
    closeChar = "]";
  } else {
    start = firstBrace;
    closeChar = "}";
  }

  const end = text.lastIndexOf(closeChar);
  if (end <= start) return null;

  return text.slice(start, end + 1);
}
