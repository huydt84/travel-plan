import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { createAssistantStore } from "../../lib/v1/store.mjs";
import { createBatchStore } from "../../lib/v1/batch-store.mjs";
import { createBackgroundStore } from "../../lib/v1/background-store.mjs";
import { compileBatch } from "../../lib/v1/batch-proposal.mjs";
import { createContextService } from "../../lib/v1/context.mjs";
import { expect, test, gotoHealthy } from "./fixtures.mjs";

async function fixture() {
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI), email = `batch-${randomUUID()}@example.com`, slug = `batch-${randomUUID()}`;
  await sql`INSERT INTO users(email,name,role,first_login,last_login,last_active_at) VALUES(${email},'Batch reviewer','admin',NOW(),NOW(),NOW())`;
  const store = createAssistantStore({ sql }), batches = createBatchStore(sql, "local-agentic-v1-secret");
  const args = { operations: [
    { kind: "trip.create", draftId: "trip", value: { slug, title: "Chuyến đi Kyoto", startDate: "2030-04-01", endDate: "2030-04-01", timezone: "Asia/Tokyo", location: "Kyoto" } },
    { kind: "source.create", draftId: "official", trip: { draftId: "trip" }, value: { title: "Thông tin chính thức", url: "https://www.japan.travel/" } },
    { kind: "place.create", draftId: "museum", trip: { draftId: "trip" }, value: { name: "Bảo tàng Kyoto", address: "Kyoto, Japan", notes: "Kiểm tra giờ mở cửa trước chuyến đi." } },
    ...Array.from({ length: 5 }, (_, i) => ({ kind: "activity.create", draftId: `visit${i}`, trip: { draftId: "trip" }, value: { title: `Tham quan ${i+1}`, detail: "Hoạt động thử nghiệm", type: "Visit", icon: "pin", startDate: "2030-04-01", endDate: "2030-04-01", start: `${String(9+i).padStart(2,"0")}:00`, end: `${String(10+i).padStart(2,"0")}:00`, sources: [{ draftId: "official" }], place: { draftId: "museum" } } })),
  ] };
  const citations = [{ id: "E1", kind: "web", title: "Japan Travel", url: "https://www.japan.travel/" }];
  const stage = async (input = args, snapshots = [], evidence = citations) => {
    const accepted = await store.acceptRequest({ ownerEmail: email, clientTurnId: randomUUID(), input: "Tạo chuyến đi với hoạt động, nguồn và địa điểm", title: "Batch approval", leaseMs: 60000, maxTurnsPerHour: 100, background: true });
    const compiled = compileBatch(input, snapshots, evidence);
    const action = await batches.stage({ turnId: accepted.turn.id, call: { id: randomUUID(), arguments: input }, compiled, citations: evidence, usedContext: [], lifetimeMs: 1800000, email });
    return { ...accepted, action };
  };
  const finish = async (turnId) => store.publishTurn({ turnId, output: "Done", citations: [] });
  const close = async () => {
    await sql`DELETE FROM assistant_conversations WHERE owner_email=${email}`;
    await sql`DELETE FROM trips WHERE slug LIKE ${slug + '%'}`;
    await sql`DELETE FROM users WHERE email=${email}`; await sql.end();
  };
  return { sql, email, slug, store, batches, args, stage, finish, close };
}

async function snapshotFromDatabase(sql, tripId) {
  const [t] = await sql`SELECT id::TEXT,slug,title,trip_date::TEXT AS "startDate",end_date::TEXT AS "endDate",timezone,location,plan_revision FROM trips WHERE id=${tripId}`;
  const sources=await sql`SELECT id::TEXT,source_number AS number,title,host,url FROM sources WHERE trip_id=${tripId}`;
  const places=await sql`SELECT id::TEXT,name,address,latitude,longitude,website,google_place_id AS "googlePlaceId",notes FROM saved_places WHERE trip_id=${tripId}`;
  const backbone=await sql`SELECT a.id::TEXT,a.item_key AS key,a.start_date::TEXT AS "startDate",a.end_date::TEXT AS "endDate",to_char(a.start_time,'HH24:MI') AS start,to_char(a.end_time,'HH24:MI') AS end,a.type,a.icon,a.title,a.detail,a.display_end AS "displayEnd",a.place_id::TEXT AS "placeId",a.branch_id::TEXT AS "branchId",COALESCE(array_agg(s.source_number) FILTER(WHERE s.id IS NOT NULL),'{}') AS refs FROM activities a LEFT JOIN activity_sources l ON l.activity_id=a.id LEFT JOIN sources s ON s.id=l.source_id WHERE a.trip_id=${tripId} GROUP BY a.id`;
  return {tripId,revision:Number(t.plan_revision),trip:t,sources,places,backbone,itinerary:backbone,branchGroups:[]};
}

