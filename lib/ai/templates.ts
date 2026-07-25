/**
 * Prompt templates for the Forge pipeline.
 *
 * Ported from docs/references/databricks_forge_v34.ipynb (reference) PROMPT_TEMPLATES dict.
 * Each template uses {placeholder} syntax for variable injection.
 *
 * IMPORTANT: When modifying prompts, always update docs/PROMPTS.md in parallel.
 */

import { createHash } from "crypto";
import { logger } from "@/lib/logger";

import { BUSINESS_CONTEXT_WORKER_PROMPT } from "./templates-business-context";
import { FILTER_BUSINESS_TABLES_PROMPT } from "./templates-filtering";
import { AI_USE_CASE_GEN_PROMPT, STATS_USE_CASE_GEN_PROMPT } from "./templates-usecase-gen";
import {
  DOMAIN_FINDER_PROMPT,
  DOMAINS_MERGER_PROMPT,
  SUBDOMAIN_DETECTOR_PROMPT,
} from "./templates-domain";
import {
  SCORE_USE_CASES_PROMPT,
  REVIEW_USE_CASES_PROMPT,
  GLOBAL_SCORE_CALIBRATION_PROMPT,
  CROSS_DOMAIN_DEDUP_PROMPT,
} from "./templates-scoring";
import { USE_CASE_SQL_GEN_PROMPT, USE_CASE_SQL_FIX_PROMPT } from "./templates-sql-gen";
import {
  ENV_DOMAIN_CATEGORISATION_PROMPT,
  ENV_PII_DETECTION_PROMPT,
  ENV_AUTO_DESCRIPTIONS_PROMPT,
  ENV_REDUNDANCY_DETECTION_PROMPT,
  ENV_IMPLICIT_RELATIONSHIPS_PROMPT,
  ENV_MEDALLION_TIER_PROMPT,
  ENV_DATA_PRODUCTS_PROMPT,
  ENV_CANONICAL_ENTITIES_PROMPT,
  ENV_GOVERNANCE_GAPS_PROMPT,
  ENV_ANALYTICS_MATURITY_PROMPT,
} from "./templates-env";
import {
  PARSE_OUTCOME_MAP,
  SUMMARY_GEN_PROMPT,
  METADATA_GENIE_INDUSTRY_DETECT_PROMPT,
  METADATA_GENIE_DESCRIBE_TABLES_PROMPT,
} from "./templates-misc";
import {
  FINANCIAL_QUANTIFICATION_PROMPT,
  ROADMAP_PHASING_PROMPT,
  EXECUTIVE_SYNTHESIS_PROMPT,
  STAKEHOLDER_ANALYSIS_PROMPT,
} from "./templates-business-value";
import { COLUMN_RANKING_PROMPT } from "./templates-column-ranking";

// ---------------------------------------------------------------------------
// PROMPT_TEMPLATES registry
// ---------------------------------------------------------------------------

export const PROMPT_TEMPLATES = {
  // Step 1: Business Context
  BUSINESS_CONTEXT_WORKER_PROMPT,

  // Step 3: Table Filtering
  FILTER_BUSINESS_TABLES_PROMPT,

  // Step 4: Use Case Generation
  AI_USE_CASE_GEN_PROMPT,
  STATS_USE_CASE_GEN_PROMPT,

  // Step 5: Domain Clustering
  DOMAIN_FINDER_PROMPT,
  SUBDOMAIN_DETECTOR_PROMPT,
  DOMAINS_MERGER_PROMPT,

  // Step 6: Scoring & Deduplication
  SCORE_USE_CASES_PROMPT,
  REVIEW_USE_CASES_PROMPT,
  GLOBAL_SCORE_CALIBRATION_PROMPT,
  CROSS_DOMAIN_DEDUP_PROMPT,

  // Step 7: SQL Generation
  USE_CASE_SQL_GEN_PROMPT,
  USE_CASE_SQL_FIX_PROMPT,

  // Environment Intelligence (Estate Scan)
  ENV_DOMAIN_CATEGORISATION_PROMPT,
  ENV_PII_DETECTION_PROMPT,
  ENV_AUTO_DESCRIPTIONS_PROMPT,
  ENV_REDUNDANCY_DETECTION_PROMPT,
  ENV_IMPLICIT_RELATIONSHIPS_PROMPT,
  ENV_MEDALLION_TIER_PROMPT,
  ENV_DATA_PRODUCTS_PROMPT,
  ENV_CANONICAL_ENTITIES_PROMPT,
  ENV_GOVERNANCE_GAPS_PROMPT,
  ENV_ANALYTICS_MATURITY_PROMPT,

  // Outcome Map Parsing
  PARSE_OUTCOME_MAP,

  // Export: LLM-Generated Summaries (for PDF/PPTX)
  SUMMARY_GEN_PROMPT,

  // Meta Data Genie
  METADATA_GENIE_INDUSTRY_DETECT_PROMPT,
  METADATA_GENIE_DESCRIBE_TABLES_PROMPT,

  // Business Value Pipeline Steps
  FINANCIAL_QUANTIFICATION_PROMPT,
  ROADMAP_PHASING_PROMPT,
  EXECUTIVE_SYNTHESIS_PROMPT,
  STAKEHOLDER_ANALYSIS_PROMPT,

  // Adaptive Column Budget Engine
  COLUMN_RANKING_PROMPT,
} as const;

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------

