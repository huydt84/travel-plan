import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      name: "fake-resend",
      command: "node tests/e2e/fake-resend-server.mjs",
      url: "http://127.0.0.1:3101/health",
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        FAKE_RESEND_API_KEY: "e2e-test-key",
      },
    },
    {
      name: "next",
      command: "next dev --hostname 127.0.0.1 --port 3100",
      url: baseURL,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        LOCAL_ADMIN_BYPASS: "true",
        NEXT_DIST_DIR: ".next-playwright",
        NEXT_TELEMETRY_DISABLED: "1",
        FORCE_COLOR: "",
        NO_COLOR: "",
        RESEND_API_ENDPOINT: "http://127.0.0.1:3101/emails",
        RESEND_API_KEY: "e2e-test-key",
      },
    },
  ],
});
