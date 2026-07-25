/**
 * Core types for the LLM Skills system.
 *
 * Skills are composable knowledge blocks injected into LLM prompts
 * to improve output quality. Each skill encapsulates domain expertise
 * (SQL patterns, data modeling, Genie design, metric views, industry
 * knowledge) and declares where it's relevant (intents, Genie passes,
 * pipeline steps).
 */

// ---------------------------------------------------------------------------
// Relevance targets
// ---------------------------------------------------------------------------

/** Ask Forge intent categories that a skill may apply to. */
export type AskForgeIntent = "business" | "technical" | "dashboard" | "navigation" | "exploration";

/** Genie Engine passes that a skill may apply to. */
export type GeniePass =
  | "instructions"
  | "semanticExpressions"
  | "benchmarks"
  | "trustedAssets"
  | "metricViews"
  | "columnIntelligence"
  | "exampleQueries"
  | "joinInference";

/** Pipeline steps that a skill may apply to. */
export type PipelineStep =
  | "sql-generation"
  | "scoring"
  | "use-case-generation"
  | "table-filtering"
  | "dashboard-design";

/** Categorisation of knowledge within a chunk. */
export type SkillCategory =
  | "rules"
  | "patterns"
  | "anti-patterns"
  | "examples"
  | "vocabulary"
  | "kpis";

// ---------------------------------------------------------------------------
// Skill definition
// ---------------------------------------------------------------------------

/** Declares where a skill is relevant. */
export interface SkillRelevance {
  intents?: AskForgeIntent[];
  geniePasses?: GeniePass[];
  pipelineSteps?: PipelineStep[];
}

/**
 * A single composable prompt block within a skill.
 * Each chunk is independently embeddable and selectable.
 */
export interface SkillChunk {
  id: string;
  title: string;
  /** Prompt-ready text -- can be injected directly into system or user messages. */
  content: string;
  category: SkillCategory;
  /** Soft budget hint (chars). The resolver uses this during composition. */
  maxCharBudget?: number;
}

/**
 * A registered skill definition.
 * Skills are static (loaded at module init) or dynamic (built at runtime
 * from industry outcome maps).
 */
export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  relevance: SkillRelevance;
  chunks: SkillChunk[];
}

// ---------------------------------------------------------------------------
// Resolved output
// ---------------------------------------------------------------------------

/** A titled section for injection into the user-message context. */
export interface SkillSection {
  title: string;
  content: string;
}

/**
 * The composed output of skill resolution -- ready for prompt injection.
 * Produced by the resolver for a specific context (intent, pass, or step).
 */
export interface ResolvedSkills {
  /** Extra instructions appended to the system prompt. */
  systemOverlay: string;
  /** Sections appended to the user-message context. */
  contextSections: SkillSection[];
  /** Total character count across all resolved content. */
  totalChars: number;
}

/** Empty resolved skills -- used as a no-op fallback. */
export const EMPTY_RESOLVED_SKILLS: ResolvedSkills = {
  systemOverlay: "",
  contextSections: [],
  totalChars: 0,
};