test("all four update types and multiple targets commit against final dates and preserve links",async()=>{
  const f=await fixture();
  try {
    const initial=await f.stage(); const saved=await f.batches.approve(initial.action.id,f.email,initial.action.confirmationToken); await f.finish(initial.turn.id);
    const first=await snapshotFromDatabase(f.sql,saved.receipt.createdIds.trip);
    const args={operations:[
      {kind:"trip.update",target:{id:first.tripId},set:{startDate:"2030-04-02",endDate:"2030-04-02",title:"Kyoto đã cập nhật"}},
      {kind:"source.update",trip:{id:first.tripId},target:{id:first.sources[0].id},set:{title:"Nguồn đã kiểm tra"}},
      {kind:"place.update",trip:{id:first.tripId},target:{id:first.places[0].id},set:{notes:"Mang theo vé"}},
      ...first.backbone.map(a=>({kind:"activity.update",trip:{id:first.tripId},target:{id:a.id},set:{startDate:"2030-04-02",endDate:"2030-04-02"}})),
      {kind:"trip.create",draftId:"second",value:{...f.args.operations[0].value,slug:f.slug+"-second",title:"Chuyến đi thứ hai"}},
    ]};
    const staged=await f.stage(args,[first]);
    await f.batches.approve(staged.action.id,f.email,staged.action.confirmationToken);
    const result=await snapshotFromDatabase(f.sql,first.tripId);
    expect(result.trip.startDate).toBe("2030-04-02");expect(result.sources[0].title).toBe("Nguồn đã kiểm tra");expect(result.places[0].notes).toBe("Mang theo vé");
    expect(result.backbone.map(a=>a.key).sort()).toEqual(first.backbone.map(a=>a.key).sort());
    expect(result.backbone.every(a=>a.placeId===first.places[0].id && a.refs.length===1 && a.startDate==="2030-04-02")).toBe(true);
    const context=createContextService({sql:f.sql}); const actor={email:f.email,isAdmin:true};
    const places=await context.search(actor,{kind:"place",tripId:first.tripId});
    expect(places.items[0].ref.id).toBe(`saved:${first.places[0].id}`);
    expect((await context.read(actor,places.items[0].ref)).content.notes).toBe("Mang theo vé");
  }finally{await f.close();}
});

test("stale targets, non-expiring approvals, and immutable arguments cannot be applied",async()=>{
  const f=await fixture();
  try {
    const initial=await f.stage();const saved=await f.batches.approve(initial.action.id,f.email,initial.action.confirmationToken);await f.finish(initial.turn.id);
    const snapshot=await snapshotFromDatabase(f.sql,saved.receipt.createdIds.trip);
    const args={operations:[{kind:"trip.update",target:{id:snapshot.tripId},set:{title:"Never saved"}}]};
    const staged=await f.stage(args,[snapshot]);
    await expect(f.sql`UPDATE assistant_actions SET operations='[]' WHERE id=${staged.action.id}::UUID`).rejects.toThrow("Immutable");
    await f.sql`UPDATE trips SET title='Concurrent editor' WHERE id=${snapshot.tripId}`;
    await expect(f.batches.approve(staged.action.id,f.email,staged.action.confirmationToken)).rejects.toMatchObject({code:"PLAN_CONFLICT"});
    expect((await snapshotFromDatabase(f.sql,snapshot.tripId)).trip.title).toBe("Concurrent editor");
    const accepted=await f.store.acceptRequest({ownerEmail:f.email,clientTurnId:randomUUID(),input:"Approval can wait",title:"Approval can wait",leaseMs:60000,maxTurnsPerHour:100});
    const pending=await f.batches.stage({turnId:accepted.turn.id,call:{id:"pending",arguments:args},compiled:compileBatch(args,[await snapshotFromDatabase(f.sql,snapshot.tripId)]),citations:[],usedContext:[],lifetimeMs:-86400000,email:f.email});
    await f.store.reconcile(f.email);
    expect((await f.batches.list([accepted.turn.id],f.email))[0]).toMatchObject({ id: pending.id, status: "pending", expiresAt: null });
    expect((await f.store.getTurn(accepted.turn.id,f.email)).status).toBe("awaiting_approval");
    await f.batches.reject(pending.id, f.email);
  }finally{await f.close();}
});

test("approval rejects a legacy pending action that contains a provider grounding redirect", async () => {
  const f = await fixture();
  try {
    const redirect = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/provider-token";
    const legacyArgs = { operations: [
      { kind: "trip.create", draftId: "trip", value: { ...f.args.operations[0].value, slug: `${f.slug}-legacy-redirect` } },
      { kind: "source.create", draftId: "source", trip: { draftId: "trip" }, value: { title: "Legacy redirect", url: redirect } },
    ] };
    const accepted = await f.store.acceptRequest({ ownerEmail: f.email, clientTurnId: randomUUID(), input: "Legacy redirect", title: "Legacy redirect", leaseMs: 60000, maxTurnsPerHour: 100, background: true });
    const compiled = {
      operations: [
        { kind: "trip.create", ref: { draftId: "trip" }, trip: { draftId: "trip" }, value: { ...legacyArgs.operations[0].value } },
        { kind: "source.create", ref: { draftId: "source" }, trip: { draftId: "trip" }, value: { title: "Legacy redirect", host: "vertexaisearch.cloud.google.com", url: redirect, number: 1 } },
      ],
      revisions: {}, evidenceRefs: ["E1"],
      preview: { summary: "Tạo 1 chuyến đi, Thêm 1 nguồn", groups: [], changes: [], warnings: [] },
    };
    const action = await f.batches.stage({ turnId: accepted.turn.id, call: { id: "legacy", arguments: legacyArgs }, compiled,
      citations: [{ id: "E1", kind: "web", title: "Legacy redirect", url: redirect }], usedContext: [], lifetimeMs: 1800000, email: f.email });
    await expect(f.batches.approve(action.id, f.email, action.confirmationToken)).rejects.toMatchObject({ code: "ACTION_SOURCE_INVALID" });
    expect(await f.sql`SELECT id FROM trips WHERE slug=${legacyArgs.operations[0].value.slug}`).toHaveLength(0);
  } finally { await f.close(); }
});

