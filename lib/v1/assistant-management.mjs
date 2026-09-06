import { createBatchStore } from "./batch-store.mjs";
import { createAssistantStore } from "./store.mjs";
import { AssistantFault } from "./errors.mjs";
import { validatePolicy } from "./assistant-policy.mjs";

export const inheritedPolicy = { enabled: true, daily: "inherit", weekly: "inherit", model: "inherit", effort: "default", version: 0 };
export function createAssistantManagement(store = createAssistantStore()) {
  const sql = store.sql;
  return {
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
      const people = await sql`SELECT u.email,u.name,u.role,o.policy,o.version FROM users u
        LEFT JOIN assistant_policy_overrides o ON o.email=u.email
        WHERE u.email<>${defaults.owner_email} AND (u.role='admin' OR EXISTS(SELECT 1 FROM assistant_conversations c WHERE c.owner_email=u.email))
        ORDER BY u.role='admin' DESC,u.name,u.email`;
      const admins = await Promise.all(people.map(async (p) => ({ email: p.email, name: p.name, role: p.role,
        policy: p.policy ? { ...p.policy, version: p.version } : inheritedPolicy, access: await this.access(p.email) })));
      return { defaults: { ...defaults.policy, version: defaults.version }, admins };
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
    async conversation(id, before) {
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
      return { conversation, email: row.owner_email, turns: turns.reverse().map((t) => ({ ...t, actions: actions.filter((a) => a.turnId === t.id) })), cursor: rows.length>30 ? { createdAt: selected.at(-1).created_at, id: selected.at(-1).id } : null };
    },
    async stop(actor, id) {
      const [row] = await sql`WITH stopped AS (UPDATE assistant_turns SET status='failed',error_code='TURN_CANCELLED',completed_at=NOW(),lease_expires_at=NULL
        WHERE id=${id}::UUID AND status IN ('running','awaiting_approval') RETURNING id,conversation_id)
        INSERT INTO assistant_management_audit(actor_email,target_email,action,after_value)
        SELECT ${actor},c.owner_email,'stop',jsonb_build_object('turnId',s.id) FROM stopped s JOIN assistant_conversations c ON c.id=s.conversation_id RETURNING target_email`;
      if (row) await store.reconcile(row.target_email);
      return { stopped: Boolean(row) };
    },
  };
}
