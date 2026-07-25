import { describe, expect, it } from "vitest";
import {
  buildEstateProgramCreatePayload,
  buildEstateScopeCreateInputs,
} from "@/lib/domain/estate-program-form";
import {
  MAX_ESTATE_DESCRIPTION_LENGTH,
  MAX_ESTATE_NAME_LENGTH,
  MAX_ORG_CONTEXT_LENGTH,
  normalizeEstateProgramInput,
} from "@/lib/domain/estate-program-input";

describe("estate program form payload helpers", () => {
  it("includes optional sub-vertical and organisation context in program creation", () => {
    expect(
      buildEstateProgramCreatePayload({
        name: "NOC estate",
        description: "National estate",
        industryId: "oil-gas-noc",
        subVertical: "National Oil Company",
        orgContext: "State-owned integrated energy operator",
      }),
    ).toEqual({
      name: "NOC estate",
      description: "National estate",
      industryId: "oil-gas-noc",
      subVertical: "National Oil Company",
      orgContext: "State-owned integrated energy operator",
    });
  });

  it("applies optional advanced scope fields to every selected UC scope", () => {
    const result = buildEstateScopeCreateInputs(
      ["energy.upstream", "energy.downstream"],
      {
        inclusionPatterns: "fact_*, dim_*",
        workspaceId: "123456789",
        teamLabel: "Energy Data",
      },
    );

    expect(result.ok).toBe(true);
    expect(result.scopes).toEqual([
      {
        label: "energy.upstream",
        ucMetadata: "energy.upstream",
        inclusionPatterns: "fact_*, dim_*",
        workspaceId: "123456789",
        teamLabel: "Energy Data",
      },
      {
        label: "energy.downstream",
        ucMetadata: "energy.downstream",
        inclusionPatterns: "fact_*, dim_*",
        workspaceId: "123456789",
        teamLabel: "Energy Data",
      },
    ]);
  });

  it("rejects unsafe inclusion patterns before scope submission", () => {
    const result = buildEstateScopeCreateInputs(["energy.upstream"], {
      inclusionPatterns: "fact_$$$",
      workspaceId: "",
      teamLabel: "",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/pattern/i);
  });

  it("uses one bounded normalizer for create and patch payloads", () => {
    const isRegisteredIndustry = (id: string) => id === "oil-gas-noc";

    const create = normalizeEstateProgramInput(
      {
        name: "  NOC Estate  ",
        description: "  National estate  ",
        industryId: "oil-gas-noc",
        subVertical: "  National Oil Company  ",
        orgContext: "  State-owned operator  ",
      },
      { mode: "create", isRegisteredIndustry },
    );
    expect(create).toEqual({
      success: true,
      data: {
        name: "NOC Estate",
        description: "National estate",
        industryId: "oil-gas-noc",
        subVertical: "National Oil Company",
        orgContext: "State-owned operator",
      },
    });

    const patch = normalizeEstateProgramInput(
      { description: null, subVertical: null },
      { mode: "patch", isRegisteredIndustry },
    );
    expect(patch).toEqual({
      success: true,
      data: { description: null, subVertical: null },
    });
  });

  it("rejects invalid industry and oversized bounded fields", () => {
    const invalidIndustry = normalizeEstateProgramInput(
      { industryId: "made-up" },
      { mode: "patch", isRegisteredIndustry: () => false },
    );
    expect(invalidIndustry.success).toBe(false);

    const oversizedContext = normalizeEstateProgramInput(
      { orgContext: "x".repeat(MAX_ORG_CONTEXT_LENGTH + 1) },
      { mode: "patch", isRegisteredIndustry: () => true },
    );
    expect(oversizedContext.success).toBe(false);

    const oversizedName = normalizeEstateProgramInput(
      { name: "x".repeat(MAX_ESTATE_NAME_LENGTH + 1) },
      { mode: "patch", isRegisteredIndustry: () => true },
    );
    expect(oversizedName.success).toBe(false);

    const oversizedDescription = normalizeEstateProgramInput(
      { description: "x".repeat(MAX_ESTATE_DESCRIPTION_LENGTH + 1) },
      { mode: "patch", isRegisteredIndustry: () => true },
    );
    expect(oversizedDescription.success).toBe(false);
  });
});
