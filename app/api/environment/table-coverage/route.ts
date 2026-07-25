/**
 * API: /api/environment/table-coverage
 *
 * GET -- returns table-centric view linking estate metadata with discovered use cases.
 *
 * For each table in the aggregate estate, returns:
 *   - Estate metadata (domain, tier, health, governance, PII)
 *   - List of use cases that reference this table (from latest completed run)
 *   - Coverage status (has use cases / untapped)
 */

import { NextResponse } from "next/server";
import { getAggregateEstateView } from "@/lib/lakebase/environment-scans";
import { logger } from "@/lib/logger";
import { withPrisma } from "@/lib/prisma";

interface TableCoverageRow {
  tableFqn: string;
  domain: string | null;
  tier: string | null;
  sensitivityLevel: string | null;
  governanceScore: number | null;
  comment: string | null;
  generatedDescription: string | null;
  sizeInBytes: string | null;
  numRows: string | null;
  owner: string | null;
  useCases: Array<{
    id: string;
    name: string;
    type: string;
    domain: string;
    overallScore: number;
    runId: string;
  }>;
}

export async function GET() {
  try {
    const aggregate = await getAggregateEstateView();
    if (!aggregate || aggregate.details.length === 0) {
      return NextResponse.json({ tables: [], hasEstateData: false });
    }

    const useCasesByTable = await withPrisma(async (prisma) => {
      const latestRun = await prisma.forgeRun.findFirst({
        where: { status: "completed" },
        orderBy: { completedAt: "desc" },
        select: { runId: true },
      });

      const map = new Map<string, TableCoverageRow["useCases"]>();
      if (latestRun) {
        const useCases = await prisma.forgeUseCase.findMany({
          where: { runId: latestRun.runId },
          orderBy: { overallScore: "desc" },
        });

        for (const uc of useCases) {
          let tables: string[] = [];
          try {
            tables = JSON.parse(uc.tablesInvolved as string);
          } catch {
            tables = [];
          }
          for (const fqn of tables) {
            const clean = fqn.replace(/`/g, "");
            if (!map.has(clean)) map.set(clean, []);
            map.get(clean)!.push({
              id: uc.id,
              name: uc.name ?? "",
              type: uc.type ?? "",
              domain: uc.domain ?? "",
              overallScore: uc.overallScore ?? 0,
              runId: uc.runId,
            });
          }
        }
      }
      return map;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tables: TableCoverageRow[] = aggregate.details.map((d: any) => ({
      tableFqn: String(d.tableFqn ?? ""),
      domain: d.dataDomain ?? null,
      tier: d.dataTier ?? null,
      sensitivityLevel: d.sensitivityLevel ?? null,
      governanceScore: d.governanceScore ?? null,
      comment: d.comment ?? null,
      generatedDescription: d.generatedDescription ?? null,
      sizeInBytes: d.sizeInBytes ?? null,
      numRows: d.numRows ?? null,
      owner: d.owner ?? null,
      useCases: useCasesByTable.get(String(d.tableFqn ?? "").replace(/`/g, "")) ?? [],
    }));

    // Sort: tables without use cases first (expansion signals), then by use case count desc
    tables.sort((a, b) => {
      if (a.useCases.length === 0 && b.useCases.length > 0) return -1;
      if (a.useCases.length > 0 && b.useCases.length === 0) return 1;
      return b.useCases.length - a.useCases.length;
    });

    const covered = tables.filter((t) => t.useCases.length > 0).length;
    const uncovered = tables.filter((t) => t.useCases.length === 0).length;

    return NextResponse.json(
      {
        tables,
        hasEstateData: true,
        stats: {
          totalTables: tables.length,
          coveredTables: covered,
          uncoveredTables: uncovered,
          coveragePct: tables.length > 0 ? Math.round((covered / tables.length) * 100) : 0,
        },
      },
      {
        headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
      },
    );
  } catch (error) {
    logger.error("[api/environment/table-coverage] GET failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to load table coverage" }, { status: 500 });
  }
}
