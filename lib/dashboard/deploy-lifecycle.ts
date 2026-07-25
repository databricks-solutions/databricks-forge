import {
  createDashboard,
  DEFAULT_DASHBOARD_PARENT_PATH,
  getDashboard,
  getPublishedDashboard,
  publishDashboard,
  updateDashboard,
  type DashboardAuth,
} from "@/lib/dbx/dashboards";
import {
  evidenceFailed,
  evidencePassed,
  evidenceSkipped,
  type ValidationEvidence,
} from "@/lib/validation/evidence";
import { isDashboardDraftReadBackEnabled } from "@/lib/config/semantic-uplift-flags";
import {
  validateSerializedDashboard,
  type DashboardContractValidationMode,
} from "./contract-validator";
import { isDashboardScopeUnsupportedError } from "@/lib/dbx/dashboard-capability";
import type {
  LakeviewDashboardResponse,
  LakeviewPublishedDashboardResponse,
  SerializedLakeviewDashboard,
} from "./types";

export interface DeployDashboardOptions {
  mode: "create" | "update";
  dashboardId?: string;
  displayName: string;
  serializedDashboard: string;
  warehouseId: string;
  parentPath?: string;
  publish: boolean;
  embedCredentials?: boolean;
  auth: DashboardAuth;
  contractValidation?: DashboardContractValidationMode;
}

export interface DeployDashboardResult {
  dashboardId: string;
  displayName: string;
  action: "created" | "updated";
  publicationStatus: "draft" | "published" | "publish_failed";
  readBack: {
    datasetCount: number;
    widgetCount: number;
    contractOk: boolean;
  };
  evidence: ValidationEvidence[];
  publishError?: string;
  publishedAt?: string;
}

export interface DashboardDeployDependencies {
  createDashboard: (options: {
    displayName: string;
    serializedDashboard: string;
    warehouseId: string;
    parentPath?: string;
    auth: DashboardAuth;
  }) => Promise<LakeviewDashboardResponse>;
  updateDashboard: (
    dashboardId: string,
    options: {
      displayName?: string;
      serializedDashboard?: string;
      warehouseId?: string;
      auth: DashboardAuth;
    },
  ) => Promise<LakeviewDashboardResponse>;
  getDashboard: (dashboardId: string, auth: DashboardAuth) => Promise<LakeviewDashboardResponse>;
  publishDashboard: (
    dashboardId: string,
    warehouseId: string,
    embedCredentials: boolean,
    auth: DashboardAuth,
  ) => Promise<void>;
  getPublishedDashboard: (
    dashboardId: string,
    auth: DashboardAuth,
  ) => Promise<LakeviewPublishedDashboardResponse | null>;
}

export const dashboardDeployDependencies: DashboardDeployDependencies = {
  createDashboard,
  updateDashboard,
  getDashboard,
  publishDashboard,
  getPublishedDashboard,
};

export class DashboardReadBackValidationError extends Error {
  readonly dashboardId: string;
  readonly expectedDashboardId?: string;
  readonly observedDashboardId?: string;
  readonly displayName: string;
  readonly evidence: ValidationEvidence[];

  constructor(
    dashboardId: string,
    displayName: string,
    message: string,
    evidence: ValidationEvidence[],
    identity?: {
      expectedDashboardId?: string;
      observedDashboardId?: string;
    },
  ) {
    super(message);
    this.name = "DashboardReadBackValidationError";
    this.dashboardId = dashboardId;
    this.expectedDashboardId = identity?.expectedDashboardId;
    this.observedDashboardId = identity?.observedDashboardId;
    this.displayName = displayName;
    this.evidence = evidence;
  }
}

export class DashboardScopeUnsupportedError extends DashboardReadBackValidationError {
  readonly code = "DASHBOARD_OBO_SCOPE_UNSUPPORTED";
  readonly requiredScope = "dashboards";
  readonly draftCreated = true;
  readonly publicationStatus = "draft";

  constructor(dashboardId: string, displayName: string, evidence: ValidationEvidence[]) {
    super(
      dashboardId,
      displayName,
      "Lakeview draft was created, but Apps OBO cannot read or publish it because the required dashboards scope is unavailable.",
      evidence,
    );
    this.name = "DashboardScopeUnsupportedError";
  }
}

export class DashboardDraftReadBackDisabledError extends Error {
  readonly code = "DASHBOARD_DRAFT_READBACK_DISABLED";

  constructor(message: string) {
    super(message);
    this.name = "DashboardDraftReadBackDisabledError";
  }
}

