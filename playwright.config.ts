import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for Estate Programs (Task 7) browser E2E.
 *
 * These specs exercise the REAL rendered client routes/components but mock the
 * `/api/**` surface deterministically via `page.route`, so they run without a
 * live Databricks/Lakebase backend. The app is served by `next dev` (which only
 * touches the DB on API calls — all of which are intercepted).
 *
 * No screenshot/video/trace artifacts are captured by default so nothing
 * binary is produced or committed. Task 8 runs the full rollout in CI.
 */

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["line"], ["github"]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    screenshot: "off",
    video: "off",
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `PLAYWRIGHT_E2E=1 PORT=${PORT} FORGE_LOCAL_USER_EMAIL=e2e@example.com npm run dev`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
