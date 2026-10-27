/**
 * Input validation utilities for API routes and SQL identifier safety.
 */

import { z } from "zod/v4";
import {
  BENCHMARK_KINDS,
  BENCHMARK_SOURCE_TYPES,
  BENCHMARK_LICENSE_CLASSES,
  BENCHMARK_LIFECYCLE,
} from "@/lib/domain/benchmarks";

// ---------------------------------------------------------------------------
// SQL identifier validation
// ---------------------------------------------------------------------------

/**
 * Strict regex for Unity Catalog identifiers (catalog, schema, table names).
 * Allows alphanumeric, underscores, hyphens, and dots (for FQNs).
 * Rejects SQL injection characters like quotes, semicolons, dashes (--), etc.
 */
const SAFE_IDENTIFIER_RE = /^[a-zA-Z0-9_\-]+$/;

/**
 * Validate a SQL identifier (catalog or schema name) is safe for interpolation.
 * Throws if the identifier contains dangerous characters.
 */
export function validateIdentifier(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new IdentifierValidationError(`${label} cannot be empty`);
  }
  if (trimmed.length > 255) {
    throw new IdentifierValidationError(`${label} exceeds maximum length (255 chars)`);
  }
  if (!SAFE_IDENTIFIER_RE.test(trimmed)) {
    throw new IdentifierValidationError(
      `${label} contains invalid characters. Only alphanumeric, underscores, and hyphens are allowed.`,
    );
  }
  return trimmed;
}

export class IdentifierValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentifierValidationError";
  }
}

/**
 * Validate a fully-qualified name (catalog.schema.object) for safe SQL interpolation.
 * Each dot-separated segment must pass SAFE_IDENTIFIER_RE.
 */
