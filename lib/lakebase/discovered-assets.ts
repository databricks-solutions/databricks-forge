/**
 * CRUD operations for discovered analytics assets — backed by Lakebase (Prisma).
 *
 * Stores snapshots of existing Genie spaces, dashboards, and coverage
 * metrics discovered during pipeline runs or estate scans.
 */

import { withPrisma } from "@/lib/prisma";
import type { DiscoveryResult, AssetCoverage } from "@/lib/discovery/types";

// ---------------------------------------------------------------------------
// Save discovery results
// ---------------------------------------------------------------------------

export async function saveDiscoveryResults(
  runId: string,
  discovery: DiscoveryResult,
  coverage: AssetCoverage,
): Promise<void> {
  await withPrisma(async (prisma) => {
    // Clear previous discovery data for this run
    await prisma.forgeDiscoveredGenieSpace.deleteMany({ where: { runId } });
    await prisma.forgeDiscoveredDashboard.deleteMany({ where: { runId } });
    await prisma.forgeAssetCoverage.deleteMany({ where: { runId } });

    // Save discovered Genie spaces
    if (discovery.genieSpaces.length > 0) {
      await prisma.forgeDiscoveredGenieSpace.createMany({
        data: discovery.genieSpaces.map((s) => ({
          runId,
          spaceId: s.spaceId,
          title: s.title,
          description: s.description,
          tablesJson: JSON.stringify(s.tables),
          metricViewsJson: JSON.stringify(s.metricViews),
          sampleQuestionCount: s.sampleQuestionCount,
          measureCount: s.measureCount,
          filterCount: s.filterCount,
          instructionLength: s.instructionLength,
        })),
      });
    }

    // Save discovered dashboards
    if (discovery.dashboards.length > 0) {
      await prisma.forgeDiscoveredDashboard.createMany({
        data: discovery.dashboards.map((d) => ({
          runId,
          dashboardId: d.dashboardId,
          displayName: d.displayName,
          tablesJson: JSON.stringify(d.tables),
          isPublished: d.isPublished,
          datasetCount: d.datasetCount,
          widgetCount: d.widgetCount,
          creatorEmail: d.creatorEmail ?? null,
          parentPath: d.parentPath ?? null,
        })),
      });
    }

    // Save coverage summary
    await prisma.forgeAssetCoverage.create({
      data: {
        runId,
        totalTables: coverage.allTables.length,
        coveredTables: coverage.allTables.length - coverage.uncoveredTables.length,
        uncoveredTables: coverage.uncoveredTables.length,
        coveragePercent: coverage.coveragePercent,
        genieSpaceCount: coverage.genieSpaceCount,
        dashboardCount: coverage.dashboardCount,
        metricViewCount: coverage.metricViewCount,
        coverageDetailJson: JSON.stringify(coverage),
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Read discovery results
// ---------------------------------------------------------------------------

export async function getDiscoveryResultsByRunId(runId: string): Promise<{
  genieSpaces: Array<{
    spaceId: string;
    title: string;
    tables: string[];
    metricViews: string[];
    sampleQuestionCount: number;
    measureCount: number;
    filterCount: number;
  }>;
  dashboards: Array<{
    dashboardId: string;
    displayName: string;
    tables: string[];
    isPublished: boolean;
    datasetCount: number;
    widgetCount: number;
  }>;
  coverage: AssetCoverage | null;
} | null> {
  return withPrisma(async (prisma) => {
    const spaces = await prisma.forgeDiscoveredGenieSpace.findMany({
      where: { runId },
    });
    const dashboards = await prisma.forgeDiscoveredDashboard.findMany({
      where: { runId },
    });
    const coverageRow = await prisma.forgeAssetCoverage.findUnique({
      where: { runId },
    });

    if (spaces.length === 0 && dashboards.length === 0 && !coverageRow) {
      return null;
    }

    return {
      genieSpaces: spaces.map((s) => ({
        spaceId: s.spaceId,
        title: s.title,
        tables: parseJsonArray(s.tablesJson),
        metricViews: parseJsonArray(s.metricViewsJson),
        sampleQuestionCount: s.sampleQuestionCount,
        measureCount: s.measureCount,
        filterCount: s.filterCount,
      })),
      dashboards: dashboards.map((d) => ({
        dashboardId: d.dashboardId,
        displayName: d.displayName,
        tables: parseJsonArray(d.tablesJson),
        isPublished: d.isPublished,
        datasetCount: d.datasetCount,
        widgetCount: d.widgetCount,
      })),
      coverage: coverageRow?.coverageDetailJson
        ? (JSON.parse(coverageRow.coverageDetailJson) as AssetCoverage)
        : null,
    };
  });
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
