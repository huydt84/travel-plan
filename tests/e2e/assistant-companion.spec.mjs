import { cleanupAssistantTrips } from "./assistant-cleanup.mjs";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { createAssistantStore } from "../../lib/v1/store.mjs";
import { createBackgroundStore } from "../../lib/v1/background-store.mjs";
import { expect, gotoHealthy, test } from "./fixtures.mjs";

const ownerEmail = "local-admin@localhost.invalid";
async function fixture(request, persistent = false) {
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
  if (persistent) {
    const existing = await sql`SELECT id,slug,title FROM trips ORDER BY created_at`;
    const kyoto = existing.find((trip) => trip.slug === "kyoto-local-assistant");
    const original = existing.find((trip) => trip.id !== kyoto?.id);
    expect(original).toBeTruthy(); expect(kyoto).toBeTruthy();
    return { sql, trips: [original, kyoto], async close() { await sql.end(); } };
  }
  const trips = [];
  for (const title of ["Tokyo companion", "Kyoto companion"]) {
    const slug = `companion-${randomUUID()}`;
    const [trip] = await sql`INSERT INTO trips(slug,title,trip_date,end_date,timezone,location)
      VALUES(${slug},${title},'2030-01-01','2030-01-01','Asia/Tokyo','Japan') RETURNING id,slug,title`;
    await sql`INSERT INTO activities(trip_id,item_key,sort_order,start_date,start_time,end_date,end_time,type,icon,title,detail)
      VALUES(${trip.id},'museum',0,'2030-01-01','09:00','2030-01-01','10:00','Visit','pin','Museum','Original')`;
    trips.push(trip);
  }
  return { sql, trips, store: createAssistantStore({ sql }), async close() {
    await cleanupAssistantTrips(sql, trips.map((trip) => trip.id));
    for (const trip of trips) {
      if (request) await request.delete(`/api/trips/${trip.slug}`);
      else await sql`DELETE FROM trips WHERE id=${trip.id}`;
    }
    await sql.end();
  } };
}

