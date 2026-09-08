import { randomUUID } from "node:crypto";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { createAssistantStore } from "../../lib/v1/store.mjs";
import { createQuestionStore } from "../../lib/v1/question-store.mjs";
import { expect, gotoHealthy, test } from "./fixtures.mjs";

const definitions = [{ id: "pace", header: "Nhịp độ", question: "Bạn muốn đi như thế nào?", options: [
  { id: "relaxed", label: "Thư thả", description: "Có thời gian nghỉ.", recommended: true },
  { id: "busy", label: "Nhiều trải nghiệm", description: "Thêm nhiều điểm dừng.", recommended: false },
] }];

async function fixture() {
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
  const email = `question-${randomUUID()}@example.com`;
  await sql`INSERT INTO users(email,name,role,first_login,last_login,last_active_at) VALUES(${email},'Question tester','admin',NOW(),NOW(),NOW())`;
  const store = createAssistantStore({ sql }), questions = createQuestionStore(sql);
  const stage = async (questionDefinitions = definitions) => {
    const accepted = await store.acceptRequest({ ownerEmail: email, clientTurnId: randomUUID(), input: "Ask", title: "Ask", leaseMs: 60000, maxTurnsPerHour: 100, background: true });
    const question = await questions.stage({ turnId: accepted.turn.id, call: { id: "call-question", arguments: { questions: questionDefinitions } }, email });
    return { ...accepted, question };
  };
  const close = async () => { await sql`DELETE FROM assistant_conversations WHERE owner_email=${email}`; await sql`DELETE FROM users WHERE email=${email}`; await sql.end(); };
  return { sql, email, store, questions, stage, close };
}

test("question persistence resumes once and fences concurrent or changed answers", async () => {
  const f = await fixture();
  try {
    const staged = await f.stage();
    expect((await f.store.getTurn(staged.turn.id, f.email)).status).toBe("awaiting_input");
    await expect(f.sql`UPDATE assistant_questions SET questions='[]' WHERE id=${staged.question.id}::UUID`).rejects.toThrow("Immutable");
    const input = { submissionId: randomUUID(), answers: [{ questionId: "pace", optionId: "relaxed" }] };
    const answered = await f.questions.answer(staged.question.id, f.email, input);
    expect(answered.replayed).toBe(false);
    expect((await f.questions.answer(staged.question.id, f.email, input)).replayed).toBe(true);
    await expect(f.questions.answer(staged.question.id, f.email, { ...input, submissionId: randomUUID() })).rejects.toMatchObject({ code: "QUESTION_RESOLVED" });
    const turn = await f.store.getTurn(staged.turn.id, f.email);
    expect(turn).toMatchObject({ status: "running", segment: 1 });
    expect(turn.continuation[0]).toMatchObject({ name: "ask_question", result: { answers: input.answers } });
    expect((await f.sql`SELECT segment,attempts FROM assistant_jobs WHERE turn_id=${staged.turn.id}::UUID`)[0]).toMatchObject({ segment: 1, attempts: 0 });
  } finally { await f.close(); }
});

test("concurrent different submissions have exactly one authoritative winner", async () => {
  const f = await fixture();
  try {
    const staged = await f.stage();
    const candidates = [
      { submissionId: randomUUID(), answers: [{ questionId: "pace", optionId: "relaxed" }] },
      { submissionId: randomUUID(), answers: [{ questionId: "pace", optionId: "busy" }] },
    ];
    const outcomes = await Promise.allSettled(candidates.map((input) => f.questions.answer(staged.question.id, f.email, input)));
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "rejected").reason).toMatchObject({ code: "QUESTION_RESOLVED" });
    const stored = (await f.questions.list([staged.turn.id], f.email))[0];
    const winningOption = outcomes[0].status === "fulfilled" ? "relaxed" : "busy";
    expect(stored).toMatchObject({ status: "answered", answers: [{ questionId: "pace", optionId: winningOption }] });
    expect((await f.store.getTurn(staged.turn.id, f.email)).segment).toBe(1);
  } finally { await f.close(); }
});

