/**
 * Server-only async functions for industry outcome maps.
 *
 * These functions access Lakebase (via Prisma) to merge built-in outcomes
 * with user-uploaded custom outcome maps. They MUST NOT be imported from
 * client components — use the /api/outcome-maps/registry endpoint instead.
 *
 * @module server-only
 */

import { INDUSTRY_OUTCOMES, getIndustryOutcome, type IndustryOutcome } from "./industry-outcomes";
import { getMasterRepoEnrichment } from "./industry-outcomes/master-repo-registry";
import type { MasterRepoUseCase } from "./industry-outcomes/master-repo-types";

// ---------------------------------------------------------------------------
// Dynamic Registry (built-in + custom from Lakebase)
// ---------------------------------------------------------------------------

/**
 * Load ALL industry outcomes (built-in + user-uploaded custom maps).
 * Custom maps override built-in if they share the same id.
 */
export async function getAllIndustryOutcomes(): Promise<IndustryOutcome[]> {
  try {
    const { loadAllCustomOutcomes } = await import("@/lib/lakebase/outcome-maps");
    const customOutcomes = await loadAllCustomOutcomes();

    // Custom maps override built-in if same id
    const customIds = new Set(customOutcomes.map((c) => c.id));
    const builtIn = INDUSTRY_OUTCOMES.filter((i) => !customIds.has(i.id));

    return [...builtIn, ...customOutcomes].sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    // Fallback to built-in if DB is unavailable
    return [...INDUSTRY_OUTCOMES].sort((a, b) => a.name.localeCompare(b.name));
  }
}

/**
 * Look up an industry outcome by id, checking custom maps first, then built-in.
 * Async — for server-side code with DB access.
 */
