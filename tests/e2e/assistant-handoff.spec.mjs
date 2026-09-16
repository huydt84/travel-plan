import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { createAssistantStore } from "../../lib/v1/store.mjs";
import { createAssistantManagement } from "../../lib/v1/assistant-management.mjs";
import { processAssistantHandoffOutboxRecords } from "../../lib/assistant-handoff-outbox-store.mjs";
import { listNotificationRecords } from "../../lib/notification-store.mjs";
import { expect, test, gotoHealthy } from "./fixtures.mjs";

const ownerEmail="local-admin@localhost.invalid";
async function fixture() {
  const sql=createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI),email=`handoff-${randomUUID()}@example.com`;
  await sql`INSERT INTO users(email,name,role,first_login,last_login,last_active_at) VALUES(${email},'Người thử bàn giao','admin',NOW(),NOW(),NOW())`;
  const store=createAssistantStore({sql}),management=createAssistantManagement(store);
  const actor={email,name:"Người thử bàn giao",isAdmin:true,isOwner:false};
  const accept=(overrides={})=>store.acceptMessage({actor,conversationId:null,clientTurnId:randomUUID(),input:"Chồng iu, giúp em nhé",title:"Cần hỗ trợ",leaseMs:60000,maxTurnsPerHour:100,background:true,triggerMatch:true,notificationRecipient:ownerEmail,...overrides});
  return {sql,email,store,management,accept,actor,cleanup:async()=>{
    await sql`DELETE FROM assistant_conversations WHERE owner_email=${email}`;
    await sql`DELETE FROM assistant_management_audit WHERE target_email=${email}`;
    await sql`DELETE FROM users WHERE email=${email}`;await sql.end();
  }};
}

async function ownerDisplayFixture() {
  const sql=createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI),conversationId=randomUUID(),handoffId=randomUUID();
  await sql`INSERT INTO assistant_conversations(id,owner_email,title) VALUES(${conversationId},${ownerEmail},'Bàn giao hiển thị')`;
  await sql`INSERT INTO assistant_handoffs(id,conversation_id,initiated_by_email,initiated_by_name,status)
    VALUES(${handoffId},${conversationId},'guest@example.com','Người đồng hành','active')`;
  await sql`INSERT INTO assistant_handoff_messages(id,handoff_id,conversation_id,client_message_id,author_email,author_name,author_role,body)
    VALUES(${randomUUID()},${handoffId},${conversationId},${randomUUID()},'guest@example.com','Người đồng hành','participant','Chồng iu, giúp em nhé'),
      (${randomUUID()},${handoffId},${conversationId},${randomUUID()},${ownerEmail},'Chủ lịch trình','owner','Anh đang xử lý nhé')`;
  return {sql,conversationId,handoffId,management:createAssistantManagement(createAssistantStore({sql})),cleanup:async()=>{await sql`DELETE FROM assistant_conversations WHERE id=${conversationId}`;await sql.end();}};
}

