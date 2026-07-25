/**
 * Default skill resolver implementation.
 *
 * Wraps the concrete `lib/skills/resolver` module, mapping surface
 * strings to the appropriate resolution function.
 */

import {
  resolveForGeniePass,
  resolveForPipelineStep,
  resolveForIntent,
} from "@/lib/skills/resolver";
import type { SkillResolver, ResolvedSkills } from "../skill-resolver";
import { EMPTY_RESOLVED } from "../skill-resolver";
import type { GeniePass, PipelineStep, AskForgeIntent } from "@/lib/skills/types";

const GENIE_PASSES = new Set<string>([
  "instructions",
  "semanticExpressions",
  "benchmarks",
  "trustedAssets",
  "metricViews",
  "columnIntelligence",
  "exampleQueries",
  "joinInference",
]);

const PIPELINE_STEPS = new Set<string>([
  "sql-generation",
  "scoring",
  "use-case-generation",
  "table-filtering",
  "dashboard-design",
]);

const INTENTS = new Set<string>([
  "business",
  "technical",
  "dashboard",
  "navigation",
  "exploration",
]);

export const defaultSkillResolver: SkillResolver = {
  resolve(surface: string, _opts?: { industryId?: string }): ResolvedSkills {
    if (GENIE_PASSES.has(surface)) {
      return resolveForGeniePass(surface as GeniePass);
    }
    if (PIPELINE_STEPS.has(surface)) {
      return resolveForPipelineStep(surface as PipelineStep);
    }
    if (INTENTS.has(surface)) {
      return resolveForIntent(surface as AskForgeIntent);
    }
    return EMPTY_RESOLVED;
  },
};
