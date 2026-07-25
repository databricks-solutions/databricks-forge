/**
 * Skill resolver -- selects and composes relevant skills for a given context.
 *
 * Two resolution strategies:
 *   1. Rule-based: matches skill relevance fields against the current
 *      intent / Genie pass / pipeline step.
 *   2. RAG-based (Ask Forge only): retrieves skill chunks by embedding
 *      similarity to the user question.
 *
 * Both strategies produce a ResolvedSkills object ready for prompt injection,
 * respecting a configurable character budget.
 */

import type {
  AskForgeIntent,
  GeniePass,
  PipelineStep,
  ResolvedSkills,
  SkillChunk,
  SkillSection,
} from "./types";
import { EMPTY_RESOLVED_SKILLS } from "./types";
import { getChunksForIntent, getChunksForGeniePass, getChunksForPipelineStep } from "./registry";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Budget defaults (chars)
// ---------------------------------------------------------------------------

const DEFAULT_SYSTEM_BUDGET = 1200;
const DEFAULT_CONTEXT_BUDGET = 4000;

const GENIE_INSTRUCTION_BUDGET = 800;
const GENIE_PASS_SYSTEM_BUDGET = 600;
const GENIE_PASS_CONTEXT_BUDGET = 2000;

// ---------------------------------------------------------------------------
// Rule-based resolution
// ---------------------------------------------------------------------------

interface ResolveOptions {
  /** Max chars for the system overlay. */
  systemBudget?: number;
  /** Max chars across all context sections. */
  contextBudget?: number;
}

/**
 * Resolve skills for an Ask Forge intent (rule-based path).
 * For RAG-augmented resolution, call `resolveSkillsForAskForge` instead.
 */
export function resolveForIntent(
  intent: AskForgeIntent,
  opts: ResolveOptions = {},
): ResolvedSkills {
  const chunks = getChunksForIntent(intent);
  if (chunks.length === 0) return EMPTY_RESOLVED_SKILLS;
  return composeSkills(chunks, {
    systemBudget: opts.systemBudget ?? DEFAULT_SYSTEM_BUDGET,
    contextBudget: opts.contextBudget ?? DEFAULT_CONTEXT_BUDGET,
  });
}

/** Resolve skills for a Genie Engine pass (always rule-based). */
export function resolveForGeniePass(pass: GeniePass, opts: ResolveOptions = {}): ResolvedSkills {
  const chunks = getChunksForGeniePass(pass);
  if (chunks.length === 0) return EMPTY_RESOLVED_SKILLS;

  const isInstructions = pass === "instructions";
  return composeSkills(chunks, {
    systemBudget:
      opts.systemBudget ?? (isInstructions ? GENIE_INSTRUCTION_BUDGET : GENIE_PASS_SYSTEM_BUDGET),
    contextBudget: opts.contextBudget ?? GENIE_PASS_CONTEXT_BUDGET,
  });
}

/** Resolve skills for a pipeline step (always rule-based). */
export function resolveForPipelineStep(
  step: PipelineStep,
  opts: ResolveOptions = {},
): ResolvedSkills {
  const chunks = getChunksForPipelineStep(step);
  if (chunks.length === 0) return EMPTY_RESOLVED_SKILLS;
  return composeSkills(chunks, {
    systemBudget: opts.systemBudget ?? DEFAULT_SYSTEM_BUDGET,
    contextBudget: opts.contextBudget ?? DEFAULT_CONTEXT_BUDGET,
  });
}

// ---------------------------------------------------------------------------
// Composition engine
// ---------------------------------------------------------------------------

interface ComposeBudget {
  systemBudget: number;
  contextBudget: number;
}

/**
 * Compose a set of skill chunks into a ResolvedSkills object, partitioning
 * into system overlay (rules, anti-patterns) and context sections (patterns,
 * examples, vocabulary, kpis), then trimming to budget.
 */
function composeSkills(chunks: SkillChunk[], budget: ComposeBudget): ResolvedSkills {
  const systemCategories = new Set(["rules", "anti-patterns"]);
  const systemChunks = chunks.filter((c) => systemCategories.has(c.category));
  const contextChunks = chunks.filter((c) => !systemCategories.has(c.category));

  const systemOverlay = trimToCharBudget(
    systemChunks.map((c) => c.content),
    budget.systemBudget,
  ).join("\n\n");

  const contextSections: SkillSection[] = [];
  let contextChars = 0;

  for (const chunk of contextChunks) {
    if (contextChars + chunk.content.length > budget.contextBudget) {
      const remaining = budget.contextBudget - contextChars;
      if (remaining > 100) {
        contextSections.push({
          title: chunk.title,
          content: chunk.content.slice(0, remaining),
        });
      }
      break;
    }
    contextSections.push({ title: chunk.title, content: chunk.content });
    contextChars += chunk.content.length;
  }

  const totalChars = systemOverlay.length + contextChars;

  if (totalChars > 0) {
    logger.debug("[skills] Resolved skills", {
      systemChunks: systemChunks.length,
      contextSections: contextSections.length,
      totalChars,
    });
  }

  return { systemOverlay, contextSections, totalChars };
}

/** Greedily select blocks that fit within the char budget. */
function trimToCharBudget(blocks: string[], budget: number): string[] {
  const result: string[] = [];
  let used = 0;
  for (const block of blocks) {
    if (used + block.length > budget) {
      const remaining = budget - used;
      if (remaining > 100) result.push(block.slice(0, remaining));
      break;
    }
    result.push(block);
    used += block.length;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Formatting helpers (for injection into prompts)
// ---------------------------------------------------------------------------

/** Format resolved context sections as a markdown block for the user message. */
export function formatContextSections(sections: SkillSection[]): string {
  if (sections.length === 0) return "";
  return sections.map((s) => `### ${s.title}\n${s.content}`).join("\n\n");
}

/** Format the system overlay for appending to system messages. */
export function formatSystemOverlay(overlay: string): string {
  if (!overlay.trim()) return "";
  return `\n\n${overlay}`;
}
