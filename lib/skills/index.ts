/**
 * LLM Skills module -- public API.
 *
 * Importing this module registers all static skills and exports the
 * registry, resolver, types, and industry enrichment helpers.
 */

// Register all static skills on first import
import "./content";

// Re-export public API
export type {
  SkillDefinition,
  SkillChunk,
  SkillSection,
  ResolvedSkills,
  AskForgeIntent,
  GeniePass,
  PipelineStep,
  SkillCategory,
  SkillRelevance,
} from "./types";
export { EMPTY_RESOLVED_SKILLS } from "./types";

export {
  registerSkill,
  registerSkills,
  getSkill,
  getAllSkills,
  getSkillsForIntent,
  getSkillsForGeniePass,
  getSkillsForPipelineStep,
  getChunksForIntent,
  getChunksForGeniePass,
  getChunksForPipelineStep,
  clearRegistry,
} from "./registry";

export {
  resolveForIntent,
  resolveForGeniePass,
  resolveForPipelineStep,
  formatContextSections,
  formatSystemOverlay,
} from "./resolver";

export {
  buildIndustrySkillChunks,
  buildIndustrySkillSections,
  buildDomainQuestionPatterns,
} from "./content/industry-enrichment";
