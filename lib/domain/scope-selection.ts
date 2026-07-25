/**
 * Scope Selection -- shared types and utilities for UC catalog/schema/table
 * inclusion and exclusion with wildcard pattern support.
 *
 * Used by:
 * - CatalogBrowser component (frontend)
 * - Metadata fetcher (backend)
 * - Pipeline metadata extraction (backend)
 * - Standalone scan (backend)
 *
 * @module domain/scope-selection
 */

import type { MetadataScope } from "@/lib/metadata/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScopeSelection {
  /** Included catalog, schema, or table paths (e.g. "catalog", "catalog.schema", "catalog.schema.table"). */
  includes: string[];
  /** Explicitly excluded paths (same format as includes). */
  excludes: string[];
  /** Glob patterns matched against names at every level (catalog, schema, table). */
  exclusionPatterns: string[];
  /**
   * Glob patterns that a table must match (on any segment) to be kept. When
   * empty, all tables are kept (inclusion is opt-in). Exclusions always win
   * over inclusions.
   */
  inclusionPatterns: string[];
}

export const emptyScopeSelection: ScopeSelection = {
  includes: [],
  excludes: [],
  exclusionPatterns: [],
  inclusionPatterns: [],
};

// ---------------------------------------------------------------------------
// Glob matching
// ---------------------------------------------------------------------------

/**
 * Convert a simple glob pattern (supports `*` and `?`) into a RegExp.
 * The match is case-insensitive and anchored (full-string match).
 */
