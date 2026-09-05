import assert from "node:assert/strict";
import test from "node:test";
import {
  GMAIL_SEND_SCOPE,
  getGoogleMailAuthorizationState,
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

test("reports Gmail authorization without refreshing a token", async () => {
  const state = await getGoogleMailAuthorizationState(request, {
    env,
    getTokenImpl: async () => ({ email: "Friend@Example.com", googleScope: `openid ${GMAIL_SEND_SCOPE}` }),
  });
  assert.deepEqual(state, { authorized: true, email: "friend@example.com" });
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

test("login uses basic scopes; explicit Gmail consent adds offline send access", async () => {
  const { googleLoginParams, googleMailConsentParams, createGoogleAuthCallbacks } = await import("../lib/google-auth-policy.mjs");
  assert.equal(googleLoginParams.scope, "openid email profile");
  assert.equal(googleLoginParams.prompt, undefined);
  assert.equal(googleLoginParams.access_type, undefined);
  assert.equal(googleMailConsentParams.scope, `openid email profile ${GMAIL_SEND_SCOPE}`);
  assert.equal(googleMailConsentParams.prompt, "consent");
  assert.equal(googleMailConsentParams.access_type, "offline");
  const callbacks = createGoogleAuthCallbacks(() => "owner@example.com");
  assert.equal(await callbacks.signIn({ account: { provider: "google" }, profile: { email: "owner@example.com", email_verified: true } }), true);
  assert.equal(await callbacks.signIn({ account: { provider: "google" }, profile: { email: "owner@example.com", email_verified: false } }), false);
  const token = await callbacks.jwt({ token: { googleRefreshToken: "previous" }, account: { provider: "google", access_token: "private-token", scope: GMAIL_SEND_SCOPE, expires_at: 123 } });
  assert.equal(token.googleRefreshToken, "previous");
  assert.equal(token.googleAccessToken, "private-token");
  const session = await callbacks.session({ session: { user: { email: "OWNER@example.com" } }, token });
  assert.deepEqual(session, { user: { email: "OWNER@example.com", isOwner: true, isAdmin: true, role: "owner" } });
});
