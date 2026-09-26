import { expect, gotoHealthy, itineraryTest as test } from "./fixtures.mjs";

const installConnectivityState = async (page) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => window.__passiveRefreshVisibility || "visible",
    });
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => window.__passiveRefreshOnline !== false,
    });
  });
};

test("itinerary and notifications stay idle until a meaningful refresh trigger", async ({ page, tripSlug }) => {
  await installConnectivityState(page);
  await page.clock.install({ time: new Date("2026-09-19T00:00:00.000Z") });
  let itineraryRequests = 0, notificationRequests = 0;
  let itineraryInFlight = 0, notificationInFlight = 0;
  await page.route("**/api/itinerary?**", async (route) => {
    itineraryRequests++;
    itineraryInFlight++;
    try { await route.continue(); } finally { itineraryInFlight--; }
  });
  await page.route("**/api/notifications?**", async (route) => {
    notificationRequests++;
    notificationInFlight++;
    try { await route.continue(); } finally { notificationInFlight--; }
  });

  await gotoHealthy(page, `/?trip=${tripSlug}`);
  await expect.poll(() => notificationRequests).toBeGreaterThan(0);
  await page.getByRole("button", { name: /Mở thông báo/ }).click();
  await expect(page.getByText("Chưa có cập nhật", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => itineraryInFlight + notificationInFlight).toBe(0);
  const startup = { itinerary: itineraryRequests, notifications: notificationRequests };

  await page.clock.fastForward(5 * 60_000);
  expect(itineraryRequests).toBe(startup.itinerary);
  expect(notificationRequests).toBe(startup.notifications);

  await page.evaluate(() => {
    window.__passiveRefreshVisibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(itineraryRequests).toBe(startup.itinerary);
  expect(notificationRequests).toBe(startup.notifications);

  await page.evaluate(() => {
    window.__passiveRefreshVisibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => itineraryRequests).toBe(startup.itinerary + 1);
  await expect.poll(() => notificationRequests).toBe(startup.notifications + 1);

  await page.evaluate(() => {
    window.__passiveRefreshOnline = false;
    window.dispatchEvent(new Event("offline"));
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(itineraryRequests).toBe(startup.itinerary + 1);
  expect(notificationRequests).toBe(startup.notifications + 1);

  await page.evaluate(() => {
    window.__passiveRefreshOnline = true;
    window.dispatchEvent(new Event("online"));
  });
  await expect.poll(() => itineraryRequests).toBe(startup.itinerary + 2);
  await expect.poll(() => notificationRequests).toBe(startup.notifications + 2);

  await page.getByRole("button", { name: /Mở thông báo/ }).click();
  await expect.poll(() => notificationRequests).toBe(startup.notifications + 3);
  expect(itineraryRequests).toBe(startup.itinerary + 2);
});

test("focus refreshes never overlap for itinerary or notifications", async ({ page, tripSlug }) => {
  await installConnectivityState(page);
  let delay = false, itineraryInFlight = 0, notificationInFlight = 0;
  let maximumItineraryInFlight = 0, maximumNotificationInFlight = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/itinerary?**", async (route) => {
    if (delay) {
      itineraryInFlight++;
      maximumItineraryInFlight = Math.max(maximumItineraryInFlight, itineraryInFlight);
      await gate;
      itineraryInFlight--;
    }
    await route.continue();
  });
  await page.route("**/api/notifications?**", async (route) => {
    if (delay) {
      notificationInFlight++;
      maximumNotificationInFlight = Math.max(maximumNotificationInFlight, notificationInFlight);
      await gate;
      notificationInFlight--;
    }
    await route.continue();
  });

  await gotoHealthy(page, `/?trip=${tripSlug}`);
  await page.getByRole("button", { name: /Mở thông báo/ }).click();
  await expect(page.getByText("Chưa có cập nhật", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  delay = true;
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
  });
  await expect.poll(() => itineraryInFlight).toBe(1);
  await expect.poll(() => notificationInFlight).toBe(1);
  expect(maximumItineraryInFlight).toBe(1);
  expect(maximumNotificationInFlight).toBe(1);
  release();
});