export function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexStr = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${regexStr}$`, "i");
}

/**
 * Test whether `name` matches a glob pattern (case-insensitive).
 */
export function globMatch(pattern: string, name: string): boolean {
  return globToRegex(pattern).test(name);
}

/**
 * Test whether a fully-qualified path (e.g. "cat.schema.table") has any
 * segment that matches at least one of the given patterns.
 */
export function matchesAnyPattern(fqn: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const segments = fqn.split(".");
  return patterns.some((p) => segments.some((seg) => globMatch(p, seg)));
}

// ---------------------------------------------------------------------------
// Exclusion helpers
// ---------------------------------------------------------------------------

/**
 * Whether a table FQN survives inclusion patterns. With no inclusion patterns
 * every table is kept; otherwise the table must match at least one pattern on
 * some segment (catalog / schema / table).
 */
export function matchesIncludePatterns(fqn: string, includePatterns: string[]): boolean {
  if (!includePatterns || includePatterns.length === 0) return true;
  return matchesAnyPattern(fqn, includePatterns);
}

/**
 * Final keep/drop decision for a table FQN given both filters. Exclusions take
 * precedence over inclusions; inclusion patterns narrow the surviving set.
 */
export function shouldKeepTable(
  fqn: string,
  opts: { excludes?: string[]; excludePatterns?: string[]; includePatterns?: string[] },
): boolean {
  if (isCoveredByExclusion(fqn, opts.excludes ?? [], opts.excludePatterns ?? [])) return false;
  return matchesIncludePatterns(fqn, opts.includePatterns ?? []);
}

/**
 * Check whether `path` is explicitly excluded OR matched by an exclusion pattern.
 */
export function isExcluded(path: string, excludes: string[], patterns: string[]): boolean {
  const lower = path.toLowerCase();
  if (excludes.some((e) => e.toLowerCase() === lower)) return true;
  return matchesAnyPattern(path, patterns);
}

/**
 * Check whether any *ancestor* of `path` is excluded (cascade).
 * E.g. if "catalog.schema" is excluded, "catalog.schema.table" is covered.
 */
export function isCoveredByExclusion(
  path: string,
  excludes: string[],
  patterns: string[],
): boolean {
  const parts = path.split(".");
  if (parts.length <= 1) return isExcluded(path, excludes, patterns);

  for (let i = 1; i < parts.length; i++) {
    const ancestor = parts.slice(0, i).join(".");
    if (isExcluded(ancestor, excludes, patterns)) return true;
  }
  return isExcluded(path, excludes, patterns);
}

/**
 * Check whether `path` is implicitly included via a parent inclusion.
 * E.g. if "catalog" is included, "catalog.schema" is covered.
 */
export function isCoveredByInclusion(path: string, includes: string[]): boolean {
  const lower = path.toLowerCase();
  const parts = lower.split(".");
  for (let i = 1; i < parts.length; i++) {
    const ancestor = parts.slice(0, i).join(".");
    if (includes.some((inc) => inc.toLowerCase() === ancestor)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Preview helper -- best-effort match against loaded tree nodes
// ---------------------------------------------------------------------------

export interface PatternMatchPreview {
  pattern: string;
  matches: string[];
}

/**
 * For each pattern, find which of the `loadedFqns` have a segment matching it.
 * Used by the UI for best-effort match preview.
 */
export function matchPatternPreview(
  patterns: string[],
  loadedFqns: string[],
): PatternMatchPreview[] {
  return patterns.map((pattern) => ({
    pattern,
    matches: loadedFqns.filter((fqn) => fqn.split(".").some((seg) => globMatch(pattern, seg))),
  }));
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Convert includes to the comma-separated ucMetadata string used by
 * pipeline runs and estate scans.
 */
export function scopeToUcMetadata(sel: ScopeSelection): string {
  return sel.includes.join(", ");
}

/**
 * Serialize explicit exclusions to a comma-separated string for persistence.
 * Returns null if there are no exclusions.
 */
export function scopeToExcludedString(sel: ScopeSelection): string | null {
  if (sel.excludes.length === 0) return null;
  return sel.excludes.join(", ");
}

/**
 * Serialize exclusion patterns to a comma-separated string for persistence.
 * Returns null if there are no patterns.
 */
export function scopeToPatternsString(sel: ScopeSelection): string | null {
  if (sel.exclusionPatterns.length === 0) return null;
  return sel.exclusionPatterns.join(", ");
}

/**
 * Parse a comma-separated exclusion string back into an array.
 */
export function parseExcludedString(val: string | null | undefined): string[] {
  if (!val) return [];
  return val
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse a comma-separated patterns string back into an array.
 */
export function parsePatternsString(val: string | null | undefined): string[] {
  if (!val) return [];
  return val
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Convert a ScopeSelection into the MetadataScope used by the comment engine
 * and metadata fetcher.
 */
export function scopeToMetadataScope(sel: ScopeSelection): MetadataScope {
  const catalogs = new Set<string>();
  const schemas: string[] = [];
  const tables: string[] = [];
  const excludedSchemas: string[] = [];
  const excludedTables: string[] = [];

  for (const src of sel.includes) {
    const parts = src.replace(/`/g, "").split(".");
    if (parts.length === 1) {
      catalogs.add(parts[0]);
    } else if (parts.length === 2) {
      catalogs.add(parts[0]);
      schemas.push(src);
    } else if (parts.length >= 3) {
      catalogs.add(parts[0]);
      tables.push(src);
    }
  }

  for (const ex of sel.excludes) {
    const parts = ex.replace(/`/g, "").split(".");
    if (parts.length === 2) {
      excludedSchemas.push(ex);
    } else if (parts.length >= 3) {
      excludedTables.push(ex);
    }
  }

  return {
    catalogs: Array.from(catalogs),
    ...(schemas.length > 0 && { schemas }),
    ...(tables.length > 0 && { tables }),
    ...(excludedSchemas.length > 0 && { excludedSchemas }),
    ...(excludedTables.length > 0 && { excludedTables }),
    ...(sel.exclusionPatterns.length > 0 && {
      exclusionPatterns: sel.exclusionPatterns,
    }),
    ...(sel.inclusionPatterns.length > 0 && {
      inclusionPatterns: sel.inclusionPatterns,
    }),
  };
}

/**
 * Serialize inclusion patterns to a comma-separated string for persistence.
 * Returns null if there are no patterns.
 */
export function scopeToInclusionPatternsString(sel: ScopeSelection): string | null {
  if (sel.inclusionPatterns.length === 0) return null;
  return sel.inclusionPatterns.join(", ");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Allowed characters in exclusion patterns: alphanumeric, underscore, hyphen, dot, *, ? */
const PATTERN_REGEX = /^[a-zA-Z0-9_\-.*?]+$/;

/**
 * Stable validation codes let translated UI surfaces map validation failures
 * through their own message catalog without parsing English text.
 */
export type PatternValidationErrorCode =
  | "empty"
  | "match_all"
  | "invalid_characters"
  | "too_long";

export function validatePatternCode(pattern: string): PatternValidationErrorCode | null {
  const trimmed = pattern?.trim() ?? "";
  if (trimmed.length === 0) return "empty";
  if (trimmed === "*") return "match_all";
  if (!PATTERN_REGEX.test(trimmed)) return "invalid_characters";
  if (trimmed.length > 200) return "too_long";
  return null;
}

const LEGACY_PATTERN_ERRORS: Record<PatternValidationErrorCode, string> = {
  empty: "Pattern cannot be empty",
  match_all: "Pattern '*' would exclude everything -- be more specific",
  invalid_characters: "Pattern can only contain letters, numbers, _, -, ., *, ?",
  too_long: "Pattern is too long (max 200 characters)",
};

/**
 * Compatibility wrapper for existing API/domain consumers that still expect
 * English strings. New translated UI should use `validatePatternCode`.
 */
export function validateExclusionPattern(pattern: string): string | null {
  const code = validatePatternCode(pattern);
  return code ? LEGACY_PATTERN_ERRORS[code] : null;
}
