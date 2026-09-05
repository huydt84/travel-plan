import test from "node:test";
import assert from "node:assert/strict";
import { observeRun } from "../components/v1/transport.mjs";
import { remapEvidenceText, validateEvidenceText } from "../lib/v1/evidence.mjs";

test("event reconnect resumes from its cursor and ignores duplicate text", async (t) => {
  const calls = [], received = [], runId = "run";
  const pages = [
    [{ seq: 1, type: "accepted" }, { seq: 2, type: "answer-delta", text: "Chào " }],
    [{ seq: 2, type: "answer-delta", text: "Chào " }, { seq: 3, type: "answer-delta", text: "bạn" }, { seq: 4, type: "completed", turn: { output: "Chào bạn" } }],
  ];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    assert.ok(pages.length, "observation stops at the terminal event");
    return new Response(pages.shift().map((event) => JSON.stringify({ ...event, runId })).join("\n"));
  });
  await observeRun(runId, (event) => received.push(event), new AbortController().signal);
  assert.deepEqual(calls, ["/api/v1/assistant/runs/run/events?after=0", "/api/v1/assistant/runs/run/events?after=2"]);
  assert.equal(received.filter((e) => e.type === "answer-delta").map((e) => e.text).join(""), "Chào bạn");
  assert.deepEqual(received.map((e) => e.seq), [1, 2, 3, 4]);
});

test("grouped evidence rejects an unverified member of a citation group", () => {
  const evidence = [{ id: "E5", url: "https://example.com/temple" }, { id: "E12", url: "https://example.com/hours" }];
  assert.doesNotThrow(() => validateEvidenceText("Open today [E5, E12]", evidence));
  assert.throws(() => validateEvidenceText("Open today [E5, E13]", evidence), { code: "INVALID_EVIDENCE" });
  assert.equal(remapEvidenceText("[E5, E12] and [E5]", new Map([["E5", "E1"], ["E12", "E2"]])), "[E1, E2] and [E1]");
});