test("only the conversation owner can answer and Stop cancels a pending question", async () => {
  const f = await fixture();
  try {
    const staged = await f.stage();
    await expect(f.questions.answer(staged.question.id, "other@example.com", { submissionId: randomUUID(), answers: [{ questionId: "pace", optionId: "relaxed" }] })).rejects.toMatchObject({ code: "QUESTION_NOT_FOUND" });
    await f.store.failTurn(staged.turn.id, "TURN_CANCELLED");
    expect((await f.questions.list([staged.turn.id], f.email))[0].status).toBe("cancelled");
  } finally { await f.close(); }
});

test("Codex-style question UI persists, accepts a custom answer, and resumes the same turn", async ({ page }) => {
  const ready = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/assistant/workspace" && response.ok());
  await gotoHealthy(page, "/assistant");
  await ready;
  await page.getByLabel("Yêu cầu cho trợ lý").fill("Hãy hỏi tôi về chuyến đi");
  await page.getByRole("button", { name: "Gửi yêu cầu" }).click();
  await expect(page.getByRole("heading", { name: "Trợ lý cần bạn chọn" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("Yêu cầu cho trợ lý")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Dừng" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Gửi câu trả lời" })).toBeDisabled();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Trợ lý cần bạn chọn" })).toBeVisible();
  await page.getByTestId("language-switcher").first().selectOption("en");
  await expect(page.getByRole("heading", { name: "The assistant needs your input" })).toBeVisible();
  await expect(page.getByText("Bạn muốn chuyến đi có nhịp độ như thế nào?")).toBeVisible();
  await page.getByTestId("language-switcher").first().selectOption("ja");
  await expect(page.getByRole("heading", { name: "アシスタントが回答を必要としています" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /自分の回答を入力/ }).first()).toBeVisible();
  await page.getByTestId("language-switcher").first().selectOption("vi");
  const firstChoice = page.getByRole("radio", { name: /Thư thả/ });
  await firstChoice.focus();
  await page.keyboard.press("Space");
  await expect(firstChoice).toBeChecked();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("radio", { name: /Nhập câu trả lời riêng/ }).nth(1).check();
  const disclosureDurations = await page.getByLabel("Câu trả lời của bạn").evaluate((element) => element.parentElement.getAnimations().map((animation) => Number(animation.effect.getTiming().duration)));
  expect(disclosureDurations.every((duration) => duration <= 1)).toBe(true);
  await page.getByLabel("Câu trả lời của bạn").fill("Ưu tiên các hoạt động miễn phí");
  await expect(page.getByRole("button", { name: "Gửi câu trả lời" })).toBeEnabled();
  await page.getByRole("button", { name: "Gửi câu trả lời" }).click();
  await expect(page.getByRole("heading", { name: "Đã trả lời" })).toBeFocused();
  await expect(page.getByText(/Cảm ơn. Tôi sẽ tiếp tục với lựa chọn:/)).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.getByText("Nhập câu trả lời riêng: Ưu tiên các hoạt động miễn phí")).toBeVisible();
});

