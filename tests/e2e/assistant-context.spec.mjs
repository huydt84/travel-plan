import { preparePlanChanges } from "../../lib/v1/actions.mjs";
import { commitStoredChangeSet } from "../../lib/v1/committer.mjs";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { createAssistantStore } from "../../lib/v1/store.mjs";
import { createContextService } from "../../lib/v1/context.mjs";
import { createBackgroundStore } from "../../lib/v1/background-store.mjs";
import { expect, gotoHealthy, test } from "./fixtures.mjs";
async function fixture() {
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI), ownerEmail = `${randomUUID()}@example.com`;
  const trips = [];
  for (const label of ["A", "B"]) {
    const [trip] = await sql`INSERT INTO trips(slug,title,trip_date,end_date,timezone,location) VALUES(${`context-${randomUUID()}`},${`Context ${label}`},'2030-01-01','2030-01-01','Asia/Tokyo','Tokyo') RETURNING *`;
    trips.push(trip);
  }
  const refs = trips.map((t) => ({ kind: "trip", id: String(t.id) }));
  await sql`INSERT INTO users(email,name,role,first_login,last_login,last_active_at) VALUES(${ownerEmail},'Assistant fixture','admin',NOW(),NOW(),NOW()) ON CONFLICT(email) DO UPDATE SET role='admin'`;
  for (const trip of trips) await sql`INSERT INTO trip_participants(trip_id,user_email,role,added_by_email) VALUES(${trip.id},${ownerEmail},'leader',${ownerEmail})`;
  const store = createAssistantStore({ sql });
  const accept = (options = {}) => store.acceptRequest({ ownerEmail, clientTurnId: randomUUID(), conversationId: null, input: "Context question", title: "Context", leaseMs: 60000, maxTurnsPerHour: 100, ...options });
  return { sql, store, trips, refs, accept, ownerEmail, close: async () => {
    await sql`DELETE FROM assistant_conversations WHERE owner_email=${ownerEmail}`;
    await sql`DELETE FROM trips WHERE id=ANY(${trips.map((t) => t.id)}::BIGINT[])`; await sql`DELETE FROM users WHERE email=${ownerEmail}`; await sql.end();
  } };
}
async function useFixtureActor(page, fixtureState) {
  await page.setExtraHTTPHeaders({
    "x-local-viewer-email": fixtureState.ownerEmail,
    "x-local-viewer-name": "Assistant fixture",
  });
}
test("no-trip acceptance, context capture, pin conflict, replay and retry are independent of trips", async () => {
  const f = await fixture();
  try {
    const selectedTools = ["search_context", "read_context"];
    const first = await f.accept({ initialPins: [f.refs[0]], mentions: [f.refs[1]], allowedTools: selectedTools, background: true });
    expect(first.conversation.tripSlug).toBeNull();
    expect(first.turn.pinnedContext).toEqual([f.refs[0]]); expect(first.turn.mentions).toEqual([f.refs[1]]);
    expect(first.turn.allowedTools).toEqual(selectedTools);
    await f.store.updatePins(first.conversation.id, f.ownerEmail, [], 0);
    await expect(f.store.updatePins(first.conversation.id, f.ownerEmail, [f.refs[1]], 0)).rejects.toMatchObject({ code: "CONTEXT_CONFLICT" });
    const replay = await f.accept({ clientTurnId: first.turn.clientTurnId, initialPins: [f.refs[0]], mentions: [f.refs[1]], allowedTools: selectedTools, background: true });
    expect(replay.turn.id).toBe(first.turn.id); expect(replay.turn.pinnedContext).toEqual([f.refs[0]]);
    await expect(f.accept({ clientTurnId: first.turn.clientTurnId, initialPins: [f.refs[0]], mentions: [f.refs[1]], allowedTools: [] })).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    await expect(f.accept({ clientTurnId: first.turn.clientTurnId, initialPins: [], mentions: [f.refs[1]] })).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    await f.store.failTurn(first.turn.id, "TURN_CANCELLED");
    const retry = await f.accept({ conversationId: first.conversation.id, retryOfTurnId: first.turn.id, mentions: [f.refs[1]], allowedTools: selectedTools, background: true });
    expect(retry.turn.pinnedContext).toEqual([f.refs[0]]);
    expect(retry.turn.allowedTools).toEqual(selectedTools);
    await f.sql`DELETE FROM trips WHERE id=${f.trips[0].id}`;
    expect((await f.store.getConversation(first.conversation.id, f.ownerEmail)).id).toBe(first.conversation.id);
    expect((await createContextService({ sql: f.sql }).read({ email: f.ownerEmail, isAdmin: true }, f.refs[0])).available).toBe(false);
    const job = await createBackgroundStore(f.store).job(retry.turn.id);
    expect(job.conversation_id).toBe(first.conversation.id);
    expect(job.allowed_tools).toEqual(selectedTools);
    expect(await createBackgroundStore(f.store).summaries(f.ownerEmail)).toHaveLength(2);
  } finally { await f.close(); }
});
test("resource search distinguishes identical sources in two trips by stable identity", async () => {
  const f = await fixture();
  try {
    for (const trip of f.trips) await f.sql`INSERT INTO sources(trip_id,source_number,title,host,url) VALUES(${trip.id},1,'Same official source','example.com','https://example.com')`;
    const service = createContextService({ sql: f.sql }); const actor = { email: f.ownerEmail, isAdmin: true };
    const a = await service.search(actor, { query: "Same official", kind: "source", tripId: String(f.trips[0].id) });
    const b = await service.search(actor, { query: "Same official", kind: "source", tripId: String(f.trips[1].id) });
    expect(a.items[0].ref.id).not.toBe(b.items[0].ref.id); expect(a.items[0].parent.label).toBe("Context A");
    expect((await service.read(actor, a.items[0].ref)).content.number).toBe(1);
    await expect(service.search({ email: "member@example.com" })).rejects.toMatchObject({ code: "PILOT_FORBIDDEN" });
  } finally { await f.close(); }
});
test("trip context gives the assistant exact expense totals without exposing member emails", async () => {
  const f = await fixture();
  try {
    const [activity] = await f.sql`INSERT INTO activities(trip_id,item_key,sort_order,start_date,start_time,end_date,end_time,type,icon,title,detail)
      VALUES(${f.trips[0].id},'assistant-expense',0,'2030-01-01','09:00','2030-01-01','10:00','Meal','🍜','Assistant expense','Expense context fixture')
      RETURNING id`;
    await f.sql`INSERT INTO activity_expenses(trip_id,activity_id,payer_email,amount_minor,created_by_email,updated_by_email)
      VALUES(${f.trips[0].id},${activity.id},${f.ownerEmail},125,${f.ownerEmail},${f.ownerEmail})`;

    const context = await createContextService({ sql: f.sql }).read(
      { email: f.ownerEmail, isAdmin: true },
      f.refs[0],
    );

    expect(context.available).toBe(true);
    expect(context.content.expenses).toMatchObject({
      currency: "JPY",
      totalAmount: "125",
      averageAmount: "125",
      participantCount: 1,
      recentEntriesTruncated: false,
    });
    expect(context.content.expenses.activities).toEqual([
      expect.objectContaining({ activityId: String(activity.id), title: "Assistant expense", totalAmount: "125", expenseCount: 1 }),
    ]);
    expect(context.content.expenses.recentEntries).toEqual([
      expect.objectContaining({ activityId: String(activity.id), payer: "Assistant fixture", amount: "125", recordedBy: "Assistant fixture" }),
    ]);
    expect(JSON.stringify(context.content.expenses)).not.toContain(f.ownerEmail);
  } finally { await f.close(); }
});
test("a conversation referencing A publishes and applies an explicit proposal only to B", async () => {
  const f = await fixture();
  try {
    const accepted = await f.accept({ mentions: [f.refs[0]] });
    const service = createContextService({ sql: f.sql, readSnapshot: async (slug) => {
      const [trip] = await f.sql`SELECT * FROM trips WHERE slug=${slug}`;
      return { tripId: String(trip.id), revision: Number(trip.plan_revision), trip: { slug: trip.slug, title: trip.title, timezone: trip.timezone },
        sources: [], backbone: [], branchGroups: [], itinerary: [] };
    } });
    const prepared = await preparePlanChanges({ actor: { email: f.ownerEmail, isAdmin: true }, trip: f.refs[1],
      operations: [{ kind: "source.add", draftId: "official", title: "Official", url: "https://example.com" }],
      evidence: [{ url: "https://example.com" }], contextService: service });
    const proposal = { id: randomUUID(), tripId: prepared.targetSnapshot.tripId, operations: prepared.compiledProposal.operations,
      preview: prepared.compiledProposal.preview, baseRevision: prepared.targetSnapshot.revision, digest: "test", tokenHash: "test", expiresAt: new Date(Date.now()+60000).toISOString() };
    const turn = await f.store.publishTurn({ turnId: accepted.turn.id, output: "Review B", citations: [], proposal });
    expect(turn.changeSet.tripSlug).toBe(f.trips[1].slug);
    await commitStoredChangeSet({ store: f.store, changeSet: turn.changeSet, actorEmail: f.ownerEmail });
    expect(await f.sql`SELECT id FROM sources WHERE trip_id=${f.trips[0].id}`).toHaveLength(0);
    expect(await f.sql`SELECT id FROM sources WHERE trip_id=${f.trips[1].id}`).toHaveLength(1);
  } finally { await f.close(); }
});
for (const [width, height] of [[320,760],[1440,900],[1920,1080]]) {
  test(`mentions, pins, no-trip send and independent navigation at ${width}`, async ({ page }) => {
    const f = await fixture();
    try {
    await useFixtureActor(page, f);
    await page.setViewportSize({ width, height });
    await gotoHealthy(page, "/assistant");
    const input = page.getByLabel("Yêu cầu cho trợ lý"); await expect(input).toBeEnabled();
    await input.fill("Tìm ý tưởng cho cuối tuần"); await input.press("Enter");
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Dừng", exact: true })).toHaveCount(0, { timeout: 20000 });
    const conversation = new URL(page.url()).searchParams.get("conversation"); expect(conversation).toBeTruthy();
    await page.reload(); await expect(input).toBeEnabled(); await expect(page.getByRole("article")).toHaveCount(1);
    await input.press("@");
    const picker = page.getByRole("dialog"); await expect(picker).toBeVisible();
    await picker.getByLabel("Loại ngữ cảnh").selectOption("trip");
    const result = picker.locator("li button").first(); await expect(result).toBeVisible();
    await mkdir(".impeccable/review/assistant-context", { recursive: true });
    await page.screenshot({ path: `.impeccable/review/assistant-context/${width}-picker.png` });
    await result.click();
    const attachments = page.getByRole("list", { name: "Ngữ cảnh sắp gửi" });
    const attachmentLayout = await page.evaluate(() => {
      const input = document.getElementById("assistant-message").getBoundingClientRect();
      const list = document.querySelector('[aria-label="Ngữ cảnh sắp gửi"]').getBoundingClientRect();
      const tools = [...document.querySelectorAll("button")].find((button) => button.textContent.startsWith("Công cụ")).getBoundingClientRect();
      const send = document.querySelector('button[aria-label="Gửi yêu cầu"]').getBoundingClientRect();
      return { inputBottom: input.bottom, listTop: list.top, listBottom: list.bottom, listHeight: list.height, toolsRight: tools.right, listLeft: list.left, sendBottom: send.bottom };
    });
    expect(attachmentLayout.listTop).toBeGreaterThanOrEqual(attachmentLayout.inputBottom);
    expect(attachmentLayout.listBottom).toBeLessThanOrEqual(attachmentLayout.sendBottom);
    expect(attachmentLayout.listHeight).toBeLessThanOrEqual(44);
    expect(attachmentLayout.toolsRight).toBeLessThanOrEqual(attachmentLayout.listLeft);
    await attachments.getByRole("button", { name: /^Ghim/ }).click();
    const pins = page.getByRole("list", { name: "Ngữ cảnh đã ghim" }); await expect(pins).toBeVisible();
    await expect(pins.getByRole("button", { name: /^Bỏ ghim/ })).toBeEnabled();
    await input.fill("So sánh thông tin đã thêm"); await input.press("Enter");
    await expect(page.getByRole("article")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Dừng", exact: true })).toHaveCount(0, { timeout: 20000 });
    await expect(page.getByRole("list", { name: "Ngữ cảnh tin nhắn" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Ngữ cảnh đã dùng" })).toBeVisible();
    await input.fill("Bản nháp cùng cuộc trò chuyện");
    await page.getByRole("link", { name: "Thu nhỏ", exact: true }).click();
    await expect(input).toHaveValue("Bản nháp cùng cuộc trò chuyện");
    await expect(page.getByRole("button", { name: "Thêm chuyến đi này", exact: true })).toBeVisible();
    const visibleTrip = await page.getByRole("combobox", { name: "Chọn chuyến đi", includeHidden: true }).inputValue();
    expect(new URL(page.url()).searchParams.get("conversation")).toBe(conversation);
    await page.getByRole("link", { name: "Mở rộng", exact: true }).click();
    await expect(input).toHaveValue("Bản nháp cùng cuộc trò chuyện");
    await expect(pins).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get("trip")).toBe(visibleTrip);
    const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
      input: document.getElementById("assistant-message").getBoundingClientRect().toJSON() }));
    expect(geometry.scroll).toBe(width); expect(geometry.input.right).toBeLessThanOrEqual(width); expect(geometry.input.bottom).toBeLessThanOrEqual(height);
    await page.screenshot({ path: `.impeccable/review/assistant-context/${width}-conversation.png` });
    await pins.getByRole("button", { name: /^Bỏ ghim/ }).click(); await expect(pins).toHaveCount(0);
    await page.reload(); await expect(input).toHaveValue("Bản nháp cùng cuộc trò chuyện"); await expect(pins).toHaveCount(0);
    } finally { await f.close(); }
  });
}

