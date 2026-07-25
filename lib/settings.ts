/**
 * App-level settings persisted in localStorage.
 *
 * These are user preferences that apply across runs (not per-run config).
 * They are read by the pipeline config form at submission time.
 */

import type { DiscoveryDepth, DiscoveryDepthConfig } from "@/lib/domain/types";
import { DISCOVERY_DEPTHS, DEFAULT_DEPTH_CONFIGS } from "@/lib/domain/types";
import {
  COMMENT_OUTPUT_LANGUAGES,
  DEFAULT_COMMENT_OUTPUT_LANGUAGE,
  isCommentOutputLanguage,
  type CommentOutputLanguage,
} from "@/lib/ai/comment-engine/types";

export type { CommentOutputLanguage };
export { COMMENT_OUTPUT_LANGUAGES, DEFAULT_COMMENT_OUTPUT_LANGUAGE };

export type GenieAuthMode = "obo" | "sp";
const VALID_AUTH_MODES = new Set<GenieAuthMode>(["obo", "sp"]);

export type QuestionComplexity = "simple" | "medium" | "complex";
const VALID_COMPLEXITIES = new Set<QuestionComplexity>(["simple", "medium", "complex"]);

export type QualityPreset = "speed" | "balanced" | "premium";
const VALID_PRESETS = new Set<QualityPreset>(["speed", "balanced", "premium"]);

export interface QuestionComplexitySettings {
  genieEngine: QuestionComplexity;
  adhocGenie: QuestionComplexity;
  metadataGenie: QuestionComplexity;
}

export interface GenieEngineDefaults {
  engineEnabled: boolean;
  maxTablesPerSpace: number;
  /** Max domains to auto-analyse per run (0 = unlimited). */
  maxAutoSpaces: number;
  llmRefinement: boolean;
  generateBenchmarks: boolean;
  generateMetricViews: boolean;
  autoTimePeriods: boolean;
  generateTrustedAssets: boolean;
  fiscalYearStartMonth: number;
  entityMatchingMode: "auto" | "manual" | "off";
  qualityPreset: QualityPreset;
}

export interface AppSettings {
  /** Number of sample rows to fetch per table for discovery & SQL generation (0 = disabled) */
  sampleRowsPerTable: number;
  /** Default export format */
  defaultExportFormat: string;
  /** Default notebook deployment path */
  notebookPath: string;
  /** Default discovery depth for new pipeline runs */
  defaultDiscoveryDepth: DiscoveryDepth;
  /** Tunable parameters for each discovery depth level */
  discoveryDepthConfigs: Record<DiscoveryDepth, DiscoveryDepthConfig>;
  /** Global Genie Engine defaults applied to new runs */
  genieEngineDefaults: GenieEngineDefaults;
  /** Whether to run estate scan (environment intelligence) during pipeline runs (default: false) */
  estateScanEnabled: boolean;
  /** Whether to discover existing analytics assets (Genie spaces, dashboards, metric views) during runs (default: false) */
  assetDiscoveryEnabled: boolean;
  /** Auth mode for Genie Space deployments: "obo" (user token) or "sp" (service principal) */
  genieDeployAuthMode: GenieAuthMode;
  /** Whether semantic search, knowledge base, and RAG retrieval are enabled in the UI (default: true). Embeddings are still generated regardless. */
  semanticSearchEnabled: boolean;
  /** Whether the benchmark catalog UI, embedding, and RAG retrieval are enabled (default: false). Requires FORGE_BENCHMARKS_ENABLED=true server-side. */
  benchmarksEnabled: boolean;
  /** Per-surface question complexity (simple / medium / complex). Controls the language style of Genie sample questions. */
  questionComplexity: QuestionComplexitySettings;
  /** Prefix prepended to Unity Catalog resource names (views, metric views, tables) created by Forge. Must be lowercase alphanumeric + underscores and end with '_'. */
  catalogResourcePrefix: string;
  /** Global industry outcome map id. When set, kickoff forms skip the per-job industry dropdown and use this value. Empty string = not set. */
  industry: string;
  /** Output language for AI-generated table/column comments. Independent from the UI locale. */
  aiCommentLanguage: CommentOutputLanguage;
  /**
   * Per-item sidebar visibility, keyed by nav item href. Most absent keys are
   * visible; product defaults can opt specific items out (Ask Forge starts
   * hidden). Deployment gates still apply independently.
   */
  menuVisibility: Record<string, boolean>;
}

const STORAGE_KEY = "forge-settings";
const LEGACY_STORAGE_KEY = "forge-ai-settings";

