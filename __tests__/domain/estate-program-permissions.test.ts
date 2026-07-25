/**
 * Task 7 Req2: map a caller's estate-program permission to UI capabilities.
 *
 * View-only recipients must not see or activate any mutating control
 * (add/remove scope, run/pause/resume/cancel/retry, delete, update). Owners and
 * edit-share recipients may mutate; only the owner may delete. Read tabs and
 * exports are always available and are NOT gated here.
 */

import { describe, expect, it } from "vitest";
import { estateProgramCapabilities } from "@/lib/domain/estate-program-permissions";

describe("estateProgramCapabilities", () => {
  it("grants full control to the owner", () => {
    const c = estateProgramCapabilities("owner");
    expect(c).toEqual({
      canEdit: true,
      canManageScopes: true,
      canRunSequence: true,
      canDelete: true,
    });
  });

  it("grants edit-share recipients everything except delete", () => {
    const c = estateProgramCapabilities("edit");
    expect(c.canEdit).toBe(true);
    expect(c.canManageScopes).toBe(true);
    expect(c.canRunSequence).toBe(true);
    expect(c.canDelete).toBe(false);
  });

  it("grants view-only recipients nothing mutating", () => {
    const c = estateProgramCapabilities("view");
    expect(c).toEqual({
      canEdit: false,
      canManageScopes: false,
      canRunSequence: false,
      canDelete: false,
    });
  });

  it("defaults an unknown/absent permission to view-only (fail closed)", () => {
    const c = estateProgramCapabilities(undefined);
    expect(c.canEdit).toBe(false);
    expect(c.canDelete).toBe(false);
    expect(estateProgramCapabilities("nonsense" as never).canEdit).toBe(false);
  });
});
