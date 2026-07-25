/**
 * Fabric / Power BI feature gate.
 *
 * When `FORGE_FABRIC_ENABLED` is absent or not `"true"`, all Fabric and
 * Power BI migration features are hidden from the UI.  Set
 * `FORGE_FABRIC_ENABLED=true` (or pass `--enable-fabric` to deploy.sh)
 * to enable them.
 */
export function isFabricEnabled(): boolean {
  return process.env.FORGE_FABRIC_ENABLED === "true";
}
