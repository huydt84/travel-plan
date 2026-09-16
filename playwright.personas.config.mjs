import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3110";

export default defineConfig({
  testDir: "./tests/personas-e2e",
  globalSetup: "./tests/personas-e2e/global-setup.mjs",
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
      name: "next-personas",
      command: "node scripts/dev-server.mjs --hostname 127.0.0.1 --port 3110",
      url: baseURL,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        LOCAL_ADMIN_BYPASS: "true",
        LOCAL_PERSONA_SWITCHER: "true",
        APP_URL: baseURL,
        NEXT_DIST_DIR: ".next-playwright",
        NEXT_TELEMETRY_DISABLED: "1",
      },
  },
});
