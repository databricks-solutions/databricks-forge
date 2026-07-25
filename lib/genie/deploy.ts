/**
 * Shared Genie deployment logic: DDL rewriting, metric view sanitization,
 * deployment with auto-fix, space preparation, and validation.
 *
 * Used by:
 * - app/api/runs/[runId]/genie-deploy/route.ts (full deploy flow)
 * - app/api/genie-spaces/route.ts (ad-hoc space creation with metric views)
 */

import { executeSQL } from "@/lib/dbx/sql";
import { logger } from "@/lib/logger";
import { validateFqn, validateIdentifier } from "@/lib/validation";
import { validateMetricViewTargetSchema } from "@/lib/metric-views/deploy-target";
import { nestSnowflakeJoins, qualifyNestedAliasRefs } from "./passes/metric-view-proposals";

export { validateMetricViewTargetSchema } from "@/lib/metric-views/deploy-target";

type DeploySql = (sql: string) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeployAsset {
  name: string;
  ddl: string;
  description?: string;
}

export interface StrippedRef {
  type: "metric_view";
  identifier: string;
  reason: string;
}

export interface AssetResult {
  name: string;
  type: "metric_view";
  success: boolean;
  error?: string;
  fqn?: string;
  autoFixed?: boolean;
  errorCategory?: string;
  manifestPromoted?: boolean;
}

