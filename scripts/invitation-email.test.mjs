import assert from "node:assert/strict";
import test from "node:test";
import { createInvitationDraft } from "../lib/invitation-draft.mjs";
import {
  buildInvitationEmail,
  buildRawGmailMessage,
  InvitationAuthorizationError,
  InvitationConfigurationError,
  InvitationDeliveryError,
  InvitationInputError,
  normalizeInvitationEmail,
  parseInvitationInput,
  sendInvitationBatch,
} from "../lib/invitation-email.mjs";

const requestId = "f14f33e9-668c-4c5f-9f80-16f3af284926";
const env = { APP_URL: "https://travel.example/path" };
const trip = {
  slug: "kasai-evening",
  title: "Kasai Rinkai Park · Sunflower Evening",
  startDate: "2026-08-15",
  endDate: "2026-08-15",
  timezone: "Asia/Tokyo",
  location: "Kasai Rinkai Park",
};
const itinerary = [
  { startDate: "2026-08-15", start: "15:30", endDate: "2026-08-15", end: "16:00", title: "Đi tàu đến Kasai", detail: "Gặp nhau ở ga." },
  { startDate: "2026-08-15", start: "16:00", endDate: "2026-08-15", end: "17:00", title: "Cánh đồng hoa hướng dương", detail: "Đi dạo và chụp ảnh." },
];
const subject = "Đi Kasai cùng mình thứ Bảy nhé?";
const message = "Bạn có muốn đi Kasai cùng mình không?\n\n15:30 — Gặp nhau ở ga.\nhttps://travel.example/path?trip=kasai-evening";

test("normalizes recipients and validates trip plus editable draft fields", () => {
  assert.equal(normalizeInvitationEmail(" Friend@Example.com "), "friend@example.com");
  assert.deepEqual(parseInvitationInput({
    recipients: [" Friend@Example.com ", "friend@example.com", "other@example.com"],
    requestId,
    tripSlug: trip.slug,
    subject,
    message,
  }), {
    recipients: ["friend@example.com", "other@example.com"],
    requestId,
    tripSlug: trip.slug,
    subject,
    message,
  });
  assert.throws(() => parseInvitationInput({ recipients: [], requestId, tripSlug: trip.slug, subject, message }), InvitationInputError);
  assert.throws(() => parseInvitationInput({ recipients: ["not-an-email"], requestId, tripSlug: trip.slug, subject, message }), InvitationInputError);
  assert.throws(() => parseInvitationInput({ recipients: ["a@example.com"], requestId: "retry-1", tripSlug: trip.slug, subject, message }), InvitationInputError);
  assert.throws(() => parseInvitationInput({ recipients: ["a@example.com"], requestId, tripSlug: "Bad Slug", subject, message }), /chuyến đi hợp lệ/);
  assert.throws(() => parseInvitationInput({ recipients: ["a@example.com"], requestId, tripSlug: trip.slug, subject: "", message }), /Tiêu đề/);
  assert.throws(() => parseInvitationInput({ recipients: ["a@example.com"], requestId, tripSlug: trip.slug, subject, message: "" }), /Nội dung/);
  assert.throws(() => parseInvitationInput({
    recipients: Array.from({ length: 7 }, (_, index) => `friend-${index}@example.com`),
    requestId,
    tripSlug: trip.slug,
    subject,
    message,
  }), /tối đa 6/);
});

test("generates an editable invitation draft from the selected trip and schedule", () => {
  const draft = createInvitationDraft({
    trip,
    itinerary,
    inviter: { name: "John Doe", email: "owner@example.com" },
    url: "https://travel.example/?trip=kasai-evening",
  });
  assert.match(draft.subject, /John Doe rủ bạn đi Kasai Rinkai Park/);
  assert.match(draft.message, /Bạn có muốn đi Kasai Rinkai Park cùng mình vào 15:30/);
  assert.match(draft.message, /15:30–16:00 — Đi tàu đến Kasai/);
  assert.match(draft.message, /Cánh đồng hoa hướng dương/);
  assert.match(draft.message, /travel\.example\/\?trip=kasai-evening/);
});

