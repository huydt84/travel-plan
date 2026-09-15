import { randomUUID } from "node:crypto";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { expect, gotoHealthy, test } from "./fixtures.mjs";

for (const [width, height] of [[320, 760], [1440, 900], [1920, 1080]]) test(`saved places are distinct from citations at ${width}`, async ({ page, request }, testInfo) => {
  const slug = `saved-place-layout-${randomUUID()}`;
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
  try {
    expect((await request.post("/api/trips", { data: { slug, title: "Saved place layout", startDate: "2030-04-01", endDate: "2030-04-01", timezone: "Asia/Tokyo", location: "Kyoto" } })).status()).toBe(201);
    expect((await request.post(`/api/trips/${slug}/sources`, { data: { title: "Official source", url: "https://example.com/official" } })).status()).toBe(201);
    expect((await request.post(`/api/trips/${slug}/schedule`, { data: { startDate: "2030-04-01", endDate: "2030-04-01", start: "09:00", end: "10:00", title: "Visit Kyoto", type: "Visit", icon: "📍", detail: "Fixture activity", refs: [1] } })).status()).toBe(201);
    const [trip] = await sql`SELECT id FROM trips WHERE slug=${slug}`;
    await sql`INSERT INTO saved_places(trip_id,name,address,latitude,longitude,website,google_place_id,notes)
      VALUES(${trip.id},'Kiyomizu-dera','Kyoto, Japan',34.9949,135.785,'https://example.com/place','fixture-place','Meet by the main gate')`;

    await page.setViewportSize({ width, height });
    await gotoHealthy(page, `/?trip=${slug}`);
    const places = page.getByRole("region", { name: "Địa điểm đã lưu" });
    const sources = page.getByRole("region", { name: "Nguồn tham khảo" });
    await expect(places).toBeVisible();
    await expect(sources).toBeVisible();
    const [placeBox, sourceBox] = await Promise.all([places.boundingBox(), sources.boundingBox()]);
    expect(placeBox.y).toBeLessThan(sourceBox.y);
    const [placeBackground, sourceBackground] = await Promise.all([
      places.evaluate((node) => getComputedStyle(node).backgroundColor),
      sources.evaluate((node) => getComputedStyle(node).backgroundColor),
    ]);
    expect(placeBackground).not.toBe(sourceBackground);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await places.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`saved-places-public-${width}.png`), fullPage: true });
  } finally {
    await request.delete(`/api/trips/${slug}`);
    await sql.end();
  }
});
