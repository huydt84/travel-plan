import { expect, gotoHealthy, test } from "./fixtures.mjs";

const runsRoute = "**/api/v1/assistant/runs";

test("idle assistant status performs one refresh without periodic polling", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-19T00:00:00.000Z") });
  let requests = 0;
  await page.route(runsRoute, async (route) => {
    requests++;
    await route.fulfill({ json: [] });
  });

  await gotoHealthy(page, "/");
  await expect.poll(() => requests).toBeGreaterThan(0);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const startupRequests = requests;
  await page.clock.fastForward(60_000);
  expect(requests).toBe(startupRequests);
});

test("active assistant status polls until the run becomes terminal", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-19T00:00:00.000Z") });
  let requests = 0, terminal = false;
  await page.route(runsRoute, async (route) => {
    requests++;
    await route.fulfill({ json: [{
      id: "00000000-0000-4000-8000-000000000001",
      conversationId: "00000000-0000-4000-8000-000000000002",
      tripSlug: null,
      status: terminal ? "completed" : "running",
      completedAt: terminal ? "2026-09-19T00:00:05.000Z" : null,
    }] });
  });

  await gotoHealthy(page, "/");
  await expect.poll(() => requests).toBeGreaterThan(0);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const startupRequests = requests;
  terminal = true;
  await page.clock.fastForward(5_000);
  await expect.poll(() => requests).toBe(startupRequests + 1);
  await page.clock.fastForward(30_000);
  expect(requests).toBe(startupRequests + 1);
});

test("assistant status pauses while hidden or offline and refreshes when restored", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => window.__assistantTestVisibility || "visible",
    });
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => window.__assistantTestOnline !== false,
    });
  });
  await page.clock.install({ time: new Date("2026-09-19T00:00:00.000Z") });
  let requests = 0;
  await page.route(runsRoute, async (route) => {
    requests++;
    await route.fulfill({ json: [{
      id: "00000000-0000-4000-8000-000000000011",
      conversationId: "00000000-0000-4000-8000-000000000012",
      tripSlug: null,
      status: "running",
      completedAt: null,
    }] });
  });

  await gotoHealthy(page, "/");
  await expect.poll(() => requests).toBeGreaterThan(0);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const startupRequests = requests;
  await page.evaluate(() => {
    window.__assistantTestVisibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(30_000);
  expect(requests).toBe(startupRequests);

  await page.evaluate(() => {
    window.__assistantTestVisibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => requests).toBe(startupRequests + 1);
  await page.evaluate(() => {
    window.__assistantTestOnline = false;
    window.dispatchEvent(new Event("offline"));
  });
  await page.clock.fastForward(30_000);
  expect(requests).toBe(startupRequests + 1);

  await page.evaluate(() => {
    window.__assistantTestOnline = true;
    window.dispatchEvent(new Event("online"));
  });
  await expect.poll(() => requests).toBe(startupRequests + 2);
});

test("assistant status never overlaps a slow refresh", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-19T00:00:00.000Z") });
  let requests = 0, delayedRequests = 0, inFlight = 0, maximumInFlight = 0, delay = false;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route(runsRoute, async (route) => {
    requests++;
    if (!delay) {
      await route.fulfill({ json: [{ id: "run", conversationId: "conversation", status: "running" }] });
      return;
    }
    delayedRequests++;
    inFlight++;
    maximumInFlight = Math.max(maximumInFlight, inFlight);
    await gate;
    inFlight--;
    await route.fulfill({ json: [{ id: "run", conversationId: "conversation", status: "running" }] });
  });

  await gotoHealthy(page, "/");
  await expect.poll(() => requests).toBeGreaterThan(0);
  await new Promise((resolve) => setTimeout(resolve, 100));
  delay = true;
  await page.clock.fastForward(5_000);
  await expect.poll(() => delayedRequests).toBe(1);
  await page.clock.fastForward(20_000);
  expect(delayedRequests).toBe(1);
  expect(maximumInFlight).toBe(1);
  release();
});

test("assistant status uses bounded retry delays after transient failures", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-19T00:00:00.000Z") });
  let requests = 0;
  await page.route(runsRoute, async (route) => {
    requests++;
    await route.fulfill({ contentType: "application/json", body: "{}" });
  });

  await gotoHealthy(page, "/");
  await expect.poll(() => requests).toBeGreaterThan(0);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const startupRequests = requests;
  await page.clock.fastForward(5_000);
  await expect.poll(() => requests).toBe(startupRequests + 1);
  await page.clock.fastForward(14_000);
  expect(requests).toBe(startupRequests + 1);
  await page.clock.fastForward(2_000);
  await expect.poll(() => requests).toBe(startupRequests + 2);
  await page.clock.fastForward(29_000);
  expect(requests).toBe(startupRequests + 2);
  await page.clock.fastForward(2_000);
  await expect.poll(() => requests).toBe(startupRequests + 3);
  await page.clock.fastForward(60_000);
  expect(requests).toBe(startupRequests + 3);
});

test("assistant lifecycle invalidation wakes an idle refresh", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-19T00:00:00.000Z") });
  let requests = 0;
  await page.route(runsRoute, async (route) => {
    requests++;
    await route.fulfill({ json: [] });
  });

  await gotoHealthy(page, "/");
  await expect.poll(() => requests).toBeGreaterThan(0);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const startupRequests = requests;
  await page.evaluate(() => window.dispatchEvent(new Event("assistant-runs-changed")));
  await expect.poll(() => requests).toBe(startupRequests + 1);
  await page.clock.fastForward(30_000);
  expect(requests).toBe(startupRequests + 1);
});
