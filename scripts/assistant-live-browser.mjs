import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { createPostgresSql } from "../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../lib/runtime-config.mjs";

// Opt-in only. Run against a local server with REAL_PROVIDERS and
// SINGLE_REQUEST_SMOKE enabled. Never print provider payloads or credentials.
const baseURL = "http://127.0.0.1:3102";
const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
const email = `live-browser-${randomUUID()}@localhost.invalid`;
const slug = `live-browser-${randomUUID()}`;
let browser, phase = "setup", runId;
try {
  await sql`INSERT INTO users(email,name,role,first_login,last_login,last_active_at)
    VALUES(${email},'Disposable live browser tester','admin',NOW(),NOW(),NOW())`;
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-local-viewer-email": email } });
  await page.goto(`${baseURL}/assistant`);
  await page.getByLabel("Yêu cầu cho trợ lý").waitFor({ state: "visible" });
  const request = `Đây là kiểm tra tính năng, không cần tra cứu. Chuẩn bị đúng một apply_changes với hai thao tác: trip.create draftId=trip, value={"slug":"${slug}","title":"Kiểm tra Gemini trực tiếp","startDate":"2030-09-08","endDate":"2030-09-08","timezone":"Asia/Tokyo","location":"Tokyo"}; place.create draftId=place, trip={"draftId":"trip"}, value={"name":"Địa điểm thử nghiệm","address":"Địa chỉ thử nghiệm","notes":"Dữ liệu giả để kiểm tra"}. Hãy gọi công cụ ngay, không gọi công cụ đọc hay tra cứu. Chờ tôi phê duyệt trước khi lưu.`;
  await page.getByLabel("Yêu cầu cho trợ lý").fill(request);
  phase = "real Gemini generation";
  const accepted = page.waitForResponse(response => response.url().endsWith("/api/v1/assistant/turns") && response.status() === 202);
  await page.getByRole("button", { name: "Gửi yêu cầu", exact: true }).click();
  runId = (await (await accepted).json()).runId;
  const deadline = Date.now() + 65000;
  let turn;
  do {
    [turn] = await sql`SELECT status,error_code FROM assistant_turns WHERE id=${runId}`;
    if (turn.status !== "running") break;
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  const audit = await sql`SELECT tool_name,status,error_code,request_metadata,result_metadata FROM assistant_tool_runs WHERE turn_id=${runId} ORDER BY created_at`;
  console.log(JSON.stringify({ status: turn.status, errorCode: turn.error_code, modelCalls: audit.filter(row => row.tool_name === "model_interaction").map(row => ({ status: row.status, errorCode: row.error_code, model: row.request_metadata?.model, usage: row.result_metadata?.usage })) }));
  await mkdir(".impeccable/review/live-gemini", { recursive: true });
  assert.equal(turn.status, "awaiting_approval", "Gemini must produce an approval request");
  phase = "inline browser review";
  const review = page.getByRole("region", { name: "Yêu cầu thay đổi" });
  await review.getByRole("button", { name: "Phê duyệt thay đổi", exact: true }).waitFor({ state: "visible" });
  assert.equal(await page.getByRole("dialog").count(), 0);
  await review.getByText("Xem 2 thay đổi", { exact: true }).click();
  await page.screenshot({ path: ".impeccable/review/live-gemini/approval.png" });
  assert.equal((await sql`SELECT id FROM trips WHERE slug=${slug}`).length, 0);
  phase = "reject without another model call";
  await review.getByRole("button", { name: "Từ chối", exact: true }).click();
  await review.getByRole("heading", { name: "Đã từ chối", exact: true }).waitFor({ state: "visible" });
  assert.equal((await sql`SELECT status FROM assistant_actions WHERE turn_id=${runId}`)[0].status, "rejected");
  assert.equal((await sql`SELECT id FROM trips WHERE slug=${slug}`).length, 0);
  await page.screenshot({ path: ".impeccable/review/live-gemini/rejected.png" });
  console.log("PASS: real Gemini → inline two-resource approval → rejection; zero domain writes and no continuation generation.");
} catch {
  console.error(`Live browser test failed during ${phase}. No automatic retry. Provider payloads withheld.`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (runId) await sql`UPDATE assistant_turns SET status='failed',error_code='TURN_CANCELLED' WHERE id=${runId} AND status IN ('running','awaiting_approval','awaiting_input')`;
  await sql`DELETE FROM assistant_conversations WHERE owner_email=${email}`;
  await sql`DELETE FROM users WHERE email=${email}`;
  await sql.end();
}
