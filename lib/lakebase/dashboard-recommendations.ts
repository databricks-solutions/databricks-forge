/**
 * CRUD operations for Dashboard Recommendations -- backed by Lakebase (Prisma).
 *
 * Recommendations are generated during the pipeline and persisted
 * so the UI can display them immediately without on-demand recomputation.
 */

import { withPrisma } from "@/lib/prisma";
import type {
  DashboardDesign,
  DashboardRecommendation,
  DatasetSourceKind,
} from "@/lib/dashboard/types";
import type { DashboardDesignV2 } from "@/lib/dashboard/design-ir";
import { requireDashboardDesignV2 } from "@/lib/dashboard/design-ir";
import { adaptLegacyDashboardDesign } from "@/lib/dashboard/legacy-design-adapter";
import { compactValidationEvidence, type ValidationEvidence } from "@/lib/validation/evidence";
import {
  fromPersistedDashboardRecommendationType,
  applyDashboardImproveDiff,
  fingerprintDashboardDesign,
  parseDashboardImproveDiff,
  toPersistedDashboardRecommendationType,
  type DashboardImproveDiff,
  type PersistedDashboardRecommendationType,
} from "@/lib/dashboard/improve-diff";

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

interface DbRow {
  id: string;
  runId: string;
  domain: string;
  subdomains: string | null;
  title: string;
  description: string;
  datasetCount: number;
  widgetCount: number;
  useCaseIds: string | null;
  serializedDashboard: string;
  dashboardDesign: string | null;
  designVersion: string | null;
  recommendationType: string;
  existingAssetId: string | null;
  improveDiffJson: string | null;
  improveBaseJson: string | null;
  changeSummary: string | null;
  ownerEmail: string | null;
  datasetSourceKind: string | null;
  publicationStatus: string | null;
  publishedAt: Date | null;
  validationStatus: string | null;
  validatorVersion: string | null;
  validationEvidenceJson: string | null;
  validatedAt: Date | null;
}

export class UnsupportedDashboardDesignVersionError extends Error {
  readonly designVersion: string;

  constructor(designVersion: string) {
    super(`Unsupported persisted dashboard design version "${designVersion}"`);
    this.name = "UnsupportedDashboardDesignVersionError";
    this.designVersion = designVersion;
  }
}

function dbRowToRecommendation(row: DbRow): DashboardRecommendation {
  let validationEvidence: ValidationEvidence[] = [];
  try {
    validationEvidence = compactValidationEvidence(
      row.validationEvidenceJson
        ? (JSON.parse(row.validationEvidenceJson) as ValidationEvidence[])
        : [],
    );
  } catch {
    /* Legacy or malformed evidence maps to an empty collection. */
  }
  const rawPersistedDesign = row.dashboardDesign
    ? (JSON.parse(row.dashboardDesign) as DashboardDesign & {
        datasetSourceKind?: DatasetSourceKind;
      })
    : null;
  let persistedDesign: DashboardDesignV2;
  if (row.designVersion === null) {
    persistedDesign = adaptLegacyDashboardDesign(
      rawPersistedDesign ?? {
        title: row.title,
        description: row.description,
        datasets: [],
        widgets: [],
      },
    );
  } else if (row.designVersion === "2") {
    persistedDesign = requireDashboardDesignV2(rawPersistedDesign);
  } else {
    throw new UnsupportedDashboardDesignVersionError(row.designVersion);
  }
  const datasetSourceKind =
    row.datasetSourceKind === "governed" ||
    row.datasetSourceKind === "mixed" ||
    row.datasetSourceKind === "table"
      ? row.datasetSourceKind
      : rawPersistedDesign?.datasetSourceKind === "governed" ||
          rawPersistedDesign?.datasetSourceKind === "mixed"
        ? rawPersistedDesign.datasetSourceKind
        : "table";
  let improveDiff: DashboardImproveDiff | undefined;
  try {
    improveDiff = row.improveDiffJson
      ? parseDashboardImproveDiff(JSON.parse(row.improveDiffJson))
      : undefined;
  } catch {
    /* Malformed legacy data is not exposed as a deployable improve plan. */
  }
  const recommendationType =
    (row.recommendationType as PersistedDashboardRecommendationType) ?? "new";
  const classification = fromPersistedDashboardRecommendationType(recommendationType);
  let improveBaseDesign: DashboardDesignV2 | undefined;
  let improvementBindingValid = true;
  if (classification === "reuse" || classification === "improve") {
    try {
      improveBaseDesign = requireDashboardDesignV2(
        row.improveBaseJson ? JSON.parse(row.improveBaseJson) : null,
      );
      if (
        !improveDiff ||
        !row.existingAssetId ||
        improveDiff.existingAssetId !== row.existingAssetId
      ) {
        throw new Error("missing binding");
      }
      const recomputed = applyDashboardImproveDiff(improveBaseDesign, improveDiff);
      if (fingerprintDashboardDesign(recomputed) !== fingerprintDashboardDesign(persistedDesign)) {
        throw new Error("artifact drift");
      }
      const isEmpty =
        improveDiff.addDatasets.length === 0 &&
        improveDiff.addWidgets.length === 0 &&
        improveDiff.addFilters.length === 0;
      if ((classification === "reuse") !== isEmpty) throw new Error("classification drift");
    } catch {
      improvementBindingValid = false;
      improveDiff = undefined;
      improveBaseDesign = undefined;
    }
  }

  return {
    domain: row.domain,
    subdomains: row.subdomains ? JSON.parse(row.subdomains) : [],
    title: row.title,
    description: row.description,
    datasetCount: row.datasetCount,
    widgetCount: row.widgetCount,
    useCaseIds: row.useCaseIds ? JSON.parse(row.useCaseIds) : [],
    serializedDashboard: row.serializedDashboard,
    dashboardDesign: persistedDesign,
    designVersion: "2",
    datasetSourceKind,
    validationStatus: !improvementBindingValid
      ? "invalid"
      : row.validationStatus === "valid" || row.validationStatus === "invalid"
        ? row.validationStatus
        : "pending",
    validatorVersion: improvementBindingValid ? (row.validatorVersion ?? undefined) : undefined,
    validationEvidence: improvementBindingValid
      ? validationEvidence
      : [
          {
            stage: "dashboard_improve",
            status: "failed",
            code: "DASHBOARD_IMPROVE_BINDING_INVALID",
            message: "Dashboard improvement binding is unavailable, corrupt, or drifted.",
          },
        ],
    validatedAt: improvementBindingValid ? row.validatedAt?.toISOString() : undefined,
    publicationStatus:
      row.publicationStatus === "draft" ||
      row.publicationStatus === "published" ||
      row.publicationStatus === "publish_failed"
        ? row.publicationStatus
        : undefined,
    publishedAt: row.publishedAt?.toISOString(),
    recommendationType,
    classification,
    existingAssetId: row.existingAssetId ?? undefined,
    improveDiff,
    improveBaseDesign,
    changeSummary: row.changeSummary ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getDashboardRecommendationsByRunId(
  runId: string,
): Promise<DashboardRecommendation[]> {
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeDashboardRecommendation.findMany({
      where: { runId },
      orderBy: { widgetCount: "desc" },
    });
    return rows.map(dbRowToRecommendation);
  });
}

