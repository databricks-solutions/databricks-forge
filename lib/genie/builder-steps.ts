/**
 * Genie Builder step definitions shared between the engine (server) and UI (client).
 * Must NOT import any server-side modules.
 */

export type GenieBuilderStep =
  | "metadata-scrape"
  | "column-intelligence"
  | "join-inference"
  | "metric-views"
  | "trusted-assets"
  | "assembly";

export const GENIE_BUILDER_STEPS: readonly {
  key: GenieBuilderStep;
  label: string;
  pct: number;
  tip: string;
}[] = [
  {
    key: "metadata-scrape",
    label: "Metadata Scrape",
    pct: 5,
    tip: "Fetches table and column metadata from Unity Catalog information_schema.",
  },
  {
    key: "column-intelligence",
    label: "Column Analysis & Expressions",
    pct: 10,
    tip: "LLM-powered column intelligence and semantic measure/filter generation in parallel.",
  },
  {
    key: "join-inference",
    label: "Join Inference",
    pct: 35,
    tip: "Discovers table relationships from foreign keys and LLM inference.",
  },
  {
    key: "metric-views",
    label: "Metric Views",
    pct: 50,
    tip: "Generates metric view proposals as reusable SQL definitions.",
  },
  {
    key: "trusted-assets",
    label: "Assets, Instructions & Benchmarks",
    pct: 60,
    tip: "Creates trusted SQL queries, Genie instructions, and benchmark questions in parallel.",
  },
  {
    key: "assembly",
    label: "Assembly & Quality Gate",
    pct: 90,
    tip: "Assembles the Genie Space, runs health checks, and evaluates the quality gate.",
  },
] as const;