test("pending questions fit dedicated and companion layouts at canonical viewports", async ({ page }, testInfo) => {
  await gotoHealthy(page, "/assistant");
  await page.getByLabel("Yêu cầu cho trợ lý").fill("Hãy hỏi tôi về chuyến đi");
  await page.getByRole("button", { name: "Gửi yêu cầu" }).click();
  await expect(page.getByRole("heading", { name: "Trợ lý cần bạn chọn" })).toBeVisible({ timeout: 20_000 });
  const conversation = new URL(page.url()).searchParams.get("conversation");
  expect(conversation).toBeTruthy();

  for (const viewport of [{ width: 320, height: 760 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    for (const [surface, path] of [
      ["dedicated", `/assistant?conversation=${conversation}`],
      ["companion", `/?chat=1&conversation=${conversation}`],
    ]) {
      await gotoHealthy(page, path);
      const heading = page.getByRole("heading", { name: "Trợ lý cần bạn chọn" });
      await expect(heading).toBeVisible();
      await expect(page.getByRole("radio", { name: /Nhập câu trả lời riêng/ }).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
      const panel = heading.locator("xpath=ancestor::form");
      const bounds = await panel.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
      await page.screenshot({ path: testInfo.outputPath(`${surface}-${viewport.width}.png`), fullPage: false, animations: "disabled" });
    }
  }
});

test("answer endpoint rejects requests without same-origin browser context", async ({ request }) => {
  const response = await request.post(`/api/v1/assistant/questions/${randomUUID()}/answer`, {
    data: { submissionId: randomUUID(), answers: [{ questionId: "pace", optionId: "relaxed" }] },
  });
  expect(response.status()).toBe(403);
  expect((await response.json()).code).toBe("ORIGIN_FORBIDDEN");
});

test("owner management review shows pending questions as read-only", async ({ page }) => {
  const f = await fixture();
  try {
    const staged = await f.stage();
    await gotoHealthy(page, `/admin/assistant/conversations/${staged.conversation.id}`);
    const review = page.getByRole("region", { name: "Xem lại cuộc trò chuyện" });
    await expect(review.getByRole("heading", { name: "Trợ lý cần bạn chọn" })).toBeVisible();
    await expect(review.getByText("Chỉ người tạo cuộc trò chuyện mới có thể trả lời.")).toBeVisible();
    await expect(review.getByRole("radio", { name: /Thư thả/ })).toBeDisabled();
    await expect(review.getByRole("button", { name: "Gửi câu trả lời" })).toHaveCount(0);
    await expect(review.getByRole("button", { name: "Dừng yêu cầu" })).toBeVisible();
  } finally { await f.close(); }
});

test("three long Vietnamese and Japanese questions keep five-option rows inside a phone review", async ({ page }, testInfo) => {
  const f = await fixture();
  try {
    const longQuestions = [
      { ...definitions[0], id: "pace_long", header: "Nhịp độ mỗi ngày", question: "Bạn muốn dành nhiều thời gian để nghỉ ngơi và quan sát khu phố, hay ưu tiên một lịch trình dày hơn để trải nghiệm được nhiều địa điểm trong cùng một ngày?" },
      { id: "food", header: "食事について", question: "長い移動日の夕食では、予約できる静かな店と、予定を変更しやすい気軽な店のどちらを優先しますか？", options: [
        { id: "reserved", label: "予約できる静かな店を優先する", description: "落ち着いて食事できる時間を確保します。", recommended: true },
        { id: "flexible", label: "変更しやすい気軽な店を優先する", description: "当日の体調や移動時間に合わせます。", recommended: false },
      ] },
      { id: "transport", header: "Di chuyển", question: "Bạn muốn cân bằng chi phí và thời gian như thế nào?", options: [
        { id: "balanced", label: "Cân bằng", description: "Ưu tiên tàu, đi bộ và taxi khi thật cần thiết.", recommended: true },
        { id: "transit", label: "Chủ yếu phương tiện công cộng", description: "Tiết kiệm hơn nhưng có thể cần đổi tuyến.", recommended: false },
        { id: "taxi", label: "Ưu tiên taxi", description: "Ít đi bộ hơn với chi phí cao hơn.", recommended: false },
        { id: "walk", label: "Ưu tiên đi bộ", description: "Khám phá khu phố ở nhịp chậm.", recommended: false },
      ] },
    ];
    const staged = await f.stage(longQuestions);
    await page.setViewportSize({ width: 320, height: 760 });
    await gotoHealthy(page, `/admin/assistant/conversations/${staged.conversation.id}`);
    const prompt = page.getByRole("form", { name: "Câu hỏi từ trợ lý" });
    await expect(prompt.locator("fieldset")).toHaveCount(3);
    await expect(prompt.getByRole("radio")).toHaveCount(11);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    const bounds = await prompt.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    await page.screenshot({ path: testInfo.outputPath("phone-long-copy.png"), fullPage: true, animations: "disabled" });
  } finally { await f.close(); }
});
