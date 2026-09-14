import { cleanupAssistantTrips } from "./assistant-cleanup.mjs";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { createAssistantStore } from "../../lib/v1/store.mjs";
import { createBackgroundStore } from "../../lib/v1/background-store.mjs";
import { dispatchAttempt } from "../../lib/v1/dispatch-attempt.mjs";
import { expect, gotoHealthy, test } from "./fixtures.mjs";

async function fixture(request) {
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
  const slug = `retry-${randomUUID()}`;
  const [trip] = await sql`INSERT INTO trips(slug,title,trip_date,end_date,timezone,location)
    VALUES(${slug},'Retry journey','2030-01-01','2030-01-01','Asia/Tokyo','Kyoto') RETURNING id`;
  const store = createAssistantStore({ sql });
  const background = createBackgroundStore(store);
  const accept = (options = {}) => store.acceptRequest({ ownerEmail: "local-admin@localhost.invalid", tripSlug: slug,
    clientTurnId: randomUUID(), input: "Tóm tắt chuyến đi", title: "Retry", leaseMs: 60000, maxTurnsPerHour: 100,
    conversationId: null, background: true, ...options });
  return { sql, slug, trip, store, background, accept, async close() {
    await cleanupAssistantTrips(sql, [trip.id]);
    await request.delete(`/api/trips/${slug}`); await sql.end();
  } };
}

test("dispatch races fence delayed workers, expiry and duplicate delivery", async ({ request }) => {
  const f = await fixture(request);
  try {
    const a = await f.accept();
    await dispatchAttempt(a.turn.id, { store: f.background, start: async () => { throw new Error("Unavailable"); } });
    expect((await f.store.getTurn(a.turn.id, "local-admin@localhost.invalid")).errorCode).toBe("DISPATCH_FAILED");
    expect(await f.background.claim(a.turn.id, 55000, "late-worker")).toBe(false);
    expect(await f.background.append(a.turn.id, { type: "answer-delta", text: "late" })).toBeNull();
    await expect(f.store.publishTurn({ turnId: a.turn.id, output: "late", citations: [] })).rejects.toMatchObject({ code: "TURN_INTERRUPTED" });
    const b = await f.accept();
    await dispatchAttempt(b.turn.id, { store: f.background, start: async () => {
      expect(await f.background.claim(b.turn.id, 55000, "claimed-worker")).toBe(true);
      throw new Error("Acknowledgement lost");
    } });
    expect((await f.store.getTurn(b.turn.id, "local-admin@localhost.invalid")).status).toBe("running");
    expect(await f.background.claim(b.turn.id, 55000, "duplicate")).toBe(false);
    const c = await f.accept();
    await f.sql`UPDATE assistant_turns SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=${c.turn.id}`;
    await f.store.reconcile("local-admin@localhost.invalid");
    expect(await f.background.claim(c.turn.id, 55000, "delayed")).toBe(false);
  } finally { await f.close(); }
});

test("retry is atomic, actor scoped, latest-only and paginated as one exchange", async ({ request }) => {
  const f = await fixture(request);
  try {
    const original = await f.accept();
    await f.store.failTurn(original.turn.id, "DISPATCH_FAILED");
    const body = { conversationId: original.conversation.id, retryOfTurnId: original.turn.id, clientTurnId: randomUUID() };
    const [a, b] = await Promise.all([f.accept(body), f.accept(body)]);
    expect(a.turn.id).toBe(b.turn.id);
    await expect(f.accept({ ...body, clientTurnId: randomUUID() })).rejects.toMatchObject({ code: "RETRY_UNAVAILABLE" });
    await expect(f.accept({ ...body, ownerEmail: "another@example.com", clientTurnId: randomUUID() })).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    await expect(f.accept({ ...body, tripSlug: "wrong-trip", clientTurnId: randomUUID() })).rejects.toMatchObject({ code: "TRIP_NOT_FOUND" });
    await f.store.failTurn(a.turn.id, "TURN_CANCELLED");
    const next = await f.accept({ conversationId: original.conversation.id, retryOfTurnId: a.turn.id });
    await f.store.publishTurn({ turnId: next.turn.id, output: "Completed", citations: [] });
    const turns = await f.store.listTurns(original.conversation.id, "local-admin@localhost.invalid");
    expect(turns).toHaveLength(1); expect(turns[0].exchangeId).toBe(original.turn.id);
    expect(turns[0].output).toBe("Completed");
    expect(await f.sql`SELECT id FROM assistant_turns WHERE conversation_id=${original.conversation.id}`).toHaveLength(3);
    const failed = await f.accept({ conversationId: original.conversation.id });
    await f.store.failTurn(failed.turn.id, "DISPATCH_FAILED");
    await f.accept({ conversationId: original.conversation.id, input: "Later message" });
    await expect(f.accept({ conversationId: original.conversation.id, retryOfTurnId: failed.turn.id })).rejects.toMatchObject({ code: "RETRY_UNAVAILABLE" });
    const older = await f.store.listTurns(original.conversation.id, "local-admin@localhost.invalid", { before: { id: failed.turn.id, createdAt: failed.turn.createdAt } });
    expect(older.map((turn) => turn.id)).toEqual([next.turn.id]);
  } finally { await f.close(); }
});

