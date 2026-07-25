/**
 * LLM-based Schema Classifier.
 *
 * Takes enriched table metadata and deterministic signals, then uses an
 * LLM to classify each table's domain, role, tier, and map it to an
 * industry Reference Data Asset. Uses token-aware batching to handle
 * schemas with hundreds of tables.
 *
 * @module metadata/classifier
 */

import { cachedChatCompletion } from "@/lib/toolkit/llm-cache";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { buildTokenAwareBatches, estimateTokens } from "@/lib/toolkit/token-budget";
import { resolveEndpoint } from "@/lib/dbx/client";
import { logger } from "@/lib/logger";
import type { ChatMessage } from "@/lib/dbx/model-serving";
import type { DataTier, TableRole, NamingSignals } from "./types";

// ---------------------------------------------------------------------------
// Input / Output Types
// ---------------------------------------------------------------------------

export interface ClassifierInput {
  fqn: string;
  columns: Array<{ name: string; dataType: string }>;
  comment: string | null;
  tags: string[];
  namingSignals: NamingSignals;
}

export interface ClassifierResult {
  fqn: string;
  domain: string;
  role: TableRole;
  tier: DataTier;
  dataAssetId: string | null;
  dataAssetName: string | null;
  relatedTableFqns: string[];
}

export interface ClassifyOptions {
  /** Reference Data Assets from industry outcome maps (for asset mapping). */
  dataAssets?: Array<{
    id: string;
    name: string;
    description: string;
    assetFamily: string;
    systemLocation?: string;
    systemKind?: string;
  }>;
  signal?: AbortSignal;
  onProgress?: (pct: number, detail?: string) => void;
}

// ---------------------------------------------------------------------------
// Prompt Template
// ---------------------------------------------------------------------------

const SCHEMA_INTELLIGENCE_PROMPT = `You are a senior data architect. Classify every table in this schema.

For each table, determine:
1. **domain** -- the business domain (e.g., "Customer", "Transaction", "Product", "Risk", "Marketing", "Operations", "Finance", "HR", "Supply Chain"). Use short, consistent labels.
2. **role** -- one of: fact, dimension, staging, lookup, bridge, audit, config, snapshot, unknown
3. **tier** -- one of: bronze, silver, gold, unknown (based on data quality/transformation level)
4. **dataAssetId** -- if an industry data asset list is provided, map the table to the closest matching asset ID. Use null if no match.
5. **relatedTables** -- list other tables in this schema that are closely related (same domain, likely joined together, FK relationships)

{data_asset_context}

Tables to classify:
{table_list}

{deterministic_hints}

Return a JSON array:
[{"fqn": "catalog.schema.table", "domain": "...", "role": "fact|dimension|staging|lookup|bridge|audit|config|snapshot|unknown", "tier": "bronze|silver|gold|unknown", "dataAssetId": "A01" or null, "dataAssetName": "Customer Master" or null, "relatedTables": ["catalog.schema.other_table"]}]

IMPORTANT:
- Every table in the input MUST appear in the output.
- Use consistent domain labels across all tables (don't use "Customer" for one and "Customers" for another).
- Respect deterministic hints when provided -- only override if clearly wrong.
- For dataAssetId, only assign if there's a strong conceptual match to the industry data asset.`;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const MAX_COLS_CLASSIFIER = 15;