// ---------------------------------------------------------------------------
// Write (bulk upsert -- called from pipeline step)
// ---------------------------------------------------------------------------

export async function saveDashboardRecommendations(
  runId: string,
  recommendations: DashboardRecommendation[],
  replaceDomains?: string[],
  ownerEmail?: string | null,
): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.$transaction(
      async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
        if (replaceDomains?.length) {
          await tx.forgeDashboardRecommendation.deleteMany({
            where: { runId, domain: { in: replaceDomains } },
          });
        } else {
          await tx.forgeDashboardRecommendation.deleteMany({ where: { runId } });
        }

        if (recommendations.length === 0) return;

        await tx.forgeDashboardRecommendation.createMany({
          data: recommendations.map((rec) => {
            const id = `${runId}_dash_${rec.domain.toLowerCase().replace(/\s+/g, "_")}`;
            return {
              id,
              runId,
              domain: rec.domain,
              subdomains: JSON.stringify(rec.subdomains),
              title: rec.title,
              description: rec.description,
              datasetCount: rec.datasetCount,
              widgetCount: rec.widgetCount,
              useCaseIds: JSON.stringify(rec.useCaseIds),
              serializedDashboard: rec.serializedDashboard,
              dashboardDesign: JSON.stringify({
                ...rec.dashboardDesign,
                datasetSourceKind: rec.datasetSourceKind,
              }),
              designVersion: rec.designVersion ?? rec.dashboardDesign.version,
              recommendationType:
                rec.classification === "reuse" ||
                rec.classification === "improve" ||
                rec.classification === "new"
                  ? toPersistedDashboardRecommendationType(rec.classification)
                  : (rec.recommendationType ?? "new"),
              existingAssetId: rec.existingAssetId ?? null,
              improveDiffJson: rec.improveDiff ? JSON.stringify(rec.improveDiff) : null,
              improveBaseJson: rec.improveBaseDesign ? JSON.stringify(rec.improveBaseDesign) : null,
              changeSummary: rec.changeSummary ?? null,
              ownerEmail: ownerEmail ?? null,
              datasetSourceKind: rec.datasetSourceKind,
              publicationStatus: rec.publicationStatus ?? null,
              publishedAt: rec.publishedAt ? new Date(rec.publishedAt) : null,
              validationStatus: rec.validationStatus ?? "pending",
              validatorVersion: rec.validatorVersion ?? null,
              validationEvidenceJson: rec.validationEvidence
                ? JSON.stringify(compactValidationEvidence(rec.validationEvidence))
                : null,
              validatedAt: rec.validatedAt ? new Date(rec.validatedAt) : null,
            };
          }),
        });
      },
    );
  });
}

export async function updateDashboardRecommendationPublication(
  runId: string,
  domain: string,
  input: {
    publicationStatus: "draft" | "published" | "publish_failed";
    publishedAt?: Date | null;
    readBackEvidence: ValidationEvidence[];
  },
): Promise<void> {
  if (input.publicationStatus === "published" && !input.publishedAt) {
    throw new Error("Published dashboard persistence requires an observed publishedAt");
  }
  await withPrisma(async (prisma) => {
    const current = await prisma.forgeDashboardRecommendation.findUnique({
      where: { runId_domain: { runId, domain } },
      select: { validationEvidenceJson: true },
    });
    let existingEvidence: ValidationEvidence[] = [];
    try {
      existingEvidence = current?.validationEvidenceJson
        ? (JSON.parse(current.validationEvidenceJson) as ValidationEvidence[])
        : [];
    } catch {
      existingEvidence = [];
    }
    const evidenceByIdentity = new Map<string, ValidationEvidence>();
    for (const item of [...existingEvidence, ...input.readBackEvidence]) {
      evidenceByIdentity.set(
        `${item.stage}\u0000${item.code}\u0000${item.artifactRef ?? ""}`,
        item,
      );
    }

    await prisma.forgeDashboardRecommendation.updateMany({
      where: { runId, domain },
      data: {
        publicationStatus: input.publicationStatus,
        publishedAt: input.publicationStatus === "published" ? input.publishedAt : null,
        validationEvidenceJson: JSON.stringify(
          compactValidationEvidence([...evidenceByIdentity.values()]),
        ),
      },
    });
  });
}
