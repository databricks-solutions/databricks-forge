/**
 * Pure interpreter for the `/configure?fromScan=<uuid>` source-scan flow.
 *
 * Turns the raw HTTP result of the guarded scan-summary endpoint into an
 * explicit UI state. Kept pure (no React, no fetch) so the branch logic —
 * unauthorized / missing / incomplete / ready — is unit-testable and the
 * configure page NEVER silently falls back to live extraction on an error.
 */

export interface ScanSummaryResponse {
  scanId: string;
  ucPath: string;
  tableCount: number;
  scanStatus: string | null;
  complete: boolean;
  hasDetails: boolean;
}

export type SourceScanState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "ready"; scanId: string; ucPath: string; tableCount: number }
  | { status: "unauthorized"; message: string }
  | { status: "missing"; message: string }
  | { status: "incomplete"; message: string }
  | { status: "error"; message: string };

function isSummary(body: unknown): body is ScanSummaryResponse {
  return (
    !!body &&
    typeof body === "object" &&
    typeof (body as Record<string, unknown>).ucPath === "string" &&
    typeof (body as Record<string, unknown>).scanId === "string"
  );
}

/**
 * Map an HTTP status + parsed body from `GET /api/environment/[scanId]/summary`
 * into an explicit source-scan UI state.
 */
export function interpretScanSummary(httpStatus: number, body: unknown): SourceScanState {
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      status: "unauthorized",
      message: "You do not have access to this estate scan. Ask the owner to share it, or start a live extraction instead.",
    };
  }
  if (httpStatus === 404) {
    return {
      status: "missing",
      message: "That estate scan no longer exists. Start a live extraction instead.",
    };
  }
  if (httpStatus === 200 && isSummary(body)) {
    if (!body.complete || !body.hasDetails) {
      return {
        status: "incomplete",
        message: "This estate scan has not finished. Wait for it to complete, or start a live extraction instead.",
      };
    }
    return {
      status: "ready",
      scanId: body.scanId,
      ucPath: body.ucPath,
      tableCount: body.tableCount,
    };
  }
  return {
    status: "error",
    message: "Could not load the estate scan. Start a live extraction instead.",
  };
}
