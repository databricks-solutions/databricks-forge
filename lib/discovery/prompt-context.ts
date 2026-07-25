/**
 * Builds prompt context sections from discovered analytics assets.
 *
 * These are injected into use case generation and scoring prompts
 * so the LLM knows what the customer already has.
 */

import type { DiscoveryResult } from "./types";

/**
 * Build a markdown summary of existing analytics assets for use case generation prompts.
 * Helps the LLM avoid proposing duplicate use cases and focus on gaps.
 */
export function buildAssetContextForGeneration(
  discovery: DiscoveryResult,
  filteredTables: string[],
): string {
  const sections: string[] = [];

  if (discovery.genieSpaces.length > 0) {
    const relevant = discovery.genieSpaces.filter((s) =>
      s.tables.some((t) => filteredTables.includes(t)),
    );
    if (relevant.length > 0) {
      sections.push("## Existing Genie Spaces");
      sections.push(
        "The customer already has these Genie spaces. Avoid duplicating their coverage:",
      );
      for (const s of relevant) {
        sections.push(
          `- **${s.title}**: covers ${s.tables.length} tables, ${s.measureCount} measures, ${s.sampleQuestionCount} sample questions`,
        );
      }
    }
  }

  if (discovery.dashboards.length > 0) {
    const relevant = discovery.dashboards.filter((d) =>
      d.tables.some((t) => filteredTables.includes(t)),
    );
    if (relevant.length > 0) {
      sections.push("## Existing Dashboards");
      sections.push("The customer already has these dashboards. Focus on areas NOT covered:");
      for (const d of relevant) {
        sections.push(
          `- **${d.displayName}**: ${d.datasetCount} datasets, covers tables: ${d.tables.join(", ")}`,
        );
      }
    }
  }

  if (discovery.metricViews.length > 0) {
    sections.push("## Existing Metric Views");
    sections.push(
      "These metric views already exist. Propose use cases that go beyond basic KPI reporting:",
    );
    for (const mv of discovery.metricViews.slice(0, 20)) {
      sections.push(`- \`${mv.fqn}\`${mv.comment ? ` — ${mv.comment}` : ""}`);
    }
    if (discovery.metricViews.length > 20) {
      sections.push(`- ... and ${discovery.metricViews.length - 20} more`);
    }
  }

  if (sections.length === 0) return "";

  return [
    "## Existing Analytics Assets",
    "The customer already has these analytics resources in their workspace.",
    "Focus on NOVEL use cases that fill gaps. Do NOT propose use cases that simply replicate what existing dashboards or Genie spaces already cover.",
    "",
    ...sections,
  ].join("\n");
}

/**
 * Build a concise asset context for scoring prompts.
 * Helps the LLM assign higher novelty scores to gap-filling use cases.
 */
export function buildAssetContextForScoring(discovery: DiscoveryResult): string {
  const coveredTables = new Set<string>();
  for (const s of discovery.genieSpaces) {
    for (const t of s.tables) coveredTables.add(t);
  }
  for (const d of discovery.dashboards) {
    for (const t of d.tables) coveredTables.add(t);
  }

  if (coveredTables.size === 0) return "";

  return [
    "## Existing Analytics Coverage",
    `The customer has ${discovery.genieSpaces.length} Genie spaces and ${discovery.dashboards.length} dashboards covering ${coveredTables.size} tables.`,
    "Use cases that reference UNCOVERED tables or propose novel analytical approaches should score higher.",
    "Use cases that merely replicate existing dashboard or Genie space coverage should score lower.",
  ].join("\n");
}