export interface MetricViewDeployResult {
  name: string;
  success: boolean;
  fqn?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// DDL rewriting & sanitization
// ---------------------------------------------------------------------------

/**
 * Prepend a resource prefix to an object name, avoiding double-prefixing.
 * Returns the name unchanged when prefix is empty.
 */
export function applyResourcePrefix(objectName: string, prefix: string): string {
  if (!prefix || objectName.startsWith(prefix)) return objectName;
  return `${prefix}${objectName}`;
}

/**
 * Strip 4-part FQN column prefixes (catalog.schema.table.column -> column)
 * from a SQL/YAML expression string.
 */
export function stripFqnPrefixes(sql: string): string {
  return sql.replace(/\b[a-zA-Z_]\w*\.[a-zA-Z_]\w*\.[a-zA-Z_]\w*\.([a-zA-Z_]\w*)\b/g, "$1");
}

/**
 * Rewrite the target FQN in a CREATE VIEW statement to use a different
 * catalog.schema while preserving the object name. Optionally applies a
 * resource prefix to the object name.
 */
export function rewriteDdlTarget(
  ddl: string,
  targetSchema: string,
  resourcePrefix?: string,
): string {
  const validatedTargetSchema = validateMetricViewTargetSchema(targetSchema);
  if (resourcePrefix) validateIdentifier(resourcePrefix, "metric view resource prefix");
  return ddl.replace(
    /(CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+)(`?[a-zA-Z_]\w*`?\.`?[a-zA-Z_]\w*`?\.`?[a-zA-Z_]\w*`?)/i,
    (_match, prefix: string, fqn: string) => {
      const parts = fqn.replace(/`/g, "").split(".");
      let objectName = parts[parts.length - 1];
      if (resourcePrefix) {
        objectName = applyResourcePrefix(objectName, resourcePrefix);
      }
      return `${prefix}${validatedTargetSchema}.${objectName}`;
    },
  );
}

/**
 * Fix ambiguous join `on:` clauses by qualifying bare column names with `source.`.
 * E.g. `on: customerID = customer.customerID` -> `on: source.customerID = customer.customerID`
 *
 * A bare column is one that appears without a dot prefix on the left side of `=`.
 */
export function qualifyJoinCriteria(onExpr: string): string {
  return onExpr.replace(
    /^(\s*)(\b[a-zA-Z_]\w*\b)\s*=\s*(\b[a-zA-Z_]\w*\b)\.(\b[a-zA-Z_]\w*\b)\s*$/,
    "$1source.$2 = $3.$4",
  );
}

/**
 * Remove window: blocks from YAML measures. The window spec is experimental
 * and the YAML parser frequently rejects LLM-generated window structures.
 * Handles both inline `window: {...}` and multi-line indented blocks.
 */
export function stripWindowBlocks(ddl: string): string {
  const lines = ddl.split("\n");
  const result: string[] = [];
  let skipIndent = -1;

  for (const line of lines) {
    if (skipIndent >= 0) {
      const indent = line.search(/\S/);
      if (indent > skipIndent || (indent === -1 && line.trim() === "")) {
        continue;
      }
      skipIndent = -1;
    }

    if (/^\s*window:\s*/.test(line)) {
      const windowIndent = line.search(/\S/);
      const afterColon = line.replace(/^\s*window:\s*/, "").trim();
      if (afterColon && !afterColon.startsWith("{")) {
        // single-line window value -- skip this line only
        continue;
      }
      // multi-line block or inline object -- skip until dedent
      skipIndent = windowIndent;
      continue;
    }

    result.push(line);
  }

  return result.join("\n");
}

const AI_FUNCTION_PATTERN =
  /\b(?:ai_analyze_sentiment|ai_classify|ai_extract|ai_gen|ai_query|ai_similarity|ai_forecast|ai_summarize)\s*\(/i;

/**
 * Remove YAML dimension/measure entries whose expr: contains an AI function.
 * Matches a `- name: ...` line followed by an `expr: ...` line that includes
 * a prohibited AI function call, and removes both lines.
 */
export function stripAiFunctionEntries(ddl: string): string {
  return ddl.replace(
    /^(\s*- name:\s*.+\n)(\s*expr:\s*.+)$/gm,
    (_match, nameLine: string, exprLine: string) => {
      if (AI_FUNCTION_PATTERN.test(exprLine)) {
        logger.warn("Stripping metric view entry with AI function", {
          entry: exprLine.trim(),
        });
        return "";
      }
      return nameLine + exprLine;
    },
  );
}

/**
 * Sanitize a metric view DDL before execution:
 * 1. Strip FQN column prefixes from expr: and on: lines
 * 2. Remove `comment:` lines (unsupported by Databricks YAML parser)
 * 3. Qualify ambiguous join criteria with `source.` prefix
 * 4. Restructure flat snowflake joins into nested joins
 * 5. Strip window: blocks (experimental, frequently malformed)
 * 6. Strip dimension/measure entries that use AI functions (non-deterministic, expensive)
 */
export function sanitizeMetricViewDdl(ddl: string): string {
  let result = ddl
    .replace(
      /^(\s*(?:expr|on):\s*)(.+)$/gm,
      (_match, prefix: string, rest: string) => prefix + stripFqnPrefixes(rest),
    )
    .replace(/^\s*comment:\s*"[^"]*"\s*$/gm, "")
    .replace(/^\s*comment:\s*'[^']*'\s*$/gm, "")
    .replace(/^\s*comment:\s*[^\n]+$/gm, "");

  // Fix ambiguous join on: clauses
  result = result.replace(
    /^(\s*on:\s*)(.+)$/gm,
    (_match, prefix: string, expr: string) => prefix + qualifyJoinCriteria(expr).trim(),
  );

  // Restructure flat snowflake joins into nested joins
  result = nestSnowflakeJoins(result);

  // Qualify nested join alias references with parent-chain prefix
  result = qualifyNestedAliasRefs(result);

  // Remove window blocks that the YAML parser rejects
  result = stripWindowBlocks(result);

  // Strip dimension/measure entries containing AI functions
  result = stripAiFunctionEntries(result);

  return result;
}

/**
 * Extract the object name from a CREATE VIEW DDL (last segment of the FQN).
 */
export function extractObjectName(ddl: string): string | null {
  const match = ddl.match(
    /(?:CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+)(`?[a-zA-Z_]\w*`?\.`?[a-zA-Z_]\w*`?\.`?[a-zA-Z_]\w*`?)/i,
  );
  if (!match) return null;
  const parts = match[1].replace(/`/g, "").split(".");
  return parts[parts.length - 1];
}

// ---------------------------------------------------------------------------
// Error classification & auto-fix
// ---------------------------------------------------------------------------

export function classifyDeployError(error: string): { category: string; treatAsSuccess: boolean } {
  const msg = error.toUpperCase();
  if (msg.includes("ALREADY_EXISTS") || msg.includes("ALREADY EXISTS")) {
    return { category: "exists", treatAsSuccess: true };
  }
  if (msg.includes("PERMISSION_DENIED") || msg.includes("ACCESS_DENIED")) {
    return { category: "permission", treatAsSuccess: false };
  }
  if (msg.includes("SCHEMA_NOT_FOUND") || msg.includes("CATALOG_NOT_FOUND")) {
    return { category: "schema_not_found", treatAsSuccess: false };
  }
  if (
    msg.includes("PARSE_SYNTAX_ERROR") ||
    msg.includes("PARSE ERROR") ||
    msg.includes("PARSING ERROR")
  ) {
    return { category: "syntax", treatAsSuccess: false };
  }
  if (msg.includes("UNRESOLVED_COLUMN") || msg.includes("UNRESOLVED_ROUTINE")) {
    return { category: "unresolved_reference", treatAsSuccess: false };
  }
  if (msg.includes("INVALID_AGGREGATE_FILTER") || msg.includes("NON_DETERMINISTIC")) {
    return { category: "non_deterministic", treatAsSuccess: false };
  }
  return { category: "unknown", treatAsSuccess: false };
}

/**
 * Try to auto-fix common DDL issues that cause deployment failures.
 * Returns the fixed DDL string, or null if no fix is applicable.
 */
export function attemptDdlAutoFix(
  ddl: string,
  error: string,
  _assetType?: "metric_view",
): string | null {
  const msg = error.toUpperCase();

  if (msg.includes("PARSE") || msg.includes("SYNTAX")) {
    let fixed = ddl;

    // Strip unsupported description: lines in YAML
    fixed = fixed.replace(/^\s*description:\s*"[^"]*"\s*$/gm, "");
    fixed = fixed.replace(/^\s*description:\s*'[^']*'\s*$/gm, "");
    fixed = fixed.replace(/^\s*description:\s*[^\n]+$/gm, "");

    // Fix aggregate keyword casing
    fixed = fixed.replace(
      /^(\s*agg:\s*)(.+)$/gm,
      (_m, prefix: string, rest: string) => prefix + rest.toUpperCase(),
    );

    // Strip label: lines (unsupported in some DBR versions)
    fixed = fixed.replace(/^\s*label:\s*[^\n]+$/gm, "");

    if (fixed !== ddl) return fixed;
  }

  // Non-deterministic AI functions in metric view expressions
  if (msg.includes("NON_DETERMINISTIC") || msg.includes("INVALID_AGGREGATE_FILTER")) {
    const fixed = stripAiFunctionEntries(ddl);
    if (fixed !== ddl) return fixed;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Pre-existing metric view validation
// ---------------------------------------------------------------------------

/**
 * Validate that pre-existing metric views from metadata are accessible.
 * Runs lightweight DESCRIBE checks in parallel; returns the set of valid FQNs.
 */
export async function validatePreExistingMetricViews(mvFqns: string[]): Promise<{
  valid: Set<string>;
  stripped: StrippedRef[];
}> {
  if (mvFqns.length === 0) return { valid: new Set(), stripped: [] };

  const results = await Promise.allSettled(
    mvFqns.map(async (fqn) => {
      validateFqn(fqn, "metric view");
      await executeSQL(`DESCRIBE TABLE ${fqn}`);
      return fqn;
    }),
  );

  const valid = new Set<string>();
  const stripped: StrippedRef[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      valid.add(r.value.toLowerCase());
    } else {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      stripped.push({
        type: "metric_view",
        identifier: mvFqns[i],
        reason: `Pre-existing metric view inaccessible: ${reason}`,
      });
      logger.warn("Pre-existing metric view inaccessible, stripping from space", {
        fqn: mvFqns[i],
        error: reason,
      });
    }
  }

  return { valid, stripped };
}

// ---------------------------------------------------------------------------
// Space preparation
// ---------------------------------------------------------------------------

/**
 * Build a clean serialized space that only references objects confirmed to
 * exist in Unity Catalog:
 *
 *   metric_views   -- keep validated pre-existing entries + deployed proposals.
 *
 * Also tracks which references were stripped so the UI can show warnings.
 */
export function prepareSerializedSpace(
  spaceJson: string,
  deployedMetricViews: { fqn: string; description?: string }[],
  validPreExistingMvFqns: Set<string>,
): { json: string; strippedRefs: StrippedRef[] } {
  const space = JSON.parse(spaceJson) as Record<string, unknown>;
  const dataSources = (space.data_sources ?? {}) as Record<string, unknown>;
  const instructions = (space.instructions ?? {}) as Record<string, unknown>;
  const strippedRefs: StrippedRef[] = [];

  // Strip any leftover sql_functions from previously-generated spaces
  delete instructions.sql_functions;

  // --- metric_views: keep validated pre-existing + add deployed proposals ---
  const existingMvs = (dataSources.metric_views ?? []) as Array<{
    identifier: string;
    description?: string[];
  }>;

  const retainedMvs = existingMvs.filter((mv) => {
    const isValid = validPreExistingMvFqns.has(mv.identifier.toLowerCase());
    if (!isValid) {
      // Only track as stripped if it wasn't already reported by validation
      const alreadyReported = strippedRefs.some(
        (s) => s.identifier.toLowerCase() === mv.identifier.toLowerCase(),
      );
      if (!alreadyReported) {
        strippedRefs.push({
          type: "metric_view",
          identifier: mv.identifier,
          reason: "Pre-existing metric view not accessible",
        });
      }
    }
    return isValid;
  });

  const deployedMvEntries = deployedMetricViews
    .filter((mv) => !retainedMvs.some((e) => e.identifier.toLowerCase() === mv.fqn.toLowerCase()))
    .map((mv) => ({
      identifier: mv.fqn,
      ...(mv.description ? { description: [mv.description] } : {}),
    }));

  const allMvs = [...retainedMvs, ...deployedMvEntries].sort((a, b) =>
    a.identifier.localeCompare(b.identifier),
  );

  if (allMvs.length > 0) {
    dataSources.metric_views = allMvs;
  } else {
    delete dataSources.metric_views;
  }

  space.data_sources = dataSources;
  space.instructions = instructions;
  return { json: JSON.stringify(space), strippedRefs };
}

/**
 * Add deployed metric view FQNs to a serialized space's data_sources.metric_views.
 * Does not validate or strip; used for ad-hoc space creation.
 */
export function patchSpaceWithMetricViews(serializedSpace: string, deployedFqns: string[]): string {
  if (deployedFqns.length === 0) return serializedSpace;
  try {
    const space = JSON.parse(serializedSpace) as Record<string, unknown>;
    const dataSources = (space.data_sources ?? {}) as Record<string, unknown>;
    const existing = (dataSources.metric_views ?? []) as Array<{ identifier: string }>;
    const existingSet = new Set(existing.map((e) => e.identifier.toLowerCase()));
    const newEntries = deployedFqns
      .filter((fqn) => !existingSet.has(fqn.toLowerCase()))
      .map((fqn) => ({ identifier: fqn }));
    dataSources.metric_views = [...existing, ...newEntries];
    space.data_sources = dataSources;
    return JSON.stringify(space);
  } catch {
    return serializedSpace;
  }
}

// ---------------------------------------------------------------------------
// Asset deployment helpers
// ---------------------------------------------------------------------------

/**
 * Wait for a newly-created view to become visible in UC.
 * The Statement Execution API can report DDL success before the metastore
 * has propagated the object, causing immediate DESCRIBE/GRANT to fail.
 */
export async function waitForAssetVisibility(
  fqn: string,
  maxRetries = 5,
  delayMs = 2000,
  deploySql: DeploySql = executeSQL,
): Promise<boolean> {
  const describeCmd = `DESCRIBE TABLE ${fqn}`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await deploySql(describeCmd);
      return true;
    } catch {
      if (attempt < maxRetries - 1) {
        logger.debug("Asset not yet visible, waiting for propagation", {
          fqn,
          attempt: attempt + 1,
          maxRetries,
          delayMs,
        });
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  return false;
}

export async function grantAccess(fqn: string, deploySql: DeploySql = executeSQL): Promise<void> {
  validateFqn(fqn, "grantAccess target");
  for (const grant of [
    `GRANT ALL PRIVILEGES ON TABLE ${fqn} TO \`account users\``,
    `GRANT SELECT ON TABLE ${fqn} TO \`account users\``,
  ]) {
    try {
      await deploySql(grant);
      logger.info("GRANT succeeded on table", { fqn, grant });
      return;
    } catch (grantErr) {
      logger.warn("GRANT attempt on table failed", {
        fqn,
        grant,
        error: grantErr instanceof Error ? grantErr.message : String(grantErr),
      });
    }
  }
}

/**
 * Deploy a single metric view DDL with auto-fix: execute DDL, classify errors,
 * attempt auto-fix on failure, and treat ALREADY_EXISTS as success.
 */
export async function deployAsset(
  asset: DeployAsset,
  targetSchema: string,
  resourcePrefix?: string,
  deploySql: DeploySql = executeSQL,
): Promise<AssetResult & { deployed: boolean; fqn: string }> {
  const validatedTargetSchema = validateMetricViewTargetSchema(targetSchema);
  if (resourcePrefix) validateIdentifier(resourcePrefix, "metric view resource prefix");
  const rewritten = sanitizeMetricViewDdl(
    rewriteDdlTarget(asset.ddl, validatedTargetSchema, resourcePrefix),
  );
  const objectName = extractObjectName(rewritten) ?? asset.name;
  const fqn = validateFqn(
    `${validatedTargetSchema}.${objectName}`,
    "metric view deployment target",
  );

  // First attempt
  try {
    await deploySql(rewritten);

    const visible = await waitForAssetVisibility(fqn, 5, 2000, deploySql);
    if (!visible) {
      logger.error("Asset DDL succeeded but asset not visible after retries", {
        fqn,
        type: "metric_view",
      });
      return {
        name: asset.name,
        type: "metric_view",
        success: false,
        fqn,
        deployed: false,
        error:
          "DDL executed but metric view not found in Unity Catalog after waiting. The SQL warehouse may need more time to propagate.",
      };
    }

    await grantAccess(fqn, deploySql);
    return { name: asset.name, type: "metric_view", success: true, fqn, deployed: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const classification = classifyDeployError(errorMsg);

    if (classification.treatAsSuccess) {
      logger.info("Asset already exists, treating as success", { fqn, type: "metric_view" });
      await grantAccess(fqn, deploySql);
      return {
        name: asset.name,
        type: "metric_view",
        success: true,
        fqn,
        deployed: true,
        errorCategory: classification.category,
      };
    }

    const fixedDdl = attemptDdlAutoFix(rewritten, errorMsg, "metric_view");
    if (fixedDdl) {
      try {
        await deploySql(fixedDdl);

        const visible = await waitForAssetVisibility(fqn, 5, 2000, deploySql);
        if (!visible) {
          logger.error("Auto-fixed DDL succeeded but asset not visible", {
            fqn,
            type: "metric_view",
          });
          return {
            name: asset.name,
            type: "metric_view",
            success: false,
            fqn,
            deployed: false,
            error:
              "Auto-fixed DDL executed but metric view not found in Unity Catalog after waiting.",
            errorCategory: classification.category,
          };
        }

        await grantAccess(fqn, deploySql);
        logger.info("Asset deployed after auto-fix", { fqn, type: "metric_view" });
        return {
          name: asset.name,
          type: "metric_view",
          success: true,
          fqn,
          deployed: true,
          autoFixed: true,
          errorCategory: classification.category,
        };
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        logger.warn("Auto-fix attempt also failed", { fqn, type: "metric_view", error: retryMsg });
      }
    }

    logger.warn("Metric view deployment failed", { name: asset.name, error: errorMsg });
    return {
      name: asset.name,
      type: "metric_view",
      success: false,
      error: errorMsg,
      fqn,
      deployed: false,
      errorCategory: classification.category,
    };
  }
}

/**
 * Deploy metric views (simplified flow for ad-hoc space creation).
 * No auto-fix; treats ALREADY_EXISTS as success.
 */
export async function deployMetricViews(
  views: Array<{ name: string; ddl: string; description?: string }>,
  targetSchema: string,
  resourcePrefix?: string,
): Promise<{ results: MetricViewDeployResult[]; deployedFqns: string[] }> {
  const results: MetricViewDeployResult[] = [];
  const deployedFqns: string[] = [];

  for (const mv of views) {
    const rewritten = sanitizeMetricViewDdl(rewriteDdlTarget(mv.ddl, targetSchema, resourcePrefix));
    const objectName = extractObjectName(rewritten) ?? mv.name;
    const fqn = `${targetSchema}.${objectName}`;

    try {
      await executeSQL(rewritten);
      // Best-effort grant
      try {
        await executeSQL(`GRANT SELECT ON TABLE ${fqn} TO \`account users\``);
      } catch {
        /* grant is best-effort */
      }
      results.push({ name: mv.name, success: true, fqn });
      deployedFqns.push(fqn);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.toUpperCase().includes("ALREADY_EXISTS") ||
        msg.toUpperCase().includes("ALREADY EXISTS")
      ) {
        results.push({ name: mv.name, success: true, fqn });
        deployedFqns.push(fqn);
      } else {
        logger.warn("Metric view deployment failed (ad-hoc)", { name: mv.name, fqn, error: msg });
        results.push({ name: mv.name, success: false, fqn, error: msg });
      }
    }
  }

  return { results, deployedFqns };
}

// ---------------------------------------------------------------------------
// FQN normalisation
// ---------------------------------------------------------------------------

/**
 * Ensure every metric_view identifier is a 3-part FQN
 * (catalog.schema.object). Genie cannot resolve bare names or 2-part names.
 * Any identifier that is not already 3-part gets prefixed with targetSchema.
 */
export function normalizeIdentifiersToFqn(spaceJson: string, targetSchema: string): string {
  const space = JSON.parse(spaceJson) as Record<string, unknown>;
  const dataSources = (space.data_sources ?? {}) as Record<string, unknown>;

  const mvs = (dataSources.metric_views ?? []) as Array<{ identifier: string }>;
  if (mvs.length > 0) {
    for (const mv of mvs) {
      const parts = mv.identifier.replace(/`/g, "").split(".");
      if (parts.length < 3) {
        const objectName = parts[parts.length - 1];
        const fqn = `${targetSchema}.${objectName}`;
        logger.info("Normalized metric view identifier to FQN", {
          from: mv.identifier,
          to: fqn,
        });
        mv.identifier = fqn;
      }
    }
    const seenMvs = new Set<string>();
    dataSources.metric_views = mvs.filter((mv) => {
      const key = mv.identifier.toLowerCase();
      if (seenMvs.has(key)) return false;
      seenMvs.add(key);
      return true;
    });
  }

  space.data_sources = dataSources;
  return JSON.stringify(space);
}

// ---------------------------------------------------------------------------
// Final existence validation
// ---------------------------------------------------------------------------

/**
 * Final belt-and-suspenders check: parse the prepared serialised space and
 * verify that every metric_view identifier actually exists in Unity Catalog
 * right now. Strip any that don't so the Genie space never references a
 * phantom object.
 */
export async function validateFinalSpace(
  spaceJson: string,
): Promise<{ json: string; stripped: StrippedRef[] }> {
  const space = JSON.parse(spaceJson) as Record<string, unknown>;
  const dataSources = (space.data_sources ?? {}) as Record<string, unknown>;
  const instructions = (space.instructions ?? {}) as Record<string, unknown>;
  const stripped: StrippedRef[] = [];

  // Strip any leftover sql_functions
  delete instructions.sql_functions;

  // --- validate metric_views ---
  const mvs = (dataSources.metric_views ?? []) as Array<{
    identifier: string;
    description?: string[];
  }>;
  if (mvs.length > 0) {
    const results = await Promise.allSettled(
      mvs.map(async (mv) => {
        validateFqn(mv.identifier, "metric_view");
        await executeSQL(`DESCRIBE TABLE ${mv.identifier}`);
        return mv.identifier;
      }),
    );
    const validMvs: typeof mvs = [];
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "fulfilled") {
        validMvs.push(mvs[i]);
      } else {
        const reason = (results[i] as PromiseRejectedResult).reason;
        const msg = reason instanceof Error ? reason.message : String(reason);
        stripped.push({
          type: "metric_view",
          identifier: mvs[i].identifier,
          reason: `Does not exist in Unity Catalog: ${msg}`,
        });
        logger.warn("Final validation: metric view missing from UC, stripping", {
          identifier: mvs[i].identifier,
          error: msg,
        });
      }
    }
    if (validMvs.length > 0) {
      dataSources.metric_views = validMvs;
    } else {
      delete dataSources.metric_views;
    }
  }

  space.data_sources = dataSources;
  space.instructions = instructions;
  return { json: JSON.stringify(space), stripped };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract pre-existing metric view FQNs from the serialized space payload.
 * These are the ones placed by the assembler from metadata, not proposals.
 */
export function extractPreExistingMvFqns(spaceJson: string): string[] {
  try {
    const space = JSON.parse(spaceJson);
    const mvs = space?.data_sources?.metric_views;
    if (!Array.isArray(mvs)) return [];
    return mvs
      .map((mv: { identifier?: string }) => mv.identifier)
      .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}
