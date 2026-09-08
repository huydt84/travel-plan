import { AssistantFault } from "./errors.mjs";
import { validateSchema } from "./schemas.mjs";

const id = "^[A-Za-z][A-Za-z0-9_-]{0,63}$";

export const askQuestionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "header", "question", "options"],
        properties: {
          id: { type: "string", pattern: id },
          header: { type: "string", minLength: 1, maxLength: 40, pattern: "\\S" },
          question: { type: "string", minLength: 1, maxLength: 500, pattern: "\\S" },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 4,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "label", "description", "recommended"],
              properties: {
                id: { type: "string", pattern: id },
                label: { type: "string", minLength: 1, maxLength: 80, pattern: "\\S" },
                description: { type: "string", maxLength: 240 },
                recommended: { type: "boolean" },
              },
            },
          },
        },
      },
    },
  },
};

export const questionAnswerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["submissionId", "answers"],
  properties: {
    submissionId: { type: "string", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$" },
    answers: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        oneOf: [
          { type: "object", additionalProperties: false, required: ["questionId", "optionId"], properties: {
            questionId: { type: "string", pattern: id }, optionId: { type: "string", pattern: id },
          } },
          { type: "object", additionalProperties: false, required: ["questionId", "text"], properties: {
            questionId: { type: "string", pattern: id }, text: { type: "string", minLength: 1, maxLength: 1000, pattern: "\\S" },
          } },
        ],
      },
    },
  },
};

export function validateQuestionSet(value) {
  validateSchema(askQuestionSchema, value, "Câu hỏi");
  const questionIds = new Set();
  for (const question of value.questions) {
    if (questionIds.has(question.id)) throw new AssistantFault("QUESTION_INVALID", "Mã câu hỏi phải là duy nhất", { status: 400 });
    questionIds.add(question.id);
    const optionIds = new Set();
    let recommended = 0;
    for (const option of question.options) {
      if (optionIds.has(option.id)) throw new AssistantFault("QUESTION_INVALID", "Mã lựa chọn phải là duy nhất trong mỗi câu hỏi", { status: 400 });
      optionIds.add(option.id);
      if (option.recommended) recommended++;
    }
    if (recommended !== 1) throw new AssistantFault("QUESTION_INVALID", "Mỗi câu hỏi cần đúng một lựa chọn được đề xuất", { status: 400 });
  }
  return value;
}

export function validateQuestionAnswers(questions, value) {
  validateSchema(questionAnswerSchema, value, "Câu trả lời");
  if (value.answers.length !== questions.length) throw new AssistantFault("QUESTION_ANSWER_INCOMPLETE", "Hãy trả lời tất cả câu hỏi", { status: 400 });
  const expected = new Map(questions.map((question) => [question.id, question]));
  const seen = new Set();
  for (const answer of value.answers) {
    const question = expected.get(answer.questionId);
    if (!question || seen.has(answer.questionId)) throw new AssistantFault("QUESTION_ANSWER_INVALID", "Câu trả lời không khớp với câu hỏi", { status: 400 });
    seen.add(answer.questionId);
    if ("optionId" in answer && !question.options.some((option) => option.id === answer.optionId)) {
      throw new AssistantFault("QUESTION_ANSWER_INVALID", "Lựa chọn không còn hợp lệ", { status: 400 });
    }
  }
  return { ...value, answers: value.answers.map((answer) => "text" in answer ? { ...answer, text: answer.text.trim() } : answer) };
}