function migrateStorageKey(): void {
  if (typeof window === "undefined") return;
  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacy && !localStorage.getItem(STORAGE_KEY)) {
    localStorage.setItem(STORAGE_KEY, legacy);
  }
  if (legacy) localStorage.removeItem(LEGACY_STORAGE_KEY);
}

const DEFAULT_GENIE_ENGINE: GenieEngineDefaults = {
  engineEnabled: true,
  maxTablesPerSpace: 25,
  maxAutoSpaces: 0,
  llmRefinement: true,
  generateBenchmarks: true,
  generateMetricViews: true,
  autoTimePeriods: true,
  generateTrustedAssets: true,
  fiscalYearStartMonth: 1,
  entityMatchingMode: "auto",
  qualityPreset: "balanced",
};

const DEFAULT_QUESTION_COMPLEXITY: QuestionComplexitySettings = {
  genieEngine: "simple",
  adhocGenie: "simple",
  metadataGenie: "simple",
};

export const DEFAULT_CATALOG_RESOURCE_PREFIX = "forge_";

/** Sidebar items that intentionally start hidden until a user opts in. */
export const DEFAULT_MENU_VISIBILITY: Readonly<Record<string, boolean>> = {
  "/ask-forge": false,
};

/** Merge valid persisted visibility choices over product defaults. */
export function normalizeMenuVisibility(raw: unknown): Record<string, boolean> {
  const result: Record<string, boolean> = { ...DEFAULT_MENU_VISIBILITY };
  if (typeof raw !== "object" || raw === null) return result;
  for (const [href, visible] of Object.entries(raw)) {
    if (typeof visible === "boolean") result[href] = visible;
  }
  return result;
}

const DEFAULTS: AppSettings = {
  sampleRowsPerTable: 0,
  defaultExportFormat: "excel",
  notebookPath: "./forge_gen/",
  defaultDiscoveryDepth: "balanced",
  discoveryDepthConfigs: { ...DEFAULT_DEPTH_CONFIGS },
  genieEngineDefaults: { ...DEFAULT_GENIE_ENGINE },
  estateScanEnabled: false,
  assetDiscoveryEnabled: false,
  genieDeployAuthMode: "obo",
  semanticSearchEnabled: true,
  benchmarksEnabled: false,
  questionComplexity: { ...DEFAULT_QUESTION_COMPLEXITY },
  catalogResourcePrefix: DEFAULT_CATALOG_RESOURCE_PREFIX,
  industry: "",
  aiCommentLanguage: DEFAULT_COMMENT_OUTPUT_LANGUAGE,
  menuVisibility: { ...DEFAULT_MENU_VISIBILITY },
};

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return { ...DEFAULTS };
  migrateStorageKey();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      sampleRowsPerTable:
        typeof parsed.sampleRowsPerTable === "number"
          ? parsed.sampleRowsPerTable
          : DEFAULTS.sampleRowsPerTable,
      defaultExportFormat:
        typeof parsed.defaultExportFormat === "string"
          ? parsed.defaultExportFormat
          : DEFAULTS.defaultExportFormat,
      notebookPath:
        typeof parsed.notebookPath === "string" ? parsed.notebookPath : DEFAULTS.notebookPath,
      defaultDiscoveryDepth:
        typeof parsed.defaultDiscoveryDepth === "string" &&
        (DISCOVERY_DEPTHS as readonly string[]).includes(parsed.defaultDiscoveryDepth)
          ? (parsed.defaultDiscoveryDepth as DiscoveryDepth)
          : DEFAULTS.defaultDiscoveryDepth,
      discoveryDepthConfigs: parseDepthConfigs(parsed.discoveryDepthConfigs),
      genieEngineDefaults: parseGenieEngineDefaults(parsed.genieEngineDefaults),
      estateScanEnabled:
        typeof parsed.estateScanEnabled === "boolean"
          ? parsed.estateScanEnabled
          : DEFAULTS.estateScanEnabled,
      assetDiscoveryEnabled:
        typeof parsed.assetDiscoveryEnabled === "boolean"
          ? parsed.assetDiscoveryEnabled
          : DEFAULTS.assetDiscoveryEnabled,
      genieDeployAuthMode:
        typeof parsed.genieDeployAuthMode === "string" &&
        VALID_AUTH_MODES.has(parsed.genieDeployAuthMode as GenieAuthMode)
          ? (parsed.genieDeployAuthMode as GenieAuthMode)
          : DEFAULTS.genieDeployAuthMode,
      semanticSearchEnabled:
        typeof parsed.semanticSearchEnabled === "boolean"
          ? parsed.semanticSearchEnabled
          : DEFAULTS.semanticSearchEnabled,
      benchmarksEnabled:
        typeof parsed.benchmarksEnabled === "boolean"
          ? parsed.benchmarksEnabled
          : DEFAULTS.benchmarksEnabled,
      questionComplexity: parseQuestionComplexity(parsed.questionComplexity),
      catalogResourcePrefix: parseCatalogResourcePrefix(parsed.catalogResourcePrefix),
      industry: typeof parsed.industry === "string" ? parsed.industry : DEFAULTS.industry,
      aiCommentLanguage: isCommentOutputLanguage(parsed.aiCommentLanguage)
        ? parsed.aiCommentLanguage
        : DEFAULTS.aiCommentLanguage,
      menuVisibility: normalizeMenuVisibility(parsed.menuVisibility),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function isValidDepthConfig(v: unknown): v is DiscoveryDepthConfig {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.batchTargetMin === "number" &&
    typeof o.batchTargetMax === "number" &&
    typeof o.qualityFloor === "number" &&
    typeof o.adaptiveCap === "number"
  );
}