test("pending batch can be revised into a fresh immutable approval", async () => {
  const f = await fixture();
  try {
    const initial = await f.stage();
    const [historical] = await f.sql`SELECT to_jsonb(a)-ARRAY['status','decided_at'] AS payload FROM assistant_actions a WHERE id=${initial.action.id}::UUID`;
    const context = createContextService({ sql: f.sql });
    const actor = { email: f.email, isAdmin: true };
    const revised = await f.batches.revise({
      id: initial.action.id,
      email: f.email,
      expectedDigest: initial.action.digest,
      edits: [
        { targetKey: "trip:draft:trip", field: "title", value: "Kyoto đã chỉnh giờ" },
        { targetKey: "activity:draft:visit1", field: "start", value: "10:30" },
        { targetKey: "activity:draft:visit1", field: "title", value: "Tham quan mới" },
      ],
      actor,
      contextService: context,
      lifetimeMs: 1800000,
    });
    expect(revised.id).not.toBe(initial.action.id);
    expect(revised.revision).toBe(1);
    expect(revised.status).toBe("pending");
    expect(revised.confirmationToken).toBeTruthy();
    expect(revised.confirmationToken).not.toBe(initial.action.confirmationToken);
    expect(revised.expiresAt).toBeNull();
    expect(revised.preview.changes.find((change) => change.targetKey === "activity:draft:visit1").after.key)
      .toBe(initial.action.preview.changes.find((change) => change.targetKey === "activity:draft:visit1").after.key);
    expect(revised.preview.changes.find((change) => change.targetKey === "trip:draft:trip").after.title).toBe("Kyoto đã chỉnh giờ");
    await expect(f.batches.revise({
      id: initial.action.id, email: f.email, expectedDigest: initial.action.digest,
      edits: [{ targetKey: "activity:draft:visit1", field: "sources", value: "not allowed" }],
      actor, contextService: context, lifetimeMs: 1800000,
    })).rejects.toMatchObject({ code: "ACTION_RESOLVED" });
    expect((await f.sql`SELECT status FROM assistant_actions WHERE id=${initial.action.id}::UUID`)[0].status).toBe("superseded");
    expect((await f.sql`SELECT to_jsonb(a)-ARRAY['status','decided_at'] AS payload FROM assistant_actions a WHERE id=${initial.action.id}::UUID`)[0]).toEqual(historical);
    expect((await f.batches.list([initial.turn.id], f.email)).map((item) => item.id)).toEqual([revised.id]);
    await expect(f.batches.approve(revised.id, f.email, initial.action.confirmationToken)).rejects.toMatchObject({ code: "CONFIRMATION_INVALID" });
    const saved = await f.batches.approve(revised.id, f.email, revised.confirmationToken);
    const snapshot = await snapshotFromDatabase(f.sql, saved.receipt.createdIds.trip);
    expect(snapshot.trip.title).toBe("Kyoto đã chỉnh giờ");
    expect(snapshot.backbone.find((item) => item.title === "Tham quan mới").start).toBe("10:30");
    const replay = await f.batches.approve(revised.id, f.email, revised.confirmationToken);
    expect(replay.receipt).toEqual(saved.receipt);
    expect((await f.store.getTurn(initial.turn.id, f.email)).continuation).toHaveLength(1);
  } finally { await f.close(); }
});

test("revision rejects stale digests and relationship edits without changing the pending action", async () => {
  const f = await fixture();
  try {
    const initial = await f.stage();
    const context = createContextService({ sql: f.sql });
    const actor = { email: f.email, isAdmin: true };
    await expect(f.batches.revise({
      id: initial.action.id, email: f.email, expectedDigest: "0".repeat(64),
      edits: [{ targetKey: "trip:draft:trip", field: "title", value: "Không lưu" }],
      actor, contextService: context, lifetimeMs: 1800000,
    })).rejects.toMatchObject({ code: "EDIT_STALE" });
    await expect(f.batches.revise({
      id: initial.action.id, email: f.email, expectedDigest: initial.action.digest,
      edits: [{ targetKey: "activity:draft:visit1", field: "sources", value: null }],
      actor, contextService: context, lifetimeMs: 1800000,
    })).rejects.toMatchObject({ code: "EDIT_FIELD_INVALID" });
    await expect(f.batches.revise({
      id: initial.action.id, email: f.email, expectedDigest: initial.action.digest,
      edits: [{ targetKey: "source:draft:official", field: "url", value: "https://example.com/" }],
      actor, contextService: context, lifetimeMs: 1800000,
    })).rejects.toMatchObject({ code: "EDIT_SOURCE_EVIDENCE_REQUIRED" });
    expect((await f.sql`SELECT status FROM assistant_actions WHERE id=${initial.action.id}::UUID`)[0].status).toBe("pending");
    expect(await f.sql`SELECT id FROM trips WHERE slug=${f.slug}`).toHaveLength(0);
  } finally { await f.close(); }
});

test("a source URL revision uses stored evidence and regenerates only its derived host", async () => {
  const f = await fixture();
  try {
    const initial = await f.stage(f.args, [], [{ url: "https://www.japan.travel/" }, { url: "https://www.example.org/researched" }]);
    const revised = await f.batches.revise({ id: initial.action.id, email: f.email, expectedDigest: initial.action.digest,
      edits: [{ targetKey: "source:draft:official", field: "url", value: "https://www.example.org/researched" }],
      actor: { email: f.email, isAdmin: true }, contextService: createContextService({ sql: f.sql }), lifetimeMs: 1800000 });
    expect(revised.preview.changes.find((change) => change.targetKey === "source:draft:official").after).toMatchObject({ host: "example.org", number: 1 });
    const saved = await f.batches.approve(revised.id, f.email, revised.confirmationToken);
    expect((await snapshotFromDatabase(f.sql, saved.receipt.createdIds.trip)).sources[0]).toMatchObject({ url: "https://www.example.org/researched", host: "example.org", number: 1 });
  } finally { await f.close(); }
});

