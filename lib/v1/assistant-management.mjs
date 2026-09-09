import { randomUUID } from "node:crypto";
import { createBatchStore } from "./batch-store.mjs";
import { createAssistantStore } from "./store.mjs";
import { AssistantFault } from "./errors.mjs";
import { validatePolicy } from "./assistant-policy.mjs";
import { createQuestionStore } from "./question-store.mjs";

const handoffMessage = (row) => ({
  id: String(row.id), handoffId: String(row.handoff_id), conversationId: String(row.conversation_id),
  clientMessageId: String(row.client_message_id),
  author: { email: row.author_email, name: row.author_name, role: row.author_role },
  body: row.body, contextRefs: row.context_refs || [], createdAt: new Date(row.created_at).toISOString(),
  ordinal: Number(row.ordinal || 0),
});
const handoffSummary = (row) => ({
  id: String(row.id), conversationId: String(row.conversation_id), conversationTitle: row.conversation_title,
  participant: { email: row.initiated_by_email, name: row.initiated_by_name }, status: row.status,
  startedAt: new Date(row.started_at).toISOString(), closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
  ownerSeenAt: row.owner_seen_at ? new Date(row.owner_seen_at).toISOString() : null,
  latestMessage: row.latest_body || null, latestAt: new Date(row.latest_at || row.started_at).toISOString(),
  unreadCount: Number(row.unread_count || 0), emailStatus: row.email_status || null, emailError: row.email_error || null,
});

