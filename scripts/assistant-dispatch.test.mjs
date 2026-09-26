import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dispatchAttempt } from "../lib/v1/dispatch-attempt.mjs";

function fixture() {
  const state = { failed: false, workflow: null };
  return { state, store: {
    async beginDispatch() { return true; },
    async failDispatch(id, segment, diagnostic) { state.failed = true; state.diagnostic = diagnostic; },
    async dispatched(id, workflow) { state.workflow = workflow; },
  } };
}
test("dispatch rejection records a failure diagnostic", async () => {
  const f = fixture();
  await dispatchAttempt("turn", { ...f, start: async () => { throw new Error("Unavailable"); } });
  assert.equal(f.state.failed, true);
  assert.equal(f.state.diagnostic?.phase, "dispatch");
  assert.equal(f.state.diagnostic?.errorType, "Error");
});
test("dispatch timeout ignores a late acknowledgement", async () => {
  const f = fixture(); let finish;
  await dispatchAttempt("turn", { ...f, timeoutMs: 5, start: () => new Promise((resolve) => { finish = resolve; }) });
  assert.equal(f.state.failed, true);
  assert.equal(f.state.diagnostic?.errorType, "TimeoutError");
  finish({ runId: "late" });
  await Promise.resolve();
  assert.equal(f.state.workflow, null);
});
test("successful dispatch persists workflow identity", async () => {
  const f = fixture();
  await dispatchAttempt("turn", { ...f, start: async () => ({ runId: "workflow" }) });
  assert.equal(f.state.workflow, "workflow"); assert.equal(f.state.failed, false);
});
test("Vercel schedules fit Hobby daily frequency", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.equal(config.crons.some((cron) => cron.path.includes("assistant-dispatch")), false);
  for (const cron of config.crons) assert.match(cron.schedule, /^\d+ \d+ \* \* \*$/);
});