test("revision fences a trip changed after snapshot compilation", async () => {
  const f = await fixture();
  try {
    const initial = await f.stage();
    const applied = await f.batches.approve(initial.action.id, f.email, initial.action.confirmationToken);
    await f.finish(initial.turn.id);
    const snapshot = await snapshotFromDatabase(f.sql, applied.receipt.createdIds.trip);
    const pending = await f.stage({ operations: [{ kind: "trip.update", target: { id: snapshot.tripId }, set: { title: "Proposed" } }] }, [snapshot]);
    const contextService = { targetSnapshot: async () => {
      await f.sql`UPDATE trips SET title='Concurrent edit' WHERE id=${snapshot.tripId}`;
      return snapshot;
    } };
    await expect(f.batches.revise({
      id: pending.action.id, email: f.email, expectedDigest: pending.action.digest,
      actor: { email: f.email, isAdmin: true }, contextService, lifetimeMs: 1800000,
      edits: [{ targetKey: `trip:id:${snapshot.tripId}`, field: "title", value: "Revision" }],
    })).rejects.toMatchObject({ code: "PLAN_CONFLICT" });
    expect((await f.batches.list([pending.turn.id], f.email))[0].id).toBe(pending.action.id);
    expect((await snapshotFromDatabase(f.sql, snapshot.tripId)).trip.title).toBe("Concurrent edit");
  } finally { await f.close(); }
});

test("revision rejects forged fields, duplicate edits, and cross-account reads", async () => {
  const f = await fixture();
  try {
    const pending = await f.stage();
    const base = { id: pending.action.id, email: f.email, expectedDigest: pending.action.digest,
      actor: { email: f.email, isAdmin: true }, contextService: createContextService({ sql: f.sql }), lifetimeMs: 1800000 };
    for (const [targetKey, field] of [["activity:draft:visit1","key"],["activity:draft:visit1","branchId"],["source:draft:official","number"],["source:draft:official","host"],["place:draft:museum","googlePlaceId"]]) {
      await expect(f.batches.revise({ ...base, edits: [{ targetKey, field, value: "forged" }] })).rejects.toMatchObject({ code: "EDIT_FIELD_INVALID" });
    }
    const edit = { targetKey: "trip:draft:trip", field: "title", value: "Changed" };
    await expect(f.batches.revise({ ...base, edits: [edit,edit] })).rejects.toMatchObject({ code: "EDIT_DUPLICATE" });
    await expect(f.batches.revise({ ...base, edits: [{ ...edit, targetKey: "trip:draft:unknown" }] })).rejects.toMatchObject({ code: "EDIT_TARGET_INVALID" });
    await expect(f.batches.revise({ ...base, edits: [{ targetKey: "place:draft:museum", field: "latitude", value: 91 }] })).rejects.toMatchObject({ code: "EDIT_VALUE_INVALID", details: { fieldErrors: [{ targetKey: "place:draft:museum", field: "latitude" }] } });
    await expect(f.batches.revise({ ...base, edits: [{ targetKey: "activity:draft:visit1", field: "start", value: "09:30" }] })).rejects.toMatchObject({ code: "BATCH_INVALID" });
    await expect(f.batches.revise({ ...base, edits: [edit], email: "someone-else@example.com" })).rejects.toMatchObject({ code: "ACTION_NOT_FOUND" });
    await f.sql`UPDATE users SET role='member' WHERE email=${f.email}`;
    await expect(f.batches.revise({ ...base, edits: [edit] })).rejects.toMatchObject({ code: "PA001" });
    await f.sql`UPDATE users SET role='admin' WHERE email=${f.email}`;
    expect((await f.batches.list([pending.turn.id], f.email))[0].status).toBe("pending");
    await f.batches.reject(pending.action.id, f.email);
  } finally { await f.close(); }
});