export const inheritedPolicy = { enabled: true, daily: "inherit", weekly: "inherit", model: "inherit", effort: "default", version: 0 };
export function createAssistantManagement(store = createAssistantStore()) {
  const sql = store.sql;
  return {
    async pageCursor(kind, id, page) {
      if (page === 1) return null;
      const offset = (page - 1) * 30 - 1;
      let rows;
      if (kind === "history") rows = await sql`SELECT id,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt" FROM assistant_conversations WHERE owner_email=${id} ORDER BY updated_at DESC,id DESC LIMIT 1 OFFSET ${offset}`;
      else if (kind === "conversation") rows = await sql`SELECT id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt" FROM assistant_turns WHERE conversation_id=${id}::UUID ORDER BY created_at DESC,id DESC LIMIT 1 OFFSET ${offset}`;
      else rows = await sql`SELECT t.id,to_char(COALESCE(t.completed_at,t.created_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt" FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id WHERE t.error_code IS DISTINCT FROM 'TURN_CANCELLED' AND (t.status='failed' OR EXISTS(SELECT 1 FROM assistant_tool_runs r WHERE r.turn_id=t.id AND r.status='failed')) ORDER BY COALESCE(t.completed_at,t.created_at) DESC,t.id DESC LIMIT 1 OFFSET ${offset}`;
      if (!rows.length) throw new AssistantFault("NOT_FOUND","Không tìm thấy",{status:404});
      return rows[0];
    },
    async targetPage(id, target) {
      await this.request(id,target);
      const [row] = await sql`SELECT COUNT(*)::INTEGER AS count FROM assistant_turns WHERE conversation_id=${id}::UUID AND (created_at,id)>(SELECT created_at,id FROM assistant_turns WHERE id=${target}::UUID)`;
      return Math.floor(row.count / 30) + 1;
    },
    async access(email) {
      const [row] = await sql`SELECT assistant_effective_policy(${email}) AS policy,
        date_trunc('day',NOW() AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo' + INTERVAL '1 day' AS daily_reset,
        date_trunc('week',NOW() AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo' + INTERVAL '7 days' AS weekly_reset,
        COUNT(*) FILTER(WHERE t.created_at >= date_trunc('day',NOW() AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo')::INTEGER AS daily_used,
        COUNT(*) FILTER(WHERE t.created_at >= date_trunc('week',NOW() AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo')::INTEGER AS weekly_used
        FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id WHERE c.owner_email=${email}`;
      return { ...row.policy, dailyUsed: row.daily_used, weeklyUsed: row.weekly_used,
        dailyReset: new Date(row.daily_reset).toISOString(), weeklyReset: new Date(row.weekly_reset).toISOString() };
    },
    async assertEnabled(email) {
      const policy = await this.access(email);
      if (!policy.enabled) throw new AssistantFault("ASSISTANT_DISABLED", "Trợ lý đã bị tắt. Bạn vẫn có thể đọc lịch sử.", { status: 403 });
      return policy;
    },
    async overview() {
      const [defaults] = await sql`SELECT policy,version,owner_email FROM assistant_policy_defaults WHERE id=TRUE`;
      const people = await sql`SELECT u.email,COALESCE(NULLIF(u.display_name,''),u.name) AS name,u.role,o.policy,o.version FROM users u
        LEFT JOIN assistant_policy_overrides o ON o.email=u.email
        WHERE u.email<>${defaults.owner_email} AND (u.role='admin' OR EXISTS(SELECT 1 FROM assistant_conversations c WHERE c.owner_email=u.email))
        ORDER BY u.role='admin' DESC,name,u.email`;
      const admins = await Promise.all(people.map(async (p) => ({ email: p.email, name: p.name, role: p.role,
        policy: p.policy ? { ...p.policy, version: p.version } : inheritedPolicy, access: await this.access(p.email) })));
      return { defaults: { ...defaults.policy, version: defaults.version }, admins, handoffs: await this.handoffs() };
    },
    async handoffs() {
      const rows = await sql`SELECT h.*,c.title AS conversation_title,
        latest.body AS latest_body,latest.created_at AS latest_at,o.status AS email_status,o.last_error_code AS email_error,
        (SELECT COUNT(*) FROM assistant_handoff_messages unread WHERE unread.handoff_id=h.id
          AND unread.author_role='participant' AND unread.created_at>COALESCE(h.owner_seen_at,'epoch'::TIMESTAMPTZ))::INTEGER AS unread_count
        FROM assistant_handoffs h JOIN assistant_conversations c ON c.id=h.conversation_id
        LEFT JOIN LATERAL (SELECT body,created_at FROM assistant_handoff_messages WHERE handoff_id=h.id ORDER BY ordinal DESC LIMIT 1) latest ON TRUE
        LEFT JOIN assistant_handoff_email_outbox o ON o.handoff_id=h.id
        WHERE h.status='active' ORDER BY (CASE WHEN latest.created_at>COALESCE(h.owner_seen_at,'epoch'::TIMESTAMPTZ) THEN 0 ELSE 1 END),latest.created_at DESC,h.id DESC`;
      return rows.map(handoffSummary);
    },
    async handoff(id) {
      const [row] = await sql`SELECT h.*,c.title AS conversation_title,o.status AS email_status,o.last_error_code AS email_error
        FROM assistant_handoffs h JOIN assistant_conversations c ON c.id=h.conversation_id
        LEFT JOIN assistant_handoff_email_outbox o ON o.handoff_id=h.id WHERE h.id=${id}::UUID`;
      if (!row) throw new AssistantFault("HANDOFF_NOT_FOUND", "Không tìm thấy cuộc bàn giao", { status: 404 });
      const messages = await sql`SELECT * FROM assistant_handoff_messages WHERE handoff_id=${id}::UUID ORDER BY ordinal`;
      const turns = await store.listTurns(row.conversation_id,row.initiated_by_email,{ limit: 100 });
      return { ...handoffSummary(row), messages: messages.map(handoffMessage), turns };
    },
    async markHandoffSeen(actor, id) {
      const [row] = await sql`WITH changed AS (
        UPDATE assistant_handoffs SET owner_seen_at=NOW()
        WHERE id=${id}::UUID AND (owner_seen_at IS NULL OR EXISTS(
          SELECT 1 FROM assistant_handoff_messages m WHERE m.handoff_id=assistant_handoffs.id
          AND m.author_role='participant' AND m.created_at>assistant_handoffs.owner_seen_at))
        RETURNING initiated_by_email
      ) INSERT INTO assistant_management_audit(actor_email,target_email,action,after_value)
        SELECT ${actor},initiated_by_email,'handoff_seen',jsonb_build_object('handoffId',${id}::UUID) FROM changed
        RETURNING target_email`;
      if (!row) {
        const [exists] = await sql`SELECT id FROM assistant_handoffs WHERE id=${id}::UUID`;
        if (!exists) throw new AssistantFault("HANDOFF_NOT_FOUND", "Không tìm thấy cuộc bàn giao", { status: 404 });
      }
      return this.handoff(id);
    },
    async replyHandoff(actor, actorName, id, input) {
      const messageId = randomUUID();
      const [row] = await sql`SELECT reply_assistant_handoff(${actor},${actorName},${id}::UUID,${input.clientMessageId}::UUID,${messageId}::UUID,${input.message}) AS result`;
      const result = row.result;
      if (result.error) {
        const message = result.error === "HANDOFF_NOT_FOUND" ? "Không tìm thấy cuộc bàn giao"
          : result.error === "HANDOFF_CLOSED" ? "Cuộc bàn giao đã kết thúc"
          : "Không thể gửi tin nhắn";
        throw new AssistantFault(result.error, message, {
          status: result.error === "HANDOFF_NOT_FOUND" ? 404 : result.error === "OWNER_REQUIRED" ? 403 : 409,
        });
      }
      const [message] = await sql`SELECT * FROM assistant_handoff_messages WHERE id=${result.messageId}::UUID`;
      return { message: handoffMessage(message), replayed: result.replayed };
    },
    async closeHandoff(actor, id) {
      const [row] = await sql`SELECT close_assistant_handoff(${actor},${id}::UUID) AS result`;
      const result = row.result;
      if (result.error) throw new AssistantFault(result.error, result.error === "HANDOFF_NOT_FOUND" ? "Không tìm thấy cuộc bàn giao" : "Cuộc bàn giao đã kết thúc", { status: result.error === "HANDOFF_NOT_FOUND" ? 404 : result.error === "OWNER_REQUIRED" ? 403 : 409 });
      return result;
    },
    async save(actor, email, input) {
      const value = validatePolicy(input, Boolean(email));
      const { version, ...policy } = value;
      if (email) {
        const [target] = await sql`SELECT u.email FROM users u,assistant_policy_defaults d WHERE u.email=${email} AND u.role='admin' AND u.email<>d.owner_email`;
        if (!target) throw new AssistantFault("INVALID_INPUT", "Chỉ thay đổi cài đặt của admin hiện tại.");
      }
      const results = await sql.transaction((tx) => [
        tx`SELECT id FROM assistant_policy_defaults WHERE id=TRUE FOR UPDATE`,
        email ? tx`WITH previous AS (SELECT policy,version FROM assistant_policy_overrides WHERE email=${email}),
          changed AS (INSERT INTO assistant_policy_overrides(email,policy,version)
            SELECT ${email},${JSON.stringify(policy)}::JSONB,1 WHERE ${version}=0 OR EXISTS(SELECT 1 FROM previous WHERE version=${version})
            ON CONFLICT(email) DO UPDATE SET policy=EXCLUDED.policy,version=assistant_policy_overrides.version+1 WHERE assistant_policy_overrides.version=${version} RETURNING *)
          INSERT INTO assistant_management_audit(actor_email,target_email,action,before_value,after_value)
          SELECT ${actor},${email},'policy', (SELECT policy FROM previous),policy FROM changed RETURNING id`
          : tx`WITH previous AS (SELECT policy FROM assistant_policy_defaults WHERE id=TRUE),
          changed AS (UPDATE assistant_policy_defaults SET policy=${JSON.stringify(policy)}::JSONB,version=version+1 WHERE id=TRUE AND version=${version} RETURNING policy)
          INSERT INTO assistant_management_audit(actor_email,action,before_value,after_value)
          SELECT ${actor},'defaults',(SELECT policy FROM previous),policy FROM changed RETURNING id`,
      ]);
      if (!results[1].length) throw new AssistantFault("POLICY_CONFLICT", "Cài đặt đã thay đổi. Tải lại trước khi lưu.", { status: 409 });
      return this.overview();
    },
    async conversations(email, before) {
      const rows = await store.listConversations(email, { limit: 31, before });
      const items = rows.slice(0,30);
      return { items, cursor: rows.length>30 ? { updatedAt: items.at(-1).updatedAt, id: items.at(-1).id } : null };
    },
    async failures(before, turnId = null) {
      const rows = await sql`SELECT t.id,t.conversation_id AS "conversationId",c.owner_email AS email,c.title,t.status,
        COALESCE(t.error_code,'TOOL_FAILED') AS code,t.error_diagnostics AS diagnostics,t.execution_settings AS settings,t.segment,
        t.retry_of_turn_id AS "retryOfTurnId",t.created_at AS "startedAt",
        to_char(COALESCE(t.completed_at,t.created_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "completedAt"
        FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id
        WHERE (${turnId}::UUID IS NULL OR t.id=${turnId}::UUID) AND t.error_code IS DISTINCT FROM 'TURN_CANCELLED' AND (t.status='failed' OR EXISTS(SELECT 1 FROM assistant_tool_runs r WHERE r.turn_id=t.id AND r.status='failed'))
        AND (${before?.createdAt || null}::TIMESTAMPTZ IS NULL OR (COALESCE(t.completed_at,t.created_at),t.id)<(${before?.createdAt || null}::TIMESTAMPTZ,${before?.id || null}::UUID))
        ORDER BY COALESCE(t.completed_at,t.created_at) DESC,t.id DESC LIMIT 31`;
      const items = rows.slice(0,30);
      const tools = items.length ? await sql`SELECT id,turn_id AS "turnId",tool_name AS name,status,error_code AS code,duration_ms AS "durationMs",result_metadata->'diagnostics' AS diagnostics
        FROM assistant_tool_runs WHERE turn_id=ANY(${items.map(item => item.id)}::UUID[]) ORDER BY created_at,id` : [];
      for (const item of items) item.tools = tools.filter(tool => tool.turnId === item.id);
      return { items, cursor: rows.length>30 ? { createdAt: items.at(-1).completedAt, id: items.at(-1).id } : null };
    },
    async failure(id) {
      const result = await this.failures(null, id);
      if (!result.items.length) throw new AssistantFault("NOT_FOUND", "Không tìm thấy", { status: 404 });
      return result.items[0];
    },
    async request(conversationId, turnId) {
      const [row] = await sql`SELECT c.owner_email FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id WHERE t.id=${turnId}::UUID AND c.id=${conversationId}::UUID`;
      if (!row) throw new AssistantFault("CONVERSATION_NOT_FOUND", "Không tìm thấy cuộc trò chuyện", { status: 404 });
      await store.reconcile(row.owner_email);
      const turn = await store.getTurn(turnId, row.owner_email);
      const actions = await createBatchStore(sql).list([turnId], row.owner_email);
      const questions = await createQuestionStore(sql).list([turnId], row.owner_email);
      const neighbors = await sql`WITH ordered AS (SELECT id,lag(id) OVER(ORDER BY created_at,id) AS previous,lead(id) OVER(ORDER BY created_at,id) AS next FROM assistant_turns WHERE conversation_id=${conversationId}::UUID) SELECT previous,next FROM ordered WHERE id=${turnId}::UUID`;
      return { conversation: await store.getConversation(conversationId,row.owner_email), email:row.owner_email, turns:[{...turn,actions,questions}], ...neighbors[0] };
    },
    async conversation(id, before, target = null) {
      let page = null;
      if (target) {
        page = await this.targetPage(id,target);
        before = await this.pageCursor("conversation",id,page);
      }
      const [row] = await sql`SELECT owner_email FROM assistant_conversations WHERE id=${id}::UUID`;
      if (!row) throw new AssistantFault("CONVERSATION_NOT_FOUND", "Không tìm thấy cuộc trò chuyện", { status: 404 });
      await store.reconcile(row.owner_email);
      const conversation = await store.getConversation(id,row.owner_email);
      // Review includes every attempt, unlike the personal exchange view which collapses retries.
      const rows = await sql`SELECT t.id,to_char(t.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
        FROM assistant_turns t WHERE conversation_id=${id}::UUID AND (${before?.createdAt || null}::TIMESTAMPTZ IS NULL OR
        (t.created_at,t.id)<(${before?.createdAt || null}::TIMESTAMPTZ,${before?.id || null}::UUID)) ORDER BY t.created_at DESC,t.id DESC LIMIT 31`;
      const selected = rows.slice(0,30);
      const turns = await Promise.all(selected.map((r) => store.getTurn(r.id,row.owner_email)));
      const actions = await createBatchStore(sql).list(turns.map((t) => t.id), row.owner_email);
      const questions = await createQuestionStore(sql).list(turns.map((t) => t.id), row.owner_email);
      return { conversation, page, previousCursor: page>1 ? await this.pageCursor("conversation",id,page-1) : null, email: row.owner_email, turns: turns.reverse().map((t) => ({ ...t, actions: actions.filter((a) => a.turnId === t.id), questions: questions.filter((q) => q.turnId === t.id) })), cursor: rows.length>30 ? { createdAt: selected.at(-1).created_at, id: selected.at(-1).id } : null };
    },
    async stop(actor, id) {
      const [row] = await sql`WITH stopped AS (UPDATE assistant_turns SET status='failed',error_code='TURN_CANCELLED',completed_at=NOW(),lease_expires_at=NULL
        WHERE id=${id}::UUID AND status IN ('running','awaiting_approval','awaiting_input') RETURNING id,conversation_id)
        INSERT INTO assistant_management_audit(actor_email,target_email,action,after_value)
        SELECT ${actor},c.owner_email,'stop',jsonb_build_object('turnId',s.id) FROM stopped s JOIN assistant_conversations c ON c.id=s.conversation_id RETURNING target_email`;
      if (row) await store.reconcile(row.target_email);
      return { stopped: Boolean(row) };
    },
  };
}