test("handoff admission is atomic, replay-safe, quota-free, and repeatable",async()=>{
  const f=await fixture();
  try {
    const clientTurnId=randomUUID();
    const first=await f.accept({clientTurnId});
    expect(first.mode).toBe("handoff");
    expect(first.replayed).toBe(false);
    expect(await f.sql`SELECT * FROM assistant_turns WHERE conversation_id=${first.conversation.id}`).toHaveLength(0);
    expect(await f.sql`SELECT j.* FROM assistant_jobs j JOIN assistant_turns t ON t.id=j.turn_id WHERE t.conversation_id=${first.conversation.id}`).toHaveLength(0);
    expect(await f.sql`SELECT * FROM assistant_handoffs WHERE conversation_id=${first.conversation.id}`).toHaveLength(1);
    expect(await f.sql`SELECT * FROM assistant_handoff_email_outbox WHERE handoff_id=${first.handoff.id}`).toHaveLength(1);
    const ownerNotifications=await listNotificationRecords(f.sql,{recipientEmail:ownerEmail,limit:50});
    expect(ownerNotifications.notifications.filter(item=>item.type==="assistant_handoff_created"&&item.handoff?.id===first.handoff.id)).toHaveLength(1);
    let deliveries=0;
    await processAssistantHandoffOutboxRecords(f.sql,{handoffId:first.handoff.id},{sendImpl:async()=>{deliveries++;return "resend-handoff";},logger:{error(){}}});
    await processAssistantHandoffOutboxRecords(f.sql,{handoffId:first.handoff.id},{sendImpl:async()=>{deliveries++;return "duplicate";},logger:{error(){}}});
    expect(deliveries).toBe(1);
    expect((await f.sql`SELECT status,attempt_count FROM assistant_handoff_email_outbox WHERE handoff_id=${first.handoff.id}`)[0]).toEqual({status:"sent",attempt_count:1});
    expect((await f.management.access(f.email)).dailyUsed).toBe(0);

    const replay=await f.accept({clientTurnId});
    expect(replay.replayed).toBe(true);expect(replay.message.id).toBe(first.message.id);
    const follow=await f.accept({conversationId:first.conversation.id,input:"Em bổ sung thêm",triggerMatch:false});
    expect(follow.mode).toBe("handoff");expect(follow.handoff.id).toBe(first.handoff.id);
    expect(await f.sql`SELECT * FROM assistant_handoff_messages WHERE handoff_id=${first.handoff.id}`).toHaveLength(2);
    expect(await f.sql`SELECT * FROM assistant_handoff_email_outbox WHERE handoff_id=${first.handoff.id}`).toHaveLength(1);
    expect((await listNotificationRecords(f.sql,{recipientEmail:ownerEmail,limit:50})).notifications
      .filter(item=>item.type==="assistant_handoff_created"&&item.handoff?.id===first.handoff.id)).toHaveLength(1);
    await f.management.markHandoffSeen(ownerEmail,first.handoff.id);
    expect((await f.management.handoffs())[0].unreadCount).toBe(0);
    expect(await f.sql`SELECT * FROM assistant_management_audit WHERE target_email=${f.email} AND action='handoff_seen'`).toHaveLength(1);

    const reply=await f.management.replyHandoff(ownerEmail,"Chủ lịch trình",first.handoff.id,{clientMessageId:randomUUID(),message:"Anh đang xem nhé"});
    expect(reply.message.author.role).toBe("owner");
    await f.management.closeHandoff(ownerEmail,first.handoff.id);
    const closedHistory=await f.store.listModelHistory(first.conversation.id,f.email,{limit:20});
    expect(closedHistory.filter(item=>item.kind==="handoff")).toHaveLength(3);
    await expect(f.management.replyHandoff(ownerEmail,"Chủ lịch trình",first.handoff.id,{clientMessageId:randomUUID(),message:"Muộn"})).rejects.toMatchObject({code:"HANDOFF_CLOSED",status:409});

    const resumed=await f.accept({conversationId:first.conversation.id,input:"Tiếp tục bằng AI",triggerMatch:false});
    expect(resumed.mode).toBe("assistant");
    await f.store.failTurn(resumed.turn.id,"TEST");
    const second=await f.accept({conversationId:first.conversation.id,input:"VỢ YÊU, xem tiếp",triggerMatch:true});
    expect(second.mode).toBe("handoff");expect(second.handoff.id).not.toBe(first.handoff.id);
    expect(await f.sql`SELECT * FROM assistant_handoff_email_outbox o JOIN assistant_handoffs h ON h.id=o.handoff_id WHERE h.conversation_id=${first.conversation.id}`).toHaveLength(2);
    expect((await listNotificationRecords(f.sql,{recipientEmail:ownerEmail,limit:50})).notifications
      .filter(item=>item.type==="assistant_handoff_created"&&[first.handoff.id,second.handoff.id].includes(item.handoff?.id))).toHaveLength(2);
    const history=await f.store.listModelHistory(first.conversation.id,f.email,{limit:30});
    expect(history.some(item=>item.kind==="handoff"&&item.owner==="Anh đang xem nhé")).toBe(true);
    expect(history.some(item=>item.kind==="handoff"&&item.user==="VỢ YÊU, xem tiếp")).toBe(false);
  } finally {await f.cleanup();}
});

test("owner phrases remain on the assistant path",async()=>{
  const f=await fixture();
  try {
    const result=await f.store.acceptMessage({
      actor:{...f.actor,isOwner:true},
      conversationId:null,clientTurnId:randomUUID(),input:"Vợ yêu, kiểm tra lịch",title:"Owner request",
      leaseMs:60000,maxTurnsPerHour:100,background:true,triggerMatch:true,notificationRecipient:ownerEmail,
    });
    expect(result.mode).toBe("assistant");
    expect(await f.sql`SELECT * FROM assistant_handoffs WHERE conversation_id=${result.conversation.id}`).toHaveLength(0);
    await f.store.failTurn(result.turn.id,"TEST");
  } finally {
    await f.cleanup();
  }
});

