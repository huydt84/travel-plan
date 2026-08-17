const scheduleFields = ["start", "end", "displayEnd", "type", "icon", "title", "detail"];

export function normalizeScheduleRefs(refs = []) {
  if (!Array.isArray(refs)) return [];
  return [...new Set(refs.filter((ref) => Number.isInteger(ref) && ref > 0))].sort((a, b) => a - b);
}

export function scheduleDraftFrom(values = {}) {
  return {
    id: values.id == null ? null : String(values.id),
    branchId: values.branchId == null ? null : String(values.branchId),
    ...Object.fromEntries(scheduleFields.map((field) => [field, values[field] ?? ""])),
    refs: normalizeScheduleRefs(values.refs),
  };
}

export function createScheduleEditor(values = {}) {
  const initial = scheduleDraftFrom(values);
  return {
    key: values.editorKey || initial.id || "new",
    initial,
    values: { ...initial, refs: [...initial.refs] },
  };
}

export function scheduleEditorIsDirty(editor) {
  if (!editor) return false;
  const current = scheduleDraftFrom(editor.values);
  return scheduleFields.some((field) => current[field] !== editor.initial[field])
    || current.refs.length !== editor.initial.refs.length
    || current.refs.some((ref, index) => ref !== editor.initial.refs[index]);
}
