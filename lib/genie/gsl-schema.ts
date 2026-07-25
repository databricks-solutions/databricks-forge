/**
 * Genie Space Language (GSL) instruction schema.
 *
 * The canonical 5-section template every `text_instructions[].content` block
 * is expected to follow:
 *
 *   ## PURPOSE
 *   ...
 *   ## DISAMBIGUATION
 *   ...
 *   ## DATA QUALITY NOTES
 *   ...
 *   ## CONSTRAINTS
 *   ...
 *   ## Instructions you must follow when providing summaries
 *   <verbatim Databricks-blessed string>
 *
 * Mirrors upstream `databricks-genie-workbench` GSL schema. Used by:
 *   - `lib/genie/passes/instruction-generation.ts` (output shape + retry)
 *   - `lib/genie/space-fixer.ts` (section-preserving patches)
 *   - `lib/genie/health-checks/evaluators.ts` (the
 *     `text-instructions-uses-gsl-sections` evaluator)
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The five canonical section headers in the *exact* order they must appear.
 * These strings are matched literally (case-insensitive but whitespace-strict)
 * against `## ...` markdown headers.
 */
export const GSL_SECTIONS = [
  "## PURPOSE",
  "## DISAMBIGUATION",
  "## DATA QUALITY NOTES",
  "## CONSTRAINTS",
  "## Instructions you must follow when providing summaries",
] as const;

export type GslSection = (typeof GSL_SECTIONS)[number];

/** Soft cap on the total length of a single text_instructions content block. */
export const GSL_MAX_CHARS = 2000;

/**
 * The exact verbatim string Genie expects in the final section. Adapted from
 * the upstream Databricks-blessed copy. We keep the wording stable so the
 * downstream Genie summarizer recognizes it.
 */
export const GSL_SUMMARY_VERBATIM = [
  "When you produce a final summary for the user:",
  "- Lead with the direct answer in one sentence.",
  "- Cite the specific tables and columns the answer is grounded in.",
  "- Call out filters, time windows, and granularity used.",
  "- If you fell back to assumptions or defaults, list them explicitly.",
  "- Never fabricate data: only state what the SQL actually returned.",
].join("\n");

/**
 * The minimum body each section needs to be considered "non-empty" by
 * validators. Three characters is intentionally low so we don't punish
 * authors for terse but valid content.
 */
export const GSL_MIN_SECTION_BODY_CHARS = 3;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface GslValidationResult {
  valid: boolean;
  /** Sections that were missing entirely. */
  missing: GslSection[];
  /** Sections that appeared in the wrong order relative to GSL_SECTIONS. */
  outOfOrder: GslSection[];
  /** Sections that were empty (only whitespace). */
  empty: GslSection[];
  /** True when the final summary section's body matches GSL_SUMMARY_VERBATIM. */
  summaryVerbatim: boolean;
  /** Total character count of the input. */
  length: number;
  /** True when length > GSL_MAX_CHARS. */
  oversize: boolean;
  /** Human-readable reason; populated when valid=false. */
  reason?: string;
}

/**
 * Validate a `text_instructions[].content` block against the GSL spec.
 *
 * Hard requirements (`valid=false` when any fail):
 *   - all 5 GSL_SECTIONS present
 *   - sections appear in the canonical order
 *   - no section body is empty
 *
 * Soft signals (don't fail validation but exposed for the caller):
 *   - `oversize`     -- length > GSL_MAX_CHARS
 *   - `summaryVerbatim` -- last section body matches GSL_SUMMARY_VERBATIM
 */