test("send and close serialize so the message has exactly one route",async()=>{
  const f=await fixture();
  try {
    const first=await f.accept();
    const [closed,sent]=await Promise.allSettled([
      f.management.closeHandoff(ownerEmail,first.handoff.id),
      f.accept({conversationId:first.conversation.id,input:"Tin nhắn ở ranh giới",triggerMatch:false}),
    ]);
    expect(closed.status).toBe("fulfilled");expect(sent.status).toBe("fulfilled");
    const result=sent.value;
    expect(["handoff","assistant"]).toContain(result.mode);
    const handoffMessages=await f.sql`SELECT * FROM assistant_handoff_messages WHERE client_message_id=${result.mode==="handoff"?result.message.clientMessageId:randomUUID()}::UUID`;
    expect(handoffMessages).toHaveLength(result.mode==="handoff"?1:0);
    if(result.mode==="assistant") await f.store.failTurn(result.turn.id,"TEST");
    expect(await f.sql`SELECT * FROM assistant_handoffs WHERE conversation_id=${first.conversation.id} AND status='active'`).toHaveLength(0);
  } finally {await f.cleanup();}
});

for(const [width,height] of [[320,760],[1440,900],[1920,1080]]) test(`owner handoff inbox and thread at ${width}`,async({page})=>{
  const f=await fixture();
  try {
    const first=await f.accept();
    await f.accept({conversationId:first.conversation.id,input:"Em gửi thêm chi tiết",triggerMatch:false});
    await f.management.replyHandoff(ownerEmail,"Chủ lịch trình",first.handoff.id,{clientMessageId:randomUUID(),message:"Anh đã nhận được"});
    await page.setViewportSize({width,height});
    await mkdir(".impeccable/review/handoff",{recursive:true});
    await gotoHealthy(page,"/");
    await page.getByRole("button",{name:/Mở thông báo/}).click();
    const handoffNotification=page.locator(".notification-list button").filter({hasText:"Người thử bàn giao đã bàn giao cuộc trò chuyện cho bạn"});
    await expect(handoffNotification).toContainText("Chồng iu, giúp em nhé");
    await expect(handoffNotification).toContainText("Trợ lý hành trình · Cần hỗ trợ");
    await page.screenshot({path:`.impeccable/review/handoff/${width}-notification.png`,fullPage:false});
    await handoffNotification.click();
    await expect(page).toHaveURL(new RegExp(`/admin/assistant/handoffs/${first.handoff.id}`));
    await gotoHealthy(page,"/admin/assistant");
    await expect(page.getByRole("heading",{name:"Bàn giao đang hoạt động"})).toBeVisible();
    await page.screenshot({path:`.impeccable/review/handoff/${width}-inbox.png`,fullPage:false});
    await page.getByRole("region",{name:"Bàn giao đang hoạt động"}).getByRole("link",{name:/Người thử bàn giao/}).click();
    await expect(page).toHaveURL(new RegExp(`/admin/assistant/handoffs/${first.handoff.id}`));
    await expect(page.getByText("Em gửi thêm chi tiết")).toBeVisible();
    await expect(page.getByText("Anh đã nhận được")).toBeVisible();
    await page.screenshot({path:`.impeccable/review/handoff/${width}-thread.png`,fullPage:false});
    await expect(page.getByText("Email thông báo đang chờ gửi")).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    page.once("dialog",dialog=>dialog.accept());
    await page.getByRole("button",{name:"Kết thúc bàn giao"}).click();
    await expect(page.getByRole("button",{name:"Đã kết thúc"})).toBeDisabled();
  } finally {await f.cleanup();}
});

for(const [width,height] of [[320,760],[1440,900],[1920,1080]]) test(`handoff transcript and closure state at ${width}`,async({page})=>{
  const f=await ownerDisplayFixture();
  try {
    await page.setViewportSize({width,height});
    await gotoHealthy(page,`/assistant?conversation=${f.conversationId}`);
    const transcript=page.getByLabel("Nội dung cuộc trò chuyện");
    await expect(transcript.getByText("Chủ lịch trình đang tiếp quản")).toBeVisible();
    await expect(transcript.getByText("Chồng iu, giúp em nhé")).toBeVisible();
    await expect(transcript.getByText("Anh đang xử lý nhé")).toBeVisible();
    await expect(page.locator("#assistant-message")).toBeEnabled();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    await mkdir(".impeccable/review/handoff",{recursive:true});
    await page.screenshot({path:`.impeccable/review/handoff/${width}-user.png`,fullPage:false});
    await f.management.closeHandoff(ownerEmail,f.handoffId);
    await expect(transcript.getByText("Đã kết thúc bàn giao")).toBeVisible({timeout:7000});
    await expect(page.locator("#assistant-message")).toBeEnabled();
  } finally {await f.cleanup();}
});
