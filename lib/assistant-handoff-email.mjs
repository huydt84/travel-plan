import { resolveLocalAdminMode } from "./runtime-config.mjs";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const FROM_ADDRESS = "Travel Plan <onboarding@resend.dev>";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const textValue = (value) => typeof value === "string" ? value.trim() : "";
const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

export class AssistantHandoffEmailError extends Error {
  constructor(code) { super("Assistant handoff email could not be delivered"); this.code = code; }
}

const configured = (env, name) => {
  const value = textValue(env[name]);
  if (!value) throw new AssistantHandoffEmailError("RESEND_CONFIG_ERROR");
  return value;
};

function resolveResendEndpoint(env) {
  const override = textValue(env.RESEND_API_ENDPOINT);
  if (!override) return RESEND_ENDPOINT;
  try {
    const url = new URL(override);
    const local = resolveLocalAdminMode(env);
    if (!["http:", "https:"].includes(url.protocol) || !local.enabled || !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) throw new Error();
    return url.toString();
  } catch { throw new AssistantHandoffEmailError("RESEND_CONFIG_ERROR"); }
}

export function buildAssistantHandoffUrl(env, handoffId) {
  try {
    const url = new URL(configured(env, "APP_URL"));
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    url.pathname = `/admin/assistant/handoffs/${encodeURIComponent(handoffId)}`;
    url.search = ""; url.hash = "";
    return url.toString();
  } catch { throw new AssistantHandoffEmailError("RESEND_CONFIG_ERROR"); }
}

export function buildAssistantHandoffEmail(row, env = process.env) {
  const url = buildAssistantHandoffUrl(env, row.handoff_id);
  const recipient = configured(env, "AUTH_OWNER_EMAIL").toLowerCase();
  const safe = { name: escapeHtml(row.sender_name), email: escapeHtml(row.sender_email),
    title: escapeHtml(row.conversation_title), body: escapeHtml(row.message_body).replaceAll("\n", "<br>"), url: escapeHtml(url) };
  return {
    from: FROM_ADDRESS,
    to: [recipient],
    subject: `[Trợ lý] ${row.sender_name} cần bạn tiếp quản`,
    text: [`${row.sender_name} (${row.sender_email}) đã bàn giao cuộc trò chuyện “${row.conversation_title}”.`, "", row.message_body, "", `Mở cuộc trò chuyện: ${url}`].join("\n"),
    html: `<!doctype html><html lang="vi"><body style="margin:0;background:#f4f1e8;color:#10243d;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:28px 12px;background:#f4f1e8"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;border:2px solid #10243d;background:#fffdf7"><tr><td style="padding:12px 22px;background:#008f68;color:#fffdf7;font-size:11px;font-weight:700">BÀN GIAO TRỢ LÝ</td></tr><tr><td style="padding:28px"><h1 style="margin:0;font-size:28px;line-height:1.15">${safe.name} cần bạn tiếp quản</h1><p style="margin:10px 0 20px;color:#586473;font-size:12px">${safe.email} · ${safe.title}</p><div style="padding:18px;border:1px solid #10243d;background:#fff0bf;color:#32445a;font-size:14px;line-height:1.65">${safe.body}</div><p style="margin:22px 0 0"><a href="${safe.url}" style="display:inline-block;padding:11px 15px;background:#008f68;color:#fffdf7;font-size:12px;font-weight:700;text-decoration:none">Mở cuộc trò chuyện</a></p></td></tr></table></td></tr></table></body></html>`,
  };
}

export async function sendAssistantHandoffEmail(row, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const endpoint = resolveResendEndpoint(env);
  const response = await fetchImpl(endpoint, { method: "POST", headers: {
    Authorization: `Bearer ${configured(env, "RESEND_API_KEY")}`,
    "Content-Type": "application/json", "Idempotency-Key": `assistant-handoff/${row.handoff_id}`,
  }, body: JSON.stringify(buildAssistantHandoffEmail(row, env)) }).catch(() => { throw new AssistantHandoffEmailError("RESEND_NETWORK_ERROR"); });
  if (!response.ok) throw new AssistantHandoffEmailError(`RESEND_HTTP_${response.status}`);
  const payload = await response.json().catch(() => null);
  if (!textValue(payload?.id)) throw new AssistantHandoffEmailError("RESEND_INVALID_RESPONSE");
  return payload.id;
}
