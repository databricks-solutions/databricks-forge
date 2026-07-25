/**
 * Dynamic suggested questions for the Ask Forge empty state.
 *
 * Builds context-aware questions from the latest pipeline run, industry
 * outcome map, environment scan, and generated use cases. Falls back to
 * sensible defaults when no data exists.
 */

import { withPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getIndustryOutcomeAsync } from "@/lib/domain/industry-outcomes-server";
import type { IndustryOutcome } from "@/lib/domain/industry-outcomes";
import type { AssistantPersona } from "./prompts";

import {
  FALLBACK_QUESTIONS,
  FALLBACK_QUESTIONS_ANALYST,
  FALLBACK_QUESTIONS_TECH,
  FALLBACK_QUESTIONS_STRATEGIC,
} from "./suggested-question-defaults";

// Re-export client-safe constants so existing server-side imports still work.
export { FALLBACK_QUESTIONS, FALLBACK_QUESTIONS_ANALYST, FALLBACK_QUESTIONS_TECH, FALLBACK_QUESTIONS_STRATEGIC };

const TARGET_COUNT = 6;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickRandom<T>(arr: T[], count: number): T[] {
  if (arr.length <= count) return arr;
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function collectKpis(outcome: IndustryOutcome, max: number): string[] {
  const all: string[] = [];
  for (const obj of outcome.objectives) {
    for (const pri of obj.priorities) {
      all.push(...pri.kpis);
    }
  }
  return pickRandom([...new Set(all)], max);
}

function collectUseCaseNames(outcome: IndustryOutcome, max: number): string[] {
  const all: string[] = [];
  for (const obj of outcome.objectives) {
    for (const pri of obj.priorities) {
      for (const uc of pri.useCases) {
        all.push(uc.name);
      }
    }
  }
  return pickRandom([...new Set(all)], max);
}

function collectPersonas(outcome: IndustryOutcome, max: number): string[] {
  const all: string[] = [];
  for (const obj of outcome.objectives) {
    for (const pri of obj.priorities) {
      all.push(...pri.personas);
    }
  }
  return pickRandom([...new Set(all)], max);
}

// ---------------------------------------------------------------------------
// Core builder
// ---------------------------------------------------------------------------

interface RunContext {
  businessName: string;
  runId: string;
  industry: string;
  domains: string;
  priorities: string;
  goals: string;
}

interface ScanContext {
  ucPath: string;
  tableCount: number;
  domainCount: number;
  piiTablesCount: number;
  avgGovernanceScore: number;
}

interface UseCaseSummary {
  name: string;
  domain: string;
}

export async function buildSuggestedQuestions(
  persona: AssistantPersona = "business",
): Promise<string[]> {
  try {
    const { run, scan, useCases } = await fetchContext();

    const candidates: string[] = [];

    if (persona === "tech") {
      // --- Tech-specific questions ---
      if (scan) {
        if (scan.tableCount > 0) {
          candidates.push(`Which of our ${scan.tableCount} tables need VACUUM or OPTIMIZE?`);
          candidates.push(`Show me tables with the lowest health scores`);
        }
        if (scan.piiTablesCount > 0) {
          candidates.push(`List the ${scan.piiTablesCount} tables with PII — who owns them?`);
        }
        if (scan.avgGovernanceScore > 0) {
          const score = Math.round(scan.avgGovernanceScore);
          candidates.push(`Governance score is ${score}/100 — what are the top technical gaps?`);
        }
        candidates.push(`Which tables have stale data (no writes in 30+ days)?`);
        candidates.push(`Show me tables with the most downstream dependencies`);
        candidates.push(`What schema drift or missing owners exist in our estate?`);
      }

      if (run) {
        const domains = run.domains
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean);
        if (domains.length > 0) {
          const domain = pickRandom(domains, 1)[0];
          candidates.push(`What is the technical health of tables in ${domain}?`);
        }
      }
    } else if (persona === "business") {
      // --- Business outcome-focused questions ---
      candidates.push(`What business outcomes can we drive from our data?`);
      candidates.push(`What quick wins can we deploy today?`);

      if (run?.industry) {
        const outcome = await getIndustryOutcomeAsync(run.industry);
        if (outcome) {
          const kpis = collectKpis(outcome, 2);
          for (const kpi of kpis) {
            candidates.push(`Build me a dashboard to track ${kpi.toLowerCase()}`);
          }

          const ucNames = collectUseCaseNames(outcome, 2);
          for (const name of ucNames) {
            candidates.push(`What's the revenue impact of ${name}?`);
          }
        }
      }

      if (useCases.length > 0) {
        const topUc = pickRandom(useCases, 1);
        for (const uc of topUc) {
          candidates.push(`Deploy a Genie Space for the ${uc.name} use case`);
        }
      }

      if (run?.goals) {
        candidates.push(`How does our data support our strategic goals?`);
      }

      if (scan) {
        candidates.push(`Show me the top opportunities in our data estate`);
      }
    } else if (persona === "strategic") {
      // --- C-level / board-level strategic questions ---
      candidates.push(`What is the total estimated business value across all discovered use cases?`);
      candidates.push(`Which strategic investments should we prioritise and why?`);

      if (run?.industry) {
        const outcome = await getIndustryOutcomeAsync(run.industry);
        if (outcome) {
          const kpis = collectKpis(outcome, 2);
          for (const kpi of kpis) {
            candidates.push(`What is the ROI potential of improving ${kpi.toLowerCase()}?`);
          }
          const ucNames = collectUseCaseNames(outcome, 2);
          for (const name of ucNames) {
            candidates.push(`Draft an executive brief on the business case for ${name}`);
          }
        }
      }

      if (useCases.length > 0) {
        const topUc = pickRandom(useCases, 1);
        for (const uc of topUc) {
          candidates.push(`What should I present to the board about ${uc.name}?`);
        }
      }

      if (run?.goals) {
        candidates.push(`How well does our data portfolio align with our strategic goals?`);
        candidates.push(`What gaps exist between our data capabilities and our business strategy?`);
      }

      if (run?.businessName) {
        candidates.push(`Summarise the data-driven transformation roadmap for ${run.businessName}`);
      }

      if (scan) {
        candidates.push(`Give me a board-ready overview of our data estate maturity`);
        if (scan.avgGovernanceScore > 0) {
          const score = Math.round(scan.avgGovernanceScore);
          candidates.push(`Our governance score is ${score}/100 — what executive actions are needed?`);
        }
      }
    } else {
      // --- Analyst persona questions ---
      if (run?.industry) {
        const outcome = await getIndustryOutcomeAsync(run.industry);
        if (outcome) {
          const kpis = collectKpis(outcome, 3);
          for (const kpi of kpis) {
            candidates.push(`How can we measure ${kpi.toLowerCase()}?`);
          }

          const ucNames = collectUseCaseNames(outcome, 2);
          for (const name of ucNames) {
            candidates.push(`How would we implement ${name}?`);
          }

          const personas = collectPersonas(outcome, 1);
          for (const p of personas) {
            candidates.push(`What insights does a ${p} need from our data?`);
          }
        }
      }

      if (useCases.length > 0) {
        const topUc = pickRandom(useCases, 2);
        for (const uc of topUc) {
          candidates.push(`Tell me more about the ${uc.name} use case`);
        }
      }

      if (run) {
        const domains = run.domains
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean);
        if (domains.length > 0) {
          const domain = pickRandom(domains, 1)[0];
          candidates.push(`What data assets exist in ${domain}?`);
        }

        if (run.goals) {
          candidates.push(`How can our data help us achieve our strategic goals?`);
        }
      }

      if (scan) {
        if (scan.tableCount > 0) {
          candidates.push(`Which of our ${scan.tableCount} tables have data quality issues?`);
        }
        if (scan.piiTablesCount > 0) {
          candidates.push(`Show me the ${scan.piiTablesCount} tables that contain PII data`);
        }
        if (scan.avgGovernanceScore > 0) {
          const score = Math.round(scan.avgGovernanceScore);
          candidates.push(`Our governance score is ${score}/100 — how can we improve it?`);
        }
        candidates.push(`Give me an overview of our data estate`);
      }
    }

    if (candidates.length === 0) {
      if (persona === "tech") return FALLBACK_QUESTIONS_TECH;
      if (persona === "analyst") return FALLBACK_QUESTIONS_ANALYST;
      if (persona === "strategic") return FALLBACK_QUESTIONS_STRATEGIC;
      return FALLBACK_QUESTIONS;
    }

    return pickRandom(candidates, TARGET_COUNT);
  } catch (err) {
    logger.warn("[suggested-questions] Failed to build dynamic questions", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Lakebase data fetch
// ---------------------------------------------------------------------------

async function fetchContext(): Promise<{
  run: RunContext | null;
  scan: ScanContext | null;
  useCases: UseCaseSummary[];
}> {
  return withPrisma(async (prisma) => {
    // Latest completed pipeline run
    const latestRun = await prisma.forgeRun.findFirst({
      where: { status: "completed" },
      orderBy: { createdAt: "desc" },
      select: {
        runId: true,
        businessName: true,
        generationOptions: true,
        businessDomains: true,
        businessPriorities: true,
        strategicGoals: true,
      },
    });

    let run: RunContext | null = null;
    if (latestRun) {
      let industry = "";
      try {
        const opts = latestRun.generationOptions ? JSON.parse(latestRun.generationOptions) : {};
        industry = opts?.industry ?? "";
      } catch {
        /* ignore */
      }

      run = {
        businessName: latestRun.businessName,
        runId: latestRun.runId,
        industry,
        domains: latestRun.businessDomains ?? "",
        priorities: latestRun.businessPriorities ?? "",
        goals: latestRun.strategicGoals ?? "",
      };
    }

    // Latest environment scan
    const latestScan = await prisma.forgeEnvironmentScan.findFirst({
      orderBy: { createdAt: "desc" },
      select: {
        ucPath: true,
        tableCount: true,
        domainCount: true,
        piiTablesCount: true,
        avgGovernanceScore: true,
      },
    });

    const scan: ScanContext | null = latestScan
      ? {
          ucPath: latestScan.ucPath,
          tableCount: latestScan.tableCount,
          domainCount: latestScan.domainCount,
          piiTablesCount: latestScan.piiTablesCount,
          avgGovernanceScore: Number(latestScan.avgGovernanceScore),
        }
      : null;

    // Top use cases from the latest completed run
    let useCases: UseCaseSummary[] = [];
    if (run) {
      const rows = await prisma.forgeUseCase.findMany({
        where: { runId: run.runId },
        orderBy: { overallScore: "desc" },
        select: { name: true, domain: true },
        take: 10,
      });
      useCases = rows
        .filter((r) => r.name)
        .map((r) => ({ name: r.name ?? "", domain: r.domain ?? "" }));
    }

    return { run, scan, useCases };
  });
}
