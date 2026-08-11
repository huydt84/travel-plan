import { createHash } from "node:crypto";
import {
  InvitationAuthorizationError,
  InvitationConfigurationError,
  InvitationDeliveryError,
  InvitationInputError,
} from "./invitation-errors.mjs";

const GMAIL_SEND_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const MAX_RECIPIENTS = 100;
const MAX_PARALLEL_SENDS = 5;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tripSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const textValue = (value) => typeof value === "string" ? value.trim() : "";

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const configuredValue = (env, name) => {
  const value = textValue(env[name]);
  if (!value) throw new InvitationConfigurationError();
  return value;
};

const invitationUrl = (env, tripSlug) => {
  const configuredUrl = configuredValue(env, "APP_URL");
  try {
    const url = new URL(configuredUrl);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Unsupported protocol");
    url.hash = "";
    url.searchParams.set("trip", tripSlug);
    return url.toString();
  } catch {
    throw new InvitationConfigurationError();
  }
};

const cleanHeader = (value) => textValue(value).replace(/[\r\n]+/g, " ");
const encodedHeader = (value) => `=?UTF-8?B?${Buffer.from(cleanHeader(value), "utf8").toString("base64")}?=`;
const encodedBody = (value) => Buffer.from(value, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") || "";
const base64Url = (value) => Buffer.from(value, "utf8").toString("base64url");
const recipientHash = (recipient) => createHash("sha256").update(recipient).digest("hex").slice(0, 20);

export {
  InvitationAuthorizationError,
  InvitationConfigurationError,
  InvitationDeliveryError,
  InvitationInputError,
};

export function normalizeInvitationEmail(value) {
  const email = textValue(value).toLowerCase();
  if (!email || email.length > 254 || !emailPattern.test(email)) {
    throw new InvitationInputError("Mỗi người nhận phải có địa chỉ email hợp lệ");
  }
  return email;
}

export function parseInvitationInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new InvitationInputError("Nội dung yêu cầu phải là một object");
  }
  if (!Array.isArray(body.recipients)) {
    throw new InvitationInputError("recipients phải là một mảng email");
  }

  const recipients = [...new Set(body.recipients.map(normalizeInvitationEmail))];
  if (recipients.length === 0) throw new InvitationInputError("Hãy chọn ít nhất một người nhận");
  if (recipients.length > MAX_RECIPIENTS) {
    throw new InvitationInputError(`Chỉ có thể gửi tối đa ${MAX_RECIPIENTS} lời mời mỗi lần`);
  }

  const requestId = textValue(body.requestId);
  if (!requestIdPattern.test(requestId)) {
    throw new InvitationInputError("requestId phải là UUID hợp lệ");
  }

  const tripSlug = textValue(body.tripSlug);
  if (!tripSlugPattern.test(tripSlug) || tripSlug.length > 100) {
    throw new InvitationInputError("Hãy chọn một chuyến đi hợp lệ");
  }

  const subject = cleanHeader(body.subject);
  if (!subject || subject.length > 200) {
    throw new InvitationInputError("Tiêu đề email phải có từ 1 đến 200 ký tự");
  }

  const message = typeof body.message === "string" ? body.message.replaceAll("\r\n", "\n").trim() : "";
  if (message.length < 2 || message.length > 10_000) {
    throw new InvitationInputError("Nội dung email phải có từ 2 đến 10000 ký tự");
  }

  return { recipients, requestId, tripSlug, subject, message };
}

export function buildInvitationEmail({ recipient, inviter, subject, message, url }) {
  const inviterName = cleanHeader(inviter?.name || inviter?.email || "Chủ lịch trình");
  const inviterEmail = normalizeInvitationEmail(inviter?.email);
  const safeName = escapeHtml(inviterName);
  const safeEmail = escapeHtml(inviterEmail);
  const safeUrl = escapeHtml(url);
  const safeSubject = escapeHtml(cleanHeader(subject));
  const messageHtml = escapeHtml(message)
    .replaceAll(safeUrl, `<a href="${safeUrl}" style="color:#006e52;word-break:break-all">${safeUrl}</a>`)
    .replaceAll("\n", "<br>");
  const preheader = escapeHtml(message.split("\n").find((line) => line.trim()) || subject);

  return {
    from: inviterEmail,
    to: recipient,
    replyTo: inviterEmail,
    subject: cleanHeader(subject),
    text: message,
    html: `<!doctype html>
<html lang="vi">
  <body style="margin:0;background:#f4f1e8;color:#10243d;font-family:Arial,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden">${preheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1e8;padding:28px 12px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;border:2px solid #10243d;background:#fffdf7">
          <tr><td style="padding:12px 22px;background:#008f68;color:#fffdf7;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Lời rủ đi cùng</td></tr>
          <tr><td style="padding:30px 28px 20px">
            <h1 style="margin:0;font-size:30px;line-height:1.12">${safeSubject}</h1>
          </td></tr>
          <tr><td style="padding:0 28px 30px">
            <div style="padding:18px;border:1px solid #10243d;background:#fff8d8;color:#32445a;font-size:14px;line-height:1.65">${messageHtml}</div>
          </td></tr>
          <tr><td style="border-top:1px solid #a8aa9f;padding:14px 28px;color:#586473;font-size:11px;line-height:1.5">Gửi bởi ${safeName} (${safeEmail}).</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
  };
}

export function buildRawGmailMessage({ recipient, inviter, subject, message, url, requestId }) {
  const email = buildInvitationEmail({ recipient, inviter, subject, message, url });
  const hash = recipientHash(recipient);
  const boundary = `trip-invitation-${requestId}-${hash}`;
  const messageId = `<${requestId}.${hash}@travel-plan.local>`;
  const mime = [
    `From: ${email.from}`,
    `To: ${email.to}`,
    `Reply-To: ${email.replyTo}`,
    `Subject: ${encodedHeader(email.subject)}`,
    `Message-ID: ${messageId}`,
    `X-Trip-Invitation-Request-ID: ${requestId}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodedBody(email.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodedBody(email.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");

  return { raw: base64Url(mime), messageId };
}

async function sendGmailMessage({ recipient, requestId, inviter, subject, message, url, accessToken, fetchImpl }) {
  const gmailMessage = buildRawGmailMessage({ recipient, requestId, inviter, subject, message, url });
  let response;
  try {
    response = await fetchImpl(GMAIL_SEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: gmailMessage.raw }),
    });
  } catch {
    throw new InvitationDeliveryError();
  }

  if (response.status === 401 || response.status === 403) {
    throw new InvitationAuthorizationError();
  }
  if (!response.ok) throw new InvitationDeliveryError();

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new InvitationDeliveryError();
  }
  if (!textValue(payload?.id)) throw new InvitationDeliveryError();
  return payload.id;
}

export async function sendInvitationBatch(
  { recipients, requestId, inviter, trip, subject, message, accessToken },
  { env = process.env, fetchImpl = globalThis.fetch } = {},
) {
  const url = invitationUrl(env, trip.slug);
  const token = textValue(accessToken);
  if (!token) throw new InvitationAuthorizationError();
  const ids = new Array(recipients.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < recipients.length) {
      const index = nextIndex;
      nextIndex += 1;
      ids[index] = await sendGmailMessage({
        recipient: recipients[index],
        requestId,
        inviter,
        subject,
        message,
        url,
        accessToken: token,
        fetchImpl,
      });
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(MAX_PARALLEL_SENDS, recipients.length) },
    () => worker(),
  ));
  return { sent: recipients.length, ids };
}