function parseDepthConfigs(raw: unknown): Record<DiscoveryDepth, DiscoveryDepthConfig> {
  const result = { ...DEFAULT_DEPTH_CONFIGS };
  if (typeof raw !== "object" || raw === null) return result;
  const obj = raw as Record<string, unknown>;
  for (const depth of DISCOVERY_DEPTHS) {
    if (isValidDepthConfig(obj[depth])) {
      // Merge over defaults so configs persisted before new fields existed
      // (e.g. lineageEnabled / lineageDirection) fall back gracefully.
      result[depth] = { ...DEFAULT_DEPTH_CONFIGS[depth], ...obj[depth] };
    }
  }
  return result;
}

const VALID_ENTITY_MODES = new Set(["auto", "manual", "off"]);

function parseGenieEngineDefaults(raw: unknown): GenieEngineDefaults {
  const result = { ...DEFAULT_GENIE_ENGINE };
  if (typeof raw !== "object" || raw === null) return result;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.engineEnabled === "boolean") result.engineEnabled = obj.engineEnabled;
  if (typeof obj.maxTablesPerSpace === "number") result.maxTablesPerSpace = obj.maxTablesPerSpace;
  if (typeof obj.maxAutoSpaces === "number") result.maxAutoSpaces = obj.maxAutoSpaces;
  if (typeof obj.llmRefinement === "boolean") result.llmRefinement = obj.llmRefinement;
  if (typeof obj.generateBenchmarks === "boolean")
    result.generateBenchmarks = obj.generateBenchmarks;
  if (typeof obj.generateMetricViews === "boolean")
    result.generateMetricViews = obj.generateMetricViews;
  if (typeof obj.autoTimePeriods === "boolean") result.autoTimePeriods = obj.autoTimePeriods;
  if (typeof obj.generateTrustedAssets === "boolean")
    result.generateTrustedAssets = obj.generateTrustedAssets;
  if (typeof obj.fiscalYearStartMonth === "number")
    result.fiscalYearStartMonth = obj.fiscalYearStartMonth;
  if (typeof obj.entityMatchingMode === "string" && VALID_ENTITY_MODES.has(obj.entityMatchingMode))
    result.entityMatchingMode = obj.entityMatchingMode as GenieEngineDefaults["entityMatchingMode"];
  if (
    typeof obj.qualityPreset === "string" &&
    VALID_PRESETS.has(obj.qualityPreset as QualityPreset)
  )
    result.qualityPreset = obj.qualityPreset as QualityPreset;
  return result;
}

function parseQuestionComplexity(raw: unknown): QuestionComplexitySettings {
  const result = { ...DEFAULT_QUESTION_COMPLEXITY };
  if (typeof raw !== "object" || raw === null) return result;
  const obj = raw as Record<string, unknown>;
  for (const key of ["genieEngine", "adhocGenie", "metadataGenie"] as const) {
    if (typeof obj[key] === "string" && VALID_COMPLEXITIES.has(obj[key] as QuestionComplexity)) {
      result[key] = obj[key] as QuestionComplexity;
    }
  }
  return result;
}

function parseCatalogResourcePrefix(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_CATALOG_RESOURCE_PREFIX;
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_CATALOG_RESOURCE_PREFIX;
  if (!/^[a-z0-9_]+$/.test(trimmed)) return DEFAULT_CATALOG_RESOURCE_PREFIX;
  return trimmed.endsWith("_") ? trimmed : `${trimmed}_`;
}

export function saveSettings(settings: Partial<AppSettings>): AppSettings {
  const current = loadSettings();
  const merged = { ...current, ...settings };
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  }
  return merged;
}
