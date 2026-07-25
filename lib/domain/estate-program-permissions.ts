/**
 * Estate-program UI capability model.
 *
 * The API is authoritative (every mutating route is `edit`-guarded and delete
 * is owner-only), but the client must not even render controls a caller cannot
 * use. This pure mapping turns the caller `permission` echoed by the GET /
 * aggregate responses into a small capability set the UI branches on.
 *
 * Fail-closed: any unknown/absent permission collapses to view-only.
 */

export type EstateProgramPermission = "owner" | "edit" | "view";

export interface EstateProgramCapabilities {
  /** Rename/update program metadata. */
  canEdit: boolean;
  /** Add or remove scan scopes. */
  canManageScopes: boolean;
  /** Run / pause / resume / cancel / retry the scan sequence. */
  canRunSequence: boolean;
  /** Delete the whole program (owner only). */
  canDelete: boolean;
}

export function estateProgramCapabilities(
  permission: string | null | undefined,
): EstateProgramCapabilities {
  const isOwner = permission === "owner";
  const canMutate = isOwner || permission === "edit";
  return {
    canEdit: canMutate,
    canManageScopes: canMutate,
    canRunSequence: canMutate,
    canDelete: isOwner,
  };
}