export function validateGsl(content: string): GslValidationResult {
  const text = String(content ?? "");
  const length = text.length;
  const oversize = length > GSL_MAX_CHARS;

  const lines = text.split(/\r?\n/);
  const headerIndices = new Map<GslSection, number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("## ")) continue;
    for (const sec of GSL_SECTIONS) {
      if (line.toLowerCase() === sec.toLowerCase()) {
        if (!headerIndices.has(sec)) headerIndices.set(sec, i);
      }
    }
  }

  const missing: GslSection[] = [];
  const outOfOrder: GslSection[] = [];
  const empty: GslSection[] = [];

  let prevIdx = -1;
  for (const sec of GSL_SECTIONS) {
    const idx = headerIndices.get(sec);
    if (idx === undefined) {
      missing.push(sec);
      continue;
    }
    if (idx < prevIdx) outOfOrder.push(sec);
    prevIdx = idx;
  }

  // Body emptiness: scan from each header index up to the next GSL header.
  const orderedHeaders = [...GSL_SECTIONS]
    .map((sec) => ({ sec, idx: headerIndices.get(sec) }))
    .filter((h): h is { sec: GslSection; idx: number } => h.idx !== undefined)
    .sort((a, b) => a.idx - b.idx);

  for (let h = 0; h < orderedHeaders.length; h++) {
    const start = orderedHeaders[h].idx + 1;
    const end = h + 1 < orderedHeaders.length ? orderedHeaders[h + 1].idx : lines.length;
    const body = lines
      .slice(start, end)
      .join("\n")
      .trim();
    if (body.length < GSL_MIN_SECTION_BODY_CHARS) empty.push(orderedHeaders[h].sec);
  }

  // Summary verbatim check: compare normalized whitespace.
  const summarySec = GSL_SECTIONS[GSL_SECTIONS.length - 1];
  const summaryIdx = headerIndices.get(summarySec);
  let summaryBody = "";
  if (summaryIdx !== undefined) {
    summaryBody = lines.slice(summaryIdx + 1).join("\n").trim();
  }
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const summaryVerbatim = normalize(summaryBody).includes(normalize(GSL_SUMMARY_VERBATIM).slice(0, 80));

  const valid = missing.length === 0 && outOfOrder.length === 0 && empty.length === 0;

  return {
    valid,
    missing,
    outOfOrder,
    empty,
    summaryVerbatim,
    length,
    oversize,
    reason: valid
      ? undefined
      : [
          missing.length > 0 ? `missing: ${missing.join(", ")}` : null,
          outOfOrder.length > 0 ? `out_of_order: ${outOfOrder.join(", ")}` : null,
          empty.length > 0 ? `empty: ${empty.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join("; "),
  };
}

// ---------------------------------------------------------------------------
// Section parsing & merging (used by section-preserving fixer)
// ---------------------------------------------------------------------------

export interface ParsedGsl {
  /**
   * Each canonical section's body, keyed by section header. Missing sections
   * map to `null` so writers know whether to insert vs. update.
   */
  sections: Record<GslSection, string | null>;
}

/** Parse a GSL content block into per-section bodies. */
export function parseGsl(content: string): ParsedGsl {
  const lines = String(content ?? "").split(/\r?\n/);
  const headerIndices = new Map<GslSection, number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("## ")) continue;
    for (const sec of GSL_SECTIONS) {
      if (line.toLowerCase() === sec.toLowerCase() && !headerIndices.has(sec)) {
        headerIndices.set(sec, i);
      }
    }
  }
  const ordered = [...GSL_SECTIONS]
    .map((sec) => ({ sec, idx: headerIndices.get(sec) }))
    .filter((h): h is { sec: GslSection; idx: number } => h.idx !== undefined)
    .sort((a, b) => a.idx - b.idx);

  const sections = Object.fromEntries(GSL_SECTIONS.map((s) => [s, null])) as Record<
    GslSection,
    string | null
  >;
  for (let h = 0; h < ordered.length; h++) {
    const start = ordered[h].idx + 1;
    const end = h + 1 < ordered.length ? ordered[h + 1].idx : lines.length;
    sections[ordered[h].sec] = lines.slice(start, end).join("\n").trim();
  }
  return { sections };
}

/**
 * Render a `ParsedGsl` back to canonical GSL markdown. Preserves any
 * sections that were originally null/empty by skipping them rather than
 * emitting an empty header (which would fail validation again).
 */
export function renderGsl(parsed: ParsedGsl): string {
  const out: string[] = [];
  for (const sec of GSL_SECTIONS) {
    const body = parsed.sections[sec];
    if (body == null || body.trim().length === 0) continue;
    out.push(sec, "", body, "");
  }
  return out.join("\n").trimEnd();
}

/**
 * Merge a partial section-update on top of an existing GSL block without
 * erasing other sections. Pass an object whose keys are GslSection headers
 * and values are new section bodies. Existing values are preserved when a
 * key is omitted.
 */
export function mergeGslSections(
  existing: string,
  updates: Partial<Record<GslSection, string | null>>,
): string {
  const parsed = parseGsl(existing);
  for (const sec of GSL_SECTIONS) {
    if (sec in updates) {
      parsed.sections[sec] = updates[sec] ?? parsed.sections[sec] ?? null;
    }
  }
  return renderGsl(parsed);
}

/**
 * Build a fresh, fully-populated GSL block from per-section bodies. Missing
 * sections are filled with sensible defaults so the result always passes
 * `validateGsl`.
 */
export function buildGsl(opts: {
  purpose: string;
  disambiguation: string;
  dataQualityNotes: string;
  constraints: string;
  /** When omitted, GSL_SUMMARY_VERBATIM is used. */
  instructions?: string;
}): string {
  const sections: Record<GslSection, string> = {
    "## PURPOSE": opts.purpose.trim(),
    "## DISAMBIGUATION": opts.disambiguation.trim(),
    "## DATA QUALITY NOTES": opts.dataQualityNotes.trim(),
    "## CONSTRAINTS": opts.constraints.trim(),
    "## Instructions you must follow when providing summaries":
      (opts.instructions ?? GSL_SUMMARY_VERBATIM).trim(),
  };
  return GSL_SECTIONS.map((sec) => `${sec}\n\n${sections[sec]}`).join("\n\n");
}

/**
 * Returns a system-prompt-friendly schema reminder. Drop into
 * `instruction-generation` prompts as the required output shape.
 */
export function gslPromptInstructions(): string {
  return [
    "Output the text instruction as ONE markdown block with these five sections IN ORDER:",
    ...GSL_SECTIONS.map((s) => `- ${s}`),
    "",
    `Total length must be <= ${GSL_MAX_CHARS} characters.`,
    "Each section must have a non-empty body.",
    `The final section's body MUST be exactly the string below, no edits:\n${GSL_SUMMARY_VERBATIM}`,
  ].join("\n");
}