export class DashboardMutationUntrackableError extends Error {
  readonly code = "DASHBOARD_MUTATION_OBSERVED_UNTRACKABLE";
  readonly mutationObserved = true;
  readonly trackable = false;

  constructor(message: string) {
    super(message);
    this.name = "DashboardMutationUntrackableError";
  }
}

/**
 * Raised when a serialized dashboard payload is not a structurally usable
 * Lakeview object. Unparseable text, `null`, JSON primitives, and arrays all
 * surface here as coded contract evidence instead of an incidental `TypeError`
 * from property access on a non-object.
 */
export class DashboardSerializationContractError extends Error {
  readonly code = "DASHBOARD_SERIALIZATION_INVALID";
  readonly evidence: ValidationEvidence[];

  constructor(reason: string) {
    super(`DASHBOARD_SERIALIZATION_INVALID: ${reason}`);
    this.name = "DashboardSerializationContractError";
    this.evidence = [
      evidenceFailed("dashboard_contract", "DASHBOARD_SERIALIZATION_INVALID", this.message),
    ];
  }
}

function parseSerializedDashboard(value: string): SerializedLakeviewDashboard {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    throw new DashboardSerializationContractError(
      `Serialized dashboard is not valid JSON (${failureMessage(error)})`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new DashboardSerializationContractError(
      "Serialized dashboard must be a JSON object with datasets and pages arrays",
    );
  }
  const dashboard = parsed as Partial<SerializedLakeviewDashboard>;
  if (!Array.isArray(dashboard.datasets) || !Array.isArray(dashboard.pages)) {
    throw new DashboardSerializationContractError(
      "Serialized dashboard must contain datasets and pages arrays",
    );
  }
  for (const page of dashboard.pages) {
    if (!page || typeof page !== "object" || !Array.isArray(page.layout)) {
      throw new DashboardSerializationContractError(
        "Serialized dashboard pages must contain layout arrays",
      );
    }
  }
  return dashboard as SerializedLakeviewDashboard;
}

