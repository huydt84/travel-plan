import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  GMAIL_SEND_SCOPE,
  getGoogleMailAccess,
  refreshGoogleAccessToken,
} from "../lib/google-mail-auth.mjs";
import {
  InvitationAuthorizationError,
  InvitationConfigurationError,
} from "../lib/invitation-errors.mjs";

const env = {
  AUTH_SECRET: "auth-secret",
  AUTH_GOOGLE_ID: "google-client-id",
  AUTH_GOOGLE_SECRET: "google-client-secret",
};
const request = new Request("https://travel.example/api/invitations");

test("Auth.js requests Gmail send access and keeps mail tokens out of the browser session", async () => {
  const source = await readFile(new URL("../auth.js", import.meta.url), "utf8");
  assert.match(source, /https:\/\/www\.googleapis\.com\/auth\/gmail\.send/);
  assert.match(source, /access_type: "offline"/);
  assert.match(source, /prompt: "consent"/);
  assert.match(source, /token\.googleAccessToken = account\.access_token/);
  assert.doesNotMatch(source, /session\.googleAccessToken/);
  assert.doesNotMatch(source, /session\.user\.googleAccessToken/);
});

test("uses an unexpired Gmail access token from the encrypted Auth.js JWT", async () => {
  const result = await getGoogleMailAccess(request, {
    env,
    now: () => 1_000_000,
    getTokenImpl: async (options) => {
      assert.equal(options.secureCookie, true);
      assert.equal(options.secret, env.AUTH_SECRET);
      return {
        email: "Owner@Example.com",
        googleScope: `openid ${GMAIL_SEND_SCOPE}`,
        googleAccessToken: "current-token",
        googleAccessTokenExpiresAt: 2_000,
      };
    },
  });
  assert.deepEqual(result, { accessToken: "current-token", email: "owner@example.com" });
});

test("refreshes an expired access token with the stored Google refresh token", async () => {
  let refreshRequest;
  const result = await getGoogleMailAccess(request, {
    env,
    now: () => 2_000_000,
    getTokenImpl: async () => ({
      email: "owner@example.com",
      googleScope: GMAIL_SEND_SCOPE,
      googleAccessToken: "expired-token",
      googleAccessTokenExpiresAt: 1,
      googleRefreshToken: "refresh-token",
    }),
    fetchImpl: async (url, options) => {
      refreshRequest = { url, options };
      return { ok: true, json: async () => ({ access_token: "refreshed-token" }) };
    },
  });

  assert.deepEqual(result, { accessToken: "refreshed-token", email: "owner@example.com" });
  assert.equal(refreshRequest.url, "https://oauth2.googleapis.com/token");
  assert.equal(refreshRequest.options.body.get("refresh_token"), "refresh-token");
  assert.equal(refreshRequest.options.body.get("client_id"), env.AUTH_GOOGLE_ID);
});

test("rejects sessions without Gmail consent and invalid refresh responses", async () => {
  await assert.rejects(
    getGoogleMailAccess(request, {
      env,
      getTokenImpl: async () => ({ email: "owner@example.com", googleScope: "openid email" }),
    }),
    InvitationAuthorizationError,
  );
  await assert.rejects(
    refreshGoogleAccessToken("refresh-token", {
      env,
      fetchImpl: async () => ({ ok: false, json: async () => ({ error: "invalid_grant" }) }),
    }),
    InvitationAuthorizationError,
  );
  await assert.rejects(refreshGoogleAccessToken("refresh-token", { env: {} }), InvitationConfigurationError);
});