test("a real workflow streams before completion and survives switching trips and closing chat", async ({ page }) => {
  const f = await fixture(page.request, process.env.E2E_LOCAL_TRIP_SWITCH === "true");
  try {
    await page.request.patch(`/api/trips/${f.trips[0].slug}`, { data: { title: f.trips[0].title } });
    await gotoHealthy(page, `/?trip=${f.trips[0].slug}`);
    await page.getByRole("button", { name: "Trợ lý", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Yêu cầu cho trợ lý" });
    await expect(page.getByRole("button", { name: "Trò chuyện mới" })).toBeEnabled();
    await page.getByRole("button", { name: "Trò chuyện mới" }).click();
    await page.getByRole("button", { name: "Thêm chuyến đi này" }).click();
    const acceptance = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/assistant/turns"));
    // Multiple paragraphs give the explicitly simulated provider enough chunks
    // to observe real background progress without relying on subsecond navigation.
    await input.fill("Tóm tắt Tokyo\n\n" + Array.from({ length: 8 }, (_, i) => `Mục kiểm tra ${i + 1}`).join("\n\n")); await input.press("Enter");
    const acceptedResponse = await acceptance;
    expect(acceptedResponse.status()).toBe(202);
    const { runId } = await acceptedResponse.json();
    await expect(page.getByText("Đây là chế độ mô phỏng cục bộ.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dừng", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: /^Chọn chuyến đi/ }).selectOption(f.trips[1].slug);
    await expect(input).toBeEnabled();
    const [duringSwitch] = await f.sql`SELECT status,output_text FROM assistant_turns WHERE id=${runId}`;
    expect(duringSwitch.status, "the worker must still be running after the trip actually changed").toBe("running");
    expect(duringSwitch.output_text.length).toBeGreaterThan(0);
    await input.fill("Bản nháp Kyoto");
    await page.getByRole("button", { name: "Đóng", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Trợ lý hành trình", exact: true })).toHaveCount(0);
    expect((await f.sql`SELECT status FROM assistant_turns WHERE id=${runId}`)[0].status,
      "closing chat must happen before completion").toBe("running");
    await expect.poll(async () => (await f.sql`SELECT status FROM assistant_turns WHERE id=${runId}`)[0]?.status).toBe("completed");
    const [finished] = await f.sql`SELECT output_text FROM assistant_turns WHERE id=${runId}`;
    expect(finished.output_text.length).toBeGreaterThan(duringSwitch.output_text.length);
    expect(await f.sql`SELECT id FROM assistant_turns WHERE id=${runId} AND conversation_id IN
      (SELECT id FROM assistant_conversations WHERE trip_id=${f.trips[1].id})`).toHaveLength(0);
    await page.getByRole("button", { name: /Trợ lý/ }).click();
    await expect(input).toHaveValue("Bản nháp Kyoto");

    await expect(page.getByText("Yêu cầu của bạn: Tóm tắt Tokyo", { exact: false })).toBeVisible();
    await expect(input).toHaveValue("Bản nháp Kyoto");
    await page.reload();
    await expect(page.getByText("Yêu cầu của bạn: Tóm tắt Tokyo", { exact: false })).toBeVisible();
    await expect(input).toHaveValue("Bản nháp Kyoto");
    if (process.env.E2E_LOCAL_TRIP_SWITCH === "true") {
      await mkdir(".impeccable/review/trip-switch", { recursive: true });
      await writeFile(".impeccable/review/trip-switch/close-and-return.json", JSON.stringify({
        runId, trips: f.trips, afterSwitch: duringSwitch, afterCompletion: finished,
        checked: ["running after switch", "running after close", "more text after detachment", "return and reload"],
      }, null, 2));
    }
  } finally { await f.close(); }
});

test("Stop persists an incomplete reply and never stages a proposal", async ({ page }) => {
  const f = await fixture(page.request);
  try {
    const accepted = await f.store.acceptRequest({ ownerEmail, tripSlug: f.trips[0].slug, clientTurnId: randomUUID(), conversationId: null,
      input: "Tóm tắt trước khi dừng", title: "Stop test", leaseMs: 60000, maxTurnsPerHour: 100, background: true });
    const background = createBackgroundStore(f.store);
    await background.claim(accepted.turn.id, 60000);
    await background.append(accepted.turn.id, { type: "answer-delta", runId: accepted.turn.id, text: "Câu trả lời đang viết" });
    await gotoHealthy(page, `/assistant?trip=${f.trips[0].slug}&conversation=${accepted.conversation.id}`);
    await expect(page.getByText("Câu trả lời đang viết", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Dừng", exact: true }).click();
    await expect(page.getByText(/Đã dừng trả lời/)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/Đã dừng trả lời/)).toBeVisible();
    expect(await f.sql`SELECT id FROM assistant_change_sets WHERE trip_id=${f.trips[0].id}`).toHaveLength(0);
  } finally { await f.close(); }
});

test("Markdown, grouped citations, keyboard focus and unsafe content", async ({ page }) => {
  const f = await fixture(page.request);
  try {
    const accepted = await f.store.acceptRequest({ ownerEmail, tripSlug: f.trips[0].slug, clientTurnId: randomUUID(), conversationId: null, input: "Markdown test", title: "Markdown", leaseMs: 60000, maxTurnsPerHour: 100 });
    await f.store.publishTurn({ turnId: accepted.turn.id, output: "### Giờ mở cửa\n\n**Hasedera** [E5, E12]\n\n- Vé vào cửa\n- Lối đi\n\n| Mục | Giờ |\n| --- | --- |\n| Cổng | 09:00 |\n\n```js\nconst trip = 1;\n```\n\n<script>alert(1)</script>\n\n[Unsafe](javascript:alert(1))", citations: [{ id: "E5", title: "Temple", url: "https://example.com/temple" }, { id: "E12", title: "Hours", url: "https://example.com/hours" }] });
    await gotoHealthy(page, `/assistant?trip=${f.trips[0].slug}&conversation=${accepted.conversation.id}`);
    await expect(page.getByRole("heading", { name: "Giờ mở cửa" })).toBeVisible();
    await expect(page.locator("strong", { hasText: "Hasedera" })).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    expect(await page.locator('a[href^="javascript:"]').count()).toBe(0);
    await page.getByRole("button", { name: "[E12]", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Nguồn tham khảo" })).toBeVisible();
    await expect(page.locator("#evidence-E12")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "[E12]", exact: true })).toBeFocused();
  } finally { await f.close(); }
});

test("conversation and turn pagination reach old history without losing scroll position", async ({ page }) => {
  const f = await fixture(page.request);
  try {
    await f.sql`INSERT INTO assistant_conversations(id,owner_email,trip_id,title,created_at,updated_at)
      SELECT gen_random_uuid(),${ownerEmail},${f.trips[0].id},'History ' || i,
        NOW()+INTERVAL '1 day'-i*INTERVAL '1 minute',NOW()+INTERVAL '1 day'-i*INTERVAL '1 minute' FROM generate_series(1,35) i`;
    const [conversation] = await f.sql`SELECT id FROM assistant_conversations WHERE trip_id=${f.trips[0].id} AND title='History 35'`;
    await f.sql`INSERT INTO assistant_turns(id,conversation_id,client_turn_id,input_text,output_text,status,created_at,completed_at)
      SELECT gen_random_uuid(),${conversation.id},gen_random_uuid(),
        'Question ' || i,'Answer ' || i,'completed',NOW()-INTERVAL '2 days'+i*INTERVAL '1 microsecond',NOW() FROM generate_series(1,65) i`;
    await gotoHealthy(page, `/assistant?trip=${f.trips[0].slug}`);
    await page.getByRole("button", { name: "Lịch sử", exact: true }).click();
    await expect(page.getByRole("button", { name: /History 35/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Xem thêm cuộc trò chuyện" }).click();
    await page.getByRole("button", { name: /History 35/ }).click();
    await expect(page.getByText("Answer 65", { exact: true })).toBeVisible();
    await expect(page.getByText("Answer 1", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Xem trao đổi trước" }).click();
    await expect(page.getByText("Answer 1", { exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Xem trao đổi trước" })).toHaveCount(0);
    expect(await page.getByRole("article").count()).toBe(65);
  } finally { await f.close(); }
});

test("durable acceptance, single dispatch and worker claims remain idempotent", async ({ page }) => {
  const f = await fixture(page.request);
  try {
    const input = { ownerEmail, tripSlug: f.trips[0].slug, conversationId: null, clientTurnId: randomUUID(), input: "Queued", title: "Queued", leaseMs: 600000, maxTurnsPerHour: 100, background: true };
    const [a, b] = await Promise.all([f.store.acceptRequest(input), f.store.acceptRequest(input)]);
    expect(a.turn.id).toBe(b.turn.id);
    const background = createBackgroundStore(f.store);
    expect(await f.sql`SELECT * FROM assistant_jobs WHERE turn_id=${a.turn.id}`).toHaveLength(1);
    expect(await background.beginDispatch(a.turn.id)).toBe(true);
    expect(await background.beginDispatch(a.turn.id)).toBe(false);
    expect((await Promise.all([background.claim(a.turn.id, 60000), background.claim(a.turn.id, 60000)])).sort()).toEqual([false, true]);
    await background.append(a.turn.id, { type: "answer-delta", runId: a.turn.id, text: "Partial" });
    await f.store.failTurn(a.turn.id, "TURN_CANCELLED");
    expect(await background.append(a.turn.id, { type: "answer-delta", runId: a.turn.id, text: "Must not publish" })).toBeNull();
    await expect(f.store.publishTurn({ turnId: a.turn.id, output: "Late", citations: [] })).rejects.toMatchObject({ code: "TURN_INTERRUPTED" });
    expect((await f.store.getTurn(a.turn.id, ownerEmail)).output).toBe("Partial");
    expect((await background.events(a.turn.id, 1)).map((event) => event.seq)).toEqual([2]);
    const terminal = { type: "cancelled", runId: a.turn.id, turn: await f.store.getTurn(a.turn.id, ownerEmail) };
    expect(await Promise.all([background.append(a.turn.id, terminal), background.append(a.turn.id, terminal)])).toEqual([3, 3]);
    expect((await background.events(a.turn.id, 2))).toHaveLength(1);
  } finally { await f.close(); }
});

test("intermediate widths keep chat controls inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await gotoHealthy(page, "/assistant");
  await expect(page.getByRole("button", { name: "Trò chuyện mới" })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(900);
  const bounds = await page.getByRole("button", { name: "Lịch sử", exact: true }).boundingBox();
  expect(bounds.y + bounds.height).toBeLessThan(250);
});

test("Back and Forward preserve conversation drafts independently of the visible trip", async ({ page }) => {
  const f = await fixture(page.request);
  try {
    const a = await f.store.createConversation({ ownerEmail, title: "Draft A" });
    const b = await f.store.createConversation({ ownerEmail, title: "Draft B" });
    await gotoHealthy(page, `/assistant?trip=${f.trips[0].slug}&conversation=${a.id}`);
    const input = page.getByRole("textbox", { name: "Yêu cầu cho trợ lý" });
    await expect(input).toBeEnabled(); await input.fill("Tokyo draft");
    await page.getByRole("button", { name: "Lịch sử", exact: true }).click();
    await page.getByRole("button", { name: /Draft B/ }).click();
    await expect(input).toHaveValue(""); await input.fill("Kyoto draft");
    expect(new URL(page.url()).searchParams.get("trip")).toBe(f.trips[0].slug);
    await page.goBack(); await expect(input).toHaveValue("Tokyo draft");
    await page.goForward(); await expect(input).toHaveValue("Kyoto draft");
    await f.sql`DELETE FROM assistant_conversations WHERE id=ANY(${[a.id,b.id]}::UUID[])`;
  } finally { await f.close(); }
});

test("composer respects IME composition and Shift Enter", async ({ page }) => {
  const f = await fixture(page.request);
  try {
    await gotoHealthy(page, `/assistant?trip=${f.trips[0].slug}`);
    const input = page.getByRole("textbox", { name: "Yêu cầu cho trợ lý" });
    await expect(input).toBeEnabled(); await input.fill("かな");
    await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
    await expect(input).toHaveValue("かな");
    await input.press("Shift+Enter"); await input.press("a");
    await expect(input).toHaveValue("かな\na");
    expect(await f.sql`SELECT t.id FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id WHERE c.trip_id=${f.trips[0].id}`).toHaveLength(0);
  } finally { await f.close(); }
});

test("reading earlier messages preserves scroll and announces a background response", async ({ page }) => {
  const f = await fixture(page.request);
  try {
    const a = await f.store.acceptRequest({ ownerEmail, tripSlug: f.trips[0].slug, conversationId: null,
      clientTurnId: randomUUID(), input: "Long reply", title: "Long reply", leaseMs: 60000, maxTurnsPerHour: 100, background: true });
    const background = createBackgroundStore(f.store);
    await background.claim(a.turn.id, 60000);
    await background.append(a.turn.id, { type: "answer-delta", runId: a.turn.id, text: Array.from({ length: 40 }, (_, i) => `Paragraph ${i}`).join("\n\n") });
    await gotoHealthy(page, `/assistant?trip=${f.trips[0].slug}&conversation=${a.conversation.id}`);
    await expect(page.getByText("Paragraph 39", { exact: true })).toBeVisible();
    const list = page.getByLabel("Nội dung cuộc trò chuyện", { exact: true });
    await list.evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event("scroll")); });
    await background.append(a.turn.id, { type: "answer-delta", runId: a.turn.id, text: "\n\nNew paragraph" });
    await expect(page.getByRole("button", { name: "Có câu trả lời mới" })).toBeVisible();
    expect(await list.evaluate((el) => el.scrollTop)).toBe(0);
    await page.getByRole("button", { name: "Có câu trả lời mới" }).click();
    expect(await list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2);
    await page.getByRole("button", { name: "Lịch sử", exact: true }).click();
    await expect(page.getByRole("button", { name: /Long reply.*Đang trả lời/ })).toBeVisible();
    await f.store.publishTurn({ turnId: a.turn.id, output: "Finished reply", citations: [] });
    await expect(page.getByRole("button", { name: /Long reply.*Đang trả lời/ })).toHaveCount(0, { timeout: 10000 });
  } finally { await f.close(); }
});
