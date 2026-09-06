import { randomUUID } from "node:crypto";
import { test, expect, gotoHealthy } from "./fixtures.mjs";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { createAssistantStore } from "../../lib/v1/store.mjs";
import { createBatchStore } from "../../lib/v1/batch-store.mjs";
import { compileBatch } from "../../lib/v1/batch-proposal.mjs";
import { LOCALE_COOKIE, translate } from "../../lib/i18n.mjs";

for (const locale of ["en", "ja"]) for (const [width, height] of [[320, 760], [1440, 900], [1920, 1080]]) {
  test(`${locale} batch, proposal, and evidence review at ${width}`, async ({ page, context, baseURL }, testInfo) => {
    const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
    const email = `locale-review-${randomUUID()}@localhost.invalid`;
    const slug = `locale-review-${randomUUID()}`;
    const t = (key, values) => translate(locale, key, values);
    let trip;
    try {
      await sql`INSERT INTO users(email,name,role,first_login,last_login,last_active_at) VALUES(${email},'Locale reviewer','admin',NOW(),NOW(),NOW())`;
      const store = createAssistantStore({ sql });
      const batches = createBatchStore(sql, "local-agentic-v1-secret");
      const accepted = await store.acceptRequest({ ownerEmail: email, clientTurnId: randomUUID(), input: "Giữ nguyên yêu cầu 日本語", title: "Bản nháp Kyoto", leaseMs: 60000, maxTurnsPerHour: 100, background: true });
      const args = { operations: [{ kind: "trip.create", draftId: "trip", value: { slug, title: "Chuyến đi Kyoto", startDate: "2030-04-01", endDate: "2030-04-01", timezone: "Asia/Tokyo", location: "Kyoto" } }] };
      const action = await batches.stage({ turnId: accepted.turn.id, call: { id: randomUUID(), arguments: args }, compiled: compileBatch(args, []), citations: [], usedContext: [], lifetimeMs: 1800000, email });
      await context.addCookies([{ name: LOCALE_COOKIE, value: locale, url: baseURL }]);
      await page.setExtraHTTPHeaders({ "x-local-viewer-email": email });
      await page.setViewportSize({ width, height });
      await gotoHealthy(page, `/assistant?conversation=${accepted.conversation.id}`);
      const review = page.getByRole("region", { name: t("assistantExtra.batch.region"), exact: true });
      await expect(review.getByRole("heading", { name: t("assistantExtra.batch.pending"), exact: true })).toBeVisible();
      await expect(review.getByText(t("assistantExtra.summary.trip.create", { count: 1 }), { exact: true })).toBeVisible();
      await expect(review.getByRole("button", { name: t("assistantExtra.batch.approve"), exact: true })).toBeEnabled();
      await review.getByText(t("assistantExtra.batch.details", { count: 1 }), { exact: true }).click();
      await expect(review.getByText("Chuyến đi Kyoto", { exact: true }).last()).toBeVisible();
      await expect(page.getByText("Giữ nguyên yêu cầu 日本語", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      expect(await review.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("batch-review.png"), animations: "disabled" });
      await review.getByRole("button", { name: t("assistantExtra.batch.reject"), exact: true }).click();
      await expect(review.getByRole("heading", { name: t("assistantExtra.batch.rejected"), exact: true })).toBeVisible();
      expect(await sql`SELECT id FROM trips WHERE slug=${slug}`).toHaveLength(0);
      expect((await batches.list([accepted.turn.id], email))[0].status).toBe("rejected");
      expect(action.id).toBeTruthy();

      [trip] = await sql`INSERT INTO trips(slug,title,trip_date,end_date,timezone,location) VALUES(${slug},'旅の記録','2030-04-01','2030-04-01','Asia/Tokyo','Kyoto') RETURNING id,plan_revision`;
      const proposalTurn = await store.acceptRequest({ ownerEmail: email, clientTurnId: randomUUID(), input: "Kiểm tra đề xuất", title: "Đề xuất giữ nguyên", leaseMs: 60000, maxTurnsPerHour: 100 });
      await store.publishTurn({ turnId: proposalTurn.turn.id, output: "Câu trả lời giữ nguyên · 日本語", citations: [{ id: "E1", kind: "web", title: "Nguồn do tác giả viết", url: "https://example.com/", checkedAt: "2030-04-01T14:25:00Z" }], proposal: {
        id: randomUUID(), tripId: String(trip.id), operations: [], baseRevision: Number(trip.plan_revision), digest: "locale-review-digest", tokenHash: "unused-review-only-token", expiresAt: new Date(Date.now() + 1800000).toISOString(),
        preview: { summary: "Tóm tắt do trợ lý viết", changes: [{ kind: "activity.update", targetKey: "visit", title: "Tên hoạt động giữ nguyên", before: { detail: "Nội dung cũ" }, after: { detail: "Nội dung mới" } }], warnings: [] },
      } });
      await gotoHealthy(page, `/assistant?conversation=${proposalTurn.conversation.id}`);
      await expect(page.getByText("Câu trả lời giữ nguyên · 日本語", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: t("assistantExtra.viewProposed", { count: 1 }), exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("Tóm tắt do trợ lý viết", { exact: true })).toBeVisible();
      await expect(dialog.getByText("Nội dung mới", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await page.screenshot({ path: testInfo.outputPath("proposal-review.png"), animations: "disabled" });
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: t("assistantExtra.sourceCount", { count: 1 }), exact: true }).click();
      await expect(dialog.getByRole("link", { name: t("assistantExtra.evidence.open"), exact: true })).toBeVisible();
      await expect(dialog.getByText("Nguồn do tác giả viết", { exact: true })).toBeVisible();
      await expect(dialog.locator("time")).not.toContainText(/AM|PM/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await page.screenshot({ path: testInfo.outputPath("evidence-review.png"), animations: "disabled" });
    } finally {
      await sql`DELETE FROM assistant_conversations WHERE owner_email=${email}`;
      if (trip) await sql`DELETE FROM trips WHERE id=${trip.id}`;
      await sql`DELETE FROM users WHERE email=${email}`;
      await sql.end();
    }
  });
}