function counts(dashboard: SerializedLakeviewDashboard): {
  datasetCount: number;
  widgetCount: number;
} {
  return {
    datasetCount: dashboard.datasets.length,
    widgetCount: dashboard.pages.reduce((total, page) => total + page.layout.length, 0),
  };
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeWorkspacePath(value: string): string {
  let normalized = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  if (normalized === "/Workspace") return "/";
  if (normalized.startsWith("/Workspace/")) {
    normalized = normalized.slice("/Workspace".length);
  }
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

function parentFromDashboardPath(value: string): string {
  const normalized = normalizeWorkspacePath(value);
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) return "/";
  return normalized.slice(0, lastSlash);
}

export async function deployDashboardDraftAndVerify(
  options: DeployDashboardOptions,
  deps: DashboardDeployDependencies = dashboardDeployDependencies,
): Promise<DeployDashboardResult> {
  if (!options.auth) {
    throw new Error("An explicit dashboard auth mode is required for deployment");
  }
  if (options.auth.mode === "user" && !options.auth.oboToken) {
    throw new Error("An OBO token is required for user-owned dashboard deployment");
  }
  if (options.mode === "update" && !options.dashboardId) {
    throw new Error("dashboardId is required for update mode");
  }

  const expectedDashboard = parseSerializedDashboard(options.serializedDashboard);
  const expectedCounts = counts(expectedDashboard);
  const contractValidation = options.contractValidation ?? { mode: "forge-assembled" };
  const expectedContract = validateSerializedDashboard(expectedDashboard, contractValidation);
  if (!expectedContract.valid) {
    throw new Error(
      `Dashboard failed mandatory contract validation: ${expectedContract.errors
        .map((item) => item.code)
        .join(", ")}`,
    );
  }
  const readBackEnabled = isDashboardDraftReadBackEnabled();
  if (!readBackEnabled && options.publish) {
    throw new DashboardDraftReadBackDisabledError(
      "Dashboard publication requires FORGE_DASHBOARD_DRAFT_READBACK=true; direct publication is disabled.",
    );
  }
  const draft =
    options.mode === "create"
      ? await deps.createDashboard({
          displayName: options.displayName,
          serializedDashboard: options.serializedDashboard,
          warehouseId: options.warehouseId,
          parentPath: options.parentPath,
          auth: options.auth,
        })
      : await deps.updateDashboard(options.dashboardId!, {
          displayName: options.displayName,
          serializedDashboard: options.serializedDashboard,
          warehouseId: options.warehouseId,
          auth: options.auth,
        });

  const observedDashboardId = draft.dashboard_id;
  const expectedDashboardId = options.mode === "update" ? options.dashboardId : undefined;
  if (!observedDashboardId && !expectedDashboardId) {
    throw new DashboardMutationUntrackableError(
      "Dashboard mutation was observed, but its response did not contain dashboard_id.",
    );
  }
  const dashboardId = expectedDashboardId ?? observedDashboardId!;
  const observedDisplayName = draft.display_name ?? options.displayName;
  const mutationResponseProblem = !observedDashboardId
    ? "Dashboard update mutation response did not contain dashboard_id"
    : !draft.display_name
      ? "Dashboard mutation response did not contain display_name"
      : options.mode === "update" && observedDashboardId !== expectedDashboardId
        ? `Updated dashboard ID "${observedDashboardId}" does not match expected "${expectedDashboardId}"`
        : options.mode === "update" && draft.display_name !== options.displayName
          ? `Updated display name "${draft.display_name}" does not match requested "${options.displayName}"`
          : null;
  if (mutationResponseProblem) {
    throw new DashboardReadBackValidationError(
      dashboardId,
      observedDisplayName,
      mutationResponseProblem,
      [
        evidenceFailed(
          "dashboard_read_back",
          "DASHBOARD_MUTATION_RESPONSE_INVALID",
          mutationResponseProblem,
          { artifactRef: `dashboard:${dashboardId}` },
        ),
      ],
      {
        expectedDashboardId,
        observedDashboardId,
      },
    );
  }
  const expectedDisplayName = options.mode === "create" ? observedDisplayName : options.displayName;
  const action = options.mode === "create" ? "created" : "updated";
  const evidence: ValidationEvidence[] = readBackEnabled ? [] : [...expectedContract.evidence];
  if (!readBackEnabled) {
    evidence.push(
      evidenceSkipped(
        "dashboard_read_back",
        "DASHBOARD_READ_BACK_ROLLOUT_DISABLED",
        "Draft read-back is disabled by rollout flag; the dashboard remains an unpublished draft.",
      ),
    );
    return {
      dashboardId,
      displayName: expectedDisplayName,
      action,
      publicationStatus: "draft",
      readBack: {
        ...expectedCounts,
        contractOk: false,
      },
      evidence,
    };
  }
  let readBackDashboard: SerializedLakeviewDashboard;

  try {
    const readBack = await deps.getDashboard(dashboardId, options.auth);
    if (!readBack.dashboard_id) {
      throw new Error("Read-back response did not contain dashboard_id");
    }
    if (readBack.dashboard_id !== dashboardId) {
      throw new Error(
        `Read-back dashboard ID "${readBack.dashboard_id}" does not match draft "${dashboardId}"`,
      );
    }
    if (!readBack.display_name) {
      throw new Error("Read-back response did not contain display_name");
    }
    if (readBack.display_name !== expectedDisplayName) {
      throw new Error(
        `Read-back display name "${readBack.display_name}" does not match expected "${expectedDisplayName}"`,
      );
    }
    if (!readBack.warehouse_id) {
      throw new Error("Read-back response did not contain warehouse_id");
    }
    if (readBack.warehouse_id !== options.warehouseId) {
      throw new Error(
        `Read-back warehouse "${readBack.warehouse_id}" does not match expected "${options.warehouseId}"`,
      );
    }
    const expectedParentPath = normalizeWorkspacePath(
      options.parentPath ?? DEFAULT_DASHBOARD_PARENT_PATH,
    );
    if (!readBack.parent_path && !readBack.path) {
      throw new Error("Read-back response did not contain parent_path or path");
    }
    const observedParents = [
      readBack.parent_path ? normalizeWorkspacePath(readBack.parent_path) : null,
      readBack.path ? parentFromDashboardPath(readBack.path) : null,
    ].filter((value): value is string => value !== null);
    if (observedParents.some((value) => value !== expectedParentPath)) {
      throw new Error(
        `Read-back destination "${observedParents.join(
          ", ",
        )}" does not match expected parent "${expectedParentPath}"`,
      );
    }
    if (!readBack.serialized_dashboard) {
      throw new Error("Read-back response did not contain serialized_dashboard");
    }

    readBackDashboard = parseSerializedDashboard(readBack.serialized_dashboard);
    const readBackCounts = counts(readBackDashboard);
    if (
      readBackCounts.datasetCount !== expectedCounts.datasetCount ||
      readBackCounts.widgetCount !== expectedCounts.widgetCount
    ) {
      throw new Error(
        `Read-back counts ${readBackCounts.datasetCount}/${readBackCounts.widgetCount} do not match expected ${expectedCounts.datasetCount}/${expectedCounts.widgetCount}`,
      );
    }

    const contract = validateSerializedDashboard(readBackDashboard, contractValidation);
    evidence.push(...contract.evidence);
    if (!contract.valid) {
      throw new Error(
        `Read-back dashboard failed contract validation: ${contract.errors
          .map((item) => item.code)
          .join(", ")}`,
      );
    }
    evidence.push(
      evidencePassed(
        "dashboard_read_back",
        "DASHBOARD_READ_BACK_VERIFIED",
        "Draft identity, counts, and serialized dashboard contract were verified.",
      ),
    );
  } catch (error) {
    if (options.auth.mode === "user" && isDashboardScopeUnsupportedError(error)) {
      evidence.push(
        evidenceFailed(
          "dashboard_read_back",
          "DASHBOARD_OBO_SCOPE_UNSUPPORTED",
          "Lakeview draft read-back requires the dashboards scope, which Databricks Apps does not issue in this workspace.",
          { artifactRef: `dashboard:${dashboardId}` },
        ),
      );
      throw new DashboardScopeUnsupportedError(dashboardId, expectedDisplayName, evidence);
    }
    if (!evidence.some((item) => item.status === "failed")) {
      evidence.push(
        evidenceFailed("dashboard_read_back", "DASHBOARD_READ_BACK_FAILED", failureMessage(error)),
      );
    }
    throw new DashboardReadBackValidationError(
      dashboardId,
      expectedDisplayName,
      `Dashboard draft read-back validation failed: ${failureMessage(error)}`,
      evidence,
    );
  }

  const readBack = {
    ...expectedCounts,
    contractOk: true,
  };
  if (!options.publish) {
    return {
      dashboardId,
      displayName: expectedDisplayName,
      action,
      publicationStatus: "draft",
      readBack,
      evidence,
    };
  }

  try {
    await deps.publishDashboard(
      dashboardId,
      options.warehouseId,
      options.embedCredentials ?? false,
      options.auth,
    );
    const published = await deps.getPublishedDashboard(dashboardId, options.auth);
    if (!published) {
      throw new Error("Published dashboard state is missing");
    }
    if (published.dashboard_id !== dashboardId) {
      throw new Error(
        `Published dashboard ID "${published.dashboard_id}" does not match draft "${dashboardId}"`,
      );
    }
    if (published.display_name !== expectedDisplayName) {
      throw new Error(
        `Published display name "${String(
          published.display_name,
        )}" does not match expected "${expectedDisplayName}"`,
      );
    }
    if (published.warehouse_id !== options.warehouseId) {
      throw new Error(
        `Published warehouse "${String(
          published.warehouse_id,
        )}" does not match expected "${options.warehouseId}"`,
      );
    }
    if (published.embed_credentials !== (options.embedCredentials ?? false)) {
      throw new Error("Published embed_credentials does not match the requested value");
    }
    if (
      !published.revision_create_time ||
      !Number.isFinite(Date.parse(published.revision_create_time))
    ) {
      throw new Error("Published dashboard state does not contain a valid revision_create_time");
    }
    evidence.push(
      evidencePassed(
        "dashboard_publication",
        "DASHBOARD_PUBLICATION_VERIFIED",
        "Published dashboard state was observed and matched the verified draft.",
        { artifactRef: `dashboard:${dashboardId}` },
      ),
    );
    return {
      dashboardId,
      displayName: expectedDisplayName,
      action,
      publicationStatus: "published",
      readBack,
      evidence,
      publishedAt: published.revision_create_time,
    };
  } catch (error) {
    if (options.auth.mode === "user" && isDashboardScopeUnsupportedError(error)) {
      evidence.push(
        evidenceFailed(
          "dashboard_publication",
          "DASHBOARD_OBO_SCOPE_UNSUPPORTED",
          "Lakeview publication verification requires the dashboards scope, which Databricks Apps does not issue in this workspace.",
          { artifactRef: `dashboard:${dashboardId}` },
        ),
      );
      throw new DashboardScopeUnsupportedError(dashboardId, expectedDisplayName, evidence);
    }
    evidence.push(
      evidenceFailed(
        "dashboard_publication",
        "DASHBOARD_PUBLICATION_FAILED",
        failureMessage(error),
        { artifactRef: `dashboard:${dashboardId}` },
      ),
    );
    return {
      dashboardId,
      displayName: expectedDisplayName,
      action,
      publicationStatus: "publish_failed",
      readBack,
      evidence,
      publishError: failureMessage(error),
    };
  }
}
