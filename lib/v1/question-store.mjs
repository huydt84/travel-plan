import { randomUUID } from "node:crypto";
import { AssistantFault } from "./errors.mjs";
import { validateQuestionAnswers, validateQuestionSet } from "./question-schema.mjs";

const publicQuestion = (row) => ({
  id: String(row.id),
  turnId: String(row.turn_id),
  segment: Number(row.segment),
  questions: row.questions,
  answers: row.answers || null,
  status: row.status,
  answeredAt: row.answered_at ? new Date(row.answered_at).toISOString() : null,
});

export function createQuestionStore(sql) {
  const get = async (id, email) => {
    const [row] = await sql`SELECT q.* FROM assistant_questions q JOIN assistant_turns t ON t.id=q.turn_id
      JOIN assistant_conversations c ON c.id=t.conversation_id WHERE q.id=${id}::UUID AND c.owner_email=${email}`;
    if (!row) throw new AssistantFault("QUESTION_NOT_FOUND", "Không tìm thấy câu hỏi", { status: 404 });
    return row;
  };
  return {
    async list(turnIds, email) {
      if (!turnIds.length) return [];
      const rows = await sql`SELECT q.* FROM assistant_questions q JOIN assistant_turns t ON t.id=q.turn_id
        JOIN assistant_conversations c ON c.id=t.conversation_id WHERE t.id=ANY(${turnIds}::UUID[]) AND c.owner_email=${email}
        ORDER BY q.segment,q.created_at,q.id`;
      return rows.map(publicQuestion);
    },
    async stage({ turnId, segment = 0, call, citations = [], usedContext = [], email }) {
      const value = validateQuestionSet(call.arguments || {});
      const id = randomUUID();
      const [row] = await sql`WITH paused AS (
        UPDATE assistant_turns SET status='awaiting_input',lease_expires_at=NULL,citations=${JSON.stringify(citations)}::JSONB,
          used_context=${JSON.stringify(usedContext)}::JSONB
        WHERE id=${turnId}::UUID AND segment=${segment} AND status='running' AND lease_expires_at>NOW() RETURNING id
      ) INSERT INTO assistant_questions(id,turn_id,segment,call_id,questions)
        SELECT ${id}::UUID,id,${segment},${call.id},${JSON.stringify(value.questions)}::JSONB FROM paused RETURNING *`;
      if (!row) throw new AssistantFault("TURN_INTERRUPTED", "Yêu cầu đã dừng", { status: 409 });
      return publicQuestion(row);
    },
    async answer(id, email, input) {
      const row = await get(id, email);
      const value = validateQuestionAnswers(row.questions, input);
      const [result] = await sql`SELECT answer_assistant_question(${id}::UUID,${email},${value.submissionId}::UUID,${JSON.stringify(value.answers)}::JSONB) AS result`;
      if (result.result.error) throw new AssistantFault(result.result.error, ({
        QUESTION_RESOLVED: "Câu hỏi đã được trả lời hoặc đã dừng.",
        QUESTION_ANSWER_INVALID: "Câu trả lời không còn hợp lệ.",
      })[result.result.error] || "Không thể gửi câu trả lời", { status: result.result.error === "QUESTION_NOT_FOUND" ? 404 : 409 });
      return { turnId: String(row.turn_id), question: publicQuestion(result.result.question), replayed: Boolean(result.result.replayed) };
    },
  };
}
