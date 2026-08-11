import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNING_CONTEXT = "travel-plan-cache-revalidation-v1";
const MAX_AGE_MS = 5 * 60 * 1000;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const signingKey = (secret) => createHmac("sha256", secret)
  .update(SIGNING_CONTEXT)
  .digest();

export function signRevalidation({ slug, timestamp }, secret) {
  return createHmac("sha256", signingKey(secret))
    .update(`${timestamp}\n${slug}`)
    .digest("hex");
}

export function verifyRevalidation({ slug, timestamp, signature }, secret, now = Date.now()) {
  if (!secret || typeof slug !== "string" || !slugPattern.test(slug)) return false;
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > MAX_AGE_MS) return false;
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(signRevalidation({ slug, timestamp }, secret), "hex");
  const received = Buffer.from(signature, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
