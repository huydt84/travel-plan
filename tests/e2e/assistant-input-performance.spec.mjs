import { randomUUID } from "node:crypto";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { createAssistantStore } from "../../lib/v1/store.mjs";
import { createBackgroundStore } from "../../lib/v1/background-store.mjs";
import { expect, gotoHealthy, itineraryTest as test } from "./fixtures.mjs";

async function useFreshActor(page, sql, tripSlug) {
  const email = `assistant-performance-${randomUUID()}@localhost.invalid`;
  const [trip] = await sql`SELECT id FROM trips WHERE slug=${tripSlug}`;
  await sql`INSERT INTO users(email,name,role,first_login,last_login,last_active_at)
    VALUES(${email},'Assistant performance','admin',NOW(),NOW(),NOW())`;
  await sql`INSERT INTO trip_participants(trip_id,user_email,role,added_by_email)
    VALUES(${trip.id},${email},'member',${email})`;
  await page.setExtraHTTPHeaders({"x-local-viewer-email":email,"x-local-viewer-name":"Assistant performance"});
  return email;
}

async function removeFreshActor(sql, email) {
  await sql`DELETE FROM assistant_conversations WHERE owner_email=${email}`;
  await sql`DELETE FROM trip_participants WHERE user_email=${email}`;
  await sql`DELETE FROM users WHERE email=${email}`;
}

test("assistant composer echoes keyboard input without a long interaction delay", async ({ page, tripSlug }) => {
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
  const conversationId = randomUUID();
  const ownerEmail = `assistant-input-${randomUUID()}@localhost.invalid`;
  const repeatedMarkdown = Array.from({ length: 60 }, (_, index) =>
    `### Điểm dừng ${index + 1}\n\nThông tin chi tiết cho lịch trình với **nội dung quan trọng** và [nguồn](https://example.com/${index}).`,
  ).join("\n\n");
  try {
    const [trip] = await sql`SELECT id FROM trips WHERE slug=${tripSlug}`;
    await sql`INSERT INTO users(email,name,role,first_login,last_login,last_active_at)
      VALUES(${ownerEmail},'Input performance','admin',NOW(),NOW(),NOW())`;
    await sql`INSERT INTO trip_participants(trip_id,user_email,role,added_by_email)
      VALUES(${trip.id},${ownerEmail},'member','local-admin@localhost.invalid')`;
    await page.setExtraHTTPHeaders({
      "x-local-viewer-email": ownerEmail,
      "x-local-viewer-name": "Input performance",
    });
    await sql`INSERT INTO assistant_conversations(id,owner_email,trip_id,title)
      VALUES(${conversationId},${ownerEmail},${trip.id},'Typing performance')`;
    await sql`INSERT INTO assistant_turns(id,conversation_id,client_turn_id,input_text,output_text,status,created_at,completed_at)
      SELECT gen_random_uuid(),${conversationId},gen_random_uuid(),'Câu hỏi ' || i,${repeatedMarkdown},'completed',NOW()+i*INTERVAL '1 microsecond',NOW()
      FROM generate_series(1,16) i`;

    await gotoHealthy(page, `/assistant?trip=${tripSlug}&conversation=${conversationId}`);
    const input = page.getByRole("textbox", { name: "Yêu cầu cho trợ lý" });
    await expect(input).toBeEnabled();

    await page.evaluate(() => {
      window.__assistantInputTimings = [];
      let keyStartedAt = 0;

      window.addEventListener("keydown", (event) => {
        if (event.target?.getAttribute("aria-label") === "Yêu cầu cho trợ lý") {
          keyStartedAt = performance.now();
        }
      }, true);
      window.addEventListener("input", (event) => {
        if (event.target?.getAttribute("aria-label") !== "Yêu cầu cho trợ lý" || !keyStartedAt) return;
        const startedAt = keyStartedAt;
        requestAnimationFrame(() => {
          window.__assistantInputTimings.push(performance.now() - startedAt);
        });
      });
    });

    await input.click();
    await page.keyboard.type("responsive typing");
    await expect(input).toHaveValue("responsive typing");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const timings = await page.evaluate(() => window.__assistantInputTimings);
    expect(timings).toHaveLength("responsive typing".length);
    expect(Math.max(...timings), `worst key-to-paint delay: ${Math.max(...timings).toFixed(1)}ms`).toBeLessThan(200);
  } finally {
    await sql`DELETE FROM assistant_conversations WHERE id=${conversationId}`;
    await sql`DELETE FROM trip_participants WHERE user_email=${ownerEmail}`;
    await sql`DELETE FROM users WHERE email=${ownerEmail}`;
    await sql.end();
  }
});

