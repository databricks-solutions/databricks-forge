/**
 * Discovers existing Genie spaces in the workspace and extracts
 * table coverage, measures, filters, and sample question metadata.
 */

import { listGenieSpaces, getGenieSpace } from "@/lib/dbx/genie";
import { logger } from "@/lib/logger";
import type { SerializedSpace } from "@/lib/genie/types";
import type { DiscoveredGenieSpace } from "./types";

/**
 * Scan all workspace Genie spaces and extract structured metadata.
 * Optionally filters to spaces whose tables overlap with `scopeTables`.
 */
export async function scanGenieSpaces(scopeTables?: Set<string>): Promise<DiscoveredGenieSpace[]> {
  const discovered: DiscoveredGenieSpace[] = [];

  try {
    let pageToken: string | undefined;
    const spaceIds: Array<{ id: string; title: string }> = [];

    do {
      const page = await listGenieSpaces(100, pageToken);
      for (const s of page.spaces ?? []) {
        spaceIds.push({ id: s.space_id, title: s.title });
      }
      pageToken = page.next_page_token;
    } while (pageToken);

    logger.info(`[asset-discovery] Found ${spaceIds.length} Genie spaces in workspace`);

    for (const { id, title } of spaceIds) {
      try {
        const detail = await getGenieSpace(id);
        const parsed = parseSerializedSpace(detail.serialized_space);
        if (!parsed) continue;

        const tables = parsed.data_sources?.tables?.map((t) => t.identifier) ?? [];
        const metricViews = parsed.data_sources?.metric_views?.map((m) => m.identifier) ?? [];

        if (scopeTables && tables.length > 0) {
          const hasOverlap = tables.some((t) => scopeTables.has(t));
          if (!hasOverlap) continue;
        }

        const snippets = parsed.instructions?.sql_snippets;
        discovered.push({
          spaceId: id,
          title: detail.title ?? title,
          description: detail.description ?? null,
          tables,
          metricViews,
          sampleQuestionCount: parsed.config?.sample_questions?.length ?? 0,
          measureCount: snippets?.measures?.length ?? 0,
          filterCount: snippets?.filters?.length ?? 0,
          instructionLength:
            parsed.instructions?.text_instructions?.reduce(
              (sum, i) => sum + (i.content?.join(" ").length ?? 0),
              0,
            ) ?? 0,
        });
      } catch (err) {
        logger.warn(`[asset-discovery] Failed to fetch Genie space ${id}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    logger.error("[asset-discovery] Failed to list Genie spaces", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return discovered;
}

function parseSerializedSpace(raw?: string): SerializedSpace | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SerializedSpace;
  } catch {
    return null;
  }
}
