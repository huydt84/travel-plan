import assert from "node:assert/strict";
import test from "node:test";
import {
  createScheduleEditor,
  normalizeScheduleRefs,
  scheduleEditorIsDirty,
} from "../lib/schedule-editor-state.mjs";

const activity = {
  id: "42",
  start: "09:00",
  end: "10:00",
  displayEnd: null,
  type: "Visit",
  icon: "📍",
  title: "Bảo tàng",
  detail: "Xem triển lãm",
  refs: [3, 1],
};

test("schedule editors normalize refs and keep a stable activity key", () => {
  const editor = createScheduleEditor(activity);
  assert.equal(editor.key, "42");
  assert.deepEqual(editor.values.refs, [1, 3]);
  assert.equal(scheduleEditorIsDirty(editor), false);
});

test("schedule editor dirty state detects fields and refs without depending on ref order", () => {
  const editor = createScheduleEditor(activity);
  editor.values = { ...editor.values, refs: [3, 1] };
  assert.equal(scheduleEditorIsDirty(editor), false);

  editor.values = { ...editor.values, title: "Bảo tàng mới" };
  assert.equal(scheduleEditorIsDirty(editor), true);
});

test("schedule refs remove invalid values and duplicates", () => {
  assert.deepEqual(normalizeScheduleRefs([4, 2, 4, 0, -1, 2.5]), [2, 4]);
});
