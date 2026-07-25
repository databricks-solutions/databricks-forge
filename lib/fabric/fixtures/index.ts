/**
 * Fixture loader for Fabric/PBI API responses.
 *
 * When FABRIC_USE_FIXTURES=true, the scan orchestrator uses these
 * fixtures instead of calling the real Fabric API. This allows
 * local development and CI testing without a live PBI tenant.
 */

export { MOCK_ADMIN_SCAN_RESULT, MOCK_WORKSPACES } from "./admin-scan-result";

export function shouldUseFixtures(): boolean {
  return process.env.FABRIC_USE_FIXTURES === "true";
}
