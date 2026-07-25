import type { Page, Route } from "@playwright/test";

/**
 * Deterministic API mocking helpers for the Estate Programs E2E specs.
 *
 * Every spec intercepts `/api/**` so the real client routes/components render
 * against fixed fixtures with no live backend. Handlers are matched most-
 * specific-first; unmatched API calls fall through to an empty 200 so a stray
 * fetch never hangs the page.
 */

export function jsonRoute(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

export interface ProgramFixture {
  id: string;
  name: string;
  description?: string | null;
  industryId?: string | null;
  scopes: Array<Record<string, unknown>>;
  permission?: "owner" | "edit" | "view";
}

export function emptyAggregate() {
  return {
    details: [],
    insights: [],
    stats: {
      totalTables: 0,
      totalScans: 0,
      totalSizeBytes: "0",
      domainCount: 0,
      assetInventory: { models: 0, functions: 0, genieSpaces: 0, dashboards: 0, metricViews: 0 },
      metadataCoverage: {
        tablesWithCommentPct: 0,
        tablesWithOwnerPct: 0,
        tablesWithTierPct: 0,
        tablesWithDomainPct: 0,
      },
      coverageByScope: [],
    },
  };
}

/**
 * Install a baseline set of `/api/**` mocks. Individual specs can register
 * more-specific routes BEFORE calling this (Playwright matches last-registered
 * first) or pass overrides.
 */
export async function mockCommonApis(
  page: Page,
  opts: { programs?: ProgramFixture[]; portfolioAllowed?: boolean } = {},
) {
  const programs = opts.programs ?? [];

  // Register the catch-all FIRST so the more-specific routes below (registered
  // later) take priority — Playwright matches the most-recently-added route.
  await page.route("**/api/**", (r) => jsonRoute(r, {}));

  await page.route("**/api/portfolio/access", (r) =>
    jsonRoute(r, { enabled: true, allowed: opts.portfolioAllowed ?? false, canManage: false }),
  );
  await page.route("**/api/embeddings/status", (r) => jsonRoute(r, { enabled: false }));
  // Global SystemLoadBanner (rendered in the root layout) polls this on every
  // page; give it a fully-shaped calm snapshot so it never crashes the tree.
  await page.route("**/api/system-load", (r) =>
    jsonRoute(r, {
      active: { pipelineRuns: 0, scans: 0, genieDeploys: 0, demoEngines: 0, queued: 0 },
      llm: { totalInflight: 0, totalQueued: 0, perEndpoint: [], yourInflight: 0, yourQueued: 0 },
    }),
  );
  // useIndustryOutcomes fetches the registry and expects a raw array body.
  await page.route("**/api/outcome-maps/registry**", (r) => jsonRoute(r, []));
  await page.route("**/api/industries**", (r) => jsonRoute(r, []));
  await page.route("**/api/fabric/scan", (r) => jsonRoute(r, { scans: [] }));
  await page.route("**/api/search/suggestions**", (r) => jsonRoute(r, { suggestions: [] }));
  // State-of-the-Nation / Data Gap read these on the default Estate tab; a clean
  // 404 (no cached result) drives their empty state instead of crashing on {}.
  await page.route("**/api/environment/**/synthesis", (r) =>
    jsonRoute(r, { generated: false }, 404),
  );
  await page.route("**/api/environment/**/data-gap**", (r) =>
    jsonRoute(r, { generated: false }, 404),
  );

  // List programs
  await page.route("**/api/estate-programs", (r) => {
    if (r.request().method() === "POST") {
      return jsonRoute(r, { programId: "new-prog" }, 201);
    }
    return jsonRoute(
      r,
      { programs: programs.map((p) => ({ ...p, _count: { scopes: p.scopes.length, scans: 0 } })) },
    );
  });
}
