/**
 * Central skill registry.
 *
 * Skills self-register at module load via `registerSkill()`. Consumer code
 * queries the registry by relevance target (Ask Forge intent, Genie pass,
 * or pipeline step) to get applicable skills.
 */

import type { SkillDefinition, SkillChunk, AskForgeIntent, GeniePass, PipelineStep } from "./types";

// ---------------------------------------------------------------------------
// Internal store
// ---------------------------------------------------------------------------

const skills = new Map<string, SkillDefinition>();

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register a skill. Overwrites any existing skill with the same id. */
export function registerSkill(skill: SkillDefinition): void {
  skills.set(skill.id, skill);
}

/** Register multiple skills at once. */
export function registerSkills(defs: SkillDefinition[]): void {
  for (const skill of defs) registerSkill(skill);
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export function getSkill(id: string): SkillDefinition | undefined {
  return skills.get(id);
}

export function getAllSkills(): SkillDefinition[] {
  return Array.from(skills.values());
}

/** Return all skills whose relevance includes the given Ask Forge intent. */
export function getSkillsForIntent(intent: AskForgeIntent): SkillDefinition[] {
  return Array.from(skills.values()).filter((s) => s.relevance.intents?.includes(intent));
}

/** Return all skills whose relevance includes the given Genie pass. */
export function getSkillsForGeniePass(pass: GeniePass): SkillDefinition[] {
  return Array.from(skills.values()).filter((s) => s.relevance.geniePasses?.includes(pass));
}

/** Return all skills whose relevance includes the given pipeline step. */
export function getSkillsForPipelineStep(step: PipelineStep): SkillDefinition[] {
  return Array.from(skills.values()).filter((s) => s.relevance.pipelineSteps?.includes(step));
}

// ---------------------------------------------------------------------------
// Chunk helpers
// ---------------------------------------------------------------------------

/** Collect all chunks from skills matching the given intent. */
export function getChunksForIntent(intent: AskForgeIntent): SkillChunk[] {
  return getSkillsForIntent(intent).flatMap((s) => s.chunks);
}

/** Collect all chunks from skills matching the given Genie pass. */
export function getChunksForGeniePass(pass: GeniePass): SkillChunk[] {
  return getSkillsForGeniePass(pass).flatMap((s) => s.chunks);
}

/** Collect all chunks from skills matching the given pipeline step. */
export function getChunksForPipelineStep(step: PipelineStep): SkillChunk[] {
  return getSkillsForPipelineStep(step).flatMap((s) => s.chunks);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Total character count across a set of chunks. */
export function totalChunkChars(chunks: SkillChunk[]): number {
  return chunks.reduce((sum, c) => sum + c.content.length, 0);
}

/** Remove all registered skills (primarily for tests). */
export function clearRegistry(): void {
  skills.clear();
}
