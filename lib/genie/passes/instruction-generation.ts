/**
 * Pass 4: Instruction Generation (rule-based + optional LLM)
 *
 * Generates text instructions for the Genie space following Databricks best
 * practices: text instructions are a last resort, used only for behavioural
 * guidance that cannot be expressed through SQL expressions or example queries.
 *
 * What belongs here (behavioural):
 *   - Domain identity (short)
 *   - Entity matching hint
 *   - Time period / fiscal year guidance
 *   - Clarification question rules
 *   - Summary customisation
 *   - Glossary / business terminology
 *   - Customer global instructions
 *
 * What does NOT belong here (handled by structured API fields):
 *   - SQL quality rules (taught via example SQL queries)
 *   - Join relationships (structured join_specs in SerializedSpace)
 *   - Measures / filters / dimensions (SQL expressions in knowledge store)
 *   - Full business context / value chain / strategic goals
 */

import { type ChatMessage } from "@/lib/dbx/model-serving";
import { cachedChatCompletion } from "@/lib/toolkit/llm-cache";
import { logger } from "@/lib/logger";
import {
  GSL_MAX_CHARS,
  buildGsl,
  gslPromptInstructions,
  validateGsl,
} from "@/lib/genie/gsl-schema";
import type { BusinessContext, MetadataSnapshot } from "@/lib/domain/types";
import type {
  GenieEngineConfig,
  EntityMatchingCandidate,
  ClarificationRule,
  JoinSpecInput,
} from "../types";
import { buildCompactColumnsBlock } from "../schema-allowlist";
import { sanitizeUserContext } from "./title-generation";
import {
  resolveForGeniePass,
  formatContextSections,
  formatSystemOverlay,
  buildIndustrySkillSections,
} from "@/lib/skills";
import { casingNoteFor } from "@/lib/metadata/casing-profile";
import { getPromptSync } from "@/lib/ai/prompt-registry";
import { PROMPT_KEYS } from "@/lib/genie/passes/prompt-defaults";
import "@/lib/genie/passes/prompt-defaults";

const TEMPERATURE = 0.3;
const MAX_INSTRUCTION_CHARS = 3000;
const MAX_GLOSSARY_ENTRIES = 10;
const MAX_CLARIFICATION_RULES = 5;

const MONTH_NAMES = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export interface InstructionGenerationInput {
  domain: string;
  subdomains: string[];
  businessName: string;
  businessContext: BusinessContext | null;
  config: GenieEngineConfig;
  entityCandidates: EntityMatchingCandidate[];
  joinSpecs: JoinSpecInput[];
  endpoint: string;
  fallbackEndpoint?: string;
  metadata?: MetadataSnapshot;
  tableFqns?: string[];
  conversationSummary?: string;
  sensitiveColumns?: Set<string>;
  /** Industry outcome map ID for domain-specific skill content. */
  industryId?: string;
  /**
   * Pre-collected per-column casing profiles. When provided, the instruction
   * generator emits a "DATA QUALITY NOTES" block warning Genie about
   * case-sensitivity mismatches. Built from `lib/metadata/casing-profile.ts`.
   */
  casingProfiles?: ReadonlyArray<import("@/lib/metadata/casing-profile").ColumnCasingProfile>;
  signal?: AbortSignal;
}

export interface InstructionGenerationOutput {
  instructions: string[];
}

