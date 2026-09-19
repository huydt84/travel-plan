import { expect, gotoHealthy, test } from "./fixtures.mjs";

for (const viewport of [
  { name: "phone", width: 320, height: 760 },
  { name: "macbook", width: 1440, height: 900 },
  { name: "dell", width: 1920, height: 1080 },
]) {
  test(`${viewport.name} switches trips in both directions without reloading`, async ({ page, request }) => {
    const trips = [
      { slug: `switch-new-${Date.now()}`, title: "Switch newer trip", date: "2020-08-29" },
      { slug: `switch-old-${Date.now()}`, title: "Switch older trip", date: "2020-08-15" },
    ];
    const created = [];
    try {
      for (const trip of trips) {
        expect((await request.post("/api/trips", { data: {
          slug: trip.slug, title: trip.title, startDate: trip.date, endDate: trip.date,
          timezone: "Asia/Tokyo", location: "Tokyo",
        } })).status()).toBe(201);
        created.push(trip.slug);
        expect((await request.post(`/api/trips/${trip.slug}/schedule`, { data: {
          startDate: trip.date, endDate: trip.date, start: "09:00", end: "10:00",
          type: "Visit", icon: "📍", title: `${trip.title} activity`, detail: "", refs: [], branchId: null,
        } })).status()).toBe(201);
      }
      await page.setViewportSize(viewport);
      await gotoHealthy(page, `/?trip=${trips[0].slug}`);
      const assertTrip = async (trip) => {
        await expect(page.getByRole("combobox", { name: "Chọn chuyến đi" })).toHaveAttribute("data-trip-slug", trip.slug);
        await expect(page.getByRole("region", { name: `Lịch trình chi tiết ${trip.date}`, exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: `${trip.title} activity`, exact: true })).toBeVisible();
        await expect(page.getByRole("navigation", { name: "Chọn ngày trong chuyến đi" }).getByRole("button")).toHaveAttribute("aria-current", "date");
        await expect(page.getByRole("heading", { name: "Ngày này chưa có hoạt động", exact: true })).toHaveCount(0);
      };
      await assertTrip(trips[0]);
      for (const trip of [trips[1], trips[0], trips[1]]) {
        await page.getByRole("combobox", { name: "Chọn chuyến đi" }).click();
        await page.getByRole("option", { name: new RegExp(trip.title) }).click();
        await assertTrip(trip);
      }
      await page.goBack();
      await assertTrip(trips[0]);
      await page.goForward();
      await assertTrip(trips[1]);
    } finally {
      for (const slug of created) await request.delete(`/api/trips/${slug}`);
    }
  });
}
