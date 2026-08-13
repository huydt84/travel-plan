import { resolveLocalAdminMode } from "./runtime-config.mjs";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const FROM_ADDRESS = "Travel Plan <onboarding@resend.dev>";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const textValue = (value) => typeof value === "string" ? value.trim() : "";
const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

export class AdminNotificationEmailError extends Error {
  constructor(code) {
    super("Admin notification email could not be delivered");
    this.name = "AdminNotificationEmailError";
    this.code = code;
  }
}

function resolveResendEndpoint(env = process.env) {
  const override = textValue(env.RESEND_API_ENDPOINT);
  if (!override) return RESEND_ENDPOINT;

  let url;
  try {
    url = new URL(override);
  } catch {
    throw new AdminNotificationEmailError("RESEND_CONFIG_ERROR");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new AdminNotificationEmailError("RESEND_CONFIG_ERROR");
  }

  let localAdmin;
  try {
    localAdmin = resolveLocalAdminMode(env);
  } catch {
    throw new AdminNotificationEmailError("RESEND_CONFIG_ERROR");
  }
  if (!localAdmin.enabled || !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new AdminNotificationEmailError("RESEND_CONFIG_ERROR");
  }

  return url.toString();
}

const configuredValue = (env, name) => {
  const value = textValue(env[name]);
  if (!value) throw new AdminNotificationEmailError("RESEND_CONFIG_ERROR");
  return value;
};

export function buildContributionUrl(env, tripSlug, suggestionId) {
  let url;
  try {
    url = new URL(configuredValue(env, "APP_URL"));
  } catch (error) {
    if (error instanceof AdminNotificationEmailError) throw error;
    throw new AdminNotificationEmailError("RESEND_CONFIG_ERROR");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new AdminNotificationEmailError("RESEND_CONFIG_ERROR");
  }
  url.search = "";
  url.hash = `contribution-${suggestionId}`;
  url.searchParams.set("trip", tripSlug);
  return url.toString();
}

export function buildAdminContributionEmail(row, env = process.env) {
  const configuredRecipient = configuredValue(env, "AUTH_OWNER_EMAIL").toLowerCase();
  const recipient = textValue(row.recipient_email).toLowerCase() || configuredRecipient;
  const url = buildContributionUrl(env, row.trip_slug, row.suggestion_id);
  const kindLabel = row.kind === "comment" ? "Bình luận" : "Đề xuất";
  const targetLabel = row.activity_title || "Cả chuyến đi";
  const subject = `[${row.trip_title}] ${kindLabel} mới từ ${row.author_name}`;
  const text = [
    `${row.author_name} vừa gửi ${kindLabel.toLowerCase()} cho ${targetLabel}.`,
    "",
    row.body,
    "",
    `Mở trong lịch trình: ${url}`,
  ].join("\n");
  const safe = {
    author: escapeHtml(row.author_name),
    body: escapeHtml(row.body).replaceAll("\n", "<br>"),
    kind: escapeHtml(kindLabel),
    target: escapeHtml(targetLabel),
    title: escapeHtml(row.trip_title),
    url: escapeHtml(url),
  };

  return {
    from: FROM_ADDRESS,
    to: [recipient],
    subject,
    text,
    html: `<!doctype html>
<html lang="vi">
  <body style="margin:0;background:#f4f1e8;color:#10243d;font-family:Arial,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:28px 12px;background:#f4f1e8">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;border:2px solid #10243d;background:#fffdf7">
          <tr><td style="padding:12px 22px;background:#008f68;color:#fffdf7;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">${safe.kind} mới · ${safe.title}</td></tr>
          <tr><td style="padding:28px">
            <h1 style="margin:0;font-size:30px;line-height:1.1">${safe.author} vừa góp ý</h1>
            <p style="margin:10px 0 20px;color:#586473;font-size:12px">Tại: ${safe.target}</p>
            <div style="padding:18px;border:1px solid #10243d;background:#fff0bf;color:#32445a;font-size:14px;line-height:1.65">${safe.body}</div>
            <p style="margin:22px 0 0"><a href="${safe.url}" style="display:inline-block;padding:11px 15px;background:#008f68;color:#fffdf7;font-size:12px;font-weight:700;text-decoration:none">Mở trong lịch trình</a></p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
  };
}

export async function sendAdminContributionEmail(
  row,
  { env = process.env, fetchImpl = globalThis.fetch } = {},
) {
  const apiKey = configuredValue(env, "RESEND_API_KEY");
  const email = buildAdminContributionEmail(row, env);
  const endpoint = resolveResendEndpoint(env);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `admin-contribution/${row.suggestion_id}`,
      },
      body: JSON.stringify(email),
    });
  } catch {
    throw new AdminNotificationEmailError("RESEND_NETWORK_ERROR");
  }
  if (!response.ok) throw new AdminNotificationEmailError(`RESEND_HTTP_${response.status}`);

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new AdminNotificationEmailError("RESEND_INVALID_RESPONSE");
  }
  const id = textValue(payload?.id);
  if (!id) throw new AdminNotificationEmailError("RESEND_INVALID_RESPONSE");
  return id;
}