test("replacing the latest turn overwrites its persisted input and generated artifacts", async ({ request }) => {
  const f = await fixture(request);
  try {
    const original = await f.accept();
    await f.store.publishTurn({ turnId: original.turn.id, output: "Old answer", citations: [{ id: "old" }] });
    const clientTurnId = randomUUID();
    const first = await f.store.replaceLatestTurn({ turnId: original.turn.id, ownerEmail: "local-admin@localhost.invalid",
      clientTurnId, input: "Edited latest message", leaseMs: 60000, maxTurnsPerHour: 100 });
    const replay = await f.store.replaceLatestTurn({ turnId: original.turn.id, ownerEmail: "local-admin@localhost.invalid",
      clientTurnId, input: "Edited latest message", leaseMs: 60000, maxTurnsPerHour: 100 });
    expect(replay.replayed).toBe(true);
    expect(first.turn).toMatchObject({ id: original.turn.id, input: "Edited latest message", output: null, citations: [], status: "running" });
    expect(await f.sql`SELECT id,input_text,output_text FROM assistant_turns WHERE conversation_id=${original.conversation.id}`).toEqual([
      { id: original.turn.id, input_text: "Edited latest message", output_text: null },
    ]);
    expect(await f.sql`SELECT seq FROM assistant_events WHERE turn_id=${original.turn.id}`).toEqual([{ seq: 1 }]);
    expect(await f.sql`SELECT turn_id FROM assistant_jobs WHERE turn_id=${original.turn.id}`).toHaveLength(1);
    await f.store.publishTurn({ turnId: original.turn.id, output: "New answer", citations: [] });
    expect(await f.store.listModelHistory(original.conversation.id, "local-admin@localhost.invalid")).toEqual([
      expect.objectContaining({ id: original.turn.id, input: "Edited latest message", output: "New answer" }),
    ]);
    const later = await f.accept({ conversationId: original.conversation.id, input: "Later message" });
    await f.store.publishTurn({ turnId: later.turn.id, output: "Later answer", citations: [] });
    await expect(f.store.replaceLatestTurn({ turnId: original.turn.id, ownerEmail: "local-admin@localhost.invalid",
      clientTurnId: randomUUID(), input: "Too late", leaseMs: 60000, maxTurnsPerHour: 100 })).rejects.toMatchObject({ code: "REPLACE_UNAVAILABLE" });
  } finally { await f.close(); }
});