export function validateFqn(fqn: string, label = "FQN"): string {
  const trimmed = fqn.replace(/`/g, "").trim();
  if (!trimmed) {
    throw new IdentifierValidationError(`${label} cannot be empty`);
  }
  const parts = trimmed.split(".");
  if (parts.length < 1 || parts.length > 4) {
    throw new IdentifierValidationError(
      `${label} must have 1-4 dot-separated parts, got ${parts.length}`,
    );
  }
  for (const part of parts) {
    validateIdentifier(part, `${label} segment`);
  }
  return trimmed;
}

/**
 * Validate a DDL string only contains an expected CREATE statement.
 * Rejects DDL that contains dangerous standalone statements.
 */
const DDL_DANGEROUS_PATTERN =
  /\b(DROP\s+(?!FUNCTION\s+IF\s+EXISTS|VIEW\s+IF\s+EXISTS)|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|TRUNCATE|ALTER\s+TABLE|GRANT\s+|REVOKE\s+)/i;

export function validateDdl(ddl: string, expectedPrefix: RegExp, label = "DDL"): void {
  if (!expectedPrefix.test(ddl)) {
    throw new IdentifierValidationError(`${label} must start with expected CREATE statement`);
  }
  if (DDL_DANGEROUS_PATTERN.test(ddl)) {
    throw new IdentifierValidationError(`${label} contains disallowed SQL statement`);
  }
}

// ---------------------------------------------------------------------------
// UUID validation
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUUID(value: string): boolean {
  return UUID_RE.test(value);
}

export function validateUUID(value: string, label = "ID"): string {
  if (!isValidUUID(value)) {
    throw new Error(`${label} is not a valid UUID`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Safe ID validation (UUIDs or custom formats like FUL-001-abc123)
// ---------------------------------------------------------------------------

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

/** Returns true if value is a non-empty string of alphanumeric, hyphen, or underscore chars (max 128). */
export function isSafeId(value: string): boolean {
  return SAFE_ID_RE.test(value);
}

// ---------------------------------------------------------------------------
// Zod schemas for API routes
// ---------------------------------------------------------------------------

export const CreateRunSchema = z.object({
  businessName: z.string().min(1, "businessName is required").max(500),
  ucMetadata: z.string().min(1, "ucMetadata is required").max(1000),
  excludedScope: z.string().max(2000).optional().default(""),
  exclusionPatterns: z.string().max(1000).optional().default(""),
  operation: z.string().max(200).optional().default("Discover Usecases"),
  businessDomains: z.string().max(2000).optional().default(""),
  businessPriorities: z.array(z.string()).optional().default(["Increase Revenue"]),
  strategicGoals: z.string().max(5000).optional().default(""),
  additionalContext: z.string().max(6000).optional().default(""),
  customerMaturity: z.enum(["nascent", "developing", "advanced"]).optional().default("developing"),
  riskPosture: z.enum(["conservative", "balanced", "aggressive"]).optional().default("balanced"),
  transformationHorizon: z
    .enum(["quarter", "half-year", "year-plus"])
    .optional()
    .default("half-year"),
  generationOptions: z.array(z.string()).optional().default(["SQL Code"]),
  generationPath: z.string().max(500).optional().default("./forge_gen/"),
  languages: z.array(z.literal("English")).optional().default(["English"]),
  aiModel: z.string().max(200).optional().default("databricks-claude-opus-5-5"),
  sampleRowsPerTable: z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => {
      const n = typeof v === "number" ? v : parseInt(String(v ?? "0"), 10);
      return Math.min(Math.max(isNaN(n) ? 0 : n, 0), 50);
    }),
  industry: z.string().max(100).optional().default(""),
  discoveryDepth: z.enum(["focused", "balanced", "comprehensive"]).optional().default("balanced"),
  depthConfig: z
    .object({
      batchTargetMin: z.number().int().min(1).max(50),
      batchTargetMax: z.number().int().min(1).max(100),
      qualityFloor: z.number().min(0).max(1),
      adaptiveCap: z.number().int().min(10).max(1000),
      lineageDepth: z.number().int().min(1).max(10),
      lineageEnabled: z.boolean().optional(),
      lineageDirection: z.enum(["upstream", "both", "downstream"]).optional(),
    })
    .optional(),
  estateScanEnabled: z.boolean().optional().default(false),
  assetDiscoveryEnabled: z.boolean().optional().default(false),
  fabricScanId: z.string().uuid().optional().nullable(),
  sourceScanId: z.string().uuid().optional().nullable(),
  businessValueEnabled: z.boolean().optional().default(true),
  outputLanguage: z.enum(["en", "pt-BR", "es"]).optional().default("en"),
});

export type CreateRunInput = z.infer<typeof CreateRunSchema>;

export const CreateBenchmarkSchema = z.object({
  kind: z.enum(BENCHMARK_KINDS),
  title: z.string().min(8).max(240),
  summary: z.string().min(20).max(4000),
  source_type: z.enum(BENCHMARK_SOURCE_TYPES),
  source_url: z.url(),
  publisher: z.string().min(2).max(200),
  published_at: z.string().datetime().optional(),
  industry: z.string().min(2).max(80).optional(),
  region: z.string().min(2).max(80).optional(),
  metric_definition: z.string().max(2000).optional(),
  methodology_note: z.string().max(2000).optional(),
  license_class: z.enum(BENCHMARK_LICENSE_CLASSES),
  confidence: z.number().min(0).max(1),
  ttl_days: z.number().int().min(1).max(3650),
  tags: z.array(z.string().min(1).max(80)).optional().default([]),
  provenance: z
    .object({
      source_class: z.string().min(2).max(80),
      captured_at: z.string().datetime().optional(),
      citation: z.string().min(8).max(500).optional(),
      notes: z.string().max(1000).optional(),
    })
    .passthrough()
    .optional(),
});

export const UpdateBenchmarkSchema = z
  .object({
    lifecycle_status: z.enum(BENCHMARK_LIFECYCLE).optional(),
    source_content: z.string().min(50).max(500_000).optional(),
  })
  .refine((d) => d.lifecycle_status !== undefined || d.source_content !== undefined, {
    message: "Provide lifecycle_status or source_content",
  });

export const MetadataQuerySchema = z.object({
  type: z.enum(["catalogs", "schemas", "tables"]).default("catalogs"),
  catalog: z.string().max(255).optional(),
  schema: z.string().max(255).optional(),
});

// ---------------------------------------------------------------------------
// Zod schemas for LLM output validation
// ---------------------------------------------------------------------------

/** Step 1: Business context JSON returned by BUSINESS_CONTEXT_WORKER_PROMPT */
export const BusinessContextOutputSchema = z
  .object({
    industries: z.unknown().transform(String),
    strategic_goals: z.unknown().transform(String),
    business_priorities: z.unknown().transform(String),
    strategic_initiative: z.unknown().transform(String),
    value_chain: z.unknown().transform(String),
    revenue_model: z.unknown().transform(String),
    additional_context: z
      .unknown()
      .optional()
      .transform((v) => String(v ?? "")),
  })
  .passthrough();

const numericField = z.union([z.number(), z.string()]).transform(Number).pipe(z.number());

const PriorityFactorsSchema = z
  .object({
    roi: numericField,
    strategic_alignment: numericField,
    time_to_value: numericField,
    reusability: numericField,
  })
  .optional();

const FeasibilityFactorsSchema = z
  .object({
    data_availability: numericField,
    data_accessibility: numericField,
    architecture_fitness: numericField,
    team_skills: numericField,
    domain_knowledge: numericField,
    people_allocation: numericField,
    budget_allocation: numericField,
    time_to_production: numericField,
  })
  .optional();

/** Step 6a: Score items returned by SCORE_USE_CASES_PROMPT */
export const ScoreItemSchema = z.object({
  no: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "number" ? v : parseInt(String(v), 10))),
  priority_score: numericField,
  feasibility_score: numericField,
  impact_score: numericField,
  overall_score: numericField,
  priority_rationale: z.string().optional().default(""),
  feasibility_rationale: z.string().optional().default(""),
  impact_rationale: z.string().optional().default(""),
  priority_factors: PriorityFactorsSchema,
  feasibility_factors: FeasibilityFactorsSchema,
});
export type ScoreItemOutput = z.infer<typeof ScoreItemSchema>;

/** Step 6b: Dedup items returned by REVIEW_USE_CASES_PROMPT */
export const DedupItemSchema = z.object({
  no: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "number" ? v : parseInt(String(v), 10))),
  action: z.string(),
  reason: z.string().optional().default(""),
});
export type DedupItemOutput = z.infer<typeof DedupItemSchema>;

/** Step 6c: Cross-domain dedup returned by CROSS_DOMAIN_DEDUP_PROMPT */
export const CrossDomainDedupItemSchema = z.object({
  no: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "number" ? v : parseInt(String(v), 10))),
  duplicate_of: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "number" ? v : parseInt(String(v), 10))),
  reason: z.string().optional().default(""),
});
export type CrossDomainDedupItemOutput = z.infer<typeof CrossDomainDedupItemSchema>;

/** Step 6d: Calibration items returned by GLOBAL_SCORE_CALIBRATION_PROMPT */
export const CalibrationItemSchema = z.object({
  no: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "number" ? v : parseInt(String(v), 10))),
  overall_score: z.union([z.number(), z.string()]).transform(Number).pipe(z.number()),
});
export type CalibrationItemOutput = z.infer<typeof CalibrationItemSchema>;

/** Step 5a: Domain assignment returned by DOMAIN_FINDER_PROMPT */
export const DomainAssignmentSchema = z.object({
  no: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "number" ? v : parseInt(String(v), 10))),
  domain: z.string().min(1),
});
export type DomainAssignmentOutput = z.infer<typeof DomainAssignmentSchema>;

/** Step 5b: Subdomain assignment returned by SUBDOMAIN_DETECTOR_PROMPT */
export const SubdomainAssignmentSchema = z.object({
  no: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "number" ? v : parseInt(String(v), 10))),
  subdomain: z.string().min(1),
});
export type SubdomainAssignmentOutput = z.infer<typeof SubdomainAssignmentSchema>;

/**
 * Validate an array of LLM output items against a Zod schema.
 * Returns only the valid items; invalid items are logged and skipped.
 */
export function validateLLMArray<T>(items: unknown[], schema: z.ZodType<T>, context: string): T[] {
  const valid: T[] = [];
  for (let i = 0; i < items.length; i++) {
    const result = schema.safeParse(items[i]);
    if (result.success) {
      valid.push(result.data);
    } else {
      const issues = result.error.issues.map((iss) => iss.message).join("; ");
      // Use console.warn here since logger may not be imported in all contexts
      console.warn(`[validateLLMArray] ${context}: item ${i} invalid: ${issues}`);
    }
  }
  return valid;
}

// ---------------------------------------------------------------------------
// Safe JSON parse for request bodies
// ---------------------------------------------------------------------------

/**
 * Safely parse request JSON. Returns the parsed body or an error message.
 */
export async function safeParseBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { success: false, error: "Invalid JSON in request body" };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues.map((i) => i.message).join("; ");
    return { success: false, error: messages };
  }

  return { success: true, data: result.data };
}