export type PromptKey = keyof typeof PROMPT_TEMPLATES;

/**
 * System-level instructions for each prompt template. When present, these
 * are sent as the "system" role message to improve persona/instruction
 * adherence, while the rendered prompt becomes the "user" message.
 *
 * Only prompts where persona separation materially improves output quality
 * are included. Simple utility prompts (translations, parsing) are omitted.
 */
export const PROMPT_SYSTEM_MESSAGES: Partial<Record<PromptKey, string>> = {
  BUSINESS_CONTEXT_WORKER_PROMPT:
    "You are a Principal Business Analyst and recognized industry specialist with 15+ years of deep expertise. You produce structured JSON output only. Never include text outside the JSON object.",
  FILTER_BUSINESS_TABLES_PROMPT:
    "You are a Senior Data Architect and Business Domain Expert specializing in identifying business-relevant data assets. You produce structured JSON output only.",
  AI_USE_CASE_GEN_PROMPT:
    "You are a Principal Enterprise Data Architect and AI/ML Solutions Architect. You generate high-quality, data-grounded business use cases as structured JSON. Never hallucinate table or column names.",
  STATS_USE_CASE_GEN_PROMPT:
    "You are a Principal Enterprise Data Architect and Advanced Analytics Expert. You generate statistics-focused business use cases as structured JSON. Never hallucinate table or column names.",
  DOMAIN_FINDER_PROMPT:
    "You are an expert business analyst specializing in balanced domain taxonomy design. You produce structured JSON output only.",
  SUBDOMAIN_DETECTOR_PROMPT:
    "You are an expert business analyst specializing in subdomain taxonomy design within business domains. You produce structured JSON output only.",
  SCORE_USE_CASES_PROMPT:
    "You are the Chief Investment Officer & Strategic Value Architect. You are ruthless, evidence-based, and ROI-obsessed. Score use cases on absolute merit against stated strategic goals. You produce structured JSON output only.",
  REVIEW_USE_CASES_PROMPT:
    "You are an expert business analyst specializing in duplicate detection and quality control. You produce structured JSON output only.",
  GLOBAL_SCORE_CALIBRATION_PROMPT:
    "You are the Chief Investment Officer recalibrating scores across all domains to ensure global consistency. You produce structured JSON output only.",
  CROSS_DOMAIN_DEDUP_PROMPT:
    "You are an expert business analyst specializing in cross-domain duplicate detection. You produce structured JSON output only.",
  USE_CASE_SQL_GEN_PROMPT:
    "You are a Principal Databricks SQL Engineer with 15+ years of experience writing production-grade analytics queries. You produce raw SQL only -- no markdown fences, no explanations.",
  USE_CASE_SQL_FIX_PROMPT:
    "You are a Senior Databricks SQL Engineer specializing in debugging SQL queries. Fix only the reported error, preserve all business logic. You produce raw SQL only.",
  SUMMARY_GEN_PROMPT:
    "You are a senior management consultant writing executive briefings. You produce structured JSON output only. Be concise, specific, and action-oriented.",
  METADATA_GENIE_INDUSTRY_DETECT_PROMPT:
    "You are a Senior Data Industry Analyst who identifies business domains from data catalog metadata. You produce structured JSON output only.",
  METADATA_GENIE_DESCRIBE_TABLES_PROMPT:
    "You are a data catalog specialist who writes concise, business-friendly table descriptions from metadata. You produce structured JSON output only.",
  FINANCIAL_QUANTIFICATION_PROMPT:
    "You are a Senior Management Consultant and Financial Analyst. You estimate order-of-magnitude financial impact for data use cases. Be conservative and evidence-based. You produce structured JSON output only.",
  ROADMAP_PHASING_PROMPT:
    "You are a Chief Delivery Officer who sequences data initiatives into phased implementation roadmaps. You produce structured JSON output only.",
  EXECUTIVE_SYNTHESIS_PROMPT:
    "You are a Senior Partner at a top-tier management consulting firm. You distill complex data analysis into sharp, actionable executive briefings. You produce structured JSON output only.",
  STAKEHOLDER_ANALYSIS_PROMPT:
    "You are an Organizational Change Management Consultant. You map stakeholder impact and readiness for data transformation programs. You produce structured JSON output only.",
  COLUMN_RANKING_PROMPT:
    "You are a data analyst selecting the most business-relevant columns from wide database tables. You produce structured JSON output only. Never include text outside the JSON object.",
};

