import test from "node:test";
import assert from "node:assert/strict";
import { EDITOR_ACTIVITY_ICONS, EDITOR_ACTIVITY_TYPES } from "../lib/activity-types.mjs";

test("every default activity icon is available in the editor picker", () => {
  const available = new Set(EDITOR_ACTIVITY_ICONS.map(({ value }) => value));
  assert.equal(available.size, EDITOR_ACTIVITY_ICONS.length);
  for (const type of EDITOR_ACTIVITY_TYPES) {
    assert.ok(available.has(type.icon), `${type.value} uses an unavailable icon`);
  }
  assert.ok(available.has("🌙"));
});