for (const [width, height] of [[320, 760], [1440, 900], [1920, 1080]]) {
  test(`latest message edit and response regeneration fit at ${width}`, async ({ page }, testInfo) => {
    const f = await fixture(page.request);
    try {
      const original = await f.accept();
      await f.store.publishTurn({ turnId: original.turn.id, output: "Câu trả lời ban đầu", citations: [] });
      await page.setViewportSize({ width, height });
      await gotoHealthy(page, `/assistant?trip=${f.slug}&conversation=${original.conversation.id}`);
      const edit = page.getByRole("button", { name: "Sửa tin nhắn" });
      const regenerate = page.getByRole("button", { name: "Tạo lại câu trả lời" });
      await expect(edit).toBeVisible(); await expect(regenerate).toBeVisible();
      for (const control of [edit, regenerate]) {
        const box = await control.boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
      }
      await edit.click();
      const editor = page.getByRole("textbox", { name: "Nội dung tin nhắn đã sửa" });
      await expect(editor).toHaveValue("Tóm tắt chuyến đi");
      await editor.fill("Tin nhắn mới nhất đã sửa");
      await page.getByRole("button", { name: "Lưu và tạo lại" }).click();
      await expect(page.getByText("Tin nhắn mới nhất đã sửa", { exact: true })).toBeVisible();
      await expect(page.getByText("Đây là chế độ mô phỏng cục bộ.", { exact: false })).toBeVisible();
      await expect(page.getByRole("button", { name: "Tạo lại câu trả lời" })).toBeVisible();
      expect(await f.sql`SELECT input_text FROM assistant_turns WHERE conversation_id=${original.conversation.id}`).toEqual([{ input_text: "Tin nhắn mới nhất đã sửa" }]);
      await page.screenshot({ path: testInfo.outputPath("latest-message-actions.png"), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    } finally { await f.close(); }
  });
}

test("unconfirmed submission keeps its identity and does not overwrite a newer draft", async ({ page }) => {
  const f = await fixture(page.request);
  try {
    await gotoHealthy(page, `/assistant?trip=${f.slug}`);
    const input = page.getByRole("textbox", { name: "Yêu cầu cho trợ lý" });
    await page.getByRole("button", { name: "Thêm chuyến đi này" }).click();
    const bodies = [];
    await page.route("**/api/v1/assistant/turns", async (route) => {
      bodies.push(route.request().postDataJSON());
      if (bodies.length === 1) await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      else await route.continue();
    });
    await input.fill("Yêu cầu chưa xác nhận"); await input.press("Enter");
    await expect(page.getByText("Không thể bắt đầu trả lời. Hãy thử lại.", { exact: true })).toBeVisible();
    await input.fill("Bản nháp mới không được mất");
    await page.getByRole("button", { name: "Thử lại", exact: true }).click();
    await expect(page.getByText("Đây là chế độ mô phỏng cục bộ.", { exact: false })).toBeVisible();
    expect(bodies).toHaveLength(2); expect(bodies[1]).toEqual(bodies[0]);
    await expect(input).toHaveValue("Bản nháp mới không được mất");
    await expect(page.getByRole("article")).toHaveCount(1);
  } finally { await f.close(); }
});

for (const [width, height] of [[320, 760], [1440, 900], [1920, 1080]]) {
  test(`failed answer retries in place and preserves draft at ${width}`, async ({ page }) => {
    const f = await fixture(page.request); let release;
    try {
      const original = await f.accept();
      await f.background.append(original.turn.id, { type: "answer-delta", runId: original.turn.id, text: "Nội dung chưa hoàn tất" });
      await f.store.failTurn(original.turn.id, "TURN_INTERRUPTED");
      await page.setViewportSize({ width, height });
      await gotoHealthy(page, `/assistant?trip=${f.slug}&conversation=${original.conversation.id}`);
      const input = page.getByRole("textbox", { name: "Yêu cầu cho trợ lý" });
      await input.fill("Bản nháp khác của tôi");
      await expect(page.getByText("Câu trả lời bị gián đoạn.")).toBeVisible();
      await mkdir(".impeccable/review/manual-retry", { recursive: true });
      await page.screenshot({ path: `.impeccable/review/manual-retry/${width}-failed.png` });
      let calls = 0;
      const hold = new Promise((resolve) => { release = resolve; });
      await page.route("**/api/v1/assistant/turns", async (route) => {
        calls++; await hold;
        if (width === 1440) {
          const response = await route.fetch(); expect(response.status()).toBe(202);
          await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
        } else await route.continue();
      });
      await page.getByRole("button", { name: "Thử lại", exact: true }).click();
      await expect(page.getByRole("button", { name: "Đang thử lại…" })).toBeDisabled();
      await page.screenshot({ path: `.impeccable/review/manual-retry/${width}-retrying.png` });
      release();
      await expect(page.getByText("Đây là chế độ mô phỏng cục bộ.", { exact: false })).toBeVisible();
      await expect(page.getByRole("button", { name: "Dừng", exact: true })).toHaveCount(0);
      await expect(page.getByRole("article")).toHaveCount(1);
      await expect(input).toHaveValue("Bản nháp khác của tôi");
      expect(calls).toBe(1);
      await expect(page.locator(`[data-exchange="${original.turn.id}"]`)).toBeFocused();
      await page.reload();
      await expect(page.getByRole("article")).toHaveCount(1);
      await expect(input).toHaveValue("Bản nháp khác của tôi");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      expect(await f.sql`SELECT id FROM assistant_turns WHERE conversation_id=${original.conversation.id}`).toHaveLength(2);
      const waiting = await f.accept({ conversationId: original.conversation.id, input: "Autre réponse 日本語" });
      await f.background.append(waiting.turn.id, { type: "answer-delta", runId: waiting.turn.id, text: "Réponse partielle 日本語" });
      const replay = await f.background.events(waiting.turn.id);
      await page.route(`**/api/v1/assistant/runs/${waiting.turn.id}/events?*`, (route) => route.fulfill({
        status: 200, contentType: "application/x-ndjson", body: replay.map((event) => JSON.stringify(event)).join("\n") + "\n{invalid\n",
      }));
      await page.reload();
      await expect(page.getByText("Mất kết nối với câu trả lời", { exact: true })).toBeVisible({ timeout: 12000 });
      await expect(page.getByText("Réponse partielle 日本語", { exact: true })).toHaveCount(1);
      const reconnectBounds = await page.getByRole("button", { name: "Kết nối lại", exact: true }).boundingBox();
      const composerBounds = await page.locator("form").boundingBox();
      expect(reconnectBounds.y + reconnectBounds.height).toBeLessThanOrEqual(composerBounds.y);
      await page.screenshot({ path: `.impeccable/review/manual-retry/${width}-disconnected.png` });
      await page.unroute(`**/api/v1/assistant/runs/${waiting.turn.id}/events?*`);
      await f.store.publishTurn({ turnId: waiting.turn.id, output: "Réponse complète 日本語", citations: [] });
      await page.getByRole("button", { name: "Kết nối lại", exact: true }).click();
      await expect(page.getByText("Réponse complète 日本語", { exact: true })).toHaveCount(1);
      expect(await f.sql`SELECT id FROM assistant_turns WHERE conversation_id=${original.conversation.id}`).toHaveLength(3);
      expect(calls).toBe(1);
    } finally { release?.(); await f.close(); }
  });
}
