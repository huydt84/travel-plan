import assert from "node:assert/strict";
import test from "node:test";
import { signRevalidation, verifyRevalidation } from "../lib/revalidation-signature.mjs";

const secret = "test-secret-that-is-not-used-outside-this-test";
const request = { slug: "sample-trip-2030-01-15", timestamp: 1_894_684_800_000 };

test("accepts a valid signature inside the five-minute window", () => {
  const signature = signRevalidation(request, secret);
  assert.equal(verifyRevalidation({ ...request, signature }, secret, request.timestamp + 60_000), true);
});

test("rejects tampered, expired, malformed and wrong-secret requests", () => {
  const signature = signRevalidation(request, secret);
  assert.equal(verifyRevalidation({ ...request, slug: "other-trip", signature }, secret, request.timestamp), false);
  assert.equal(verifyRevalidation({ ...request, signature }, "wrong-secret", request.timestamp), false);
  assert.equal(verifyRevalidation({ ...request, signature }, secret, request.timestamp + 300_001), false);
  assert.equal(verifyRevalidation({ ...request, slug: "INVALID SLUG", signature }, secret, request.timestamp), false);
  assert.equal(verifyRevalidation({ ...request, signature: "short" }, secret, request.timestamp), false);
});
