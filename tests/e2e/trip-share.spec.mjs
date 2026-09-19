import { randomUUID } from "node:crypto";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { expect, test } from "./fixtures.mjs";

const asUser = (email) => ({ "x-local-viewer-email": email, "x-local-viewer-name": email });

test("leader creates a short-lived public read-only link", async ({ request, browser }, testInfo) => {
  const marker = randomUUID();
  const leader = `share-leader-${marker}@example.com`;
  const member = `share-member-${marker}@example.com`;
  const slug = `share-${marker}`;
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
  await request.get("/api/trips", { headers: asUser(leader) });
  await request.get("/api/trips", { headers: asUser(member) });
  try {
    expect((await request.post("/api/trips", { headers: asUser(leader), data: { slug, title: "Shared Kyoto", startDate: "2030-04-01", endDate: "2030-04-01", timezone: "Asia/Tokyo", location: "Kyoto", memberEmails: [member] } })).status()).toBe(201);
    expect((await request.post(`/api/trips/${slug}/schedule`, { headers: asUser(leader), data: { startDate: "2030-04-01", endDate: "2030-04-01", start: "09:00", end: "10:00", title: "Temple visit", type: "Visit", icon: "📍", detail: "East gate", refs: [] } })).status()).toBe(201);
    expect((await request.post(`/api/trips/${slug}/share`, { headers: asUser(member) })).status()).toBe(403);
    const created = await request.post(`/api/trips/${slug}/share`, { headers: asUser(leader) });
    expect(created.status()).toBe(201);
    const { path, expiresAt } = await created.json();
    expect(path).toMatch(/^\/share\/[A-Za-z0-9_-]{43}$/);
    expect(new Date(expiresAt).getTime() - Date.now()).toBeGreaterThan(9 * 60 * 1000);
    for (const viewport of [{ width: 320, height: 760 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      const context = await browser.newContext({ viewport, permissions: ["clipboard-read", "clipboard-write"] });
      const page = await context.newPage();
      try {
        const response = await page.goto(path);
        expect(response.status()).toBe(200);
        await expect(page.getByRole("heading", { name: "Shared Kyoto" })).toBeVisible();
        await expect(page.getByText("Temple visit")).toBeVisible();
        await expect(page.getByRole("button", { name: "Sao chép toàn bộ lịch trình" })).toBeVisible();
        await expect(page.locator("body")).not.toContainText(leader);
        await expect(page.locator("body")).not.toContainText(member);
        await expect(page.locator("body")).not.toContainText("JPY");
        expect(response.headers()["cache-control"]).toMatch(/no-store|no-cache/);
        expect(response.headers()["x-robots-tag"]).toContain("noindex");
        const width = await page.locator("body").evaluate((element) => element.scrollWidth);
        expect(width, `shared page must fit ${viewport.width}px`).toBeLessThanOrEqual(viewport.width);
        await page.getByRole("button", { name: "Sao chép toàn bộ lịch trình" }).click();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("09:00–10:00  Temple visit");
        await page.screenshot({ path: testInfo.outputPath(`shared-${viewport.width}.png`), fullPage: true });
      } finally { await context.close(); }
    }
    await sql`UPDATE activities SET title='Updated temple' WHERE trip_id=(SELECT id FROM trips WHERE slug=${slug})`;
    expect(await (await request.get(path)).text()).toContain("Updated temple");
    expect((await request.get("/share/invalid")).status()).toBe(404);
    const token = path.split("/").at(-1);
    const { createHash } = await import("node:crypto");
    await sql`UPDATE trip_share_links SET created_at=NOW()-INTERVAL '11 minutes', expires_at=NOW()-INTERVAL '1 second' WHERE token_hash=${createHash("sha256").update(token).digest("hex")}`;
    expect((await request.get(path)).status()).toBe(404);
    const second = await request.post(`/api/trips/${slug}/share`, { headers: asUser(leader) });
    expect(second.status()).toBe(201);
    expect((await request.get((await second.json()).path)).status()).toBe(200);
  } finally {
    try { await sql`DELETE FROM trips WHERE slug=${slug}`; }
    finally { await sql.end(); }
  }
});