test("tool chooser supports model-only messages, keyboard focus and conversation persistence",async({page})=>{
  const f=await fixture();
  try {
  await useFixtureActor(page,f);
  await page.setViewportSize({width:320,height:760});
  await gotoHealthy(page,"/assistant");
  await expect(page.getByLabel("Yêu cầu cho trợ lý")).toBeEnabled();
  const trigger=page.getByRole("button",{name:"Công cụ 8/8",exact:true});
  await expect(trigger).toBeVisible();
  await trigger.focus();await page.keyboard.press("Enter");await expect(trigger).toHaveAttribute("aria-expanded","true");
  const chooser=page.getByRole("region",{name:"Công cụ cho tin nhắn này"});
  await expect(chooser.getByRole("checkbox")).toHaveCount(8);
  for(const checkbox of await chooser.getByRole("checkbox").all())await checkbox.uncheck();
  await expect(page.getByRole("button",{name:"Công cụ 0/8",exact:true})).toBeVisible();
  await expect(chooser).toContainText("chỉ trả lời từ tin nhắn");
  await page.keyboard.press("Escape");await expect(page.getByRole("button",{name:"Công cụ 0/8",exact:true})).toBeFocused();
  let submitted;
  await page.route("**/api/v1/assistant/turns",async route=>{submitted=route.request().postDataJSON();await route.continue();});
  const input=page.getByLabel("Yêu cầu cho trợ lý");await input.fill("Chỉ trả lời từ lời nhắn này");await input.press("Enter");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("button",{name:"Dừng",exact:true})).toHaveCount(0,{timeout:20000});
  expect(submitted.allowedTools).toEqual([]);
  const conversation=new URL(page.url()).searchParams.get("conversation");expect(conversation).toBeTruthy();
  await page.reload();await expect(page.getByRole("button",{name:"Công cụ 0/8",exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(320);
  } finally {await f.close();}
});
