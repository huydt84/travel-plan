import { cleanupAssistantTrips } from "./assistant-cleanup.mjs";
import { randomUUID } from "node:crypto";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { createAssistantStore } from "../../lib/v1/store.mjs";
import { expect, gotoHealthy, test } from "./fixtures.mjs";

const ownerEmail = "local-admin@localhost.invalid";
async function setup(page) {
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
  const slug = `browser-harness-${randomUUID()}`;
  const [trip] = await sql`INSERT INTO trips(slug,title,trip_date,end_date,timezone,location)
    VALUES(${slug},'Browser harness','2030-01-01','2030-01-01','Asia/Tokyo','Tokyo') RETURNING id`;
  await sql`INSERT INTO activities(trip_id,item_key,sort_order,start_date,start_time,end_date,end_time,type,icon,title,detail)
    VALUES(${trip.id},'museum',0,'2030-01-01','09:00','2030-01-01','10:00','Visit','pin','Museum','Original')`;
  await gotoHealthy(page, `/assistant?trip=${slug}`);
  await page.getByRole("button", { name: "Thêm chuyến đi này" }).click();
  await expect(page.getByLabel("Yêu cầu cho trợ lý")).toBeEnabled();
  return { sql, trip, slug, store: createAssistantStore({ sql }), cleanup: async () => {
    try {
      await cleanupAssistantTrips(sql, [trip.id]);
      const response = await page.request.delete(`/api/trips/${slug}`);
      expect(response.status()).toBe(204);
    } finally { await sql.end(); }
  } };
}
const send = async (page, message) => {
  await page.getByLabel("Yêu cầu cho trợ lý").fill(message);
  await page.getByRole("button", { name: "Gửi yêu cầu", exact: true }).click();
};

test("lost acceptance and truncated responses recover without a second turn", async ({ page }) => {
  const f = await setup(page);
  try {
    let submissions = 0;
    await page.route("**/api/v1/assistant/turns", async (route) => {
      submissions++;
      const result = await route.fetch();
      expect(result.ok()).toBe(true);
      // The server finished, but the browser lost the entire acceptance stream.
      await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: "" });
    });
    await send(page, "Tóm tắt lịch kiểm tra khôi phục");
    await expect(page.getByText("Đây là chế độ mô phỏng cục bộ.", { exact: false })).toBeVisible();
    expect(submissions).toBe(1);
    expect(await f.sql`SELECT t.id FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id WHERE t.mentions @> ${JSON.stringify([{ kind: "trip", id: String(f.trip.id) }])}::JSONB`).toHaveLength(1);
    await page.reload();
    await expect(page.getByText("Đây là chế độ mô phỏng cục bộ.", { exact: false })).toBeVisible();
  } finally { await f.cleanup(); }
});

test("reload reconciles a running lease and explicit retry creates one new turn", async ({ page }) => {
  const f = await setup(page);
  try {
    let accepted;
    await page.route("**/api/v1/assistant/turns", async (route) => {
      const body = route.request().postDataJSON();
      accepted = await f.store.acceptRequest({ ownerEmail, tripSlug: f.slug, conversationId: body.conversationId,
        clientTurnId: body.clientTurnId, input: body.message, title: "Recovery", leaseMs: 60000, maxTurnsPerHour: 30 });
      await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ runId: accepted.turn.id, conversationId: accepted.conversation.id }) });
    });
    await send(page, "Tóm tắt sau khi mất kết nối");
    await expect(page.getByRole("button", { name: "Dừng", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Dừng", exact: true })).toBeVisible();
    await f.sql`UPDATE assistant_turns SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=${accepted.turn.id}`;
    await expect(page.getByRole("button", { name: "Thử lại" })).toBeVisible({ timeout: 10000 });
    await page.unroute("**/api/v1/assistant/turns");
    await page.getByRole("button", { name: "Thử lại" }).click();
    await expect(page.getByText("Đây là chế độ mô phỏng cục bộ.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dừng", exact: true })).toHaveCount(0);
    const rows = await f.sql`SELECT client_turn_id,status FROM assistant_turns WHERE conversation_id=${accepted.conversation.id}`;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.client_turn_id)).size).toBe(2);
    expect(rows.map((row) => row.status).sort()).toEqual(["completed", "failed"]);
  } finally { await f.cleanup(); }
});

