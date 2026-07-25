import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isPortfolioEnabled,
  orgAdminAllowlist,
  portfolioBootstrapAdmin,
  envOrgAdmins,
  isEnvOrgAdmin,
} from "@/lib/config/portfolio-flag";

const ENV_KEYS = [
  "FORGE_PORTFOLIO_ENABLED",
  "FORGE_ORG_ADMIN_EMAILS",
  "FORGE_PORTFOLIO_BOOTSTRAP_ADMIN",
  "LAKEBASE_BOOTSTRAP_USER",
] as const;

describe("portfolio-flag", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("defaults to enabled (opt-out kill switch)", () => {
    expect(isPortfolioEnabled()).toBe(true);
  });

  it("only an explicit falsey value disables", () => {
    for (const v of ["false", "0", "no", "off", "FALSE", " Off "]) {
      process.env.FORGE_PORTFOLIO_ENABLED = v;
      expect(isPortfolioEnabled()).toBe(false);
    }
    for (const v of ["true", "1", "yes", "on", ""]) {
      process.env.FORGE_PORTFOLIO_ENABLED = v;
      expect(isPortfolioEnabled()).toBe(true);
    }
  });

  it("parses and normalises the legacy allowlist", () => {
    process.env.FORGE_ORG_ADMIN_EMAILS = "Alice@X.com, bob@x.com; alice@x.com not-an-email";
    expect(orgAdminAllowlist().sort()).toEqual(["alice@x.com", "bob@x.com"]);
  });

  it("resolves the bootstrap admin from the dedicated var, then the lakebase user", () => {
    process.env.LAKEBASE_BOOTSTRAP_USER = "Deployer@X.com";
    expect(portfolioBootstrapAdmin()).toBe("deployer@x.com");

    process.env.FORGE_PORTFOLIO_BOOTSTRAP_ADMIN = "CDO@X.com";
    expect(portfolioBootstrapAdmin()).toBe("cdo@x.com");
  });

  it("unions the allowlist with the bootstrap admin for env admins", () => {
    process.env.FORGE_ORG_ADMIN_EMAILS = "a@x.com";
    process.env.FORGE_PORTFOLIO_BOOTSTRAP_ADMIN = "deployer@x.com";
    expect(envOrgAdmins().sort()).toEqual(["a@x.com", "deployer@x.com"]);

    expect(isEnvOrgAdmin("A@X.com")).toBe(true);
    expect(isEnvOrgAdmin("deployer@x.com")).toBe(true);
    expect(isEnvOrgAdmin("intruder@x.com")).toBe(false);
    expect(isEnvOrgAdmin(null)).toBe(false);
  });
});