/**
 * Content-addressable version fingerprint for each prompt template.
 * Computed as truncated SHA-256 hash of the template text, so any edit
 * to a template automatically produces a new version identifier.
 *
 * Stored with each pipeline run for full reproducibility.
 */
export const PROMPT_VERSIONS: Record<PromptKey, string> = Object.fromEntries(
  Object.entries(PROMPT_TEMPLATES).map(([key, tmpl]) => [
    key,
    createHash("sha256").update(tmpl).digest("hex").slice(0, 8),
  ]),
) as Record<PromptKey, string>;

/**
 * Variables that contain user-supplied free text and should be wrapped
 * with delimiter markers to reduce prompt injection risk.
 * These variables flow directly from user input (settings page, run config).
 */
const USER_INPUT_VARIABLES = new Set([
  "business_name",
  "name",
  "industry",
  "industries",
  "business_context",
  "strategic_goals",
  "business_priorities",
  "strategic_initiative",
  "value_chain",
  "revenue_model",
  "additional_context_section",
  "focus_areas_instruction",
  "business_domains",
]);

/**
 * Wrap user-supplied text with delimiter markers to reduce prompt injection.
 * Strips any existing delimiter markers from the text, then wraps it in a
 * clearly delineated block that the LLM can distinguish from instructions.
 */
function sanitiseUserInput(value: string): string {
  // Strip any attempt to close/spoof our delimiters (exact and whitespace variants)
  const cleaned = value
    .replace(/---\s*BEGIN\s+USER\s+DATA\s*---/gi, "")
    .replace(/---\s*END\s+USER\s+DATA\s*---/gi, "");
  return `---BEGIN USER DATA---\n${cleaned}\n---END USER DATA---`;
}

/**
 * Load and format a prompt template by replacing {placeholder} variables.
 *
 * User-supplied variables are wrapped with delimiter markers for safety.
 */
export function formatPrompt(key: PromptKey, variables: Record<string, string>): string {
  let prompt: string = PROMPT_TEMPLATES[key];

  for (const [varName, value] of Object.entries(variables)) {
    const safeValue = USER_INPUT_VARIABLES.has(varName) ? sanitiseUserInput(value) : value;
    prompt = prompt.replace(new RegExp(`\\{${varName}\\}`, "g"), safeValue);
  }

  // Warn on any remaining {placeholder} patterns that were not substituted.
  // This catches missing variables at runtime instead of silently sending
  // unresolved placeholders to the LLM.
  const remaining = prompt.match(/\{[a-z_]+\}/g);
  if (remaining) {
    const unique = [...new Set(remaining)];
    logger.warn("Unresolved placeholders in prompt template", {
      promptKey: key,
      unresolvedPlaceholders: unique,
    });
  }

  return prompt;
}
