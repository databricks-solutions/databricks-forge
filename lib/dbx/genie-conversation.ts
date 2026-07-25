export interface GenieConversationAttachment {
  query?: {
    query?: unknown;
    [key: string]: unknown;
  } | null;
  text?:
    | string
    | {
        content?: unknown;
        [key: string]: unknown;
      }
    | null;
  [key: string]: unknown;
}

/**
 * Shape of a Genie message from the Conversation API, narrowed to the fields
 * Forge reads.
 *
 * The API also returns a top-level `content` field. It is deliberately NOT
 * declared here: `content` echoes the *user's* question, not the assistant's
 * reply, so surfacing it as `textResponse` would render the user's own prompt
 * back to them as an answer. The index signature keeps parsing tolerant of it
 * (and of any other future field) while denying typed access, so no later code
 * can mistake it for assistant text.
 */
export interface GenieConversationApiResponse {
  attachments?: unknown;
  query_result?: {
    query_text?: unknown;
    [key: string]: unknown;
  } | null;
  error?:
    | string
    | {
        message?: unknown;
        [key: string]: unknown;
      }
    | null;
  [key: string]: unknown;
}

export interface ParsedGenieConversationResponse {
  sql?: string;
  textResponse?: string;
  error?: string;
}

function nonblankString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function textContent(value: unknown): string | undefined {
  const direct = nonblankString(value);
  if (direct) return direct;
  if (!Array.isArray(value)) return undefined;

  const parts = value.flatMap((part) => {
    const text = nonblankString(part);
    return text ? [text] : [];
  });
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function attachmentsOf(input: GenieConversationApiResponse): GenieConversationAttachment[] {
  if (!Array.isArray(input.attachments)) return [];
  return input.attachments.filter(
    (attachment): attachment is GenieConversationAttachment =>
      attachment !== null && typeof attachment === "object",
  );
}

export function parseGenieConversationResponse(
  input: GenieConversationApiResponse,
): ParsedGenieConversationResponse {
  const attachments = attachmentsOf(input);

  const modernSql = attachments
    .map((attachment) => nonblankString(attachment.query?.query))
    .find((sql) => sql !== undefined);
  const legacySql = nonblankString(input.query_result?.query_text);

  const textResponse = attachments
    .map((attachment) => {
      if (typeof attachment.text === "string") return nonblankString(attachment.text);
      return textContent(attachment.text?.content);
    })
    .find((text) => text !== undefined);

  const error =
    typeof input.error === "string"
      ? nonblankString(input.error)
      : nonblankString(input.error?.message);

  return {
    ...((modernSql ?? legacySql) ? { sql: modernSql ?? legacySql } : {}),
    ...(textResponse ? { textResponse } : {}),
    ...(error ? { error } : {}),
  };
}
