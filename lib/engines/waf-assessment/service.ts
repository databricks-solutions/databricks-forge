/**
 * WAF Assessment service — orchestrates a full assessment run end-to-end.
 *
 * Flow:
 *   1. Seed the controls catalog if empty (idempotent).
 *   2. Insert a new ForgeWafAssessment row in `running` state.
 *   3. Run all four pillar queries against the user's warehouse (OBO).
 *   4. Persist per-control results, compute per-pillar + overall scores,
 *      and mark the assessment `completed`.
 *   5. On failure, mark the assessment `failed` with the error message.
 *
 * Pillar score = (controls met / controls in pillar) * 100.
 * Overall score = average of available pillar scores (skips failed pillars).
 */

import { v4 as uuidv4 } from "uuid";
import { withPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { ensureCatalogSeeded } from "./catalog";
import { runAllPillars } from "./engine";
import type {
  WafAssessmentDetail,
  WafAssessmentSummary,
  WafControl,
  WafControlResult,
  WafIgnoredResource,
  WafPillar,
  WafQualitativeAnswer,
  WafQualitativeResponse,
} from "./types";
import {
  QUALITATIVE_SCORE,
  QUALITATIVE_THRESHOLD,
  WAF_PILLARS,
} from "./types";

const QUALITATIVE_ANSWERS: ReadonlySet<WafQualitativeAnswer> = new Set([
  "yes",
  "partial",
  "no",
  "not_applicable",
]);

function toSummary(row: {
  assessmentId: string;
  ownerEmail: string | null;
  status: string;
  scope: string | null;
  triggeredBy: string | null;
  governanceScore: number | null;
  iuScore: number | null;
  oeScore: number | null;
  scpScore: number | null;
  reliabilityScore: number | null;
  costScore: number | null;
  performanceScore: number | null;
  overallScore: number | null;
  totalControls: number;
  metControls: number;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
}): WafAssessmentSummary {
  return {
    assessmentId: row.assessmentId,
    ownerEmail: row.ownerEmail,
    status: row.status as WafAssessmentSummary["status"],
    scope: row.scope,
    triggeredBy: row.triggeredBy,
    governanceScore: row.governanceScore,
    iuScore: row.iuScore,
    oeScore: row.oeScore,
    scpScore: row.scpScore,
    reliabilityScore: row.reliabilityScore,
    costScore: row.costScore,
    performanceScore: row.performanceScore,
    overallScore: row.overallScore,
    totalControls: row.totalControls,
    metControls: row.metControls,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function pillarScore(metByPillar: Map<WafPillar, { met: number; total: number }>, pillar: WafPillar): number | null {
  const entry = metByPillar.get(pillar);
  if (!entry || entry.total === 0) return null;
  return Math.round((entry.met / entry.total) * 1000) / 10;
}

/** Start (and complete) a new assessment run. Returns the final summary. */
export async function runAssessment(opts: {
  scope?: string;
  triggeredBy?: string;
  ownerEmail?: string | null;
}): Promise<WafAssessmentSummary> {
  await ensureCatalogSeeded();

  const assessmentId = uuidv4();
  await withPrisma((prisma) =>
    prisma.forgeWafAssessment.create({
      data: {
        assessmentId,
        ownerEmail: opts.ownerEmail ?? null,
        status: "running",
        scope: opts.scope ?? null,
        triggeredBy: opts.triggeredBy ?? null,
      },
    }),
  );

  try {
    const { results, errors } = await runAllPillars();

    // Catalog is the source of truth: pull pillar+evaluationType once and use
    // it both to filter unknown waf_ids and to materialize qualitative results.
    const catalogRows = await withPrisma((prisma) =>
      prisma.forgeWafControl.findMany({
        select: { wafId: true, pillar: true, evaluationType: true },
      }),
    );
    const catalogIndex = new Map(
      catalogRows.map((r: { wafId: string; pillar: string; evaluationType: string }) => [
        r.wafId,
        { pillar: r.pillar as WafPillar, evaluationType: r.evaluationType },
      ]),
    );

    // Materialize qualitative results from saved responses. Only "yes/partial/no"
    // produce a row; "not_applicable" excludes the control from totals.
    const qualitativeResults: WafControlResult[] = [];
    const responses = await withPrisma((prisma) =>
      prisma.forgeWafQualitativeResponse.findMany(),
    );
    for (const r of responses) {
      const meta = catalogIndex.get(r.wafId);
      if (!meta || meta.evaluationType !== "qualitative") continue;
      const score = QUALITATIVE_SCORE[r.response as WafQualitativeAnswer];
      if (score == null) continue;
      qualitativeResults.push({
        wafId: r.wafId,
        pillar: meta.pillar,
        scorePercentage: score,
        thresholdPercentage: QUALITATIVE_THRESHOLD,
        thresholdMet: score >= QUALITATIVE_THRESHOLD,
      });
    }

    // Workspace-level control exclusions. Only entries with both resourceType
    // and resourceId NULL skip the entire control; resource-level entries are
    // reserved for a future iteration (will be honored inside SQL queries).
    const ignored = await withPrisma((prisma) =>
      prisma.forgeWafIgnoredResource.findMany({
        where: { resourceType: null, resourceId: null },
        select: { wafId: true },
      }),
    );
    const ignoredControlIds = new Set(ignored.map((i: { wafId: string }) => i.wafId));

    const automaticResults = results.filter(
      (r) => catalogIndex.has(r.wafId) && !ignoredControlIds.has(r.wafId),
    );
    const valid: WafControlResult[] = [
      ...automaticResults,
      ...qualitativeResults.filter((r) => !ignoredControlIds.has(r.wafId)),
    ];

    if (valid.length === 0) {
      throw new Error(
        errors.length > 0
          ? `All pillar queries failed: ${errors.map((e) => `${e.pillar}: ${e.message}`).join("; ")}`
          : "No control results returned",
      );
    }

    await withPrisma((prisma) =>
      prisma.forgeWafControlResult.createMany({
        data: valid.map((r) => ({
          assessmentId,
          wafId: r.wafId,
          pillar: r.pillar,
          scorePercentage: r.scorePercentage,
          thresholdPercentage: r.thresholdPercentage,
          thresholdMet: r.thresholdMet,
        })),
      }),
    );

    const totals = new Map<WafPillar, { met: number; total: number }>();
    let totalControls = 0;
    let metControls = 0;
    for (const r of valid) {
      const t = totals.get(r.pillar) ?? { met: 0, total: 0 };
      t.total += 1;
      if (r.thresholdMet) t.met += 1;
      totals.set(r.pillar, t);
      totalControls += 1;
      if (r.thresholdMet) metControls += 1;
    }

    const governanceScore = pillarScore(totals, "governance");
    const iuScore = pillarScore(totals, "interoperability_usability");
    const oeScore = pillarScore(totals, "operational_excellence");
    const scpScore = pillarScore(totals, "security_compliance_privacy");
    const reliabilityScore = pillarScore(totals, "reliability");
    const costScore = pillarScore(totals, "cost_optimisation");
    const performanceScore = pillarScore(totals, "performance_efficiency");
    const available = [
      governanceScore,
      iuScore,
      oeScore,
      scpScore,
      reliabilityScore,
      costScore,
      performanceScore,
    ].filter((n): n is number => n != null);
    const overallScore =
      available.length === 0
        ? null
        : Math.round((available.reduce((a, b) => a + b, 0) / available.length) * 10) / 10;

    const updated = await withPrisma((prisma) =>
      prisma.forgeWafAssessment.update({
        where: { assessmentId },
        data: {
          status: "completed",
          governanceScore,
          iuScore,
          oeScore,
          scpScore,
          reliabilityScore,
          costScore,
          performanceScore,
          overallScore,
          totalControls,
          metControls,
          completedAt: new Date(),
          errorMessage:
            errors.length > 0
              ? `Some pillars failed: ${errors.map((e) => e.pillar).join(", ")}`
              : null,
        },
      }),
    );

    return toSummary(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("[waf-assessment] run failed", { assessmentId, error: message });
    const updated = await withPrisma((prisma) =>
      prisma.forgeWafAssessment.update({
        where: { assessmentId },
        data: {
          status: "failed",
          errorMessage: message,
          completedAt: new Date(),
        },
      }),
    );
    return toSummary(updated);
  }
}

/** Build a Prisma `where` clause that admits owned + shared assessments. */
function visibilityWhere(
  ownerEmail: string,
  sharedIds: readonly string[] = [],
): { OR: Array<Record<string, unknown>> } {
  const clauses: Array<Record<string, unknown>> = [{ ownerEmail }];
  if (sharedIds.length > 0) {
    clauses.push({ assessmentId: { in: [...sharedIds] } });
  }
  return { OR: clauses };
}

/**
 * List recent assessments visible to a user (newest first). Includes
 * assessments the user owns plus any explicitly shared with them via
 * `forge_resource_acl` (resourceType="waf_assessment").
 */
export async function listAssessments(
  ownerEmail: string,
  limit = 20,
  sharedIds: readonly string[] = [],
): Promise<WafAssessmentSummary[]> {
  const rows = await withPrisma((prisma) =>
    prisma.forgeWafAssessment.findMany({
      where: visibilityWhere(ownerEmail, sharedIds),
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  );
  return rows.map(toSummary);
}

/**
 * Get the most recent completed assessment visible to a user. Honours the
 * same owned-or-shared visibility model as `listAssessments`.
 */
export async function getLatestAssessment(
  ownerEmail: string,
  sharedIds: readonly string[] = [],
): Promise<WafAssessmentDetail | null> {
  const latest = await withPrisma((prisma) =>
    prisma.forgeWafAssessment.findFirst({
      where: { ...visibilityWhere(ownerEmail, sharedIds), status: "completed" },
      orderBy: { createdAt: "desc" },
    }),
  );
  if (!latest) return null;
  return getAssessmentDetail(latest.assessmentId, ownerEmail, sharedIds);
}

/**
 * Get a single assessment with per-control results joined to the catalog.
 * Returns `null` if the caller is neither the owner nor in the resource's
 * ACL share list.
 */
export async function getAssessmentDetail(
  assessmentId: string,
  ownerEmail: string,
  sharedIds: readonly string[] = [],
): Promise<WafAssessmentDetail | null> {
  const assessment = await withPrisma((prisma) =>
    prisma.forgeWafAssessment.findUnique({
      where: { assessmentId },
      include: { results: { include: { control: true } } },
    }),
  );
  if (!assessment) return null;
  const isOwner = assessment.ownerEmail === ownerEmail;
  const isShared = sharedIds.includes(assessmentId);
  if (!isOwner && !isShared) return null;
  return {
    ...toSummary(assessment),
    results: assessment.results.map(
      (r: {
        wafId: string;
        pillar: string;
        scorePercentage: number;
        thresholdPercentage: number;
        thresholdMet: boolean;
        control: {
          wafId: string;
          pillar: string;
          pillarName: string;
          principle: string;
          bestPractice: string;
          capabilities: string | null;
          details: string | null;
          thresholdPercentage: number | null;
          metricDefinition: string | null;
          recommendationIfNotMet: string | null;
          fixActionEngine: string | null;
          fixActionParamsJson: string | null;
          evaluationType: string;
        };
      }) => ({
        wafId: r.wafId,
        pillar: r.pillar as WafPillar,
        scorePercentage: r.scorePercentage,
        thresholdPercentage: r.thresholdPercentage,
        thresholdMet: r.thresholdMet,
        control: {
          wafId: r.control.wafId,
          pillar: r.control.pillar as WafPillar,
          pillarName: r.control.pillarName,
          principle: r.control.principle,
          bestPractice: r.control.bestPractice,
          capabilities: r.control.capabilities,
          details: r.control.details,
          thresholdPercentage: r.control.thresholdPercentage,
          metricDefinition: r.control.metricDefinition,
          recommendationIfNotMet: r.control.recommendationIfNotMet,
          fixActionEngine: r.control.fixActionEngine,
          fixActionParamsJson: r.control.fixActionParamsJson,
          evaluationType:
            r.control.evaluationType === "qualitative" ? "qualitative" : "automatic",
        },
      }),
    ),
  };
}

/** Get the catalog for the controls tab (no run required). */
export async function listControls(): Promise<WafControl[]> {
  await ensureCatalogSeeded();
  const rows = await withPrisma((prisma) =>
    prisma.forgeWafControl.findMany({
      orderBy: [{ pillar: "asc" }, { wafId: "asc" }],
    }),
  );
  return rows.map(
    (r: {
      wafId: string;
      pillar: string;
      pillarName: string;
      principle: string;
      bestPractice: string;
      capabilities: string | null;
      details: string | null;
      thresholdPercentage: number | null;
      metricDefinition: string | null;
      recommendationIfNotMet: string | null;
      fixActionEngine: string | null;
      fixActionParamsJson: string | null;
      evaluationType: string;
    }) => ({
      wafId: r.wafId,
      pillar: r.pillar as WafPillar,
      pillarName: r.pillarName,
      principle: r.principle,
      bestPractice: r.bestPractice,
      capabilities: r.capabilities,
      details: r.details,
      thresholdPercentage: r.thresholdPercentage,
      metricDefinition: r.metricDefinition,
      recommendationIfNotMet: r.recommendationIfNotMet,
      fixActionEngine: r.fixActionEngine,
      fixActionParamsJson: r.fixActionParamsJson,
      evaluationType: r.evaluationType === "qualitative" ? "qualitative" : "automatic",
    }),
  );
}

export { WAF_PILLARS };

function toQualitativeResponse(row: {
  wafId: string;
  response: string;
  notes: string | null;
  respondedBy: string | null;
  updatedAt: Date;
}): WafQualitativeResponse {
  return {
    wafId: row.wafId,
    response: row.response as WafQualitativeAnswer,
    notes: row.notes,
    respondedBy: row.respondedBy,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** List all saved qualitative responses (one row per waf_id). */
export async function listQualitativeResponses(): Promise<WafQualitativeResponse[]> {
  const rows = await withPrisma((prisma) =>
    prisma.forgeWafQualitativeResponse.findMany({ orderBy: { wafId: "asc" } }),
  );
  return rows.map(toQualitativeResponse);
}

/** Upsert a qualitative response. Throws if wafId is unknown or non-qualitative. */
export async function saveQualitativeResponse(input: {
  wafId: string;
  response: WafQualitativeAnswer;
  notes?: string | null;
  respondedBy?: string | null;
}): Promise<WafQualitativeResponse> {
  if (!QUALITATIVE_ANSWERS.has(input.response)) {
    throw new Error(`Invalid response: ${input.response}`);
  }
  await ensureCatalogSeeded();
  const control = await withPrisma((prisma) =>
    prisma.forgeWafControl.findUnique({
      where: { wafId: input.wafId },
      select: { wafId: true, evaluationType: true },
    }),
  );
  if (!control) throw new Error(`Unknown waf_id: ${input.wafId}`);
  if (control.evaluationType !== "qualitative") {
    throw new Error(`Control ${input.wafId} is not qualitative`);
  }
  const row = await withPrisma((prisma) =>
    prisma.forgeWafQualitativeResponse.upsert({
      where: { wafId: input.wafId },
      create: {
        wafId: input.wafId,
        response: input.response,
        notes: input.notes ?? null,
        respondedBy: input.respondedBy ?? null,
      },
      update: {
        response: input.response,
        notes: input.notes ?? null,
        respondedBy: input.respondedBy ?? null,
      },
    }),
  );
  return toQualitativeResponse(row);
}

/** Delete a qualitative response (returns to "Pending response" state). */
export async function deleteQualitativeResponse(wafId: string): Promise<void> {
  await withPrisma((prisma) =>
    prisma.forgeWafQualitativeResponse.deleteMany({ where: { wafId } }),
  );
}

function toIgnoredResource(row: {
  id: string;
  wafId: string;
  resourceType: string | null;
  resourceId: string | null;
  reason: string;
  ignoredBy: string | null;
  createdAt: Date;
}): WafIgnoredResource {
  return {
    id: row.id,
    wafId: row.wafId,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    reason: row.reason,
    ignoredBy: row.ignoredBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/** List all workspace exclusions (control-level + resource-level). */
export async function listIgnoredResources(): Promise<WafIgnoredResource[]> {
  const rows = await withPrisma((prisma) =>
    prisma.forgeWafIgnoredResource.findMany({
      orderBy: [{ wafId: "asc" }, { createdAt: "desc" }],
    }),
  );
  return rows.map(toIgnoredResource);
}

/** Add a workspace exclusion. Idempotent on (wafId, resourceType, resourceId). */
export async function addIgnoredResource(input: {
  wafId: string;
  resourceType?: string | null;
  resourceId?: string | null;
  reason: string;
  ignoredBy?: string | null;
}): Promise<WafIgnoredResource> {
  if (!input.reason || input.reason.trim().length === 0) {
    throw new Error("reason is required");
  }
  await ensureCatalogSeeded();
  const exists = await withPrisma((prisma) =>
    prisma.forgeWafControl.findUnique({ where: { wafId: input.wafId } }),
  );
  if (!exists) throw new Error(`Unknown waf_id: ${input.wafId}`);
  const resourceType = input.resourceType ?? null;
  const resourceId = input.resourceId ?? null;
  // Manual find-then-update/create: Postgres treats NULL as distinct in
  // unique indexes, so the @@unique compound key cannot match NULL legs.
  const row = await withPrisma(async (prisma) => {
    const existing = await prisma.forgeWafIgnoredResource.findFirst({
      where: { wafId: input.wafId, resourceType, resourceId },
    });
    if (existing) {
      return prisma.forgeWafIgnoredResource.update({
        where: { id: existing.id },
        data: {
          reason: input.reason.trim(),
          ignoredBy: input.ignoredBy ?? null,
        },
      });
    }
    return prisma.forgeWafIgnoredResource.create({
      data: {
        wafId: input.wafId,
        resourceType,
        resourceId,
        reason: input.reason.trim(),
        ignoredBy: input.ignoredBy ?? null,
      },
    });
  });
  return toIgnoredResource(row);
}

/** Remove a workspace exclusion by primary key. */
export async function deleteIgnoredResource(id: string): Promise<void> {
  await withPrisma((prisma) =>
    prisma.forgeWafIgnoredResource.deleteMany({ where: { id } }),
  );
}
