import { getToken } from "next-auth/jwt";
import {
  InvitationAuthorizationError,
  InvitationConfigurationError,
} from "./invitation-errors.mjs";

import { GMAIL_SEND_SCOPE } from "./google-auth-policy.mjs";
export { GMAIL_SEND_SCOPE } from "./google-auth-policy.mjs";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const textValue = (value) => typeof value === "string" ? value.trim() : "";

const configuredValue = (env, name) => {
  const value = textValue(env[name]);
  if (!value) throw new InvitationConfigurationError();
  return value;
};

const hasGmailSendScope = (scope) => textValue(scope).split(/\s+/).includes(GMAIL_SEND_SCOPE);

export async function getGoogleMailAuthorizationState(
  request,
  { env = process.env, getTokenImpl = getToken } = {},
) {
  const secret = configuredValue(env, "AUTH_SECRET");
  const secureCookie = new URL(request.url).protocol === "https:";
  const token = await getTokenImpl({ req: request, secret, secureCookie });
  return {
    authorized: Boolean(token && hasGmailSendScope(token.googleScope)),
    email: textValue(token?.email).toLowerCase() || null,
  };
}

export async function refreshGoogleAccessToken(
  refreshToken,
  { env = process.env, fetchImpl = globalThis.fetch } = {},
) {
  const clientId = configuredValue(env, "AUTH_GOOGLE_ID");
  const clientSecret = configuredValue(env, "AUTH_GOOGLE_SECRET");
  let response;

  try {
    response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
  } catch {
    throw new InvitationAuthorizationError();
  }

  if (!response.ok) throw new InvitationAuthorizationError();

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new InvitationAuthorizationError();
  }

  const accessToken = textValue(payload?.access_token);
  if (!accessToken) throw new InvitationAuthorizationError();
  return accessToken;
}

export async function getGoogleMailAccess(
  request,
  { env = process.env, fetchImpl = globalThis.fetch, getTokenImpl = getToken, now = Date.now } = {},
) {
  const secret = configuredValue(env, "AUTH_SECRET");
  const secureCookie = new URL(request.url).protocol === "https:";
  const token = await getTokenImpl({ req: request, secret, secureCookie });

  if (!token || !hasGmailSendScope(token.googleScope)) {
    throw new InvitationAuthorizationError();
  }

  const email = textValue(token.email).toLowerCase();
  const accessToken = textValue(token.googleAccessToken);
  const expiresAt = Number(token.googleAccessTokenExpiresAt) * 1000;
  if (email && accessToken && (!Number.isFinite(expiresAt) || expiresAt > now() + 60_000)) {
    return { accessToken, email };
  }

  const refreshToken = textValue(token.googleRefreshToken);
  if (!email || !refreshToken) throw new InvitationAuthorizationError();
  return {
    accessToken: await refreshGoogleAccessToken(refreshToken, { env, fetchImpl }),
    email,
  };
}
