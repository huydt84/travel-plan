import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("admin users prioritizes recent activity over repeat login", async () => {
  const [component, store] = await Promise.all([
    read("../components/UserManagementApp.jsx"),
    read("../lib/user-login-store.mjs"),
  ]);

  assert.match(component, /Hoạt động người dùng/);
  assert.match(component, /Hoạt động gần nhất/);
  assert.match(component, /loginUser\.last_active_at/);
  assert.doesNotMatch(component, /loginUser\.last_login/);
  assert.match(store, /ORDER BY last_active_at DESC, email ASC/);
});

test("global heartbeat runs only for a visible tab and stops for anonymous sessions", async () => {
  const [heartbeat, layout, route, activityConfig] = await Promise.all([
    read("../components/ActivityHeartbeat.jsx"),
    read("../app/layout.js"),
    read("../app/api/activity/route.js"),
    read("../lib/user-activity.mjs"),
  ]);

  assert.match(layout, /<ActivityHeartbeat \/>/);
  assert.match(heartbeat, /document\.visibilityState !== "visible"/);
  assert.match(heartbeat, /USER_ACTIVITY_WRITE_INTERVAL_MS/);
  assert.match(activityConfig, /5 \* 60 \* 1000/);
  assert.match(heartbeat, /response\.status === 401/);
  assert.match(heartbeat, /document\.addEventListener\("visibilitychange", sendHeartbeat\)/);
  assert.match(route, /export async function POST/);
  assert.match(route, /status: 204/);
});

test("creating a suggestion never pretends the contribution is a login", async () => {
  const repository = await read("../lib/suggestion-repository.js");
  const participantUser = repository.slice(
    repository.indexOf("participant_user AS"),
    repository.indexOf("participant AS"),
  );

  assert.doesNotMatch(participantUser, /last_login = GREATEST/);
  assert.doesNotMatch(participantUser, /last_active_at = GREATEST/);
});