test("revision and approval serialize so only one request can win", async () => {
  const f = await fixture();
  try {
    const initial = await f.stage();
    const context = createContextService({ sql: f.sql });
    const actor = { email: f.email, isAdmin: true };
    const outcomes = await Promise.allSettled([
      f.batches.revise({
        id: initial.action.id, email: f.email, expectedDigest: initial.action.digest,
        edits: [{ targetKey: "trip:draft:trip", field: "title", value: "Race revised" }],
        actor, contextService: context, lifetimeMs: 1800000,
      }),
      f.batches.approve(initial.action.id, f.email, initial.action.confirmationToken),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const latest = (await f.batches.list([initial.turn.id], f.email))[0];
    if (outcomes[0].status === "fulfilled") {
      expect(latest.id).toBe(outcomes[0].value.id);
      await f.batches.approve(latest.id, f.email, latest.confirmationToken);
    } else {
      expect(outcomes[0].reason.code).toBe("ACTION_RESOLVED");
      expect(latest.status).toBe("applied");
    }
    expect(await f.sql`SELECT id FROM trips WHERE slug=${f.slug}`).toHaveLength(1);
  } finally { await f.close(); }
});

for (const [width, height] of [[320, 760], [1440, 900], [1920, 1080]]) test(`batch review edits a proposed title inline before approval at ${width}`, async ({ page }, testInfo) => {
  const f = await fixture();
  try {
    const staged = await f.stage();
    await createBackgroundStore(f.store).append(staged.turn.id, { runId: staged.turn.id, type: "awaiting_approval", segment: 0, turn: await f.store.getTurn(staged.turn.id, f.email) });
    await page.setExtraHTTPHeaders({ "x-local-viewer-email": f.email });
    await page.setViewportSize({ width, height });
    await gotoHealthy(page, `/assistant?conversation=${staged.conversation.id}`);
    const review = page.getByRole("region", { name: "Yêu cầu thay đổi" });
    await review.getByRole("button", { name: "Chỉnh sửa", exact: true }).click();
    await expect(review.getByRole("button", { name: "Tạo lại đề xuất", exact: true })).toHaveCount(0);
    const title = review.locator('input[value="Chuyến đi Kyoto"]');
    await expect(review.locator("input").first()).toBeFocused();
    const geometry = await review.evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth,
      controls: [...el.querySelectorAll("input,textarea,button")].map((item) => ({ height: item.getBoundingClientRect().height, width: item.getBoundingClientRect().width })) }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
    expect(geometry.controls.every((control) => control.height >= 44 && control.width >= 44)).toBe(true);
    await mkdir(testInfo.outputPath("captures"), { recursive: true });
    await page.screenshot({ path: testInfo.outputPath(`captures/edit-${width}.png`) });
    await title.fill("Kyoto chỉnh sửa trực tiếp");
    await review.getByRole("group", { name: "Hoạt động: Tham quan 2", exact: true }).locator('input[type="time"]').first().fill("10:30");
    const submission = page.waitForRequest((request) => request.url().endsWith("/revise") && request.method() === "POST");
    await review.getByRole("button", { name: "Lưu bản chỉnh sửa", exact: true }).click();
    expect((await submission).postDataJSON().edits).toHaveLength(2);
    await expect(review.getByRole("heading", { name: "Đã cập nhật đề xuất. Chưa lưu vào lịch trình.", exact: true })).toBeVisible();
    await expect(review.getByRole("heading", { name: "Đã cập nhật đề xuất. Chưa lưu vào lịch trình.", exact: true })).toBeFocused();
    await page.reload();
    await expect(review.getByRole("heading", { name: "Đã cập nhật đề xuất. Chưa lưu vào lịch trình.", exact: true })).toBeVisible();
    await review.getByText("Xem 8 thay đổi", { exact: true }).click();
    await expect(review.locator("ins").filter({ hasText: "Kyoto chỉnh sửa trực tiếp" })).toBeVisible();
    await review.getByRole("button", { name: "Phê duyệt thay đổi", exact: true }).click();
    await expect(review.getByRole("heading", { name: "Đã lưu", exact: true })).toBeVisible();
    await expect(page.getByText("Đã lưu toàn bộ nhóm thay đổi được phê duyệt.", { exact: true })).toBeVisible({ timeout: 30000 });
    const [trip] = await f.sql`SELECT title FROM trips WHERE slug=${f.slug}`;
    expect(trip.title).toBe("Kyoto chỉnh sửa trực tiếp");
  } finally { await f.close(); }
});

test("batch review preserves an invalid draft and shows an inline review error", async ({ page, runtimeHealth }) => {
  const f = await fixture();
  try {
    const staged = await f.stage();
    await createBackgroundStore(f.store).append(staged.turn.id, { runId: staged.turn.id, type: "awaiting_approval", segment: 0, turn: await f.store.getTurn(staged.turn.id, f.email) });
    await page.setExtraHTTPHeaders({ "x-local-viewer-email": f.email });
    await gotoHealthy(page, `/assistant?conversation=${staged.conversation.id}`);
    const review = page.getByRole("region", { name: "Yêu cầu thay đổi" });
    await review.getByRole("button", { name: "Chỉnh sửa", exact: true }).click();
    const title = review.locator('input[id*="title"]').first();
    await title.fill("");
    await review.getByRole("button", { name: "Lưu bản chỉnh sửa", exact: true }).click();
    await expect(review.getByRole("alert")).toContainText("không hợp lệ");
    await expect(title).toHaveValue("");
    await expect(title).toHaveAttribute("aria-invalid", "true");
    runtimeHealth.splice(0, runtimeHealth.length, ...runtimeHealth.filter((message) => !message.includes("server responded with a status of 400")));
    await review.getByRole("button", { name: "Hủy", exact: true }).click();
    await expect(review.getByRole("button", { name: "Phê duyệt thay đổi", exact: true })).toBeVisible();
    expect(await f.sql`SELECT id FROM trips WHERE slug=${f.slug}`).toHaveLength(0);
  } finally { await f.close(); }
});

test("mixed batch approval is atomic, idempotent, durable and individually gated", async () => {
  const f = await fixture();
  try {
    const staged = await f.stage();
    expect(await f.sql`SELECT id FROM trips WHERE slug=${f.slug}`).toHaveLength(0);
    expect((await f.store.getTurn(staged.turn.id, f.email)).status).toBe("awaiting_approval");
    await f.store.reconcile(f.email);
    await expect(f.batches.approve(staged.action.id, f.email, "x".repeat(43))).rejects.toMatchObject({ code: "CONFIRMATION_INVALID" });
    await expect(f.batches.approve(staged.action.id, "other@example.com", staged.action.confirmationToken)).rejects.toMatchObject({ code: "ACTION_NOT_FOUND" });
    const [first, duplicate] = await Promise.all([f.batches.approve(staged.action.id, f.email, staged.action.confirmationToken), f.batches.approve(staged.action.id, f.email, staged.action.confirmationToken)]);
    expect(first.receipt).toEqual(duplicate.receipt); expect(first.receipt.resources).toHaveLength(8);
    expect(await f.sql`SELECT id FROM activities WHERE trip_id=${first.receipt.createdIds.trip}`).toHaveLength(5);
    expect(await f.sql`SELECT * FROM activity_sources WHERE activity_id IN (SELECT id FROM activities WHERE trip_id=${first.receipt.createdIds.trip})`).toHaveLength(5);
    const recovered = await f.store.getTurn(staged.turn.id, f.email);
    expect(recovered.continuation[0].receipt).toEqual(first.receipt); expect(recovered.segment).toBe(1);
    const background = createBackgroundStore(f.store);
    expect((await background.job(staged.turn.id)).segment).toBe(1);
    await f.sql`UPDATE assistant_turns SET lease_expires_at=NOW()-INTERVAL '1 minute' WHERE id=${staged.turn.id}`;
    await f.store.reconcile(f.email);
    expect((await f.store.getTurn(staged.turn.id,f.email)).status).toBe("running");
    expect((await background.pendingContinuations(f.email)).map(job=>job.id)).toContain(staged.turn.id);
    expect(await background.beginDispatch(staged.turn.id,1)).toBe(true);
    expect(await background.beginDispatch(staged.turn.id,1)).toBe(false);
    expect(await background.claim(staged.turn.id,60000,"old-worker",0)).toBe(false);
    expect(await background.claim(staged.turn.id,60000,"new-worker",1)).toBe(true);
    expect(await background.claim(staged.turn.id,60000,"duplicate-worker",1)).toBe(false);
    const nextArgs = { operations: [{ kind: "trip.create", draftId: "next", value: { ...f.args.operations[0].value, slug: f.slug + "-next" } }] };
    const next = await f.batches.stage({ turnId: staged.turn.id, segment: 1, call: { id: "second-call", arguments: nextArgs }, compiled: compileBatch(nextArgs,[]), citations: [], usedContext: [], lifetimeMs: 60000, email: f.email });
    expect(await f.sql`SELECT id FROM trips WHERE slug=${f.slug + "-next"}`).toHaveLength(0);
    await expect(f.batches.approve(next.id,f.email,staged.action.confirmationToken)).rejects.toMatchObject({code:"CONFIRMATION_INVALID"});
    await f.batches.reject(next.id,f.email);
    expect(await f.sql`SELECT id FROM trips WHERE slug=${f.slug + "-next"}`).toHaveLength(0);
    expect((await f.store.getTurn(staged.turn.id,f.email)).status).toBe("completed");
  } finally { await f.close(); }
});

test("one database error rolls back all resources and requires new approval", async () => {
  const f = await fixture();
  try {
    const args = { operations: [f.args.operations[0], { ...f.args.operations[0], draftId: "duplicate" }] };
    const staged = await f.stage(args);
    await expect(f.batches.approve(staged.action.id,f.email,staged.action.confirmationToken)).rejects.toMatchObject({code:"ACTION_FAILED"});
    expect(await f.sql`SELECT id FROM trips WHERE slug=${f.slug}`).toHaveLength(0);
    expect((await f.batches.list([staged.turn.id],f.email))[0].status).toBe("failed");
    await expect(f.batches.approve(staged.action.id,f.email,staged.action.confirmationToken)).rejects.toMatchObject({code:"ACTION_RESOLVED"});
  } finally { await f.close(); }
});

test("approval rechecks role and disabled policy, Stop invalidates approval", async () => {
  const f = await fixture();
  try {
    const staged = await f.stage();
    await f.sql`UPDATE users SET role='member' WHERE email=${f.email}`;
    await expect(f.batches.approve(staged.action.id,f.email,staged.action.confirmationToken)).rejects.toMatchObject({code:"PA001"});
    await f.sql`UPDATE users SET role='admin' WHERE email=${f.email}`;
    await f.sql`INSERT INTO assistant_policy_overrides(email,policy) VALUES(${f.email},'{"enabled":false,"daily":"inherit","weekly":"inherit","model":"inherit"}')`;
    await expect(f.batches.approve(staged.action.id,f.email,staged.action.confirmationToken)).rejects.toMatchObject({code:"PA001"});
    await f.sql`DELETE FROM assistant_policy_overrides WHERE email=${f.email}`;
    await f.store.failTurn(staged.turn.id,"TURN_CANCELLED");
    expect((await f.batches.list([staged.turn.id],f.email))[0].status).toBe("cancelled");
    await expect(f.batches.approve(staged.action.id,f.email,staged.action.confirmationToken)).rejects.toMatchObject({code:"ACTION_RESOLVED"});
    expect(await f.sql`SELECT id FROM trips WHERE slug=${f.slug}`).toHaveLength(0);
  } finally { await f.close(); }
});

test("approval and revision HTTP boundaries accept only action-bound decisions", async ({ request, baseURL }) => {
  const f=await fixture();
  try {
    const staged=await f.stage();
    const endpoint=`/api/v1/assistant/actions/${staged.action.id}/approve`;
    const data={confirmationToken:staged.action.confirmationToken};
    const headers={"x-local-viewer-email":f.email,origin:baseURL};
    expect((await request.post(endpoint,{headers:{"x-local-viewer-email":f.email},data})).status()).toBe(403);
    expect((await request.post(endpoint,{headers:{...headers,origin:"https://other.example"},data})).status()).toBe(403);
    expect((await request.post(endpoint,{headers,data:{...data,operations:[]}})).status()).toBe(400);
    expect((await request.post(endpoint,{headers,data:{confirmationToken:"x".repeat(43)}})).status()).toBe(403);
    const reviseEndpoint=`/api/v1/assistant/actions/${staged.action.id}/revise`;
    const reviseData={expectedDigest:staged.action.digest,edits:[{targetKey:"trip:draft:trip",field:"title",value:"HTTP revised"}]};
    expect((await request.post(reviseEndpoint,{headers: {"x-local-viewer-email":f.email},data:reviseData})).status()).toBe(403);
    expect((await request.post(reviseEndpoint,{headers:{...headers,origin:"https://other.example"},data:reviseData})).status()).toBe(403);
    const invalidRevision=await request.post(reviseEndpoint,{headers,data:{...reviseData,edits:[{...reviseData.edits[0],extra:true}]}});
    expect(invalidRevision.status()).toBe(400);
    const revisedResponse=await request.post(reviseEndpoint,{headers,data:reviseData});
    expect(revisedResponse.status()).toBe(200);
    const revised=await revisedResponse.json();
    expect(revised.action.revision).toBe(1);
    expect(revised.action.preview.changes.find((change)=>change.targetKey==="trip:draft:trip").after.title).toBe("HTTP revised");
    expect(await f.sql`SELECT id FROM trips WHERE slug=${f.slug}`).toHaveLength(0);
    expect((await request.post(`/api/v1/assistant/actions/${revised.action.id}/reject`,{headers,data:{}})).status()).toBe(200);
    expect((await f.batches.list([staged.turn.id],f.email))[0].status).toBe("rejected");
  } finally {await f.close();}
});

test("lost revision response reconciles once, while cancel and reload discard only unsaved edits", async ({ page, runtimeHealth }) => {
  const f = await fixture();
  try {
    const staged = await f.stage();
    await page.setExtraHTTPHeaders({ "x-local-viewer-email": f.email });
    await gotoHealthy(page, `/assistant?conversation=${staged.conversation.id}`);
    const review = page.getByRole("region", { name: "Yêu cầu thay đổi" });
    const edit = review.getByRole("button", { name: "Chỉnh sửa", exact: true });
    await edit.focus(); await page.keyboard.press("Enter");
    const title = review.locator('input[id*="title"]').first();
    await title.fill("Draft to cancel");
    await review.getByRole("button", { name: "Hủy", exact: true }).click();
    await expect(edit).toBeFocused();
    await edit.click(); await expect(title).toHaveValue("Chuyến đi Kyoto");
    await title.fill("Draft to discard on reload");
    await page.reload(); await edit.click();
    await expect(title).toHaveValue("Chuyến đi Kyoto");
    let submissions = 0;
    await page.route(`**/api/v1/assistant/actions/${staged.action.id}/revise`, async (route) => {
      submissions++;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    });
    await title.fill("Recovered revision");
    await review.getByRole("button", { name: "Lưu bản chỉnh sửa", exact: true }).click();
    await expect(review.getByRole("heading", { name: "Đã cập nhật đề xuất. Chưa lưu vào lịch trình.", exact: true })).toBeVisible();
    expect(submissions).toBe(1);
    expect((await f.batches.list([staged.turn.id], f.email))[0].revision).toBe(1);
    expect(await f.sql`SELECT id FROM trips WHERE slug=${f.slug}`).toHaveLength(0);
    runtimeHealth.splice(0, runtimeHealth.length, ...runtimeHealth.filter((message) => !message.includes("net::ERR_FAILED")));
  } finally { await f.close(); }
});

for (const [width, height] of [[320, 760], [1440, 900], [1920, 1080]]) test(`an empty trip retains navigation, notes and invitations at ${width}`, async ({ page }, testInfo) => {
  const f = await fixture();
  try {
    const staged = await f.stage({ operations: [f.args.operations[0]] });
    await f.batches.approve(staged.action.id, f.email, staged.action.confirmationToken);
    await page.setViewportSize({ width, height });
    await page.setExtraHTTPHeaders({ "x-local-viewer-email": f.email });
    await gotoHealthy(page, `/?trip=${f.slug}`);
    const created = await page.request.post(`/api/trips/${f.slug}/suggestions`, { headers: { "x-local-viewer-email": f.email }, data: { activityId: null, kind: "comment", body: "Planning before adding activities" } });
    expect(created.status()).toBe(201);
    const note = await created.json();
    await page.reload();
    await expect(page.locator(`#contribution-${note.id}`)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: testInfo.outputPath(`empty-trip-${width}.png`) });
    await expect(page.getByRole("combobox", { name: "Chọn chuyến đi" })).toHaveValue(f.slug);
    await expect(page.getByRole("button", { name: "Trợ lý", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Rủ bạn đi cùng", exact: true }).click();
    await expect(page.getByRole("dialog", { name: /Rủ bạn đi/ })).toBeVisible();
  } finally { await f.close(); }
});

test("lost approval response reconciles the receipt without repeating the write", async ({ page, runtimeHealth }) => {
  const f=await fixture();
  try {
    const staged=await f.stage();
    await page.setExtraHTTPHeaders({"x-local-viewer-email":f.email});
    await gotoHealthy(page,`/assistant?conversation=${staged.conversation.id}`);
    let submissions=0;
    await page.route(`**/api/v1/assistant/actions/${staged.action.id}/approve`,async route=>{
      submissions++;
      const response=await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    });
    await page.getByRole("button",{name:"Phê duyệt thay đổi",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Đã lưu",exact:true})).toBeVisible();
    await expect(page.getByText("Đã lưu toàn bộ nhóm thay đổi được phê duyệt.",{exact:true})).toBeVisible();
    expect(submissions).toBe(1);
    expect((await f.batches.list([staged.turn.id],f.email))[0].receipt.resources).toHaveLength(8);
    runtimeHealth.splice(0,runtimeHealth.length,...runtimeHealth.filter(message=>!message.includes("net::ERR_FAILED")));
  } finally {await f.close();}
});

for (const [width,height] of [[320,760],[1440,900],[1920,1080]]) test(`batch review, reload and approved continuation at ${width}`,async({page},testInfo)=>{
  const f=await fixture();
  try {
    const staged=await f.stage();
    await createBackgroundStore(f.store).append(staged.turn.id,{runId:staged.turn.id,type:"awaiting_approval",segment:0,turn:await f.store.getTurn(staged.turn.id,f.email)});
    await page.setExtraHTTPHeaders({"x-local-viewer-email":f.email});
    await page.setViewportSize({width,height});
    await gotoHealthy(page,`/assistant?conversation=${staged.conversation.id}`);
    const review=page.getByRole("region",{name:"Yêu cầu thay đổi"});
    await expect(review).toBeVisible();
    await page.getByRole("button",{name:"Lịch sử",exact:true}).click();
    await expect(page.getByRole("navigation",{name:"Lịch sử trò chuyện"}).getByText("Cần phê duyệt",{exact:true}).first()).toBeVisible();
    await page.getByRole("button",{name:"Đóng lịch sử",exact:true}).click();
    await page.reload(); await expect(review).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const conversationUrl=page.url();
    await expect(page.getByRole("button",{name:"Phê duyệt thay đổi",exact:true})).toBeEnabled();
    expect(await f.sql`SELECT id FROM trips WHERE slug=${f.slug}`).toHaveLength(0);
    const geometry=await review.evaluate(el=>({width:el.getBoundingClientRect().width,scroll:el.scrollWidth,client:el.clientWidth}));
    expect(geometry.width).toBeLessThanOrEqual(width);expect(geometry.scroll).toBeLessThanOrEqual(geometry.client+1);
    await mkdir(testInfo.outputPath("captures"),{recursive:true});
    await page.screenshot({path:testInfo.outputPath(`captures/batch-${width}.png`)});
    await review.getByText("Xem 8 thay đổi",{exact:true}).click();
    await review.getByRole("heading",{name:"Tạo: Bảo tàng Kyoto"}).scrollIntoViewIfNeeded();
    await page.screenshot({path:testInfo.outputPath(`captures/details-${width}.png`)});
    await page.getByRole("button",{name:"Phê duyệt thay đổi",exact:true}).click();
    await expect(page.getByText("Đã lưu toàn bộ nhóm thay đổi được phê duyệt.",{exact:true})).toBeVisible({timeout:30000});
    expect(page.url()).toBe(conversationUrl);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading",{name:"Tài nguyên đã lưu"})).toBeVisible();
    await page.screenshot({path:testInfo.outputPath(`captures/receipt-${width}.png`)});
    const [saved]=await f.sql`SELECT id FROM trips WHERE slug=${f.slug}`;
    expect(await f.sql`SELECT id FROM activities WHERE trip_id=${saved.id}`).toHaveLength(5);
    const snapshot=await snapshotFromDatabase(f.sql,String(saved.id));
    const update=await f.stage({operations:[
      {kind:"place.update",trip:{id:snapshot.tripId},target:{id:snapshot.places[0].id},set:{notes:"Mang theo vé và đến trước 15 phút."}},
      {kind:"activity.update",trip:{id:snapshot.tripId},target:{id:snapshot.backbone[0].id},set:{detail:"Đã kiểm tra thông tin từ nguồn chính thức."}},
    ]},[snapshot]);
    await gotoHealthy(page,`/assistant?conversation=${update.conversation.id}`);
    await review.getByText("Xem 2 thay đổi",{exact:true}).click();
    await review.getByRole("heading",{name:/Cập nhật: Bảo tàng/}).scrollIntoViewIfNeeded();
    await expect(review.getByText("Trước",{exact:true}).first()).toBeVisible();
    await page.screenshot({path:testInfo.outputPath(`captures/update-${width}.png`)});
    await page.getByRole("button",{name:"Từ chối",exact:true}).click();
    await expect(review.getByRole("heading",{name:"Đã từ chối",exact:true})).toBeVisible();
    await page.screenshot({path:testInfo.outputPath(`captures/rejected-${width}.png`)});
    expect((await snapshotFromDatabase(f.sql,snapshot.tripId)).places[0].notes).toBe(snapshot.places[0].notes);
    await gotoHealthy(page,`/?trip=${f.slug}#place-${snapshot.places[0].id}`);
    await expect(page.getByRole("heading",{name:"Địa điểm đã lưu"})).toBeVisible();
    await page.locator(`#place-${snapshot.places[0].id}`).scrollIntoViewIfNeeded();
    await page.screenshot({path:testInfo.outputPath(`captures/saved-place-${width}.png`)});
  } finally {await f.close();}
});
