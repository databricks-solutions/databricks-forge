import { describe, expect, it } from "vitest";

import { safeErrorMetadata } from "@/lib/logging/safe-error-metadata";

describe("safeErrorMetadata", () => {
  it("maps secret-shaped valid names and codes to generic safe metadata", () => {
    const error = new Error("private prompt");
    error.name = "BearerSecretToken";
    (error as Error & { code: string }).code = "PROMPT_SECRET_TOKEN";
    error.stack = [
      "BearerSecretToken: private prompt",
      "    at runDashboard (/workspace/lib/dashboard/engine.ts:812:17)",
    ].join("\n");

    const metadata = safeErrorMetadata(error, "Dashboard domain generation failed.");

    expect(metadata).toEqual({
      errorName: "Error",
      errorCategory: "runtime",
      safeSummary: "Dashboard domain generation failed.",
      location: "lib/dashboard/engine.ts:812:17",
    });
    expect(JSON.stringify(metadata)).not.toContain("BearerSecretToken");
    expect(JSON.stringify(metadata)).not.toContain("PROMPT_SECRET_TOKEN");
    expect(JSON.stringify(metadata)).not.toContain("private prompt");
  });

  it("preserves an allowlisted built-in TypeError and only its safe code location", () => {
    const error = new TypeError("SELECT secret");
    error.stack = [
      "TypeError: SELECT secret",
      "    at processDomain (/workspace/lib/dashboard/engine.ts:999:11)",
    ].join("\n");

    expect(safeErrorMetadata(error, "Dashboard domain generation failed.")).toEqual({
      errorName: "TypeError",
      errorCategory: "programming",
      safeSummary: "Dashboard domain generation failed.",
      location: "lib/dashboard/engine.ts:999:11",
    });
  });
});