function renderTableForClassifier(t: ClassifierInput): string {
  const cols = t.columns
    .slice(0, MAX_COLS_CLASSIFIER)
    .map((c) => `${c.name}(${c.dataType})`)
    .join(", ");
  const extra =
    t.columns.length > MAX_COLS_CLASSIFIER
      ? ` +${t.columns.length - MAX_COLS_CLASSIFIER} more`
      : "";

  const parts = [`- ${t.fqn}: [${cols}${extra}]`];

  if (t.comment) parts.push(`  comment: "${t.comment}"`);
  if (t.tags.length > 0) parts.push(`  tags: [${t.tags.join(", ")}]`);

  const hints: string[] = [];
  if (t.namingSignals.prefixTier) hints.push(`tier_hint=${t.namingSignals.prefixTier}`);
  if (t.namingSignals.prefixRole) hints.push(`role_hint=${t.namingSignals.prefixRole}`);
  if (hints.length > 0) parts.push(`  hints: ${hints.join(", ")}`);

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Main Classifier
// ---------------------------------------------------------------------------

export async function classifySchema(
  tables: ClassifierInput[],
  options: ClassifyOptions = {},
): Promise<ClassifierResult[]> {
  const { dataAssets, signal, onProgress } = options;

  if (tables.length === 0) return [];

  const endpoint = resolveEndpoint("classification");

  // Build data asset context block. When the caller provides system hints
  // (systemLocation / systemKind from the master repo), include them so the
  // classifier can match a table sourced from "Salesforce" to the CRM-kind
  // industry asset even when the table name is opaque.
  let dataAssetContext = "";
  if (dataAssets && dataAssets.length > 0) {
    const lines = [
      "### INDUSTRY DATA ASSETS",
      "Map tables to the closest matching data asset where appropriate.",
      "Use the system hints (typical source / system kind) to break ties",
      "when the table name alone is ambiguous.",
      "",
    ];
    for (const asset of dataAssets) {
      const sys: string[] = [];
      if (asset.systemKind) sys.push(`system: ${asset.systemKind}`);
      if (asset.systemLocation) sys.push(`typical: ${asset.systemLocation}`);
      const sysStr = sys.length ? ` (${sys.join("; ")})` : "";
      lines.push(
        `- ${asset.id}: ${asset.name} [${asset.assetFamily}]${sysStr} -- ${asset.description}`,
      );
    }
    dataAssetContext = lines.join("\n");
  }

  // Build deterministic hints summary
  const hintsWithTier = tables.filter((t) => t.namingSignals.prefixTier);
  const hintsWithRole = tables.filter((t) => t.namingSignals.prefixRole);
  let deterministicHints = "";
  if (hintsWithTier.length > 0 || hintsWithRole.length > 0) {
    deterministicHints = [
      "Deterministic analysis detected:",
      hintsWithTier.length > 0
        ? `- ${hintsWithTier.length} tables have tier prefixes (bronze_, silver_, gold_, etc.)`
        : "",
      hintsWithRole.length > 0
        ? `- ${hintsWithRole.length} tables have role prefixes (dim_, fact_, stg_, etc.)`
        : "",
      "These hints are provided per-table above. Respect them unless clearly incorrect.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  // Build base prompt for token estimation
  const basePrompt = SCHEMA_INTELLIGENCE_PROMPT.replace("{data_asset_context}", dataAssetContext)
    .replace("{table_list}", "")
    .replace("{deterministic_hints}", deterministicHints);

  const baseTokens = estimateTokens(basePrompt);

  // Build token-aware batches
  const batches = buildTokenAwareBatches(tables, renderTableForClassifier, baseTokens);

  const allResults: ClassifierResult[] = [];
  let batchIdx = 0;

  for (const batch of batches) {
    if (signal?.aborted) throw new Error("Cancelled");

    const tableList = batch.map(renderTableForClassifier).join("\n");
    const prompt = SCHEMA_INTELLIGENCE_PROMPT.replace("{data_asset_context}", dataAssetContext)
      .replace("{table_list}", tableList)
      .replace("{deterministic_hints}", deterministicHints);

    const messages: ChatMessage[] = [{ role: "user", content: prompt }];

    try {
      const resp = await cachedChatCompletion({
        endpoint,
        messages,
        temperature: 0.15,
        responseFormat: "json_object",
        signal,
      });

      const parsed = parseLLMJson(resp.content, "schema-intelligence") as Array<{
        fqn: string;
        domain: string;
        role: string;
        tier: string;
        dataAssetId: string | null;
        dataAssetName?: string | null;
        relatedTables?: string[];
      }>;

      for (const item of parsed) {
        allResults.push({
          fqn: item.fqn,
          domain: item.domain || "Unknown",
          role: validateRole(item.role),
          tier: validateTier(item.tier),
          dataAssetId: item.dataAssetId ?? null,
          dataAssetName: item.dataAssetName ?? resolveAssetName(item.dataAssetId, dataAssets),
          relatedTableFqns: item.relatedTables ?? [],
        });
      }
    } catch (err) {
      logger.warn("[schema-classifier] Batch failed, using deterministic fallback", {
        batchSize: batch.length,
        error: err instanceof Error ? err.message : String(err),
      });

      // Fallback: use deterministic signals for this batch
      for (const table of batch) {
        allResults.push({
          fqn: table.fqn,
          domain: "Unknown",
          role: table.namingSignals.prefixRole ?? "unknown",
          tier: table.namingSignals.prefixTier ?? "unknown",
          dataAssetId: null,
          dataAssetName: null,
          relatedTableFqns: [],
        });
      }
    }

    batchIdx++;
    onProgress?.(
      Math.round((batchIdx / batches.length) * 100),
      `Classified ${allResults.length}/${tables.length} tables`,
    );
  }

  // Fill in any tables that the LLM missed
  const classifiedFqns = new Set(allResults.map((r) => r.fqn.toLowerCase()));
  for (const table of tables) {
    if (!classifiedFqns.has(table.fqn.toLowerCase())) {
      allResults.push({
        fqn: table.fqn,
        domain: "Unknown",
        role: table.namingSignals.prefixRole ?? "unknown",
        tier: table.namingSignals.prefixTier ?? "unknown",
        dataAssetId: null,
        dataAssetName: null,
        relatedTableFqns: [],
      });
    }
  }

  return allResults;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_ROLES = new Set<TableRole>([
  "fact",
  "dimension",
  "staging",
  "lookup",
  "bridge",
  "audit",
  "config",
  "snapshot",
  "unknown",
]);

const VALID_TIERS = new Set<DataTier>(["bronze", "silver", "gold", "unknown"]);

function validateRole(role: string): TableRole {
  const lower = role.toLowerCase() as TableRole;
  return VALID_ROLES.has(lower) ? lower : "unknown";
}

function validateTier(tier: string): DataTier {
  const lower = tier.toLowerCase() as DataTier;
  return VALID_TIERS.has(lower) ? lower : "unknown";
}

function resolveAssetName(
  assetId: string | null,
  dataAssets?: Array<{ id: string; name: string }>,
): string | null {
  if (!assetId || !dataAssets) return null;
  return dataAssets.find((a) => a.id === assetId)?.name ?? null;
}
