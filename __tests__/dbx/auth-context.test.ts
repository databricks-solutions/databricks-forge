import { describe, expect, it } from "vitest";
import { getDatabricksAuthContext, runWithDatabricksAuthContext } from "@/lib/dbx/auth-context";

describe("Databricks auth context", () => {
  it("survives awaits and nested async calls", async () => {
    await runWithDatabricksAuthContext({ oboToken: "obo-a" }, async () => {
      await Promise.resolve();

      const nested = async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return getDatabricksAuthContext();
      };

      await expect(nested()).resolves.toEqual({ oboToken: "obo-a" });
    });
  });

  it("does not leak outside its callback", async () => {
    await runWithDatabricksAuthContext({ oboToken: "obo-a" }, async () => {
      expect(getDatabricksAuthContext()?.oboToken).toBe("obo-a");
    });

    expect(getDatabricksAuthContext()).toBeNull();
  });

  it("isolates concurrent callbacks", async () => {
    let releaseA!: () => void;
    const waitForA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const a = runWithDatabricksAuthContext({ oboToken: "obo-a" }, async () => {
      await waitForA;
      return getDatabricksAuthContext()?.oboToken;
    });
    const b = runWithDatabricksAuthContext({ oboToken: "obo-b" }, async () => {
      await Promise.resolve();
      const token = getDatabricksAuthContext()?.oboToken;
      releaseA();
      return token;
    });

    await expect(Promise.all([a, b])).resolves.toEqual(["obo-a", "obo-b"]);
  });
});
