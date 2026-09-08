import { randomUUID } from "node:crypto";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { expect, test } from "./fixtures.mjs";

for (const viewport of [{ width: 320, height: 760 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
test(`home recovers a deleted cached trip at ${viewport.width}`, async ({ page, request }, testInfo) => {
  await page.setViewportSize(viewport);
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
  const slug = `cache-recovery-${randomUUID()}`;
  const original = (await (await request.get("/api/trips")).json()).trips;
  try {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
    const created = await request.post("/api/trips", { data: {
      slug, title: "Disposable cache regression", startDate: today, endDate: today, timezone: "Asia/Tokyo", location: "Test",
    } });
    expect(created.status()).toBe(201);
    // Warm only the list, leaving the selected itinerary uncached. This is
    // exactly what two local Next servers sharing a test database can produce.
    await expect.poll(async () => (await (await request.get("/api/trips")).json()).trips.some((trip) => trip.slug === slug)).toBe(true);
    await page.goto(`/?trip=${original[0].slug}`);
    await expect(page.getByRole("combobox", { name: "Chọn chuyến đi" }).locator(`option[value="${slug}"]`)).toHaveCount(1);
    await page.goto(`/admin/trips?trip=${slug}`);
    await expect(page.locator(".plan-summary .plan-slug")).toHaveText(slug);
    await sql`DELETE FROM trips WHERE slug=${slug}`;
    const adminResponse = await page.goto(`/admin/trips?trip=${slug}`);
    expect(adminResponse.status()).toBe(200);
    await expect(page.locator(".plan-summary .plan-slug")).not.toHaveText(slug);
    await expect(page.locator(".trip-list-item code").filter({ hasText: slug })).toHaveCount(0);
    const response = await page.goto("/");
    expect(response.status()).toBe(200);
    await expect(page.getByRole("combobox", { name: "Chọn chuyến đi" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Chọn chuyến đi" })).not.toHaveValue(slug);
    await expect(page.getByText(/Trip not found:/)).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Chọn chuyến đi" }).locator(`option[value="${slug}"]`)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("recovered-tracker.png") });
    // Exercise the integration after recovery, not merely the HTTP status.
    const selected = await page.getByRole("combobox", { name: "Chọn chuyến đi" }).inputValue();
    await page.getByRole("button", { name: /^Trợ lý/ }).click();
    await expect(page.getByRole("textbox", { name: "Yêu cầu cho trợ lý" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Thêm chuyến đi này", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Chọn chuyến đi", includeHidden: true })).toHaveValue(selected);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    await page.screenshot({ path: testInfo.outputPath("recovered-companion.png") });
    await page.getByRole("button", { name: "Lịch sử", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Lịch sử trò chuyện" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("recovered-history.png") });
  } finally {
    await sql`DELETE FROM trips WHERE slug=${slug}`;
    if (original[0]) await request.patch(`/api/trips/${original[0].slug}`, { data: { title: original[0].title } });
    await sql.end();
  }
});
}
