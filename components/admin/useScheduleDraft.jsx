import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createScheduleEditor, scheduleEditorIsDirty } from "../../lib/schedule-editor-state.mjs";

// Owns draft protection and focus restoration across all admin schedule entry points.
export function useScheduleDraft(busy) {
  const [scheduleEditor, setScheduleEditor] = useState(null);
  const [scheduleError, setScheduleError] = useState("");
  const [discardPrompt, setDiscardPrompt] = useState(null);
  const pendingScheduleActionRef = useRef(null);
  const scheduleReturnFocusRef = useRef(null);
  const scheduleDirty = scheduleEditorIsDirty(scheduleEditor);
  const scheduleEditorKey = scheduleEditor?.key;

  const restoreFocus = () => requestAnimationFrame(() => {
    const trigger = scheduleReturnFocusRef.current;
    // A branch's add button is replaced by its editor and remounted on close.
    const target = trigger?.isConnected ? trigger : trigger?.id && document.getElementById(trigger.id);
    target?.focus?.();
  });

  useEffect(() => {
    if (!scheduleEditorKey) return undefined;
    const frame = requestAnimationFrame(() => {
      const editor = document.getElementById(`schedule-editor-${scheduleEditorKey}`);
      if (!editor) return;
      editor.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "nearest",
      });
      editor.querySelector("[data-editor-heading]")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [scheduleEditorKey]);

  useEffect(() => {
    if (!scheduleDirty) return undefined;
    const protectDraft = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [scheduleDirty]);

  const guardScheduleDraft = (action, message) => {
    if (!scheduleDirty) { action(); return; }
    pendingScheduleActionRef.current = action;
    setDiscardPrompt({ message });
  };

  const activateScheduleEditor = (values, trigger) => {
    if (busy) return;
    const nextEditor = createScheduleEditor(values);
    if (scheduleEditor?.key === nextEditor.key) {
      document.getElementById(`schedule-editor-${nextEditor.key}`)?.querySelector("[data-editor-heading]")?.focus();
      return;
    }
    guardScheduleDraft(() => {
      scheduleReturnFocusRef.current = trigger;
      setScheduleError("");
      setScheduleEditor(nextEditor);
    }, `Bạn có thay đổi chưa lưu trong “${scheduleEditor?.values.title || "hoạt động hiện tại"}”.`);
  };

  const closeScheduleEditor = () => {
    if (busy) return;
    guardScheduleDraft(() => {
      setScheduleEditor(null);
      setScheduleError("");
      restoreFocus();
    }, `Bạn có thay đổi chưa lưu trong “${scheduleEditor?.values.title || "hoạt động hiện tại"}”.`);
  };

  const keepScheduleDraft = () => {
    pendingScheduleActionRef.current = null;
    setDiscardPrompt(null);
  };

  const discardScheduleDraft = () => {
    const action = pendingScheduleActionRef.current;
    pendingScheduleActionRef.current = null;
    setDiscardPrompt(null);
    action?.();
  };

  return {
    editor: scheduleEditor, setEditor: setScheduleEditor, error: scheduleError, setError: setScheduleError,
    activate: activateScheduleEditor, close: closeScheduleEditor, guard: guardScheduleDraft,
    returnFocusRef: scheduleReturnFocusRef,
    restoreFocus,
    discardDialog: discardPrompt && <DiscardChangesDialog message={discardPrompt.message} onKeep={keepScheduleDraft} onDiscard={discardScheduleDraft} />,
  };
}

function DiscardChangesDialog({ message, onKeep, onDiscard }) {
  const dialogRef = useRef(null);
  const safeActionRef = useRef(null);
  const returnFocusRef = useRef(null);
  const keepDraft = useEffectEvent(onKeep);
  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    safeActionRef.current?.focus();
    const handleEscape = (event) => { if (event.key === "Escape") keepDraft(); };
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      returnFocusRef.current?.focus?.();
    };
  }, []);
  const keepFocusInside = (event) => {
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll("button");
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return (
    <div className="suggestion-overlay discard-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onKeep(); }}>
      <section className="discard-dialog" role="dialog" aria-modal="true" aria-labelledby="discard-dialog-title" aria-describedby="discard-dialog-copy" ref={dialogRef} onKeyDown={keepFocusInside}>
        <h2 id="discard-dialog-title">Bỏ thay đổi chưa lưu?</h2>
        <p id="discard-dialog-copy">{message} Bạn muốn tiếp tục sửa hay bỏ bản nháp để chuyển sang mục khác?</p>
        <div className="discard-dialog-actions">
          <button type="button" className="admin-primary" onClick={onKeep} ref={safeActionRef}>Tiếp tục sửa</button>
          <button type="button" className="admin-danger" onClick={onDiscard}>Bỏ thay đổi</button>
        </div>
      </section>
    </div>
  );
}
