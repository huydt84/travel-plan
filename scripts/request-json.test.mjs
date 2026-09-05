import assert from "node:assert/strict";
import test from "node:test";
import { requestJson } from "../lib/request-json.mjs";

test("JSON requests preserve supplied headers and propagate cancellation", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (_path, options) => {
    assert.equal(options.headers.get("content-type"), "application/json");
    assert.equal(options.headers.get("x-request-id"), "example");
    assert.equal(options.signal, controller.signal);
    return new Response(JSON.stringify({ saved: true }));
  });
  assert.deepEqual(await requestJson("/example", {
    method: "POST", body: "{}", headers: new Headers({ "x-request-id": "example" }), signal: controller.signal,
  }), { saved: true });
});

test("JSON requests support empty deletion responses and useful errors", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 204 }));
  assert.equal(await requestJson("/example", { method: "DELETE" }), null);
  fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ error: "Denied" }), { status: 403 }));
  await assert.rejects(requestJson("/example"), /Denied/);
  fetch.mock.mockImplementation(async () => new Response("Unavailable", { status: 503 }));
  await assert.rejects(requestJson("/example", {}, "Please retry"), /Please retry/);
});