for (const viewport of [{ width: 320, height: 760 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  test(`expired proposal and recovery controls fit ${viewport.width}`, async ({ page }, testInfo) => {
    await page.clock.install();
    await page.setViewportSize(viewport);
    const f = await setup(page);
    try {
      await send(page, "Cập nhật hoạt động đầu tiên với một ghi chú thử nghiệm");
      await expect(page.getByRole("button", { name: /Xem 1 thay đổi/ })).toBeVisible();
      await page.getByRole("button", { name: /Xem 1 thay đổi/ }).click();
      await expect(page.getByRole("button", { name: "Áp dụng 1 thay đổi" })).toBeVisible();
      const [proposal] = await f.sql`SELECT * FROM assistant_change_sets WHERE trip_id=${f.trip.id}`;
      // Advance the browser clock beyond the displayed immutable expiry.
      await page.clock.fastForward(31 * 60 * 1000);
      await expect(page.getByRole("button", { name: "Áp dụng 1 thay đổi" })).toHaveCount(0);
      const regenerate = page.getByRole("button", { name: "Tạo lại đề xuất từ lịch mới nhất" });
      await expect(regenerate).toBeVisible();
      expect((await f.sql`SELECT status FROM assistant_change_sets WHERE id=${proposal.id}`)[0].status).toBe("staged");
      await page.screenshot({ path: testInfo.outputPath("expired-proposal.png"), fullPage: true });
      const bounds = await regenerate.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      if (viewport.width === 320) expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
      await regenerate.click();
      await expect(page.getByLabel("Yêu cầu cho trợ lý")).toHaveValue(/Cập nhật hoạt động đầu tiên/);

    } finally { await f.cleanup(); }
  });
}

test("conflicts leave the canonical plan untouched", async ({ page, runtimeHealth }) => {
  const f = await setup(page);
  try {
    await send(page, "Cập nhật hoạt động đầu tiên với một ghi chú thử nghiệm");
    await page.getByRole("button", { name: /Xem 1 thay đổi/ }).click();
    expect((await f.sql`SELECT detail FROM activities WHERE trip_id=${f.trip.id}`)[0].detail).toBe("Original");
    await f.sql`UPDATE trips SET title='Concurrent plan edit' WHERE id=${f.trip.id}`;
    const response = page.waitForResponse((response) => response.url().endsWith("/confirm"));
    await page.getByRole("button", { name: "Áp dụng 1 thay đổi" }).click();
    expect((await response).status()).toBe(409);
    await expect(page.getByRole("button", { name: "Tạo lại đề xuất từ lịch mới nhất" })).toBeVisible();
    const expectedConsole = "console: Failed to load resource: the server responded with a status of 409 (Conflict)";
    await expect.poll(() => runtimeHealth.includes(expectedConsole)).toBe(true);
    runtimeHealth.splice(runtimeHealth.indexOf(expectedConsole), 1);
    expect((await f.sql`SELECT detail FROM activities WHERE trip_id=${f.trip.id}`)[0].detail).toBe("Original");
  } finally { await f.cleanup(); }
});

test("assistant HTTP boundaries isolate actors and reject cross-origin or empty submissions", async ({ page, request, baseURL }) => {
  const f = await setup(page);
  const other = `harness-admin-${randomUUID()}@localhost.invalid`;
  try {
    await f.sql`INSERT INTO users(email,name,role,first_login,last_login,last_active_at)
      VALUES(${other},'Harness admin','admin',NOW(),NOW(),NOW())`;
    const accepted = await f.store.acceptRequest({ ownerEmail, tripSlug: f.slug, conversationId: null,
      clientTurnId: randomUUID(), input: "Private request", title: "Private", leaseMs: 60000, maxTurnsPerHour: 100 });
    await f.store.publishTurn({ turnId: accepted.turn.id, output: "Private answer", citations: [] });
    const otherHeaders = { "x-local-viewer-email": other, "x-local-viewer-name": "Harness admin", origin: baseURL };
    const lookup = await request.get(`/api/v1/assistant/workspace?request=${accepted.turn.clientTurnId}`, { headers: otherHeaders });
    expect(lookup.status()).toBe(200);
    expect((await lookup.json()).request.found).toBe(false);
    expect((await request.get(`/api/v1/assistant/workspace?conversation=${accepted.conversation.id}`, { headers: otherHeaders })).status()).toBe(404);
    expect((await request.get(`/api/v1/assistant/runs/${accepted.turn.id}/events`, { headers: otherHeaders })).status()).toBe(404);
    expect((await request.post(`/api/v1/assistant/runs/${accepted.turn.id}`, { headers: otherHeaders })).status()).toBe(404);
    expect((await request.post(`/api/v1/assistant/runs/${accepted.turn.id}`)).status()).toBe(403);
    const endpoint = `/api/v1/trips/${f.slug}/assistant/turns`;
    const data = { clientTurnId: randomUUID(), message: "Hello" };
    expect((await request.post(endpoint, { data })).status()).toBe(403);
    expect((await request.post(endpoint, { headers: { origin: baseURL }, data: { ...data, message: "   " } })).status()).toBe(400);
    expect((await request.post(endpoint, { headers: otherHeaders, data: { ...data, conversationId: accepted.conversation.id } })).status()).toBe(404);
    expect((await request.get("/api/v1/assistant/workspace", { headers: { "x-local-viewer-email": "harness-member@localhost.invalid" } })).status()).toBe(403);
  } finally {
    await f.sql`DELETE FROM users WHERE email=${other}`;
    await f.cleanup();
  }
});