export async function runInstructionGeneration(
  input: InstructionGenerationInput,
): Promise<InstructionGenerationOutput> {
  const {
    domain,
    subdomains,
    businessName,
    businessContext,
    config,
    entityCandidates,
    endpoint,
    fallbackEndpoint,
    metadata,
    tableFqns,
    conversationSummary,
    sensitiveColumns,
    industryId,
    signal,
  } = input;

  const instructions: string[] = [];

  // 1. Short domain identity
  instructions.push(buildDomainIdentity(domain, subdomains, businessName, businessContext));

  // 2. Entity matching hint
  if (entityCandidates.some((c) => c.sampleValues.length > 0)) {
    instructions.push(
      "When users refer to coded values by their full names or descriptions, " +
        "use the column synonyms and descriptions in the table metadata to map to stored codes.",
    );
  }

  // 3. Time period guidance
  if (config.autoTimePeriods) {
    const fyMonth = MONTH_NAMES[config.fiscalYearStartMonth] || "January";
    instructions.push(
      `Fiscal year starts in ${fyMonth}. ` +
        `When users say "this year", "YTD", or "last quarter", use the fiscal calendar. ` +
        `Calendar periods (last 7/30/90 days) are also available.`,
    );
  }

  // 4. Clarification rules
  const clarificationInstr = buildClarificationInstruction(config.clarificationRules);
  if (clarificationInstr) instructions.push(clarificationInstr);

  // 5. Summary customisation
  if (config.summaryInstructions.trim()) {
    instructions.push(
      `Instructions you must follow when providing summaries:\n${config.summaryInstructions}`,
    );
  }

  // 6. Glossary / business terminology
  if (config.glossary.length > 0) {
    const glossaryLines = config.glossary
      .slice(0, MAX_GLOSSARY_ENTRIES)
      .map(
        (g) =>
          `- "${g.term}": ${g.definition}${g.synonyms.length > 0 ? ` (aka ${g.synonyms.join(", ")})` : ""}`,
      );
    instructions.push(`Business terminology:\n${glossaryLines.join("\n")}`);
  }

  // 6b. Data-quality notes from sample-value casing profiles
  if (input.casingProfiles && input.casingProfiles.length > 0) {
    const notes: string[] = [];
    for (const p of input.casingProfiles) {
      const note = casingNoteFor(p);
      if (note) notes.push(note);
    }
    if (notes.length > 0) {
      const capped = notes.slice(0, 6);
      instructions.push(
        `DATA QUALITY NOTES (case sensitivity):\n${capped.map((n) => `- ${n}`).join("\n")}`,
      );
    }
  }

  // 7. Customer global instructions
  if (config.globalInstructions.trim()) {
    instructions.push(config.globalInstructions);
  }

  // 8. LLM-refined domain guidance
  let llmRefined: string | null = null;
  const useGslOutputShape = process.env.FORGE_GSL_INSTRUCTIONS_ENABLED === "true";
  if (config.llmRefinement) {
    try {
      if (useGslOutputShape) {
        const gslResult = await generateGslInstructionBlock({
          endpoint,
          fallbackEndpoint,
          domain,
          subdomains,
          businessName,
          businessContext,
          metadata,
          tableFqns,
          joinSpecs: input.joinSpecs,
          signal,
        });
        llmRefined = sanitizeInstructionText(gslResult.content);
        if (gslResult.usedFallback) {
          logger.warn("GSL instruction block fell back to deterministic skeleton");
        }
      } else {
        llmRefined = await generateLLMInstruction(
          domain,
          subdomains,
          businessName,
          businessContext,
          endpoint,
          metadata,
          tableFqns,
          input.joinSpecs,
          conversationSummary,
          sensitiveColumns,
          industryId,
          signal,
        );
      }
    } catch (err) {
      logger.warn("LLM instruction generation failed", {
        endpoint,
        gsl: useGslOutputShape,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!llmRefined && fallbackEndpoint && fallbackEndpoint !== endpoint) {
    try {
      llmRefined = await generateLLMInstruction(
        domain,
        subdomains,
        businessName,
        businessContext,
        fallbackEndpoint,
        metadata,
        tableFqns,
        input.joinSpecs,
        conversationSummary,
        sensitiveColumns,
        industryId,
        signal,
      );
      if (llmRefined) {
        instructions.push(
          "Instruction generation degraded: fast endpoint unavailable; used fallback endpoint.",
        );
      }
    } catch (err) {
      logger.warn("Fallback LLM instruction generation failed", {
        endpoint: fallbackEndpoint,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (llmRefined) instructions.push(llmRefined);

  const sanitized = instructions.map(sanitizeInstructionText).filter(Boolean);
  return { instructions: applyInstructionCharBudget(sanitized, llmRefined, config) };
}

function totalChars(blocks: string[]): number {
  return blocks.reduce((sum, s) => sum + s.length, 0);
}

/**
 * Progressively trim instructions to stay within MAX_INSTRUCTION_CHARS.
 * Priority (lowest-value dropped first):
 *   1. LLM-refined instruction
 *   2. Glossary reduced to 5 entries
 *   3. Clarification rules reduced to 3
 */
export function applyInstructionCharBudget(
  instructions: string[],
  llmRefined: string | null,
  config: GenieEngineConfig,
): string[] {
  if (totalChars(instructions) <= MAX_INSTRUCTION_CHARS) return instructions;

  const alwaysKeep = instructions.slice(0, 4);
  let optional = instructions.slice(4);

  if (llmRefined) {
    optional = optional.filter((s) => s !== llmRefined);
    logger.debug("Instruction budget: dropped LLM-refined block");
    if (totalChars([...alwaysKeep, ...optional]) <= MAX_INSTRUCTION_CHARS)
      return [...alwaysKeep, ...optional];
  }

  if (config.glossary.length > 5) {
    const reducedGlossary = config.glossary
      .slice(0, 5)
      .map(
        (g) =>
          `- "${g.term}": ${g.definition}${g.synonyms.length > 0 ? ` (aka ${g.synonyms.join(", ")})` : ""}`,
      );
    const header = "Business terminology:";
    optional = optional.map((s) =>
      s.startsWith(header) ? `${header}\n${reducedGlossary.join("\n")}` : s,
    );
    logger.debug("Instruction budget: reduced glossary to 5 entries");
    if (totalChars([...alwaysKeep, ...optional]) <= MAX_INSTRUCTION_CHARS)
      return [...alwaysKeep, ...optional];
  }

  if (config.clarificationRules.length > 3) {
    const reducedRules = config.clarificationRules
      .slice(0, 3)
      .map(
        (r) =>
          `When users ask about ${r.topic} but don't include ${r.missingDetails.join(" or ")}, ` +
          `you must ask a clarification question first. Example: "${r.clarificationQuestion}"`,
      );
    const header = "Clarification rules:";
    optional = optional.map((s) =>
      s.startsWith(header) ? `${header}\n${reducedRules.join("\n")}` : s,
    );
    logger.debug("Instruction budget: reduced clarification rules to 3");
  }

  const merged = [...alwaysKeep, ...optional];
  if (totalChars(merged) <= MAX_INSTRUCTION_CHARS) return merged;
  let budget = MAX_INSTRUCTION_CHARS;
  const finalBlocks: string[] = [];
  for (const block of merged) {
    if (budget <= 0) break;
    if (block.length <= budget) {
      finalBlocks.push(block);
      budget -= block.length;
    } else {
      finalBlocks.push(block.slice(0, budget));
      break;
    }
  }
  return finalBlocks;
}

/**
 * Short domain identity -- just enough for Genie to know the business context.
 * Full strategic goals / value chain are NOT included (per Databricks best practices,
 * text instructions should be minimal behavioural guidance).
 */
function buildDomainIdentity(
  domain: string,
  subdomains: string[],
  businessName: string,
  bc: BusinessContext | null,
): string {
  const parts: string[] = [`This space serves the ${domain} domain for ${businessName}.`];

  if (bc?.industries) parts.push(`Industry: ${bc.industries}.`);
  if (subdomains.length > 0) parts.push(`Covers: ${subdomains.join(", ")}.`);

  return parts.join(" ");
}

function buildClarificationInstruction(rules: ClarificationRule[]): string | null {
  if (rules.length === 0) return null;

  const ruleLines = rules
    .slice(0, MAX_CLARIFICATION_RULES)
    .map(
      (r) =>
        `When users ask about ${r.topic} but don't include ${r.missingDetails.join(" or ")}, ` +
        `you must ask a clarification question first. Example: "${r.clarificationQuestion}"`,
    );

  return `Clarification rules:\n${ruleLines.join("\n")}`;
}

async function generateLLMInstruction(
  domain: string,
  subdomains: string[],
  businessName: string,
  bc: BusinessContext | null,
  endpoint: string,
  metadata: MetadataSnapshot | undefined,
  tableFqns: string[] | undefined,
  joins: JoinSpecInput[],
  conversationSummary: string | undefined,
  sensitiveColumns: Set<string> | undefined,
  industryId?: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const skillsResolved = resolveForGeniePass("instructions");

  const systemParts = [
    "You are writing one concise instruction block for a Databricks Genie space.",
    "Return plain text only.",
    "Include: business focus, key entities to group by, recommended time windows, and ambiguity handling.",
    "Do not include dataset marketing language, product pitch text, or generic platform instructions.",
    "Do not include SQL syntax lessons; keep this analyst-facing and operational.",
  ];
  const systemMessage = systemParts.join(" ") + formatSystemOverlay(skillsResolved.systemOverlay);

  const compactColumns = metadata
    ? buildCompactColumnsBlock(metadata, tableFqns).slice(0, 1600)
    : "";
  const joinHints = joins
    .slice(0, 6)
    .map((j) => `${j.leftTable} <-> ${j.rightTable}`)
    .join(", ");
  const safeConversation = sanitizeUserContext(conversationSummary);

  const industrySections = industryId ? buildIndustrySkillSections(industryId) : [];
  const industryBlock =
    industrySections.length > 0 ? "\n\n" + formatContextSections(industrySections) : "";
  const skillContextBlock =
    skillsResolved.contextSections.length > 0
      ? "\n\n" + formatContextSections(skillsResolved.contextSections)
      : "";

  const context = [
    `Business: ${businessName}`,
    `Domain: ${domain}`,
    `Subdomains: ${subdomains.join(", ") || "none"}`,
    `Industry: ${bc?.industries || "unknown"}`,
    safeConversation ? `User intent summary (quoted user text): ${safeConversation}` : "",
    joinHints ? `Join hints: ${joinHints}` : "",
    sensitiveColumns && sensitiveColumns.size > 0
      ? `Sensitive columns to avoid in guidance: ${Array.from(sensitiveColumns).slice(0, 25).join(", ")}`
      : "",
    compactColumns ? compactColumns : "",
  ]
    .filter(Boolean)
    .join("\n");

  const userMessage = `${context}${industryBlock}${skillContextBlock}

Write 4-6 short bullet points as plain text paragraphs (no markdown bullets) that guide users toward relevant analysis.`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemMessage },
    { role: "user", content: userMessage },
  ];

  const result = await cachedChatCompletion({
    endpoint,
    messages,
    temperature: TEMPERATURE,
    maxTokens: 2048,
    signal,
  });

  const content = sanitizeInstructionText(result.content?.trim() ?? "");
  return content && content.length > 20 ? content : null;
}

/**
 * Generate a single canonical GSL-shaped text instruction block (5 sections,
 * <= GSL_MAX_CHARS) using the configured LLM endpoint. Validates the output
 * against `validateGsl`, performs ONE retry with the failure reason if the
 * first attempt fails, and falls back to a deterministic `buildGsl(...)`
 * skeleton when both LLM attempts fail.
 *
 * Mirrors upstream `databricks-genie-workbench` GSL writer: the output is
 * always a valid GSL block, so the section-preserving fixer in
 * `lib/genie/space-fixer.ts` can patch sections without losing structure.
 */
export async function generateGslInstructionBlock(opts: {
  endpoint: string;
  fallbackEndpoint?: string;
  domain: string;
  subdomains: string[];
  businessName: string;
  businessContext: BusinessContext | null;
  metadata?: MetadataSnapshot;
  tableFqns?: string[];
  joinSpecs?: JoinSpecInput[];
  signal?: AbortSignal;
}): Promise<{ content: string; usedFallback: boolean }> {
  const gslSystem = getPromptSync(PROMPT_KEYS.instructionGslSystem).template;
  const buildSystem = (extra?: string) =>
    [gslSystem, gslPromptInstructions(), extra ?? ""].filter(Boolean).join("\n\n");

  const compactColumns = opts.metadata
    ? buildCompactColumnsBlock(opts.metadata, opts.tableFqns).slice(0, 1600)
    : "";
  const joinHints = (opts.joinSpecs ?? [])
    .slice(0, 6)
    .map((j) => `${j.leftTable} <-> ${j.rightTable}`)
    .join(", ");
  const userMessage = [
    `Business: ${opts.businessName}`,
    `Domain: ${opts.domain}`,
    `Subdomains: ${opts.subdomains.join(", ") || "none"}`,
    `Industry: ${opts.businessContext?.industries || "unknown"}`,
    joinHints ? `Join hints: ${joinHints}` : "",
    compactColumns,
    "",
    `Now produce the GSL block. Stay <= ${GSL_MAX_CHARS} characters.`,
  ]
    .filter(Boolean)
    .join("\n");

  const callOnce = async (
    endpoint: string,
    extraSystem?: string,
  ): Promise<{ content: string; valid: boolean; reason?: string }> => {
    const messages: ChatMessage[] = [
      { role: "system", content: buildSystem(extraSystem) },
      { role: "user", content: userMessage },
    ];
    const result = await cachedChatCompletion({
      endpoint,
      messages,
      temperature: TEMPERATURE,
      maxTokens: 1500,
      signal: opts.signal,
    });
    const content = (result.content ?? "").trim();
    const verdict = validateGsl(content);
    return { content, valid: verdict.valid, reason: verdict.reason };
  };

  // Attempt 1
  try {
    const first = await callOnce(opts.endpoint);
    if (first.valid) return { content: first.content, usedFallback: false };
    logger.warn("[gsl] first LLM attempt failed validation, retrying", {
      reason: first.reason,
    });
    // Attempt 2 with explicit failure reason
    const second = await callOnce(
      opts.endpoint,
      `Your previous response was rejected: ${first.reason}. Fix the issue and reply again.`,
    );
    if (second.valid) return { content: second.content, usedFallback: false };
    logger.warn("[gsl] second LLM attempt also failed; falling back to deterministic skeleton", {
      reason: second.reason,
    });
  } catch (err) {
    logger.warn("[gsl] LLM call failed, falling back to deterministic skeleton", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (opts.fallbackEndpoint && opts.fallbackEndpoint !== opts.endpoint) {
    try {
      const fb = await callOnce(opts.fallbackEndpoint);
      if (fb.valid) return { content: fb.content, usedFallback: true };
    } catch {
      // fall through to deterministic
    }
  }

  return {
    content: buildGsl({
      purpose: `Answer ${opts.domain} questions for ${opts.businessName}.`,
      disambiguation:
        "When the user's question could refer to more than one metric or table, ask a clarifying question before answering.",
      dataQualityNotes:
        "Treat NULL values as missing data; never silently coerce to 0. Trust documented column types.",
      constraints:
        "Use ONLY the tables and columns configured in this space. Cite the SQL you ran.",
    }),
    usedFallback: true,
  };
}

export function sanitizeInstructionText(input: string): string {
  if (!input) return "";
  const bannedPatterns = [
    /sample dataset/i,
    /dataset simulates/i,
    /simulates a .* business/i,
    /synthetically curated/i,
    /suitable for any databricks workload/i,
    /building data pipelines with delta live tables/i,
    /exploring ai and machine learning capabilities/i,
  ];
  const lines = input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !bannedPatterns.some((p) => p.test(line)));
  return lines.join("\n").slice(0, 1800);
}
