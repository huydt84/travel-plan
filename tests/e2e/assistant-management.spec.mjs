import { mkdir } from "node:fs/promises";
import { dispatchAttempt } from "../../lib/v1/dispatch-attempt.mjs";
import { createTravelAssistant } from "../../lib/v1/travel-assistant.mjs";
import { resolveAgenticV1Config } from "../../lib/v1/config.mjs";
import { createBackgroundStore } from "../../lib/v1/background-store.mjs";
import { randomUUID } from "node:crypto";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { createAssistantStore } from "../../lib/v1/store.mjs";
import { createAssistantManagement, inheritedPolicy } from "../../lib/v1/assistant-management.mjs";
import { ASSISTANT_MODELS } from "../../lib/v1/assistant-policy.mjs";
import { commitStoredChangeSet } from "../../lib/v1/committer.mjs";
import { expect, test, gotoHealthy } from "./fixtures.mjs";
const owner="local-admin@localhost.invalid";
async function fixture() {
  const sql=createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI),email=`manage-${randomUUID()}@example.com`;
  await sql`INSERT INTO users(email,name,role,first_login,last_login,last_active_at) VALUES(${email},'Admin kiểm tra','admin',NOW(),NOW(),NOW())`;
  const store=createAssistantStore({sql}), service=createAssistantManagement(store);
  const accept=(options={})=>store.acceptRequest({ownerEmail:email,conversationId:null,clientTurnId:randomUUID(),input:"Tìm ý tưởng Tokyo",title:"Lên kế hoạch Tokyo",leaseMs:60000,maxTurnsPerHour:30,...options});
  return {sql,email,store,service,accept,close:async()=>{await sql`DELETE FROM assistant_conversations WHERE owner_email=${email}`;await sql`DELETE FROM assistant_policy_overrides WHERE email=${email}`;await sql`DELETE FROM assistant_management_audit WHERE target_email=${email}`;await sql`DELETE FROM users WHERE email=${email}`;await sql.end();}};
}
test("atomic quotas, replay, retries, inherited settings, policy conflicts and disabled mutations",async()=>{
  const f=await fixture();
  try {
    await f.service.save(owner,f.email,{...inheritedPolicy,daily:1,weekly:2,model:ASSISTANT_MODELS[0],effort:"high"});
    const outcomes=await Promise.allSettled([f.accept(),f.accept()]);
    expect(outcomes.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(outcomes.find(r=>r.status==="rejected").reason.code).toBe("PA002");
    const first=outcomes.find(r=>r.status==="fulfilled").value;
    expect(first.turn.executionSettings).toEqual({model:ASSISTANT_MODELS[0],effort:"high"});
    expect((await f.accept({clientTurnId:first.turn.clientTurnId})).replayed).toBe(true);
    expect((await f.service.access(f.email)).dailyUsed).toBe(1);
    await f.service.save(owner,f.email,{...inheritedPolicy,version:1,daily:2,weekly:2,model:ASSISTANT_MODELS[1],effort:"low"});
    await expect(f.service.save(owner,f.email,{...inheritedPolicy,version:1})).rejects.toMatchObject({code:"POLICY_CONFLICT"});
    await f.service.stop(owner,first.turn.id);
    const retry=await f.accept({conversationId:first.conversation.id,retryOfTurnId:first.turn.id});
    expect(retry.turn.executionSettings.model).toBe(ASSISTANT_MODELS[1]);
    expect((await f.store.getTurn(first.turn.id,f.email)).executionSettings.model).toBe(ASSISTANT_MODELS[0]);
    await f.service.save(owner,f.email,{...inheritedPolicy,version:2,enabled:false});
    await expect(f.accept()).rejects.toMatchObject({code:"PA001"});
    await expect(f.store.updatePins(first.conversation.id,f.email,[],0)).rejects.toMatchObject({code:"PA001"});
    // Disabling does not cancel accepted work; explicit Stop prevents later publication.
    await f.store.publishTurn({turnId:retry.turn.id,output:"Finished while disabled",citations:[]});
    await expect(f.store.publishTurn({turnId:first.turn.id,output:"Late answer",citations:[]})).rejects.toMatchObject({code:"TURN_INTERRUPTED"});
    const review=await f.service.conversation(first.conversation.id);
    expect(review.turns).toHaveLength(2);expect(JSON.stringify(review)).not.toContain("confirmationToken");
    await f.sql`UPDATE users SET role='member' WHERE email=${f.email}`;
    expect((await f.service.overview()).admins.find(a=>a.email===f.email).role).toBe("member");
  } finally {await f.close();}
});
test("Japan calendar windows, weekly cap and global switch preserve individual settings",async()=>{
  const f=await fixture();const original=(await f.service.overview()).defaults;
  try {
    await f.service.save(owner,f.email,{...inheritedPolicy,daily:null,weekly:1});
    const first=await f.accept();await f.store.failTurn(first.turn.id,"TEST");
    await expect(f.accept()).rejects.toMatchObject({code:"PA002"});
    await f.sql`UPDATE assistant_turns SET created_at=(date_trunc('week',NOW() AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo')-INTERVAL '1 microsecond' WHERE id=${first.turn.id}`;
    expect((await f.service.access(f.email)).weeklyUsed).toBe(0);
    const second=await f.accept();await f.store.failTurn(second.turn.id,"TEST");
    await f.sql`UPDATE assistant_turns SET created_at=(date_trunc('day',NOW() AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo')-INTERVAL '1 microsecond' WHERE id=${second.turn.id}`;
    const access=await f.service.access(f.email);expect(access.dailyUsed).toBe(0);
    expect(new Date(access.dailyReset).getUTCHours()).toBe(15);expect(new Date(access.weeklyReset).getUTCDay()).toBe(0);
    await f.service.save(owner,null,{...original,enabled:false});
    expect((await f.service.access(f.email)).enabled).toBe(false);expect((await f.service.access(owner)).enabled).toBe(true);
    const disabled=(await f.service.overview()).defaults;await f.service.save(owner,null,{...original,version:disabled.version});
    expect((await f.service.access(f.email)).weekly).toBe(1);
  } finally {
    const current=(await f.service.overview()).defaults;
    if(current.enabled!==original.enabled) await f.service.save(owner,null,{...original,version:current.version});
    await f.close();
  }
});
test("management API rejects admins and members; disabled admin reads history but cannot submit",async({request})=>{
  const f=await fixture();
  try {
    const first=await f.accept();await f.store.failTurn(first.turn.id,"TEST");
    const headers={"x-local-viewer-email":f.email};
    expect((await request.get("/api/admin/assistant",{headers})).status()).toBe(403);
    expect((await request.get(`/api/admin/assistant/conversations/${first.conversation.id}`,{headers})).status()).toBe(403);
    await f.service.save(owner,f.email,{...inheritedPolicy,enabled:false});
    const workspace=await request.get(`/api/v1/assistant/workspace?conversation=${first.conversation.id}`,{headers});expect(workspace.status()).toBe(200);expect((await workspace.json()).access.enabled).toBe(false);
    const origin=new URL((await request.get("/api/admin/assistant")).url()).origin;
    const response=await request.post("/api/v1/assistant/turns",{headers:{...headers,origin},data:{clientTurnId:randomUUID(),message:"Denied"}});
    expect(response.status()).toBe(403);
    expect((await request.get("/api/admin/assistant",{headers:{"x-local-viewer-email":"member-management@example.com"}})).status()).toBe(403);
    await f.sql`UPDATE users SET role='member' WHERE email=${f.email}`;
    expect((await request.get("/api/v1/assistant/workspace",{headers})).status()).toBe(403);
  } finally{await f.close();}
});
test("disabled proposals cannot commit and owner review cannot expose confirmation credentials",async({request})=>{
  const f=await fixture();let trip;
  try {
    [trip]=await f.sql`INSERT INTO trips(slug,title,trip_date,end_date,timezone,location) VALUES(${`management-${randomUUID()}`},'Review target','2030-01-01','2030-01-01','Asia/Tokyo','Tokyo') RETURNING *`;
    const first=await f.accept();
    const [{plan_revision:revision}]=await f.sql`SELECT plan_revision FROM trips WHERE id=${trip.id}`;
    await f.store.publishTurn({turnId:first.turn.id,output:"Review proposal",citations:[],proposal:{id:randomUUID(),tripId:String(trip.id),operations:[],preview:{summary:"Review",changes:[]},baseRevision:Number(revision),digest:"digest",tokenHash:"private-confirmation-hash",expiresAt:new Date(Date.now()+60000).toISOString()}});
    const reviewed=await request.get(`/api/admin/assistant/conversations/${first.conversation.id}`);
    expect(reviewed.status()).toBe(200);const text=await reviewed.text();expect(text).not.toContain("confirmationToken");expect(text).not.toContain("tokenHash");expect(text).not.toContain("private-confirmation-hash");
    await f.service.save(owner,f.email,{...inheritedPolicy,enabled:false});
    const changeSet=await f.store.getChangeSet((await f.store.getTurn(first.turn.id,f.email)).changeSet.id,f.email);
    await expect(commitStoredChangeSet({store:f.store,changeSet,actorEmail:f.email})).rejects.toMatchObject({code:"PA001"});
    expect((await f.store.getChangeSet(changeSet.id,f.email)).status).toBe("staged");
  }finally{if(trip) await f.sql`DELETE FROM trips WHERE id=${trip.id}`;await f.close();}
});
for(const [width,height] of [[320,760],[1440,900],[1920,1080]]) test(`owner management and disabled chat at ${width}`,async({page},testInfo)=>{
  const f=await fixture(),other=await fixture(),former=await fixture();
  try {
    await other.sql`UPDATE users SET name='Nguyễn Hoàng Anh · Điều phối lịch trình Nhật Bản' WHERE email=${other.email}`;
    await other.service.save(owner,other.email,{...inheritedPolicy,enabled:false});
    const old=await former.accept();await former.store.failTurn(old.turn.id,"TURN_CANCELLED");
    await former.sql`UPDATE users SET name='Trần Minh Anh',role='member' WHERE email=${former.email}`;
    const first=await f.accept();await f.store.publishTurn({turnId:first.turn.id,output:"Gợi ý Tokyo cho cuối tuần. [E1]\n\n**Chánh điện (Honden):** Kiểm tra giờ mở cửa trước khi khởi hành và giữ phần nguồn tham khảo có thể mở khi cần.",citations:[
      {id:"E1",kind:"web",title:"Đền thờ Thiên hoàng Minh Trị",publisher:"Google Maps",host:"maps.google.com",url:"https://maps.google.com",checkedAt:"2026-09-06T00:06:00.000Z"},
      {id:"E2",kind:"web",title:"Hàng thùng rượu Sake",publisher:"Kazaridaru",host:"example.com",url:"https://example.com/sake",checkedAt:"2026-09-06T00:06:00.000Z"},
      {id:"E3",kind:"web",title:"Thông tin tham khảo về khu phố",publisher:"Tokyo Guide",host:"example.com",url:"https://example.com/guide",checkedAt:"2026-09-06T00:06:00.000Z"},
    ]});
    await page.setViewportSize({width,height});await gotoHealthy(page,"/admin/assistant");
    await expect(page.getByRole("button",{name:"Trợ lý",exact:true})).toHaveCount(0);
    await page.screenshot({path:testInfo.outputPath("overview.png"),fullPage:true,animations:"disabled"});
    await page.locator(`[id="admin-${f.email}"]:visible`).click();
    await page.getByRole("link",{name:"Chỉnh sửa",exact:true}).click();
    await expect(page.getByRole("button",{name:"Lưu thay đổi",exact:true})).toBeDisabled();
    await page.getByRole("combobox",{name:"Mô hình",exact:true}).selectOption("gemini-3.6-flash");await page.getByRole("combobox",{name:"Mức suy nghĩ",exact:true}).selectOption("minimal");
    await page.getByRole("combobox",{name:"Mô hình",exact:true}).selectOption("gemini-3.8-flash");await expect(page.getByRole("combobox",{name:"Mức suy nghĩ",exact:true})).toHaveValue("default");
    await page.getByRole("button",{name:"Lưu thay đổi",exact:true}).click();await expect(page.getByText("Đã lưu thay đổi. Áp dụng từ yêu cầu tiếp theo.")).toBeVisible();
    await page.screenshot({path:testInfo.outputPath("settings.png"),fullPage:true,animations:"disabled"});
    await page.getByRole("link",{name:"Cuộc trò chuyện",exact:true}).click();
    await page.getByRole("link",{name:/Lên kế hoạch Tokyo/}).click();
    const review=page.getByRole("region",{name:"Xem lại cuộc trò chuyện"});await expect(review.getByText("Gợi ý Tokyo cho cuối tuần.")).toBeVisible();await expect(review.getByText("**Chánh điện (Honden):**",{exact:false})).toHaveCount(0);await expect(review.getByText("Chánh điện (Honden):",{exact:false})).toBeVisible();
    const sources=review.locator("details").filter({hasText:"Nguồn · 3"});await expect(sources).toHaveJSProperty("open",false);
    await review.getByRole("button",{name:"[E1]",exact:true}).click();await expect(sources).toHaveJSProperty("open",true);await expect(review.locator(`[id="${first.turn.id}-evidence-E1"]`)).toBeFocused();
    if(width>=1100){const answer=review.locator("[class*='answer']").first(),sourceBox=sources;const answerBox=await answer.boundingBox(),sourceBoxRect=await sourceBox.boundingBox();expect(sourceBoxRect.x).toBeGreaterThan(answerBox.x+answerBox.width/2);}
    await review.scrollIntoViewIfNeeded();
    await page.screenshot({path:testInfo.outputPath("review.png"),fullPage:true,animations:"disabled"});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
    const controls=await page.locator("main select,main input,main button").evaluateAll(elements=>elements.filter(e=>e.checkVisibility()).map(e=>e.getBoundingClientRect().toJSON()));
    for(const rect of controls){expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(width);}
    await page.getByRole("link",{name:"Cài đặt chung",exact:true}).click();
    await page.getByRole("link",{name:"Chỉnh sửa",exact:true}).click();
    await expect(page.getByRole("combobox",{name:"Mô hình",exact:true}).locator("option")).toHaveText(ASSISTANT_MODELS);
    const panel=await page.getByRole("dialog").boundingBox();expect(panel.x).toBeGreaterThanOrEqual(0);expect(panel.x+panel.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({path:testInfo.outputPath("defaults.png"),fullPage:true,animations:"disabled"});
    await page.getByRole("button",{name:"Hủy",exact:true}).click();
    await page.setExtraHTTPHeaders({"x-local-viewer-email":f.email});await gotoHealthy(page,`/assistant?conversation=${first.conversation.id}`);
    await page.getByLabel("Yêu cầu cho trợ lý").fill("Bản nháp cần giữ lại");
    await f.service.save(owner,f.email,{...inheritedPolicy,version:1,enabled:false});await page.reload();
    await expect(page.getByLabel("Yêu cầu cho trợ lý")).toHaveValue("Bản nháp cần giữ lại");
    await expect(page.getByLabel("Yêu cầu cho trợ lý")).toBeDisabled();await expect(page.getByText("Gợi ý Tokyo cho cuối tuần.")).toBeVisible();
    await page.getByText("Trợ lý đã tắt · Chỉ đọc lịch sử",{exact:true}).click();await expect(page.getByText("Owner có thể xem các cuộc trò chuyện của admin.")).toBeVisible();
    await page.screenshot({path:testInfo.outputPath("disabled.png"),fullPage:true,animations:"disabled"});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
    await f.service.save(owner,f.email,{...inheritedPolicy,version:2,daily:1});await page.reload();
    await expect(page.getByText("Đã hết hạn mức trợ lý",{exact:true})).toBeVisible();
    await expect(page.getByLabel("Yêu cầu cho trợ lý")).toBeDisabled();await expect(page.getByLabel("Yêu cầu cho trợ lý")).toHaveValue("Bản nháp cần giữ lại");
    await page.screenshot({path:testInfo.outputPath("quota.png"),fullPage:true,animations:"disabled"});
  }finally{await f.close();await other.close();await former.close();}
});

test("editor preserves drafts on refresh and conflict, validates limits, and restores focus",async({page,runtimeHealth})=>{
  const f=await fixture();
  try {
    await gotoHealthy(page,"/admin/assistant");
    await page.locator(`[id="admin-${f.email}"]:visible`).click();
    const edit=page.getByRole("link",{name:"Chỉnh sửa",exact:true});await edit.click();
    const dialog=page.getByRole("dialog");
    await dialog.getByRole("combobox",{name:"Yêu cầu/ngày",exact:true}).selectOption("limited");
    const daily=dialog.getByRole("spinbutton",{name:"Số yêu cầu/ngày",exact:true});await daily.fill("0");
    await expect(dialog.getByRole("button",{name:"Lưu thay đổi"})).toBeDisabled();await daily.fill("17");
    await f.service.save(owner,f.email,{...inheritedPolicy,daily:23});
    await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
    await expect(daily).toHaveValue("17");
    // A rejected save is expected here; do not classify it as an unexpected runtime error.

    await dialog.getByRole("button",{name:"Lưu thay đổi"}).click();
    await expect(dialog.getByRole("alert")).toContainText("Bản nháp của bạn vẫn được giữ");await expect(daily).toHaveValue("17");
    for(let i=runtimeHealth.length-1;i>=0;i--) if(runtimeHealth[i].includes("409 (Conflict)")) runtimeHealth.splice(i,1);
    page.once("dialog",d=>d.accept());await dialog.getByRole("button",{name:"Mở cài đặt mới nhất"}).click();await expect(daily).toHaveValue("23");
    await dialog.getByRole("combobox",{name:"Yêu cầu/ngày",exact:true}).selectOption("unlimited");
    await dialog.getByRole("button",{name:"Lưu thay đổi"}).click();await expect(dialog).toHaveCount(0);await expect(edit).toBeFocused();
    expect((await f.service.access(f.email)).daily).toBeNull();
    await edit.click();await page.getByRole("dialog").getByRole("combobox",{name:"Yêu cầu/ngày",exact:true}).selectOption("inherit");
    page.once("dialog",d=>d.dismiss());await page.getByRole("button",{name:"Hủy",exact:true}).click();await expect(page.getByRole("dialog")).toBeVisible();
    page.once("dialog",d=>d.accept());await page.keyboard.press("Escape");await expect(page.getByRole("dialog")).toHaveCount(0);await expect(edit).toBeFocused();
  }finally{await f.close();}
});

test("paginated review links preserve older pages while active requests refresh and stop",async({page})=>{
  const f=await fixture();
  try {
    const conversation=randomUUID();
    await f.sql`INSERT INTO assistant_conversations(id,owner_email,title) VALUES(${conversation},${f.email},'Lịch sử dài')`;
    for(let i=0;i<32;i++) await f.sql`INSERT INTO assistant_turns(id,conversation_id,client_turn_id,input_text,output_text,status,created_at) VALUES(${randomUUID()},${conversation},${randomUUID()},${`Câu hỏi cũ ${i}`},${`Trả lời cũ ${i}`},'completed',NOW()-INTERVAL '2 days'+${i}*INTERVAL '1 second')`;
    const active=await f.accept({conversationId:conversation,input:"Câu hỏi đang chạy"});
    await gotoHealthy(page,"/admin/assistant");await page.locator(`[id="admin-${f.email}"]:visible`).click();
    await page.getByRole("link",{name:"Cuộc trò chuyện",exact:true}).click();await page.getByRole("link",{name:"Lịch sử dài",exact:true}).click();
    await page.getByRole("link",{name:"Trang sau",exact:true}).click();await expect(page.getByText("Trả lời cũ 0",{exact:true})).toBeVisible();
    await expect(page).toHaveURL(/page=2/);await page.reload();await expect(page.getByText("Trả lời cũ 0",{exact:true})).toBeVisible();
    await page.getByRole("link",{name:"Trang trước",exact:true}).click();
    await f.store.publishTurn({turnId:active.turn.id,output:"Hoàn tất tự động",citations:[]});
    await expect(page.getByText("Hoàn tất tự động",{exact:true})).toBeVisible({timeout:7000});
    await page.getByRole("link",{name:"Về cuộc trò chuyện",exact:true}).click();
    const next=await f.accept({conversationId:conversation,input:"Yêu cầu cần dừng"});
    await page.getByRole("link",{name:"Lịch sử dài",exact:true}).click();await page.getByRole("button",{name:"Dừng yêu cầu",exact:true}).click();
    await expect(page.getByText("Đã dừng",{exact:true})).toBeVisible();expect((await f.store.getTurn(next.turn.id,f.email)).errorCode).toBe("TURN_CANCELLED");
  }finally{await f.close();}
});

test("one-click switch changes only the selected user and supports keyboard",async({page})=>{
  const f=await fixture(),other=await fixture();
  try {
    await f.service.save(owner,f.email,{...inheritedPolicy,daily:19,model:ASSISTANT_MODELS[0],effort:"high"});
    await gotoHealthy(page,"/admin/assistant");
    const access=page.getByRole("switch",{name:`Cho phép ${f.email} dùng trợ lý`,exact:true});await access.click();
    await expect(access).toHaveAttribute("aria-checked","false");await expect(access).toBeEnabled();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const policy=await f.service.access(f.email);expect(policy.enabled).toBe(false);expect(policy.daily).toBe(19);expect(policy.model).toBe(ASSISTANT_MODELS[0]);expect(policy.effort).toBe("high");
    expect((await other.service.access(other.email)).enabled).toBe(true);
    await access.focus();await page.keyboard.press("Space");await expect(access).toHaveAttribute("aria-checked","true");await expect(access).toBeEnabled();
    expect((await f.service.access(f.email)).enabled).toBe(true);
  }finally{await f.close();await other.close();}
});

test("switch blocks duplicate clicks and restores state on a failed save",async({page,runtimeHealth})=>{
  const f=await fixture();let release;const gate=new Promise(resolve=>{release=resolve;});let calls=0;
  try {
    await gotoHealthy(page,"/admin/assistant");
    await page.route(`**/api/admin/assistant/admins/${encodeURIComponent(f.email)}`,async route=>{calls++;await gate;await route.fulfill({status:409,json:{error:"Conflict",code:"POLICY_CONFLICT"}});});
    const access=page.getByRole("switch",{name:`Cho phép ${f.email} dùng trợ lý`,exact:true});await access.click();
    await expect(access).toHaveAttribute("aria-checked","false");await expect(access).toBeDisabled();
    await access.dispatchEvent("click");expect(calls).toBe(1);release();
    await expect(page.locator("main").getByRole("alert")).toContainText("Cài đặt đã thay đổi");await expect(access).toHaveAttribute("aria-checked","true");await expect(access).toBeEnabled();
    for(let i=runtimeHealth.length-1;i>=0;i--) if(runtimeHealth[i].includes("409 (Conflict)")) runtimeHealth.splice(i,1);
    expect((await f.service.access(f.email)).enabled).toBe(true);
  }finally{release();await f.close();}
});

for (const [width,height] of [[320,760],[1440,900],[1920,1080]]) {
  test(`owner error log keeps diagnostics out of chat at ${width}`, async ({page,request}) => {
    const f=await fixture();let ownerTurn;
    try {
      ownerTurn=await f.accept({ownerEmail:owner,background:true,title:"Diagnostic owner test"});
      const providerError=Object.assign(new Error("Bearer SECRET_SENTINEL prompt=PRIVATE_SENTINEL"),{status:503,cause:Object.assign(new Error("private"),{code:"ECONNRESET"})});
      await dispatchAttempt(ownerTurn.turn.id,{store:createBackgroundStore(f.store),start:async()=>{throw providerError;}});
      const response=await request.get("/api/admin/assistant/failures");expect(response.status()).toBe(200);
      const body=await response.json();const recorded=body.items.find(item=>item.id===ownerTurn.turn.id);
      expect(recorded.diagnostics).toMatchObject({phase:"dispatch",upstreamStatus:503,cause:{systemCode:"ECONNRESET"}});
      expect(JSON.stringify(body)).not.toMatch(/SECRET_SENTINEL|PRIVATE_SENTINEL/);
      for (const email of [f.email,"member-management@example.com"]) expect((await request.get("/api/admin/assistant/failures",{headers:{"x-local-viewer-email":email}})).status()).toBe(403);
      const personal=await request.get(`/api/v1/assistant/workspace?conversation=${ownerTurn.conversation.id}`);
      expect(JSON.stringify(await personal.json())).not.toMatch(/error_diagnostics|upstreamStatus|ECONNRESET/);
      await page.setViewportSize({width,height});
      await gotoHealthy(page,`/assistant?conversation=${ownerTurn.conversation.id}`);
      await expect(page.getByText("Không thể bắt đầu trả lời. Hãy thử lại.",{exact:true})).toBeVisible();
      await expect(page.getByText("DISPATCH_FAILED",{exact:true})).toHaveCount(0);
      await expect(page.getByRole("article").getByRole("alert")).toHaveCount(0);
      await gotoHealthy(page,"/admin/assistant");await page.getByRole("link",{name:"Nhật ký lỗi",exact:true}).click();
      const entry=page.getByRole("article").filter({hasText:"Diagnostic owner test"});
      await expect(entry).toBeVisible();await expect(entry.getByText(ownerTurn.turn.id,{exact:true})).toHaveCount(0);
      await entry.getByRole("link",{name:"Xem chi tiết lỗi",exact:true}).click();
      const detail=page.locator("main");
      await expect(detail.getByText(ownerTurn.turn.id,{exact:true})).toBeVisible();
      await expect(detail).toContainText("503");await expect(detail).toContainText("ECONNRESET");
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
      await mkdir(".impeccable/review/owner-errors",{recursive:true});
      await page.screenshot({path:`.impeccable/review/owner-errors/${width}.png`,fullPage:false});
      await detail.locator("dl").scrollIntoViewIfNeeded();
      await page.screenshot({path:`.impeccable/review/owner-errors/${width}-details.png`,fullPage:false});
    } finally {if(ownerTurn) await f.sql`DELETE FROM assistant_conversations WHERE id=${ownerTurn.conversation.id}`;await f.close();}
  });
}

test("deadline is diagnosed distinctly and late failure cannot overwrite it",async()=>{
  const f=await fixture();
  try {
    const config={...resolveAgenticV1Config({NODE_ENV:"development",LOCAL_ADMIN_BYPASS:"true"}),turnDeadlineMs:20};
    const assistant=createTravelAssistant({store:f.store,config,modelAdapter:{run:()=>new Promise(()=>{})},contextService:{assemble:async()=>[]}});
    const run=await assistant.startTurn({actor:{email:f.email,isAdmin:true},clientTurnId:randomUUID(),message:"Deadline test"});
    const events=[];for await(const event of run.events)events.push(event);
    expect(events.at(-1).error.code).toBe("TURN_DEADLINE_EXCEEDED");
    await f.store.failTurn(run.runId,"LATE_FAILURE",0,{phase:"worker"});
    const recorded=(await f.service.failures()).items.find(item=>item.id===run.runId);
    expect(recorded.code).toBe("TURN_DEADLINE_EXCEEDED");
    expect(recorded.diagnostics).toMatchObject({phase:"deadline",deadlineMs:20});
  }finally{await f.close();}
});
test("owner log includes recovered tool errors and paginates legacy failures without duplicates",async()=>{
  const f=await fixture();let first;
  try {
    first=await f.accept({ownerEmail:owner});
    const tool=await f.store.createToolRun({turnId:first.turn.id,toolName:"search_web"});
    await f.store.finishToolRun(tool,{status:"failed",errorCode:"RESEARCH_UNAVAILABLE",resultMetadata:{diagnostics:{phase:"search_web",upstreamStatus:503}}});
    await f.store.publishTurn({turnId:first.turn.id,output:"The source is unavailable",citations:[]});
    expect((await f.service.failures()).items.find(item=>item.id===first.turn.id).tools[0].diagnostics.upstreamStatus).toBe(503);
    await f.sql`INSERT INTO assistant_turns(id,conversation_id,client_turn_id,input_text,status,error_code,created_at,completed_at)
      SELECT gen_random_uuid(),${first.conversation.id},gen_random_uuid(),'Legacy failure','failed','LEGACY','2020-01-01'::TIMESTAMPTZ+i*INTERVAL '1 second','2030-01-01'::TIMESTAMPTZ+i*INTERVAL '1 second' FROM generate_series(1,32) AS i`;
    const a=await f.service.failures();const b=await f.service.failures(a.cursor);
    expect(a.items).toHaveLength(30);expect(a.items.every(item=>item.diagnostics===null)).toBe(true);
    expect(new Set([...a.items,...b.items].map(item=>item.id)).size).toBe(a.items.length+b.items.length);
    expect(b.items.filter(item=>item.code==="LEGACY")).toHaveLength(2);
  }finally{if(first)await f.sql`DELETE FROM assistant_conversations WHERE id=${first.conversation.id}`;await f.close();}
});

for(const [width,height] of [[320,760],[1440,900],[1920,1080]]) test(`addressable history, request and error navigation at ${width}`,async({page,context,request},testInfo)=>{
 const f=await fixture();
 try {
  await f.service.save(owner,f.email,{...inheritedPolicy,daily:null,weekly:null});
  const first=await f.accept({input:"Kiểm tra lỗi từ người dùng",title:"Hội thoại cần kiểm tra"});
  await f.store.failTurn(first.turn.id,"RESEARCH_UNAVAILABLE");
  await f.sql`UPDATE assistant_turns SET created_at=NOW()-INTERVAL '3 days' WHERE id=${first.turn.id}`;
  for(let i=0;i<35;i++) await f.sql`INSERT INTO assistant_turns(id,conversation_id,client_turn_id,input_text,output_text,status,created_at) VALUES(${randomUUID()},${first.conversation.id},${randomUUID()},${`Câu hỏi tiếp theo ${i}`},${`Câu trả lời tiếp theo ${i}`},'completed',NOW()-INTERVAL '2 days'+${i+1}*INTERVAL '1 second')`;
  const base="/admin/assistant", user=`${base}/users/${encodeURIComponent(f.email)}`, history=`${user}/conversations`,conversation=`${base}/conversations/${first.conversation.id}`,turn=`${conversation}/turns/${first.turn.id}`,failure=`${base}/failures/${first.turn.id}`;
  await page.setViewportSize({width,height});
  await gotoHealthy(page,base);
  const row=page.locator("tr").filter({hasText:f.email});
  await expect(row.getByRole("link",{name:"Xem hội thoại",exact:true})).toHaveAttribute("href",history);
  await row.getByRole("link",{name:"Xem hội thoại",exact:true}).click();await expect(page).toHaveURL(new RegExp("/conversations$"));
  await page.getByRole("link",{name:"Hội thoại cần kiểm tra",exact:true}).click();await expect(page).toHaveURL(new RegExp(first.conversation.id+"$"));
  await page.goBack();await expect(page.getByRole("link",{name:"Hội thoại cần kiểm tra",exact:true})).toBeVisible();await page.goForward();
  await gotoHealthy(page,turn);await expect(page.getByRole("article").getByText("Kiểm tra lỗi từ người dùng",{exact:true})).toBeVisible();
  await expect(page.getByRole("link",{name:"Yêu cầu sau",exact:true})).toBeVisible();
  await page.getByRole("link",{name:"Toàn bộ hội thoại",exact:true}).click();await expect(page.getByRole("article").getByText("Kiểm tra lỗi từ người dùng",{exact:true})).toBeVisible();
  const targetResponse=await request.get(`/api/admin/assistant/conversations/${first.conversation.id}?target=${first.turn.id}`);
  expect(targetResponse.status()).toBe(200);const target=await targetResponse.json();expect(target.page).toBe(2);expect(target.turns.some(t=>t.id===first.turn.id)).toBe(true);
  const tab=await context.newPage();await gotoHealthy(tab,turn);await expect(tab.getByRole("article").getByText("Kiểm tra lỗi từ người dùng",{exact:true})).toBeVisible();await tab.close();
  for(const [label,url] of [["users",base],["settings",`${base}/settings`],["user",user],["history",history],["conversation",conversation],["request",turn],["failures",`${base}/failures`],["failure",failure],["editor",`${user}?edit=1`]]) {
   await gotoHealthy(page,url);await page.reload();
   if(label!=="editor")await expect(page.getByRole("heading",{level:1,name:"Quản lý trợ lý",exact:true})).toBeVisible();
   if(["conversation","request"].includes(label))await expect(page.getByRole("region",{name:"Xem lại cuộc trò chuyện"})).toBeVisible();
   if(label==="editor")await expect(page.getByRole("dialog")).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth),label).toBe(width);
   const clipped=await page.locator("main a,main button").evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility()).filter(n=>{const r=n.getBoundingClientRect();return r.left<0||r.right>innerWidth+1;}).map(n=>n.textContent));expect(clipped,label).toEqual([]);
   await page.screenshot({path:testInfo.outputPath(`${label}.png`),fullPage:false});
  }
  await gotoHealthy(page,failure);await page.getByRole("link",{name:"Xem yêu cầu",exact:true}).click();await expect(page).toHaveURL(new RegExp("/turns/"+first.turn.id+"$"));await page.goBack();await expect(page).toHaveURL(new RegExp("/failures/"+first.turn.id+"$"));
  for(const route of [base,`${base}/settings`,user,history,conversation,turn,`${base}/failures`,failure])expect((await request.get(route,{headers:{"x-local-viewer-email":f.email}})).status()).toBe(404);
  for(const route of [`/api/admin/assistant/conversations/${first.conversation.id}/turns/${first.turn.id}`,`/api/admin/assistant/failures/${first.turn.id}`]){
   const response=await request.get(route);expect(response.status()).toBe(200);expect(await response.text()).not.toMatch(/confirmationToken|tokenHash/);
   expect((await request.get(route,{headers:{"x-local-viewer-email":f.email}})).status()).toBe(403);
  }
  expect((await request.get(`${conversation}/turns/${randomUUID()}`)).status()).toBe(404);
  expect((await request.get(`/api/admin/assistant/conversations/${randomUUID()}/turns/${first.turn.id}`)).status()).toBe(404);
  expect((await request.get(`${base}/conversations/not-a-uuid`)).status()).toBe(404);
  expect((await request.get(`${base}/failures/${randomUUID()}`)).status()).toBe(404);
  expect((await request.get(`${history}?page=invalid`)).status()).toBe(404);
  await f.sql`UPDATE users SET role='member' WHERE email=${f.email}`;
  await gotoHealthy(page,history);await expect(page.getByRole("link",{name:"Hội thoại cần kiểm tra",exact:true})).toBeVisible();
 } finally {await f.close();}
});