test("assistant shows the first answer text promptly after submission", async ({ page, tripSlug }) => {
  const sql=createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
  const email=await useFreshActor(page,sql,tripSlug);
  try {
    await gotoHealthy(page, `/assistant?trip=${tripSlug}`);
    const input = page.getByRole("textbox", { name: "Yêu cầu cho trợ lý" });
    await expect(input).toBeEnabled();
    await input.fill("Đo thời gian phản hồi đầu tiên");

    const startedAt = Date.now();
    await page.getByRole("button", { name: "Gửi yêu cầu" }).click();
    await expect(page.getByText("Đây là chế độ mô phỏng cục bộ.", { exact: false })).toBeVisible({ timeout: 10_000 });
    const firstTextMs = Date.now() - startedAt;
    expect(firstTextMs, `time to first answer text: ${firstTextMs}ms`).toBeLessThan(1_000);
    await expect(page.getByRole("button",{name:"Dừng",exact:true})).toHaveCount(0,{timeout:20_000});
  } finally {await removeFreshActor(sql,email);await sql.end();}
});

test("assistant paints bursty answer deltas progressively", async ({ page, tripSlug }) => {
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
  const store = createAssistantStore({ sql });
  const background = createBackgroundStore(store);
  const clientTurnId = randomUUID();
  const streamedOutput = Array.from({ length: 40 }, (_, index) => `token${index} `).join("");
  const email=await useFreshActor(page,sql,tripSlug);
  let conversationId, turnId;
  try {
    const accepted = await store.acceptRequest({
      ownerEmail: email,
      tripSlug,
      clientTurnId,
      conversationId: null,
      input: "Streaming performance",
      title: "Streaming performance",
      leaseMs: 60_000,
      maxTurnsPerHour: 100,
      background: true,
    });
    conversationId = accepted.conversation.id;
    turnId = accepted.turn.id;
    expect(await background.claim(accepted.turn.id, 60_000)).toBe(true);
    await gotoHealthy(page, `/assistant?trip=${tripSlug}&conversation=${conversationId}`);
    const answer = page.locator(`[data-exchange="${accepted.turn.id}"]`);
    await expect(answer).toBeVisible();
    await answer.evaluate((element) => {
      window.__assistantStreamPaints = [];
      const record = () => {
        const text = element.textContent || "";
        const length = (text.match(/token\d+ /g) || []).join("").length;
        if (length && window.__assistantStreamPaints.at(-1)?.length !== length) {
          window.__assistantStreamPaints.push({ at: performance.now(), length });
        }
      };
      new MutationObserver(record).observe(element, { childList: true, characterData: true, subtree: true });
    });

    for (let index = 0; index < 40; index++) {
      await background.append(accepted.turn.id, { type: "answer-delta", runId: accepted.turn.id, text: `token${index} ` });
    }
    await expect(answer).toContainText("token39", { timeout: 5_000 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const paints = await page.evaluate(() => window.__assistantStreamPaints);
    expect(paints.length, `stream paint count: ${paints.length}`).toBeGreaterThanOrEqual(4);
    await store.publishTurn({ turnId, output: streamedOutput, citations: [] });
    await expect(page.getByRole("button", { name: "Dừng", exact: true })).toHaveCount(0, { timeout: 5_000 });
    turnId = null;
  } finally {
    if (turnId) await store.failTurn(turnId, "TURN_CANCELLED");
    await removeFreshActor(sql,email);
    await sql.end();
  }
});
