/**
 * Health Check Registry -- loads default YAML checks, merges with user
 * overrides and custom checks, and returns resolved check/category definitions.
 *
 * The default checks YAML is embedded as a string constant so the registry
 * works in bundled environments (Next.js production, Databricks Apps) where
 * __dirname does not resolve to the source tree.
 */

import { parse as parseYaml } from "yaml";
import { getRegisteredEvaluators } from "./evaluators";
import type {
  CategoryDefinition,
  CheckDefinition,
  DefaultChecksYaml,
  EvaluatorType,
  FixStrategy,
  Severity,
  UserCheckOverride,
  UserCustomCheck,
} from "./types";

import { DEFAULT_CHECKS_YAML } from "./default-checks-embedded";

let cachedDefaults: {
  categories: Record<string, CategoryDefinition>;
  checks: CheckDefinition[];
} | null = null;

function loadDefaultChecks(): {
  categories: Record<string, CategoryDefinition>;
  checks: CheckDefinition[];
} {
  if (cachedDefaults) return cachedDefaults;

  const parsed = parseYaml(DEFAULT_CHECKS_YAML) as DefaultChecksYaml;

  const categories: Record<string, CategoryDefinition> = {};
  for (const [key, val] of Object.entries(parsed.categories)) {
    categories[key] = { label: val.label, weight: val.weight };
  }

  const checks: CheckDefinition[] = parsed.checks.map((raw) => ({
    id: raw.id as string,
    category: raw.category as string,
    description: raw.description as string,
    severity: raw.severity as Severity,
    fixable: (raw.fixable as boolean) ?? false,
    fix_strategy: raw.fix_strategy as FixStrategy | undefined,
    evaluator: raw.evaluator as EvaluatorType,
    path: raw.path as string | undefined,
    paths: raw.paths as string[] | undefined,
    field: raw.field as string | undefined,
    params: (raw.params as Record<string, unknown>) ?? {},
    quick_win: raw.quick_win as string | undefined,
    condition_path: raw.condition_path as string | undefined,
    condition_min: raw.condition_min as number | undefined,
    quality_prompt: raw.quality_prompt as string | undefined,
    enabled: true,
  }));

  cachedDefaults = { categories, checks };
  return cachedDefaults;
}

/**
 * Validate a user custom check: the category must exist in defined categories
 * and the evaluator must be a registered type.
 */
function validateCustomCheck(check: UserCustomCheck, validCategories: Set<string>): string | null {
  if (!validCategories.has(check.category)) {
    return `Custom check "${check.id}": invalid category "${check.category}"`;
  }
  const validEvaluators = getRegisteredEvaluators();
  if (!validEvaluators.has(check.evaluator)) {
    return `Custom check "${check.id}": invalid evaluator "${check.evaluator}"`;
  }
  return null;
}

export interface ResolvedRegistry {
  categories: Record<string, CategoryDefinition>;
  checks: CheckDefinition[];
  validationErrors: string[];
}

/**
 * Build the final resolved registry by merging defaults with user overrides
 * and custom checks.
 *
 * Override precedence:
 * - `enabled` can disable a built-in check
 * - `params` are shallow-merged (override individual thresholds)
 * - `severity` replaces the default severity
 * - Custom checks are appended after built-in checks
 */
export function resolveRegistry(
  overrides?: UserCheckOverride[],
  customChecks?: UserCustomCheck[],
  categoryWeights?: Record<string, number>,
): ResolvedRegistry {
  const defaults = loadDefaultChecks();
  const validationErrors: string[] = [];

  const categories = { ...defaults.categories };
  if (categoryWeights) {
    for (const [key, weight] of Object.entries(categoryWeights)) {
      if (key in categories) {
        categories[key] = { ...categories[key], weight };
      }
    }
  }

  const overrideMap = new Map<string, UserCheckOverride>();
  if (overrides) {
    for (const o of overrides) overrideMap.set(o.checkId, o);
  }

  const checks: CheckDefinition[] = defaults.checks.map((check) => {
    const override = overrideMap.get(check.id);
    if (!override) return check;

    return {
      ...check,
      enabled: override.enabled ?? check.enabled,
      severity: override.severity ?? check.severity,
      params: override.params ? { ...check.params, ...override.params } : check.params,
    };
  });

  const validCategories = new Set(Object.keys(categories));
  if (customChecks) {
    for (const custom of customChecks) {
      const error = validateCustomCheck(custom, validCategories);
      if (error) {
        validationErrors.push(error);
        continue;
      }

      checks.push({
        id: custom.id,
        category: custom.category,
        description: custom.description,
        severity: custom.severity,
        fixable: false,
        evaluator: custom.evaluator,
        path: custom.path,
        field: custom.field,
        params: custom.params,
        quick_win: custom.quick_win,
        enabled: true,
      });
    }
  }

  return { categories, checks, validationErrors };
}

/** Clear the cached default checks (useful for testing or hot-reloading). */
export function clearRegistryCache(): void {
  cachedDefaults = null;
}
