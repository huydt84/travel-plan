import test from "node:test";
import assert from "node:assert/strict";
import { translate } from "../lib/i18n.mjs";
import { localizeAssistantMessage } from "../lib/i18n-assistant.mjs";
import { toolProgress } from "../lib/v1/tool-runtime.mjs";
import { createGeminiModelAdapter } from "../lib/v1/gemini-adapter.mjs";

const render = (locale, progress) => localizeAssistantMessage((key, values) => translate(locale, key, values), progress);

test("tool progress describes searches with their readable query", () => {
  const progress = toolProgress("search_web", { query: "giờ mở cửa Ghibli Museum" });
  assert.deepEqual(progress, {
    phase: "searching-web",
    label: "assistantExtra.progress.searchWebQuery",
    values: { query: "giờ mở cửa Ghibli Museum" },
  });
  assert.equal(render("vi", progress), "Đang tìm nguồn web về “giờ mở cửa Ghibli Museum”");
  assert.equal(render("en", progress), "Searching the web for “giờ mở cửa Ghibli Museum”");
});

test("tool progress names route endpoints and safely truncates long values", () => {
  const progress = toolProgress("compute_route", {
    origin: { address: `Tokyo ${"Station ".repeat(20)}` },
    destination: { address: "Ghibli Museum" },
  });
  assert.equal(progress.label, "assistantExtra.progress.routeBetween");
  assert.match(render("vi", progress), /^Đang so sánh tuyến từ Tokyo Station/);
  assert.ok(progress.values.origin.length <= 97);
  assert.equal(progress.values.destination, "Ghibli Museum");
});

test("tool progress keeps a localized fallback when arguments are opaque", () => {
  const progress = toolProgress("get_place_details", { placeId: "places/opaque-provider-id" });
  assert.equal(render("ja", progress), "営業時間とレビューを確認中");
});

test("blocking tools describe the amount of work being prepared", () => {
  const progress = toolProgress("apply_changes", { operations: [{}, {}, {}] });
  assert.equal(render("vi", progress), "Đang chuẩn bị 3 thay đổi để bạn xem lại");
  assert.equal(render("ja", progress), "確認用の変更を3件準備中");
});

test("Gemini thought summaries publish only their short stage title", async () => {
  let request;
  const events = [
    { event_type: "interaction.created", interaction: { id: "interaction-stage" } },
    { event_type: "step.start", index: 0, step: { type: "thought" } },
    { event_type: "step.delta", index: 0, delta: { type: "thought_summary", content: { type: "text", text: "**Đang phân tích lịch" } } },
    { event_type: "step.delta", index: 0, delta: { type: "thought_summary", content: { type: "text", text: " trình**\n\nChi tiết suy luận tuyệt đối không được hiển thị.\n\n**Đang xây dựng phương án**\n\nĐây là giai đoạn thứ hai." } } },
    { event_type: "step.delta", index: 0, delta: { type: "thought_signature", signature: "encrypted-private-thought" } },
    { event_type: "step.stop", index: 0 },
    { event_type: "step.start", index: 1, step: { type: "model_output" } },
    { event_type: "step.delta", index: 1, delta: { type: "text", text: "Câu trả lời" } },
    { event_type: "step.stop", index: 1 },
    { event_type: "interaction.completed", interaction: { id: "interaction-stage", status: "completed" } },
  ];
  const client = { interactions: {
    create: async (next) => {
      request = next;
      return { async *[Symbol.asyncIterator]() { for (const event of events) yield event; } };
    },
    get: async () => ({ id: "interaction-stage", status: "completed", output_text: "Câu trả lời" }),
    delete: async () => {},
  } };
  const progress = [], output = [];
  let auditResult;
  await createGeminiModelAdapter({ client, model: "gemini-3.8-flash" }).run({
    message: "Phân tích lịch trình", actor: { email: "test@example.com", isAdmin: true },
    contextService: {}, onProgress: (event) => progress.push(event), onText: (text) => output.push(text),
    onToolStart: () => "model-audit", onToolFinish: (_id, result) => { auditResult = result; },
  });
  assert.equal(request.generation_config.thinking_summaries, "auto");
  assert.deepEqual(progress.map((event) => event.label), [
    "assistantExtra.progress.thinking", "Đang phân tích lịch trình", "Đang xây dựng phương án", "assistantExtra.progress.responding",
  ]);
  assert.equal(progress.some((event) => event.label.includes("Chi tiết suy luận")), false);
  assert.equal(progress.some((event) => event.label.includes("encrypted-private-thought")), false);
  assert.equal(output.join(""), "Câu trả lời");
  assert.deepEqual(auditResult.metadata.thoughtSummaries, [
    { title: "Đang phân tích lịch trình", text: "**Đang phân tích lịch trình**\n\nChi tiết suy luận tuyệt đối không được hiển thị." },
    { title: "Đang xây dựng phương án", text: "**Đang xây dựng phương án**\n\nĐây là giai đoạn thứ hai." },
  ]);
});
