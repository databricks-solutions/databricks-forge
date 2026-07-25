/**
 * Abstract skill resolver interface.
 *
 * Decouples engines from the concrete `lib/skills/` module so skills
 * can be provided by any source (file-based, database, remote API,
 * or a no-op stub when skills are not needed).
 *
 * @module ports/skill-resolver
 */

export interface SkillSection {
  title: string;
  content: string;
}

export interface ResolvedSkills {
  systemOverlay: string;
  contextSections: SkillSection[];
  totalChars: number;
}

export const EMPTY_RESOLVED: ResolvedSkills = {
  systemOverlay: "",
  contextSections: [],
  totalChars: 0,
};

/**
 * Resolves domain-specific skill content for prompt enrichment.
 *
 * The `surface` string is opaque to the port -- concrete implementations
 * map it to their own taxonomy (GeniePass, PipelineStep, AskForgeIntent).
 */
export interface SkillResolver {
  resolve(surface: string, opts?: { industryId?: string }): ResolvedSkills;
}
