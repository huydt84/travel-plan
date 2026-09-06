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
  const stage = async (input = args, snapshots = []) => {
    const accepted = await store.acceptRequest({ ownerEmail: email, clientTurnId: randomUUID(), input: "Tạo chuyến đi với hoạt động, nguồn và địa điểm", title: "Batch approval", leaseMs: 60000, maxTurnsPerHour: 100, background: true });
    const compiled = compileBatch(input, snapshots, citations);
    const action = await batches.stage({ turnId: accepted.turn.id, call: { id: randomUUID(), arguments: input }, compiled, citations, usedContext: [], lifetimeMs: 1800000, email });
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

test("stale targets, expired approvals, and immutable arguments cannot be applied",async()=>{
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
    const accepted=await f.store.acceptRequest({ownerEmail:f.email,clientTurnId:randomUUID(),input:"Expired",title:"Expired",leaseMs:60000,maxTurnsPerHour:100});
    const expired=await f.batches.stage({turnId:accepted.turn.id,call:{id:"expired",arguments:args},compiled:compileBatch(args,[await snapshotFromDatabase(f.sql,snapshot.tripId)]),citations:[],usedContext:[],lifetimeMs:-86400000,email:f.email});
    // Expiry is enforced by reconciliation even when no browser is connected.
    await f.store.reconcile(f.email);
    expect((await f.batches.list([accepted.turn.id],f.email))[0].status).toBe("expired");
    expect((await f.store.getTurn(accepted.turn.id,f.email)).status).toBe("completed");
    expect(expired.id).toBeTruthy();
  }finally{await f.close();}
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

test("approval HTTP boundary accepts only an action-bound decision", async ({ request, baseURL }) => {
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
    expect(await f.sql`SELECT id FROM trips WHERE slug=${f.slug}`).toHaveLength(0);
    expect((await request.post(`/api/v1/assistant/actions/${staged.action.id}/reject`,{headers,data:{}})).status()).toBe(200);
    expect((await f.batches.list([staged.turn.id],f.email))[0].status).toBe("rejected");
  } finally {await f.close();}
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
