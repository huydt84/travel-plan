import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dispatchAttempt } from "../lib/v1/dispatch-attempt.mjs";

function fixture() {
  let attempted = false;
  const state = { starts: 0, failed: false, claimed: false, workflow: null };
  return { state, store: {
    async beginDispatch() { if (attempted) return false; attempted = true; return true; },
    async failDispatch(id, segment, diagnostic) { if (!state.claimed) { state.failed = true; state.diagnostic = diagnostic; } },
    async dispatched(id, workflow) { state.workflow = workflow; },
  } };
}
test("dispatch rejection becomes failure and is never automatically dispatched again", async () => {
  const f = fixture();
  const start = async () => { f.state.starts++; throw new Error("Unavailable"); };
  await dispatchAttempt("turn", { ...f, start });
  await dispatchAttempt("turn", { ...f, start });
  assert.equal(f.state.starts, 1); assert.equal(f.state.failed, true);
  assert.equal(f.state.diagnostic?.phase, "dispatch");
  assert.equal(f.state.diagnostic?.errorType, "Error");
});
test("ambiguous timeout is bounded; a late acknowledgement does not dispatch again", async () => {
  const f = fixture(); let finish;
  await dispatchAttempt("turn", { ...f, timeoutMs: 5, start: () => new Promise((resolve) => { finish = resolve; }) });
  assert.equal(f.state.failed, true);
  finish({ runId: "late" });
  await Promise.resolve();
  assert.equal(f.state.workflow, null);
});
test("a worker that claimed before acknowledgement failure continues", async () => {
  const f = fixture();
  await dispatchAttempt("turn", { ...f, start: async () => { f.state.claimed = true; throw new Error("Lost acknowledgement"); } });
  assert.equal(f.state.failed, false);
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
