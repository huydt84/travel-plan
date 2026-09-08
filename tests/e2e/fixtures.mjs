import { expect, test as base } from "@playwright/test";
import { randomUUID } from "node:crypto";

export const test = base.extend({
  runtimeHealth: [async ({ page }, use) => {
    const failures = [];

    page.on("console", (message) => {
      if (message.type() === "error") failures.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
    page.on("response", (response) => {
      if (response.status() >= 500) failures.push(`http ${response.status()}: ${response.url()}`);
    });

    await use(failures);

    expect(failures, "browser runtime and same-app responses must stay healthy").toEqual([]);
  }, { auto: true }],
});

export { expect };

// Tests of activity UI must not depend on whichever (possibly empty) trip is
// selected by today's date, or mutate an itinerary left by another test.
export const itineraryTest = test.extend({
  tripSlug: async ({ request }, provideFixture) => {
    const slug = `itinerary-fixture-${randomUUID()}`;
    try {
      expect((await request.post("/api/trips", { data: { slug, title: "Fixture itinerary", startDate: "2030-04-01", endDate: "2030-04-01", timezone: "Asia/Tokyo", location: "Kyoto" } })).status()).toBe(201);
      expect((await request.post(`/api/trips/${slug}/schedule`, { data: { startDate: "2030-04-01", endDate: "2030-04-01", start: "09:00", end: "10:00", title: "Khám phá khu phố cổ và các điểm tham quan Kyoto", type: "Visit", icon: "📍", detail: "Fixture activity", refs: [] } })).status()).toBe(201);
      expect((await request.post(`/api/trips/${slug}/schedule`, { data: { startDate: "2030-04-01", endDate: "2030-04-01", start: "10:00", end: "11:00", title: "Second stop", type: "Visit", icon: "📍", detail: "", refs: [] } })).status()).toBe(201);
      await provideFixture(slug);
    } finally { await request.delete(`/api/trips/${slug}`); }
  },
});

export async function gotoHealthy(page, path) {
  const response = await page.goto(path);
  expect(response, `navigation to ${path} should return a response`).not.toBeNull();
  expect(response.status(), `navigation to ${path} should not be an HTTP error`).toBeLessThan(400);
  return response;
}
