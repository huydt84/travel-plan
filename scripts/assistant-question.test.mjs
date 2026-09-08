import test from "node:test";
import assert from "node:assert/strict";
import { createGeminiModelAdapter } from "../lib/v1/gemini-adapter.mjs";
import { validateQuestionAnswers, validateQuestionSet } from "../lib/v1/question-schema.mjs";
import { call, scriptedClient } from "./assistant-fixtures.mjs";
import { assertBlockingContinuationAvailable } from "../lib/v1/travel-assistant.mjs";

const questions = [{
  id: "pace", header: "Pace", question: "How busy should the day be?", options: [
    { id: "relaxed", label: "Relaxed", description: "Leave time between stops.", recommended: true },
    { id: "busy", label: "Busy", description: "Fit in more places.", recommended: false },
  ],
}];

test("question sets enforce bounds, unique ids, and one recommendation", () => {
  assert.equal(validateQuestionSet({ questions }).questions.length, 1);
  assert.throws(() => validateQuestionSet({ questions: [...questions, { ...questions[0] }] }), { code: "QUESTION_INVALID" });
  assert.throws(() => validateQuestionSet({ questions: [{ ...questions[0], options: questions[0].options.map((option) => ({ ...option, recommended: false })) }] }), { code: "QUESTION_INVALID" });
  assert.throws(() => validateQuestionSet({ questions: [{ ...questions[0], options: questions[0].options.map((option) => ({ ...option, recommended: true })) }] }), { code: "QUESTION_INVALID" });
  assert.throws(() => validateQuestionSet({ questions: Array.from({ length: 4 }, (_, i) => ({ ...questions[0], id: `q${i}` })) }), { code: "INVALID_INPUT" });
  assert.throws(() => validateQuestionSet({ questions: [] }), { code: "INVALID_INPUT" });
  assert.throws(() => validateQuestionSet({ questions: [{ ...questions[0], options: questions[0].options.slice(0, 1) }] }), { code: "INVALID_INPUT" });
  assert.throws(() => validateQuestionSet({ questions: [{ ...questions[0], options: Array.from({ length: 5 }, (_, i) => ({ id: `o${i}`, label: String(i), description: "", recommended: i === 0 })) }] }), { code: "INVALID_INPUT" });
  assert.throws(() => validateQuestionSet({ questions: [{ ...questions[0], options: [questions[0].options[0], { ...questions[0].options[1], id: questions[0].options[0].id }] }] }), { code: "QUESTION_INVALID" });
});

test("answers cover each question exactly once with a stored option or bounded custom text", () => {
  const submissionId = "00000000-0000-4000-8000-000000000001";
  assert.deepEqual(validateQuestionAnswers(questions, { submissionId, answers: [{ questionId: "pace", optionId: "relaxed" }] }).answers[0], { questionId: "pace", optionId: "relaxed" });
  assert.equal(validateQuestionAnswers(questions, { submissionId, answers: [{ questionId: "pace", text: "  My pace  " }] }).answers[0].text, "My pace");
  assert.throws(() => validateQuestionAnswers(questions, { submissionId, answers: [] }), { code: "INVALID_INPUT" });
  assert.throws(() => validateQuestionAnswers(questions, { submissionId, answers: [{ questionId: "pace", optionId: "missing" }] }), { code: "QUESTION_ANSWER_INVALID" });
  assert.throws(() => validateQuestionAnswers(questions, { submissionId, answers: [{ questionId: "pace", text: "x".repeat(1001) }] }), { code: "INVALID_INPUT" });
});

const run = (client, continuation = []) => createGeminiModelAdapter({ client, model: "test" }).run({
  message: "Plan a day", continuation, actor: { email: "test@example.com", isAdmin: true }, resolvedContext: [],
});

test("the model can pause for one validated question set", async () => {
  const client = scriptedClient([{ steps: [call("ask_question", { questions })] }]);
  const result = await run(client);
  assert.equal(result.pendingQuestion.call.arguments.questions[0].id, "pace");
  assert.ok(client.requests[0].tools.some((tool) => tool.name === "ask_question"));
  assert.match(client.requests[0].system_instruction, /Do not repeat the questions in prose/);
});

test("invalid question arguments reach the model for repair", async () => {
  const client = scriptedClient([
    { steps: [call("ask_question", { questions: [{ ...questions[0], options: questions[0].options.map((option) => ({ ...option, recommended: false })) }] })] },
    (request) => {
      assert.equal(request.input[0].result.error.code, "QUESTION_INVALID");
      return { output_text: "I need more detail." };
    },
  ]);
  assert.equal((await run(client)).text, "I need more detail.");
});

test("only one blocking tool is accepted in a model round", async () => {
  const changes = { operations: [{ kind: "trip.create", draftId: "trip", value: { slug: "trip", title: "Trip", startDate: "2030-01-01", endDate: "2030-01-01", timezone: "Asia/Tokyo", location: "Tokyo" } }] };
  await assert.rejects(run(scriptedClient([{ steps: [call("ask_question", { questions }), call("apply_changes", changes)] }])), { code: "TOOL_COMBINATION_INVALID" });
  await assert.rejects(run(scriptedClient([{ steps: [call("ask_question", { questions }), call("ask_question", { questions })] }])), { code: "TOOL_COMBINATION_INVALID" });
});

test("approval and question continuations share an eight-segment ceiling", () => {
  assert.doesNotThrow(() => assertBlockingContinuationAvailable(7));
  assert.throws(() => assertBlockingContinuationAvailable(8), { code: "TOOL_BUDGET_EXCEEDED" });
});

test("structured question answers are preserved in continuation input", async () => {
  const continuation = [{ callId: "question", name: "ask_question", arguments: { questions }, result: { answers: [{ questionId: "pace", optionId: "relaxed" }] } }];
  const client = scriptedClient([(request) => {
    assert.match(request.input, /PRIOR TOOL CONTINUATIONS/);
    assert.match(request.input, /"optionId":"relaxed"/);
    return { output_text: "A relaxed day works well." };
  }]);
  assert.equal((await run(client, continuation)).text, "A relaxed day works well.");
});