test("routed history empty state, pending navigation and refresh retry",async({page,runtimeHealth})=>{
 const f=await fixture();let release=()=>{};
 try {
  await gotoHealthy(page,`/admin/assistant/users/${encodeURIComponent(f.email)}/conversations`);
  await expect(page.getByText("Chưa có cuộc trò chuyện của quản trị viên này.",{exact:true})).toBeVisible();
  const gate=new Promise(resolve=>{release=resolve;});
  await page.route("**/admin/assistant/settings**",async route=>{await gate;await route.continue();});
  await page.getByRole("link",{name:"Cài đặt chung",exact:true}).click();
  await expect(page.getByRole("status",{name:"Đang tải"})).toBeVisible();release();
  await expect(page).toHaveURL(/\/admin\/assistant\/settings$/);
  await page.unroute("**/admin/assistant/settings**");
  await page.route("**/api/admin/assistant",route=>route.fulfill({status:503,json:{error:"Không tải được dữ liệu. Hãy thử lại."}}));
  await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await page.unroute("**/api/admin/assistant");await page.getByRole("button",{name:"Thử lại",exact:true}).click();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  for(let i=runtimeHealth.length-1;i>=0;i--)if(runtimeHealth[i].includes("503"))runtimeHealth.splice(i,1);
 }finally{release();await f.close();}
});
