import assert from "node:assert/strict";
import test from "node:test";
import {
  AdminNotificationEmailError,
  buildAdminContributionEmail,
  buildContributionUrl,
  sendAdminContributionEmail,
} from "../lib/admin-notification-email.mjs";

const env = {
  APP_URL: "https://travel.example/app?old=1#old",
  AUTH_OWNER_EMAIL: "owner@example.com",
  RESEND_API_KEY: "re_test",
};
const contribution = {
  suggestion_id: "42",
  kind: "comment",
  body: "Đi sớm hơn <script>alert('x')</script>\nNhé!",
  author_name: "An & Bình",
  trip_slug: "tokyo-day",
  trip_title: "Tokyo <Một ngày>",
  activity_title: "Ga & phố",
};

test("admin notification builds a safe deep link and escaped HTML", () => {
  assert.equal(
    buildContributionUrl(env, "tokyo-day", "42"),
    "https://travel.example/app?trip=tokyo-day#contribution-42",
  );
  const email = buildAdminContributionEmail(contribution, env);
  assert.deepEqual(email.to, ["owner@example.com"]);
  assert.match(email.subject, /Bình luận mới/);
  assert.match(email.text, /<script>alert/);
  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /&lt;script&gt;/);
  assert.match(email.html, /An &amp; Bình/);
});

test("Resend delivery uses a stable idempotency key", async () => {
  const requests = [];
  const id = await sendAdminContributionEmail(contribution, {
    env,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ id: "resend-42" }) };
    },
  });
  assert.equal(id, "resend-42");
  assert.equal(requests[0].url, "https://api.resend.com/emails");
  assert.equal(requests[0].options.headers["Idempotency-Key"], "admin-contribution/42");
  assert.equal(requests[0].options.headers.Authorization, "Bearer re_test");
});

test("Resend configuration and delivery failures use stable error codes", async () => {
  await assert.rejects(
    () => sendAdminContributionEmail(contribution, { env: { ...env, RESEND_API_KEY: "" } }),
    (error) => error instanceof AdminNotificationEmailError && error.code === "RESEND_CONFIG_ERROR",
  );
  await assert.rejects(
    () => sendAdminContributionEmail(contribution, {
      env,
      fetchImpl: async () => ({ ok: false, status: 429 }),
    }),
    (error) => error.code === "RESEND_HTTP_429",
  );
});
