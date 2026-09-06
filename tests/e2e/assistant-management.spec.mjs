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
    const first=await f.accept();await f.store.publishTurn({turnId:first.turn.id,output:"Gợi ý Tokyo cho cuối tuần.",citations:[]});
    await page.setViewportSize({width,height});await gotoHealthy(page,"/admin/assistant");
    await page.screenshot({path:testInfo.outputPath("overview.png"),fullPage:true,animations:"disabled"});
    await page.locator(`[id="admin-${f.email}"]`).click();
    await page.getByRole("button",{name:"Chỉnh sửa",exact:true}).click();
    await expect(page.getByRole("button",{name:"Lưu thay đổi",exact:true})).toBeDisabled();
    await page.getByRole("combobox",{name:"Mô hình",exact:true}).selectOption("gemini-3.6-flash");await page.getByRole("combobox",{name:"Mức suy nghĩ",exact:true}).selectOption("minimal");
    await page.getByRole("combobox",{name:"Mô hình",exact:true}).selectOption("gemini-3.8-flash");await expect(page.getByRole("combobox",{name:"Mức suy nghĩ",exact:true})).toHaveValue("default");
    await page.getByRole("button",{name:"Lưu thay đổi",exact:true}).click();await expect(page.getByText("Đã lưu thay đổi. Áp dụng từ yêu cầu tiếp theo.")).toBeVisible();
    await page.screenshot({path:testInfo.outputPath("settings.png"),fullPage:true,animations:"disabled"});
    await page.getByRole("tab",{name:"Cuộc trò chuyện",exact:true}).click();
    await page.getByRole("button",{name:/Lên kế hoạch Tokyo/}).click();
    const review=page.getByRole("region",{name:"Xem lại cuộc trò chuyện"});await expect(review.getByText("Gợi ý Tokyo cho cuối tuần.")).toBeVisible();await review.scrollIntoViewIfNeeded();
    await page.screenshot({path:testInfo.outputPath("review.png"),fullPage:true,animations:"disabled"});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
    const controls=await page.locator("main select,main input,main button").evaluateAll(elements=>elements.filter(e=>e.checkVisibility()).map(e=>e.getBoundingClientRect().toJSON()));
    for(const rect of controls){expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(width);}
    await page.getByRole("tab",{name:"Cài đặt chung",exact:true}).click();
    await page.getByRole("button",{name:"Chỉnh sửa",exact:true}).click();
    expect(await page.getByRole("combobox",{name:"Mô hình",exact:true}).locator("option").allTextContents()).toEqual(ASSISTANT_MODELS);
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
    await page.locator(`[id="admin-${f.email}"]`).click();
    const edit=page.getByRole("button",{name:"Chỉnh sửa",exact:true});await edit.click();
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

test("paginated review keeps earlier requests while active status refreshes and stops",async({page})=>{
  const f=await fixture();
  try {
    const conversation=randomUUID();
    await f.sql`INSERT INTO assistant_conversations(id,owner_email,title) VALUES(${conversation},${f.email},'Lịch sử dài')`;
    for(let i=0;i<32;i++) await f.sql`INSERT INTO assistant_turns(id,conversation_id,client_turn_id,input_text,output_text,status,created_at) VALUES(${randomUUID()},${conversation},${randomUUID()},${`Câu hỏi cũ ${i}`},${`Trả lời cũ ${i}`},'completed',NOW()-INTERVAL '2 days'+${i}*INTERVAL '1 second')`;
    const active=await f.accept({conversationId:conversation,input:"Câu hỏi đang chạy"});
    await gotoHealthy(page,"/admin/assistant");await page.locator(`[id="admin-${f.email}"]`).click();
    await page.getByRole("tab",{name:"Cuộc trò chuyện",exact:true}).click();await page.getByRole("button",{name:"Lịch sử dài",exact:true}).click();
    await page.getByRole("button",{name:"Xem yêu cầu trước"}).click();await expect(page.getByText("Trả lời cũ 0",{exact:true})).toBeVisible();
    await f.store.publishTurn({turnId:active.turn.id,output:"Hoàn tất tự động",citations:[]});
    await expect(page.getByText("Hoàn tất tự động",{exact:true})).toBeVisible({timeout:7000});await expect(page.getByText("Trả lời cũ 0",{exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"Xem yêu cầu trước"})).toHaveCount(0);
    await page.getByRole("button",{name:"Về cuộc trò chuyện",exact:true}).click();
    const next=await f.accept({conversationId:conversation,input:"Yêu cầu cần dừng"});
    await page.getByRole("button",{name:"Lịch sử dài",exact:true}).click();await page.getByRole("button",{name:"Dừng yêu cầu",exact:true}).click();
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
