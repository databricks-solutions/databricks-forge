const REDACTED_CREDENTIAL = "[redacted credential]";
const REDACTED_CONTENT = "[redacted content]";
const REDACTED_SQL = "[redacted SQL]";

const AUTHORIZATION_HEADER = /\bauthorization\s*[:=]\s*[a-z][a-z0-9._~-]*\s+[^\s;,]+/gi;
const SECRET_ASSIGNMENT =
  /(\b(?:x[-_])?(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|password)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s&;,}]+)/gi;
const IDENTIFIER_PART = '(?:`[^`]+`|"[^"]+"|[a-zA-Z_][a-zA-Z0-9_-]*)';
const QUALIFIED_IDENTIFIER = `${IDENTIFIER_PART}(?:\\s*\\.\\s*${IDENTIFIER_PART}){0,2}`;
const SELECT_EXPRESSION_EVIDENCE = [
  "'[^']*'",
  '"[^"]*"',
  "\\b\\d+(?:\\.\\d+)?\\b",
  "\\*",
  `${IDENTIFIER_PART}\\s*\\(`,
  ",",
  "\\s+AS\\s+",
  "\\s+(?:\\+|-|/|%|=|<>|!=|<=|>=)\\s+",
].join("|");
const OBJECT_TYPE = "(?:TABLE|VIEW|MATERIALIZED\\s+VIEW|FUNCTION|SCHEMA|DATABASE|CATALOG)";
const STATEMENT_END = "(?=;|$)";
const SQL_STATEMENT = new RegExp(
  [
    `\\bSELECT\\b(?=[\\s\\S]{1,1200}?\\bFROM\\s+${QUALIFIED_IDENTIFIER}(?=\\s|;|$))[\\s\\S]*?${STATEMENT_END}`,
    `\\bSELECT\\b(?=[^;]{1,1200}(?:${SELECT_EXPRESSION_EVIDENCE}))[^;]*?${STATEMENT_END}`,
    `\\bUPDATE\\s+${QUALIFIED_IDENTIFIER}\\s+SET\\b[\\s\\S]*?${STATEMENT_END}`,
    `\\bINSERT\\s+INTO\\s+${QUALIFIED_IDENTIFIER}(?=\\s|\\(|;|$)[\\s\\S]*?${STATEMENT_END}`,
    `\\bDELETE\\s+FROM\\s+${QUALIFIED_IDENTIFIER}(?=\\s|;|$)[\\s\\S]*?${STATEMENT_END}`,
    `\\bMERGE\\s+INTO\\s+${QUALIFIED_IDENTIFIER}(?=\\s|;|$)[\\s\\S]*?\\bUSING\\b[\\s\\S]*?${STATEMENT_END}`,
    `\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?${OBJECT_TYPE}\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${QUALIFIED_IDENTIFIER}(?=\\s|\\(|;|$)[\\s\\S]*?${STATEMENT_END}`,
    `\\bALTER\\s+${OBJECT_TYPE}\\s+${QUALIFIED_IDENTIFIER}(?=\\s|;|$)[\\s\\S]*?${STATEMENT_END}`,
    `\\bDROP\\s+${OBJECT_TYPE}\\s+(?:IF\\s+EXISTS\\s+)?${QUALIFIED_IDENTIFIER}(?=\\s|;|$)[\\s\\S]*?${STATEMENT_END}`,
  ].join("|"),
  "gi",
);
const PROMPT_ASSIGNMENT = /\bprompt\s*[:=]\s*[^;]*/gi;

/**
 * Produces a bounded diagnostic suitable for logs and API error metadata.
 * It preserves ordinary explanatory text while removing common credential,
 * SQL, and prompt-bearing forms.
 */
export function sanitizeBoundedDiagnostic(
  message: string | undefined,
  maxLength = 240,
): string | undefined {
  if (!message) return undefined;
  const sanitized = message
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(AUTHORIZATION_HEADER, `Authorization: ${REDACTED_CREDENTIAL}`)
    .replace(SECRET_ASSIGNMENT, (_match, prefix: string) => `${prefix}${REDACTED_CREDENTIAL}`)
    .replace(SQL_STATEMENT, REDACTED_SQL)
    .replace(PROMPT_ASSIGNMENT, REDACTED_CONTENT)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.max(0, maxLength));
  return sanitized || undefined;
}
