/**
 * Requirements Parser -- extracts Genie Space configuration from
 * uploaded requirements documents (PDF, Markdown, plain text).
 *
 * Powers the "Create from Requirements" flow in Genie Studio.
 */

import { cachedChatCompletion } from "@/lib/toolkit/llm-cache";
import { parseLLMJson } from "@/lib/genie/passes/parse-llm-json";
import { resolveEndpoint } from "@/lib/dbx/client";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedRequirements {
  tables: string[];
  businessQuestions: string[];
  sqlExamples: Array<{ question: string; sql: string }>;
  instructions: string[];
  joinHints: Array<{ leftTable: string; rightTable: string; hint: string }>;
  domainContext: string;
  suggestedTitle: string;
  glossaryTerms: Array<{ term: string; definition: string }>;
  confidence: number;
}

export interface ParsedDocument {
  text: string;
  title: string;
  format: "pdf" | "markdown" | "text";
  wordCount: number;
}

// ---------------------------------------------------------------------------
// Document text extraction
// ---------------------------------------------------------------------------

export function parseMarkdown(content: string, filename: string): ParsedDocument {
  return {
    text: content,
    title: filename.replace(/\.(md|markdown|txt)$/i, ""),
    format: content.startsWith("#") ? "markdown" : "text",
    wordCount: content.split(/\s+/).length,
  };
}

export async function parsePdf(buffer: Buffer, filename: string): Promise<ParsedDocument> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ text: string }>;
  const data = await pdfParse(buffer);
  return {
    text: data.text,
    title: filename.replace(/\.pdf$/i, ""),
    format: "pdf",
    wordCount: data.text.split(/\s+/).length,
  };
}

// ---------------------------------------------------------------------------
// LLM extraction
// ---------------------------------------------------------------------------

export async function extractRequirements(doc: ParsedDocument): Promise<ExtractedRequirements> {
  const truncatedText =
    doc.text.length > 15_000 ? doc.text.slice(0, 15_000) + "\n...[truncated]" : doc.text;

  const messages = [
    {
      role: "system" as const,
      content: `You are an expert data analyst extracting structured requirements from a business document for a Databricks Genie Space.

Extract the following from the document:

1. **tables**: Fully qualified Unity Catalog table names (catalog.schema.table format). Extract from explicit references, FROM/JOIN clauses, or table-like references.
2. **businessQuestions**: Natural language questions users would ask. Extract from FAQ sections, requirement lists, or infer from the domain.
3. **sqlExamples**: Pairs of {question, sql} where SQL is explicitly provided in the document.
4. **instructions**: Specific rules, constraints, or guidance for the AI assistant (e.g., "always use DISTINCT", "revenue = price * quantity").
5. **joinHints**: Table relationships mentioned (e.g., "orders join customers on customer_id").
6. **domainContext**: 2-3 sentence summary of the business domain and analytics goals.
7. **suggestedTitle**: Descriptive Genie Space title (max 60 chars).
8. **glossaryTerms**: Domain-specific term definitions [{term, definition}].
9. **confidence**: 0-100 score of how well you could extract structured requirements.

For tables: if only partial names are given (e.g., "orders table"), include them as-is -- the user will map them to full FQNs later.

Return JSON matching this schema exactly.`,
    },
    {
      role: "user" as const,
      content: `Document: "${doc.title}" (${doc.format}, ${doc.wordCount} words)

---
${truncatedText}
---

Extract all requirements for building a Genie Space.`,
    },
  ];

  try {
    const result = await cachedChatCompletion({
      endpoint: resolveEndpoint("classification"),
      messages,
      temperature: 0.1,
      maxTokens: 8192,
      responseFormat: "json_object",
    });

    const parsed = parseLLMJson(result.content ?? "", "requirements-extraction") as Record<
      string,
      unknown
    >;

    const toStringArray = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

    const toSqlExamples = (v: unknown): Array<{ question: string; sql: string }> =>
      Array.isArray(v)
        ? v
            .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
            .map((x) => ({ question: String(x.question ?? ""), sql: String(x.sql ?? "") }))
            .filter((x) => x.question && x.sql)
        : [];

    const toJoinHints = (
      v: unknown,
    ): Array<{ leftTable: string; rightTable: string; hint: string }> =>
      Array.isArray(v)
        ? v
            .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
            .map((x) => ({
              leftTable: String(x.leftTable ?? ""),
              rightTable: String(x.rightTable ?? ""),
              hint: String(x.hint ?? ""),
            }))
            .filter((x) => x.leftTable && x.rightTable)
        : [];

    const toGlossary = (v: unknown): Array<{ term: string; definition: string }> =>
      Array.isArray(v)
        ? v
            .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
            .map((x) => ({ term: String(x.term ?? ""), definition: String(x.definition ?? "") }))
            .filter((x) => x.term && x.definition)
        : [];

    const extracted: ExtractedRequirements = {
      tables: toStringArray(parsed.tables),
      businessQuestions: toStringArray(parsed.businessQuestions),
      sqlExamples: toSqlExamples(parsed.sqlExamples),
      instructions: toStringArray(parsed.instructions),
      joinHints: toJoinHints(parsed.joinHints),
      domainContext: String(parsed.domainContext ?? ""),
      suggestedTitle: String(parsed.suggestedTitle ?? doc.title),
      glossaryTerms: toGlossary(parsed.glossaryTerms),
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 50,
    };

    logger.info("Requirements extraction complete", {
      document: doc.title,
      tables: extracted.tables.length,
      questions: extracted.businessQuestions.length,
      sqlExamples: extracted.sqlExamples.length,
      instructions: extracted.instructions.length,
      confidence: extracted.confidence,
    });

    return extracted;
  } catch (err) {
    logger.error("Requirements extraction failed", {
      document: doc.title,
      error: err instanceof Error ? err.message : String(err),
    });

    return {
      tables: [],
      businessQuestions: [],
      sqlExamples: [],
      instructions: [],
      joinHints: [],
      domainContext: "",
      suggestedTitle: doc.title,
      glossaryTerms: [],
      confidence: 0,
    };
  }
}