test("uses the owner's edited subject and message exactly while escaping HTML", () => {
  const customMessage = "Đi cùng mình nhé? <script>alert(1)</script>\nhttps://travel.example/?trip=kasai-evening";
  const email = buildInvitationEmail({
    recipient: "friend@example.com",
    inviter: { name: "A <B>", email: "owner@example.com" },
    subject: "Lời rủ riêng <thứ Bảy>",
    message: customMessage,
    url: "https://travel.example/?trip=kasai-evening",
  });
  assert.equal(email.from, "owner@example.com");
  assert.equal(email.to, "friend@example.com");
  assert.equal(email.replyTo, "owner@example.com");
  assert.equal(email.subject, "Lời rủ riêng <thứ Bảy>");
  assert.equal(email.text, customMessage);
  assert.match(email.html, /A &lt;B&gt;/);
  assert.match(email.html, /Lời rủ riêng &lt;thứ Bảy&gt;/);
  assert.match(email.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(email.html, /href="https:\/\/travel\.example\/\?trip=kasai-evening"/);
  assert.doesNotMatch(email.html, /<script>/);
});

test("encodes an RFC 2822 multipart message for the Gmail API", () => {
  const { raw, messageId } = buildRawGmailMessage({
    recipient: "friend@example.com",
    inviter: { name: "Chủ lịch", email: "owner@example.com" },
    subject,
    message,
    url: env.APP_URL,
    requestId,
  });
  const mime = Buffer.from(raw, "base64url").toString("utf8");
  assert.match(mime, /^From: owner@example\.com\r\nTo: friend@example\.com/m);
  assert.match(mime, /Subject: =\?UTF-8\?B\?/);
  assert.match(mime, /Content-Type: multipart\/alternative/);
  assert.match(mime, /Content-Type: text\/plain; charset=UTF-8/);
  assert.match(mime, /Content-Type: text\/html; charset=UTF-8/);
  assert.match(mime, new RegExp(`X-Trip-Invitation-Request-ID: ${requestId}`));
  assert.match(mime, new RegExp(`Message-ID: ${messageId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("sends recipients as separate Gmail messages using the edited draft", async () => {
  const requests = [];
  const result = await sendInvitationBatch({
    recipients: ["one@example.com", "two@example.com"],
    requestId,
    inviter: { name: "Owner", email: "owner@example.com" },
    trip,
    subject,
    message,
    accessToken: "google-access-token",
  }, {
    env,
    fetchImpl: async (url, options) => {
      const mime = Buffer.from(JSON.parse(options.body).raw, "base64url").toString("utf8");
      const recipient = mime.match(/^To: (.+)$/m)?.[1].trim();
      requests.push({ url, options, recipient, mime });
      return { ok: true, status: 200, json: async () => ({ id: `gmail-${recipient}` }) };
    },
  });

  assert.deepEqual(result, {
    sent: 2,
    ids: ["gmail-one@example.com", "gmail-two@example.com"],
    deliveries: [
      {
        recipient: "one@example.com",
        status: "sent",
        gmailMessageId: "gmail-one@example.com",
        errorCode: null,
      },
      {
        recipient: "two@example.com",
        status: "sent",
        gmailMessageId: "gmail-two@example.com",
        errorCode: null,
      },
    ],
  });
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.url === "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"));
  assert.ok(requests.every((request) => request.options.headers.Authorization === "Bearer google-access-token"));
  assert.ok(requests.every((request) => request.mime.includes("Subject: =?UTF-8?B?")));
  assert.deepEqual(new Set(requests.map((request) => request.recipient)), new Set(["one@example.com", "two@example.com"]));
});

test("reports per-recipient outcomes when only part of a batch is delivered", async () => {
  await assert.rejects(sendInvitationBatch({
    recipients: ["one@example.com", "two@example.com"],
    requestId,
    inviter: { email: "owner@example.com" },
    trip,
    subject,
    message,
    accessToken: "token",
  }, {
    env,
    fetchImpl: async (_url, options) => {
      const mime = Buffer.from(JSON.parse(options.body).raw, "base64url").toString("utf8");
      const recipient = mime.match(/^To: (.+)$/m)?.[1].trim();
      if (recipient === "two@example.com") return { ok: false, status: 500 };
      return { ok: true, status: 200, json: async () => ({ id: "gmail-one" }) };
    },
  }), (error) => {
    assert.ok(error instanceof InvitationDeliveryError);
    assert.deepEqual(error.deliveries, [
      { recipient: "one@example.com", status: "sent", gmailMessageId: "gmail-one", errorCode: null },
      { recipient: "two@example.com", status: "failed", gmailMessageId: null, errorCode: "INVITATION_DELIVERY_ERROR" },
    ]);
    return true;
  });
});

test("fails safely when configuration, authorization, or delivery is unavailable", async () => {
  const input = {
    recipients: ["one@example.com"],
    requestId,
    inviter: { email: "owner@example.com" },
    trip,
    subject,
    message,
    accessToken: "token",
  };
  await assert.rejects(sendInvitationBatch(input, { env: {} }), InvitationConfigurationError);
  await assert.rejects(sendInvitationBatch({ ...input, accessToken: "" }, { env }), InvitationAuthorizationError);
  await assert.rejects(
    sendInvitationBatch(input, { env, fetchImpl: async () => ({ ok: false, status: 401 }) }),
    InvitationAuthorizationError,
  );
  await assert.rejects(
    sendInvitationBatch(input, { env, fetchImpl: async () => ({ ok: false, status: 500 }) }),
    InvitationDeliveryError,
  );
});
