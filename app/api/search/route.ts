/**
 * API: /api/search
 *
 * GET -- Semantic search across all embedded estate and pipeline data.
 *
 * Query params:
 *   q         (required)  Natural language search query
 *   scope     (optional)  estate | usecases | genie | insights | documents | all (default: all)
 *   runId     (optional)  Filter to a specific pipeline run
 *   scanId    (optional)  Filter to a specific estate scan
 *   catalog   (optional)  Filter by UC catalog
 *   domain    (optional)  Filter by data domain
 *   tier      (optional)  Filter by data tier
 *   topK      (optional)  Max results (default: 20, max: 100)
 *   minScore  (optional)  Minimum similarity score 0-1 (default: 0.3)
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { generateEmbedding } from "@/lib/embeddings/client";
import { searchByVector, embeddingsTableExists } from "@/lib/embeddings/store";
import { SEARCH_SCOPES, type EmbeddingKind } from "@/lib/embeddings/types";
import { isEmbeddingEnabled } from "@/lib/embeddings/config";
import { logger } from "@/lib/logger";
import { requireUser } from "@/lib/auth/route-user";
import { listAccessibleIds } from "@/lib/lakebase/acl";
import { withPrisma } from "@/lib/prisma";
import { GLOBAL_KINDS, KIND_SCOPE, SOURCE_PARENT } from "@/lib/embeddings/kind-scope";
import type { UserScope } from "@/lib/embeddings/store";

export async function GET(request: NextRequest) {
  try {
    if (!isEmbeddingEnabled()) {
      return NextResponse.json({
        results: [],
        total: 0,
        enabled: false,
        message:
          "Semantic search is not available. The embedding endpoint (serving-endpoint-embedding) is not configured.",
      });
    }

    const params = request.nextUrl.searchParams;
    const q = params.get("q");

    if (!q || q.trim().length === 0) {
      return NextResponse.json({ error: "Query parameter 'q' is required" }, { status: 400 });
    }

    const tableExists = await embeddingsTableExists();
    if (!tableExists) {
      return NextResponse.json({
        results: [],
        total: 0,
        enabled: true,
        message:
          "Semantic search is not yet available. Run an estate scan or pipeline to generate embeddings.",
      });
    }

    const scope = (params.get("scope") || "all") as keyof typeof SEARCH_SCOPES;
    const kinds: readonly EmbeddingKind[] = SEARCH_SCOPES[scope] ?? SEARCH_SCOPES.all;

    const runId = params.get("runId") || undefined;
    const scanId = params.get("scanId") || undefined;
    const topK = Math.min(parseInt(params.get("topK") || "20", 10) || 20, 100);
    const minScore = parseFloat(params.get("minScore") || "0.3") || 0.3;

    const metadataFilter: Record<string, unknown> = {};
    const catalog = params.get("catalog");
    const domain = params.get("domain");
    const tier = params.get("tier");
    if (catalog) metadataFilter.catalog = catalog;
    if (domain) metadataFilter.domain = domain;
    if (tier) metadataFilter.tier = tier;

    const user = await requireUser(request);

    const queryVector = await generateEmbedding(q.trim());

    const userScope = await buildSearchUserScope(user.email, kinds);

    const results = await searchByVector(queryVector, {
      kinds,
      runId,
      scanId,
      metadataFilter: Object.keys(metadataFilter).length > 0 ? metadataFilter : undefined,
      topK,
      minScore,
      userScope,
    });

    return NextResponse.json({
      results: results.map((r) => ({
        id: r.id,
        kind: r.kind,
        sourceId: r.sourceId,
        runId: r.runId,
        scanId: r.scanId,
        content: r.contentText,
        metadata: r.metadataJson,
        score: Math.round(r.score * 1000) / 1000,
      })),
      total: results.length,
      query: q.trim(),
      scope,
    });
  } catch (error) {
    logger.error("[api/search] GET failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

/**
 * Build a `UserScope` for the search request: resolve every kind that the
 * search may match into the set of run / scan / source ids the calling
 * user can see.
 */
async function buildSearchUserScope(
  email: string,
  kinds: readonly EmbeddingKind[],
): Promise<UserScope> {
  const needsRunIds = kinds.some((k) => KIND_SCOPE[k] === "run");
  const needsScanIds = kinds.some((k) => KIND_SCOPE[k] === "scan");
  const sourceKinds = kinds.filter((k) => KIND_SCOPE[k] === "source");
  const globalKinds = kinds.filter((k) => KIND_SCOPE[k] === "global");

  const [accessibleRunIds, accessibleScanIds] = await Promise.all([
    needsRunIds ? resolveAccessibleRunIds(email) : Promise.resolve<string[]>([]),
    needsScanIds ? resolveAccessibleScanIds(email) : Promise.resolve<string[]>([]),
  ]);

  const accessibleSourceIds: Array<{ sourceId: string; kind: EmbeddingKind }> = [];
  for (const kind of sourceKinds) {
    const parent = SOURCE_PARENT[kind];
    if (!parent) continue;
    const ids = await resolveAccessibleSourceIds(email, parent);
    for (const id of ids) accessibleSourceIds.push({ sourceId: id, kind });
  }

  return {
    accessibleRunIds,
    accessibleScanIds,
    accessibleSourceIds,
    globalKinds: globalKinds.length > 0 ? globalKinds : GLOBAL_KINDS,
  };
}

async function resolveAccessibleRunIds(email: string): Promise<string[]> {
  const shared = await listAccessibleIds(email, "run");
  const owned = await withPrisma(async (prisma) =>
    prisma.forgeRun.findMany({ where: { ownerEmail: email }, select: { runId: true } }),
  );
  return Array.from(new Set([...owned.map((r) => r.runId), ...shared]));
}

async function resolveAccessibleScanIds(email: string): Promise<string[]> {
  const [sharedEnv, sharedFabric] = await Promise.all([
    listAccessibleIds(email, "scan"),
    listAccessibleIds(email, "fabric_scan"),
  ]);
  const [ownedEnv, ownedFabric] = await withPrisma(async (prisma) => {
    return Promise.all([
      prisma.forgeEnvironmentScan.findMany({
        where: { ownerEmail: email },
        select: { scanId: true },
      }),
      prisma.forgeFabricScan.findMany({ where: { ownerEmail: email }, select: { id: true } }),
    ]);
  });
  return Array.from(
    new Set([
      ...ownedEnv.map((r) => r.scanId),
      ...ownedFabric.map((r) => r.id),
      ...sharedEnv,
      ...sharedFabric,
    ]),
  );
}

async function resolveAccessibleSourceIds(
  email: string,
  parent: "document" | "demo_session",
): Promise<string[]> {
  const shared = await listAccessibleIds(email, parent === "document" ? "document" : "demo_session");
  const owned = await withPrisma(async (prisma) => {
    if (parent === "document") {
      return prisma.forgeDocument.findMany({
        where: { ownerEmail: email },
        select: { id: true },
      });
    }
    return prisma.forgeDemoSession.findMany({
      where: { ownerEmail: email },
      select: { id: true },
    });
  });
  return Array.from(new Set([...owned.map((r) => r.id), ...shared]));
}