export async function getIndustryOutcomeAsync(id: string): Promise<IndustryOutcome | undefined> {
  // Check built-in first (fast path)
  const builtIn = getIndustryOutcome(id);
  if (builtIn) return builtIn;

  // Check custom maps
  try {
    const { getOutcomeMapByIndustryId } = await import("@/lib/lakebase/outcome-maps");
    const custom = await getOutcomeMapByIndustryId(id);
    return custom?.parsedOutcome ?? undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Auto-detection -- match LLM-generated industries string to an outcome map
// ---------------------------------------------------------------------------

/**
 * Curated aliases mapping common generic terms the LLM may produce to the
 * canonical outcome map id.  Each key is lowercase; values are outcome ids.
 * Multiple aliases can map to the same id.
 */
const INDUSTRY_ALIASES: Record<string, string> = {
  "financial services": "banking",
  fintech: "banking",
  neobank: "banking",
  "wealth management": "capital-markets",
  "capital markets": "capital-markets",
  "investment banking": "capital-markets",
  "asset management": "capital-markets",
  "broker dealer": "capital-markets",
  payments: "banking",
  pharma: "life-sciences",
  pharmaceutical: "life-sciences",
  pharmaceuticals: "life-sciences",
  healthcare: "healthcare",
  "health system": "healthcare",
  payer: "healthcare",
  "health insurance": "healthcare",
  hospital: "healthcare",
  "life sciences": "life-sciences",
  biotech: "life-sciences",
  biotechnology: "life-sciences",
  "medical devices": "life-sciences",
  retail: "retail",
  "consumer goods": "consumer-goods",
  cpg: "consumer-goods",
  ecommerce: "retail",
  "e-commerce": "retail",
  grocery: "retail",
  fashion: "retail",
  hospitality: "casinos-resorts",
  travel: "casinos-resorts",
  telco: "communications",
  telecom: "communications",
  telecommunications: "communications",
  broadband: "communications",
  isp: "communications",
  energy: "energy-utilities",
  utilities: "energy-utilities",
  renewables: "energy-utilities",
  "oil and gas": "oil-gas-noc",
  "oil & gas": "oil-gas-noc",
  "oil and gas company": "oil-gas-noc",
  petroleum: "oil-gas-noc",
  petrochemical: "oil-gas-noc",
  petrochemicals: "oil-gas-noc",
  upstream: "oil-gas-noc",
  midstream: "oil-gas-noc",
  downstream: "oil-gas-noc",
  refining: "oil-gas-noc",
  refinery: "oil-gas-noc",
  lng: "oil-gas-noc",
  "liquefied natural gas": "oil-gas-noc",
  "exploration and production": "oil-gas-noc",
  "e&p": "oil-gas-noc",
  noc: "oil-gas-noc",
  "national oil company": "oil-gas-noc",
  mining: "mining",
  "metals and mining": "mining",
  "metals & mining": "mining",
  "iron ore": "mining",
  "base metals": "mining",
  "precious metals": "mining",
  "battery minerals": "mining",
  quarrying: "mining",
  "mineral resources": "mining",
  water: "water-utilities",
  wastewater: "water-utilities",
  media: "media-advertising",
  advertising: "media-advertising",
  adtech: "media-advertising",
  streaming: "media-advertising",
  publishing: "media-advertising",
  technology: "digital-natives",
  saas: "digital-natives",
  software: "digital-natives",
  cloud: "digital-natives",
  platform: "digital-natives",
  gaming: "games",
  esports: "games",
  "video game": "games",
  igaming: "real-money-gaming",
  "online casino": "real-money-gaming",
  "sports book": "real-money-gaming",
  sportsbook: "real-money-gaming",
  "online sports betting": "real-money-gaming",
  casino: "casinos-resorts",
  casinos: "casinos-resorts",
  "integrated resort": "casinos-resorts",
  rail: "rail-transport",
  railway: "rail-transport",
  freight: "rail-transport",
  logistics: "rail-transport",
  transport: "rail-transport",
  automotive: "automotive-mobility",
  mobility: "automotive-mobility",
  oem: "automotive-mobility",
  vehicle: "automotive-mobility",
  fleet: "automotive-mobility",
  betting: "real-money-gaming",
  wagering: "real-money-gaming",
  gambling: "real-money-gaming",
  lotteries: "real-money-gaming",
  underwriting: "insurance",
  reinsurance: "insurance",
  claims: "insurance",
  insurtech: "insurance",
  manufacturing: "manufacturing",
  industrial: "manufacturing",
  aerospace: "manufacturing",
  defense: "manufacturing",
  semiconductors: "manufacturing",
  superannuation: "superannuation",
  "super fund": "superannuation",
  "pension fund": "superannuation",
  "retirement fund": "superannuation",
  retirement: "superannuation",
  pension: "superannuation",
  annuity: "superannuation",
  "defined benefit": "superannuation",
  "defined contribution": "superannuation",
};

/** Words too generic to contribute meaningful signal on their own. */
const STOP_WORDS = new Set([
  "and",
  "the",
  "for",
  "with",
  "from",
  "services",
  "solutions",
  "management",
  "data",
  "digital",
  "analytics",
  "operations",
  "group",
  "company",
  "industry",
  "sector",
  "business",
]);

/**
 * Attempt to match a free-text industries description (from BusinessContext)
 * against available outcome maps using keyword matching + curated aliases.
 *
 * Returns the `id` of the best-matching outcome map, or `null` if no
 * confident match is found. Used by the pipeline engine to auto-select
 * an industry when the user hasn't chosen one manually.
 */
export async function detectIndustryFromContext(industriesStr: string): Promise<string | null> {
  if (!industriesStr.trim()) return null;

  const outcomes = await getAllIndustryOutcomes();

  // Tokenise the input into lowercase keywords (split on commas, &, /, spaces)
  const inputTokens = industriesStr
    .toLowerCase()
    .split(/[,&/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);

  // Also build a flat lowercase string for substring matching
  const inputLower = industriesStr.toLowerCase();

  // --- Phase 1: Alias-based detection (handles generic LLM outputs) --------
  // Tally alias hits per outcome id -- aliases are curated so high confidence.
  const aliasHits: Record<string, number> = {};
  for (const [alias, outcomeId] of Object.entries(INDUSTRY_ALIASES)) {
    if (inputLower.includes(alias)) {
      aliasHits[outcomeId] = (aliasHits[outcomeId] ?? 0) + 1;
    }
  }

  // --- Phase 2: Keyword scoring against each outcome map -------------------
  let bestId: string | null = null;
  let bestScore = 0;

  for (const outcome of outcomes) {
    let score = 0;

    const nameLower = outcome.name.toLowerCase();
    const nameWords = nameLower.split(/[\s&/,]+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
    const subVerticals = (outcome.subVerticals ?? []).map((sv) => sv.toLowerCase());

    // 1. Exact name match (strongest signal, word-boundary aware)
    const nameRe = new RegExp(
      `(?:^|[\\s,;&/])${nameLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[\\s,;&/])`,
      "i",
    );
    if (nameRe.test(inputLower) || inputLower === nameLower) {
      score += 10;
    }

    // 2. Name keyword hits (e.g. "banking" appears in input)
    for (const word of nameWords) {
      if (inputLower.includes(word)) {
        score += 3;
      }
    }

    // 3. Sub-vertical matches (e.g. "Commercial Banking" in input)
    for (const sv of subVerticals) {
      if (inputLower.includes(sv)) {
        score += 5;
      }
      // Partial token matching against the full sub-vertical string.
      // Input tokens are NOT filtered by stop words -- the LLM output may
      // legitimately contain words like "services" or "management" that
      // carry meaningful signal when matched against sub-verticals.
      for (const token of inputTokens) {
        const trimmed = token.trim();
        if (trimmed.length <= 3) continue;
        if (sv.includes(trimmed)) {
          score += 2;
        }
      }
    }

    // 4. ID match (e.g. input contains "insurance" and id is "insurance")
    if (inputLower.includes(outcome.id.replace(/-/g, " "))) {
      score += 4;
    }

    // 5. Alias bonus -- curated aliases are high-confidence
    const aliasCount = aliasHits[outcome.id] ?? 0;
    score += aliasCount * 4;

    if (score > bestScore) {
      bestScore = score;
      bestId = outcome.id;
    }
  }

  // A score of 3+ means at least one strong keyword or alias match
  return bestScore >= 3 ? bestId : null;
}

// ---------------------------------------------------------------------------
// Prompt Building Helpers (async, server-only)
// ---------------------------------------------------------------------------

/**
 * Build a markdown-formatted string of reference use cases for prompt injection.
 * Filters to the most relevant priorities based on selected business domains.
 */
export async function buildReferenceUseCasesPrompt(
  industryId: string,
  businessDomains?: string,
  maxUseCases: number = 40,
): Promise<string> {
  const industry = await getIndustryOutcomeAsync(industryId);
  if (!industry) return "";
  const domainTokens = (businessDomains ?? "")
    .toLowerCase()
    .split(/[,\n]+/)
    .map((d) => d.trim())
    .filter(Boolean);

  const isRelevant = (text: string): boolean => {
    if (domainTokens.length === 0) return true;
    const lower = text.toLowerCase();
    return domainTokens.some((tok) => lower.includes(tok));
  };

  const lines: string[] = [
    `### INDUSTRY REFERENCE USE CASES (${industry.name})`,
    "",
    "The following are recognized high-value use cases for this industry.",
    "Use these as strategic inspiration -- adapt them to the specific tables and",
    "metadata available. Generate use cases that align with these patterns WHERE",
    "the customer's data supports them. The **customer-facing `name`** field of",
    "each generated use case MUST be customer-specific (do NOT copy these titles",
    "verbatim into `name`) and grounded in the actual table schemas provided.",
    "",
    "However, EVERY generated use case MUST also emit a `reference_use_case_name`",
    "field that is a **VERBATIM EXACT COPY** of the closest matching title from",
    "this list -- character-for-character, including punctuation and capitalization.",
    "This second field is a hard FK into the master-repo namespace consumed by",
    "Data Gap analysis, exports, and downstream financial roll-ups. Set it to",
    "`null` ONLY if no reference title plausibly fits.",
    "",
  ];

  // Build lookup of Master Repository enrichment by use case name
  const enrichment = getMasterRepoEnrichment(industryId);
  const enrichmentIndex = new Map<string, MasterRepoUseCase>();
  if (enrichment) {
    for (const uc of enrichment.useCases) {
      enrichmentIndex.set(uc.name.toLowerCase(), uc);
    }
  }

  let count = 0;
  for (const objective of industry.objectives) {
    if (count >= maxUseCases) break;
    if (!isRelevant(objective.name) && domainTokens.length > 0) continue;
    lines.push(`#### ${objective.name}`);
    lines.push("");

    for (const priority of objective.priorities) {
      if (count >= maxUseCases) break;
      if (!isRelevant(priority.name) && domainTokens.length > 0) continue;
      lines.push(`**Strategic Priority: ${priority.name}**`);

      for (const uc of priority.useCases) {
        if (count >= maxUseCases) break;
        if (!isRelevant(`${uc.name} ${uc.description}`) && domainTokens.length > 0) {
          continue;
        }
        let line = `- **${uc.name}**: ${uc.description}`;

        // Append Master Repository enrichment (benchmark, model type, strategy)
        const mr = enrichmentIndex.get(uc.name.toLowerCase());
        if (mr) {
          const extras: string[] = [];
          if (mr.benchmarkImpact && mr.kpiTarget) {
            extras.push(`KPI: ${mr.kpiTarget} (${mr.benchmarkImpact})`);
          }
          if (mr.modelType) {
            extras.push(`Model: ${mr.modelType}`);
          }
          if (mr.strategicImperative) {
            extras.push(`Strategy: ${mr.strategicImperative}`);
          }
          if (extras.length > 0) {
            line += ` [${extras.join(" | ")}]`;
          }
        }

        lines.push(line);
        count++;
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Build industry context string for business context prompt enrichment.
 */
export async function buildIndustryContextPrompt(industryId: string): Promise<string> {
  const industry = await getIndustryOutcomeAsync(industryId);
  if (!industry) return "";

  const lines: string[] = [
    `### INDUSTRY CONTEXT (${industry.name})`,
    "",
    `This organization operates in the **${industry.name}** industry.`,
  ];

  if (industry.subVerticals?.length) {
    lines.push(`Sub-verticals include: ${industry.subVerticals.join(", ")}.`);
  }

  lines.push("");
  lines.push("**Key strategic objectives and context for this industry:**");
  lines.push("");

  for (const objective of industry.objectives) {
    lines.push(`#### ${objective.name}`);
    lines.push(objective.whyChange);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Build industry KPIs string for scoring prompt enrichment.
 * Includes benchmark impacts from Master Repository when available.
 */
export async function buildIndustryKPIsPrompt(industryId: string): Promise<string> {
  const industry = await getIndustryOutcomeAsync(industryId);
  if (!industry) return "";

  const lines: string[] = [
    `### INDUSTRY-SPECIFIC KPIs (${industry.name})`,
    "",
    "Use these industry-specific KPIs and personas to better assess strategic alignment and value:",
    "",
  ];

  for (const objective of industry.objectives) {
    for (const priority of objective.priorities) {
      if (priority.kpis.length > 0) {
        lines.push(`**${priority.name}**: ${priority.kpis.join("; ")}`);
      }
    }
  }

  // Append benchmark calibration data from Master Repository
  const enrichment = getMasterRepoEnrichment(industryId);
  if (enrichment) {
    const benchmarks = enrichment.useCases
      .filter((uc) => uc.benchmarkImpact && uc.kpiTarget)
      .slice(0, 10);

    if (benchmarks.length > 0) {
      lines.push("");
      lines.push("**Industry Benchmark Calibration:**");
      for (const uc of benchmarks) {
        const src = uc.benchmarkSource ? ` (${uc.benchmarkSource})` : "";
        lines.push(`- ${uc.name}: ${uc.kpiTarget} ${uc.benchmarkImpact}${src}`);
      }
    }
  }

  lines.push("");
  lines.push(
    "Use cases that directly address these KPIs should receive higher strategic alignment scores.",
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Reference Data Asset Context (for Comment Engine + future consumers)
// ---------------------------------------------------------------------------

/**
 * Build a prompt block listing all Reference Data Assets for an industry.
 * Each asset includes its name, family, description, and system location.
 *
 * This gives an LLM the industry's standard data vocabulary so it can
 * understand what tables represent and use industry-appropriate terminology.
 */
export async function buildDataAssetContext(industryId: string): Promise<{
  text: string;
  assets: Array<{
    id: string;
    name: string;
    description: string;
    assetFamily: string;
    systemLocation?: string;
    systemKind?: string;
  }>;
}> {
  const enrichment = getMasterRepoEnrichment(industryId);
  const industry = await getIndustryOutcomeAsync(industryId);

  if (!enrichment || enrichment.dataAssets.length === 0) {
    return { text: "", assets: [] };
  }

  const industryName = industry?.name ?? industryId;

  const lines: string[] = [
    `### INDUSTRY DATA ASSETS (${industryName})`,
    "",
    "These are the standard data assets in this industry. Use them to understand",
    "what tables represent and to use industry-appropriate terminology. Each",
    "asset carries a recommended **ingestion strategy** -- callers integrating",
    "missing assets should prefer the High-rated strategy first.",
    "",
  ];

  const assets: Array<{
    id: string;
    name: string;
    description: string;
    assetFamily: string;
    systemLocation?: string;
    systemKind?: string;
  }> = [];

  for (const asset of enrichment.dataAssets) {
    const strategies: string[] = [];
    if (asset.lakeflowConnect === "High") strategies.push("Lakeflow Connect");
    if (asset.ucFederation === "High") strategies.push("UC Federation");
    if (asset.lakebridgeMigrate === "High") strategies.push("Lakebridge Migrate");
    if (asset.bespoke === "High") strategies.push("Bespoke");
    const stratStr = strategies.length ? ` ingest: ${strategies.join(" / ")}` : "";
    const kindStr = asset.systemKind ? ` system-kind: ${asset.systemKind}` : "";
    lines.push(
      `- **${asset.id}: ${asset.name}** [${asset.assetFamily}] -- ${asset.description}` +
        (asset.systemLocation ? ` (typical: ${asset.systemLocation};${stratStr}${kindStr})` : ""),
    );
    assets.push({
      id: asset.id,
      name: asset.name,
      description: asset.description,
      assetFamily: asset.assetFamily,
      systemLocation: asset.systemLocation || undefined,
      systemKind: asset.systemKind,
    });
  }

  return { text: lines.join("\n"), assets };
}

/**
 * Build a prompt block showing which use cases each data asset powers,
 * including criticality levels and benchmark impacts.
 *
 * Given a set of matched data asset IDs (from schema classification),
 * this tells the LLM WHY each asset matters -- not just what it stores
 * but what business outcomes it enables.
 */
export async function buildUseCaseLinkageContext(
  industryId: string,
  matchedAssetIds: string[],
): Promise<string> {
  if (matchedAssetIds.length === 0) return "";

  const enrichment = getMasterRepoEnrichment(industryId);
  if (!enrichment) return "";

  const matchedSet = new Set(matchedAssetIds);

  const lines: string[] = [
    "### DATA ASSET BUSINESS CONTEXT",
    "",
    "Tables matching these data assets power the following business use cases:",
    "",
  ];

  const useCasesByAsset = new Map<
    string,
    Array<{ name: string; criticality: string; impact: string; pattern: string }>
  >();

  for (const uc of enrichment.useCases) {
    for (const assetId of uc.dataAssetIds ?? []) {
      if (!matchedSet.has(assetId)) continue;

      if (!useCasesByAsset.has(assetId)) useCasesByAsset.set(assetId, []);

      const criticality = uc.dataAssetCriticality?.[assetId] ?? "VA";
      const critLabel = criticality === "MC" ? "Mission-Critical" : "Value-Add";
      const impact =
        uc.benchmarkImpact && uc.kpiTarget ? `${uc.kpiTarget} ${uc.benchmarkImpact}` : "";
      const pattern = uc.economicPatternName
        ? ` [${uc.economicImpactCategory ?? "?"}: ${uc.economicPatternName}]`
        : "";

      useCasesByAsset.get(assetId)!.push({
        name: uc.name,
        criticality: critLabel,
        impact,
        pattern,
      });
    }
  }

  const assetNames = new Map(enrichment.dataAssets.map((a) => [a.id, a.name]));

  for (const [assetId, useCases] of useCasesByAsset) {
    const assetName = assetNames.get(assetId) ?? assetId;
    const mcUseCases = useCases.filter((uc) => uc.criticality === "Mission-Critical");
    const vaUseCases = useCases.filter((uc) => uc.criticality === "Value-Add");

    const parts = [`- **${assetId} (${assetName})**:`];

    if (mcUseCases.length > 0) {
      const mcNames = mcUseCases
        .slice(0, 5)
        .map((uc) => uc.name + (uc.impact ? ` (${uc.impact})` : "") + uc.pattern)
        .join("; ");
      parts.push(`  Mission-Critical for: ${mcNames}`);
    }
    if (vaUseCases.length > 0) {
      const vaNames = vaUseCases
        .slice(0, 3)
        .map((uc) => uc.name + uc.pattern)
        .join("; ");
      parts.push(`  Value-Add for: ${vaNames}`);
    }

    lines.push(parts.join("\n"));
  }

  return lines.join("\n");
}
