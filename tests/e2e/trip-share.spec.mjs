import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
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
    for (const minutes of [0, 61, 1.5, "10", null]) {
      const invalid = await request.post(`/api/trips/${slug}/share`, { headers: asUser(leader), data: { minutes } });
      expect(invalid.status(), `minutes=${minutes} must be rejected`).toBe(400);
    }
    for (const minutes of [1, 60]) {
      const response = await request.post(`/api/trips/${slug}/share`, { headers: asUser(leader), data: { minutes } });
      expect(response.status()).toBe(201);
      const result = await response.json();
      expect(new Date(result.expiresAt).getTime() - Date.now()).toBeGreaterThan((minutes - 0.1) * 60_000);
      expect(await (await request.get(result.path)).text()).toContain(`${minutes} PHÚT`);
    }
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
        const downloadPromise = page.waitForEvent("download");
        await page.getByRole("button", { name: "Xuất Markdown" }).click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toBe("shared-kyoto.md");
        const markdown = await readFile(await download.path(), "utf8");
        expect(markdown).toContain("# Shared Kyoto");
        expect(markdown).toContain("**09:00–10:00** Temple visit");
        expect(markdown).toContain("East gate");
        await page.evaluate(() => { window.print = () => { window.__printCalled = true; }; });
        await page.getByRole("button", { name: "Xuất PDF" }).click();
        expect(await page.evaluate(() => window.__printCalled)).toBe(true);
        const actionBoxes = await page.locator('button').filter({ hasText: /Sao chép toàn bộ lịch trình|Xuất Markdown|Xuất PDF/ }).evaluateAll((buttons) => buttons.map((button) => {
          const box = button.getBoundingClientRect();
          return { left: box.left, right: box.right, width: box.width, height: box.height };
        }));
        expect(actionBoxes).toHaveLength(3);
        for (const box of actionBoxes) {
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(viewport.width);
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
        if (viewport.width === 1440) {
          await page.emulateMedia({ media: "print" });
          await expect(page.getByRole("button", { name: "Xuất PDF" })).toBeHidden();
          await expect(page.getByRole("heading", { name: "Shared Kyoto" })).toBeVisible();
          const pdf = await page.pdf({ format: "A4", printBackground: true });
          expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
          expect(pdf.length).toBeGreaterThan(1000);
          await writeFile(testInfo.outputPath("shared-itinerary.pdf"), pdf);
          await page.emulateMedia({ media: "screen" });
        }
        await page.screenshot({ path: testInfo.outputPath(`shared-${viewport.width}.png`), fullPage: true });
      } finally { await context.close(); }
      const leaderContext = await browser.newContext({ viewport, extraHTTPHeaders: asUser(leader), permissions: ["clipboard-read", "clipboard-write"] });
      try {
        const leaderPage = await leaderContext.newPage();
        await leaderPage.goto(`/?trip=${slug}`);
        await leaderPage.getByRole("button", { name: "Chia sẻ", exact: true }).click();
        const dialog = leaderPage.getByRole("dialog", { name: "Chia sẻ lịch trình" });
        const duration = dialog.getByRole("spinbutton", { name: "Thời hạn link (phút)" });
        await expect(duration).toHaveValue("10");
        const firstLink = dialog.getByLabel("Link xem chuyến đi");
        await expect(firstLink).toHaveValue(/\/share\//);
        await leaderPage.screenshot({ path: testInfo.outputPath(`share-ready-${viewport.width}.png`), fullPage: false });
        await dialog.getByRole("button", { name: "Sao chép link" }).click();
        expect(await leaderPage.evaluate(() => navigator.clipboard.readText())).toBe(await firstLink.inputValue());
        await duration.fill("61");
        await dialog.getByRole("button", { name: "Tạo link với thời hạn mới" }).click();
        await expect(duration).toHaveValue("61");
        await expect(dialog.getByLabel("Link xem chuyến đi")).toHaveCount(0);
        await duration.fill("60");
        const box = await dialog.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        await leaderPage.screenshot({ path: testInfo.outputPath(`share-dialog-${viewport.width}.png`), fullPage: false });
        await dialog.getByRole("button", { name: "Tạo link với thời hạn mới" }).click();
        await expect(dialog.getByLabel("Link xem chuyến đi")).toHaveValue(/\/share\//);
        expect(await leaderPage.evaluate(() => localStorage.getItem("travel-plan-share-minutes"))).toBe("60");
        await dialog.getByRole("button", { name: "Đóng" }).click();
        await leaderPage.reload();
        await leaderPage.getByRole("button", { name: "Chia sẻ", exact: true }).click();
        await expect(leaderPage.getByRole("spinbutton", { name: "Thời hạn link (phút)" })).toHaveValue("60");
        await expect(leaderPage.getByLabel("Link xem chuyến đi")).toHaveValue(/\/share\//);
      } finally { await leaderContext.close(); }
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
