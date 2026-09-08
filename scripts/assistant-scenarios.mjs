// Opt-in real-provider browser scenarios. Start the local server with
// AGENTIC_V1_REAL_PROVIDERS=true. Only disposable local conversations are used;
// proposals are rejected. Provider exceptions and credentials are never printed.
import { randomUUID } from "node:crypto";
import { resolveAgenticV1Config } from "../lib/v1/config.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { createPostgresSql } from "../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../lib/runtime-config.mjs";
const baseURL = "http://127.0.0.1:3000";
const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
const email = `scenario-${randomUUID()}@localhost.invalid`;
const output = `.impeccable/review/assistant-scenarios${process.argv.includes("--confirmation") ? "-confirmation" : ""}`;
const results = [];
let browser;
try {
  await mkdir(output, { recursive: true });
  await sql`INSERT INTO users(email,name,role,first_login,last_login,last_active_at) VALUES(${email},'Assistant scenario tester','admin',NOW(),NOW(),NOW())`;
  await sql`INSERT INTO assistant_policy_overrides(email,policy,version) VALUES(${email},${JSON.stringify({enabled:true,daily:null,weekly:null,model:"gemini-3.8-flash",effort:"default"})}::JSONB,1)`;
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-local-viewer-email": email } });
  const groups = [
    ["Gợi ý điểm đến cho cuối tuần", "Lên lịch đi chơi Hakone trong ngày"],
    ["Lên lịch đi chơi Hakone trong ngày"],
    ["Lên lịch Hakone trong ngày từ Shinjuku, đi tàu, ngân sách 10.000 yên, thích onsen và thiên nhiên. Hãy tra cứu giờ mở cửa và tuyến đường."],
    ["Đổi giờ khởi hành của chuyến đi thành 8 giờ sáng"],
    ["Tìm giờ mở cửa của bảo tàng Không-Tồn-Tại-XYZ ở Hakone, hãy nói rõ nếu không xác minh được."],
    ["Không cần tra cứu: dịch ‘đi chơi Hakone trong ngày’ sang tiếng Nhật."],
  ];
  const submit = async (prompt, retry = false) => {
    const acceptedPromise = page.waitForResponse(r => r.url().endsWith("/api/v1/assistant/turns") && r.request().method() === "POST", { timeout: 25000 }).catch(() => null);
    if (retry) await page.getByRole("button", { name: "Thử lại", exact: true }).click();
    else { const input = page.getByRole("textbox", { name: "Yêu cầu cho trợ lý" }); await input.fill(prompt); await input.press("Enter"); }
    const response = await acceptedPromise;
    if (!response) throw new Error("Acceptance response timeout");
    const accepted = await response.json();
    if (!accepted.runId) { results.push({ prompt, retry, http: response.status(), code: accepted.code }); return; }
    // Include queued dispatch and finalization beyond the worker execution budget.
    const deadline = Date.now() + resolveAgenticV1Config().turnDeadlineMs + 90_000;
    let turn;
    do {
      [turn] = await sql`SELECT id,status,created_at AS "createdAt",completed_at AS "completedAt",error_code AS code,error_diagnostics AS diagnostics,output_text AS answer,execution_settings AS settings FROM assistant_turns WHERE id=${accepted.runId}`;
      if (turn.status !== "running") break;
      await new Promise(resolve => setTimeout(resolve, 500));
    } while (Date.now() < deadline);
    const tools = await sql`SELECT tool_name AS name,status,error_code AS code,duration_ms AS "durationMs",result_metadata->'diagnostics' AS diagnostics FROM assistant_tool_runs WHERE turn_id=${accepted.runId} ORDER BY created_at,id`;
    results.push({ prompt, retry, ...turn, tools });
    console.log(JSON.stringify({ scenario: results.length, retry, status: turn.status, code: turn.code, diagnostics: turn.diagnostics, tools: tools.map(({ name, status, code, diagnostics }) => ({ name, status, code, diagnostics })) }));
    await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
    if (["awaiting_approval", "awaiting_input"].includes(turn.status)) {
      await page.getByRole("button", { name: "Từ chối", exact: true }).click({ timeout: 10000 });
      await page.getByRole("heading", { name: "Đã từ chối", exact: true }).waitFor();
    }
    if (turn.status === "running") await page.request.post(`${baseURL}/api/v1/assistant/runs/${turn.id}`, { headers: { origin: baseURL } });
    await page.screenshot({ path: `${output}/${results.length}.png` });
    return turn;
  };
  for (const prompts of groups) {
    await page.goto(`${baseURL}/assistant`);
    await page.getByRole("button", { name: "Trò chuyện mới", exact: true }).click();
    for (const prompt of prompts) {
      const turn = await submit(prompt);
      if (turn?.status === "failed" && results.filter(item => item.retry).length < 2) await submit(prompt, true);
    }
  }
  console.log(`Scenarios recorded: ${results.length}. See ${output}/results.json.`);
  if (results.some(result => !["completed", "awaiting_approval", "awaiting_input"].includes(result.status))) process.exitCode = 1;
} catch {
  console.error("Scenario harness interrupted. Review saved results and owner diagnostics; provider payloads withheld.");
  process.exitCode = 1;
} finally {
  await browser?.close();
  await sql`UPDATE assistant_turns SET status='failed',error_code='TURN_CANCELLED' WHERE conversation_id IN (SELECT id FROM assistant_conversations WHERE owner_email=${email}) AND status IN ('running','awaiting_approval','awaiting_input')`;
  // Keep the test account and conversations for owner log review; no trip writes.
  await sql.end();
}
