/**
 * Demo Scope resolution utilities.
 *
 * Maps departments and functional focus areas to industry-agnostic
 * asset families, and provides scope presets for common patterns.
 */

import type { DemoScope, ResolvedDemoScope } from "./types";

// ---------------------------------------------------------------------------
// Department → Asset Family Mapping
// ---------------------------------------------------------------------------

export const DEPARTMENT_ASSET_FAMILIES: Record<string, string[]> = {
  HR: ["Workforce", "Enterprise Operations"],
  Finance: ["Finance & Regulatory", "Enterprise & Finance"],
  Operations: ["Operations & OT", "Operations & OT Data"],
  "Supply Chain": ["Supply Chain", "Manufacturing & Supply Chain"],
  Marketing: ["Commercial & Customer", "Marketing & Channels"],
  Sales: ["Commercial & Customer", "Sales & Distribution"],
  Risk: ["Risk & External Intelligence", "Risk & Compliance"],
  IT: ["Foundation & Governance", "Enterprise Operations"],
  Legal: ["Enterprise Operations", "Risk & Compliance"],
  "Customer Service": ["Commercial & Customer", "Customer Experience"],
};

export const COMMON_DEPARTMENTS = Object.keys(DEPARTMENT_ASSET_FAMILIES);

// ---------------------------------------------------------------------------
// Scope Presets
// ---------------------------------------------------------------------------

export type ScopePreset = "full-enterprise" | "single-division" | "department-deep-dive" | "custom";

export interface ScopePresetConfig {
  label: string;
  description: string;
}

export const SCOPE_PRESETS: Record<ScopePreset, ScopePresetConfig> = {
  "full-enterprise": {
    label: "Full Enterprise",
    description: "All data assets across all functions. Best for broad discovery demos.",
  },
  "single-division": {
    label: "Single Division",
    description: "Focus on one business division or subsidiary. All functions within that unit.",
  },
  "department-deep-dive": {
    label: "Department Deep-Dive",
    description:
      "Focus on specific departments (e.g., HR, Finance). Deeper tables, fewer breadth.",
  },
  custom: {
    label: "Custom",
    description: "Choose your own combination of division, functions, and departments.",
  },
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a DemoScope into concrete asset families by combining
 * functionalFocus (already asset families) with department mappings.
 */
export function resolveScope(scope?: DemoScope): ResolvedDemoScope {
  if (!scope) {
    return { resolvedAssetFamilies: [] };
  }

  const families = new Set<string>();

  if (scope.functionalFocus) {
    for (const focus of scope.functionalFocus) {
      families.add(focus);
    }
  }

  if (scope.departments) {
    for (const dept of scope.departments) {
      const mapped = DEPARTMENT_ASSET_FAMILIES[dept];
      if (mapped) {
        for (const fam of mapped) families.add(fam);
      }
    }
  }

  return {
    ...scope,
    resolvedAssetFamilies: Array.from(families),
  };
}

/**
 * Generate a schema name from scope components.
 * E.g., "rio_tinto_aluminium_ops_demo" or "anz_commercial_fraud_demo".
 */
export function buildSchemaName(
  customerName: string,
  scope?: DemoScope,
): string {
  const parts = [slugify(customerName)];

  if (scope?.division) parts.push(slugify(scope.division));

  if (scope?.departments?.length === 1) {
    parts.push(slugify(scope.departments[0]));
  } else if (scope?.functionalFocus?.length === 1) {
    parts.push(slugify(scope.functionalFocus[0]));
  }

  parts.push("demo");

  const name = parts.join("_").slice(0, 64);
  return name.replace(/_+$/, "");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}
