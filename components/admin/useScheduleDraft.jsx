import { useLocale } from "../LocaleProvider";
import contributionsStyles from "../../src/styles/contributions.module.css";
import scheduleEditorStyles from "../../src/styles/schedule-editor.module.css";

import Button from "../ui/Button";
import Dialog, { DialogTitle, DialogDescription } from "../ui/Dialog";
import { useEffect, useRef, useState } from "react";
import {
  createScheduleEditor,
  scheduleEditorIsDirty,
} from "../../lib/schedule-editor-state.mjs";

// Owns draft protection and focus restoration across all admin schedule entry points.
export function useScheduleDraft(busy) {
  const { t } = useLocale();
  const [scheduleEditor, setScheduleEditor] = useState(null);
  const [scheduleError, setScheduleError] = useState("");
  const [discardPrompt, setDiscardPrompt] = useState(null);
  const pendingScheduleActionRef = useRef(null);
  const scheduleReturnFocusRef = useRef(null);
  const scheduleDirty = scheduleEditorIsDirty(scheduleEditor);
  const scheduleEditorKey = scheduleEditor?.key;

  const restoreFocus = () =>
    requestAnimationFrame(() => {
      const trigger = scheduleReturnFocusRef.current;
      // A branch's add button is replaced by its editor and remounted on close.
      const target = trigger?.isConnected
        ? trigger
        : trigger?.id && document.getElementById(trigger.id);
      target?.focus?.();
    });

  useEffect(() => {
    if (!scheduleEditorKey) return undefined;
    const frame = requestAnimationFrame(() => {
      const editor = document.getElementById(
        `schedule-editor-${scheduleEditorKey}`,
      );
      if (!editor) return;
      editor.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "nearest",
      });
      editor
        .querySelector("[data-editor-heading]")
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [scheduleEditorKey]);

  useEffect(() => {
    if (!scheduleDirty) return undefined;
    const protectDraft = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [scheduleDirty]);

  const guardScheduleDraft = (action, message) => {
    if (!scheduleDirty) {
      action();
      return;
    }
    pendingScheduleActionRef.current = action;
    setDiscardPrompt({ message });
  };

  const activateScheduleEditor = (values, trigger) => {
    if (busy) return;
    const nextEditor = createScheduleEditor(values);
    if (scheduleEditor?.key === nextEditor.key) {
      document
        .getElementById(`schedule-editor-${nextEditor.key}`)
        ?.querySelector("[data-editor-heading]")
        ?.focus();
      return;
    }
    guardScheduleDraft(
      () => {
        scheduleReturnFocusRef.current = trigger;
        setScheduleError("");
        setScheduleEditor(nextEditor);
      },
      t("adminExtra.message003", {
        value0: scheduleEditor?.values.title || t("adminExtra.message004"),
      }),
    );
  };

  const closeScheduleEditor = () => {
    if (busy) return;
    guardScheduleDraft(
      () => {
        setScheduleEditor(null);
        setScheduleError("");
        restoreFocus();
      },
      t("adminExtra.message003", {
        value0: scheduleEditor?.values.title || t("adminExtra.message004"),
      }),
    );
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
    editor: scheduleEditor,
    setEditor: setScheduleEditor,
    error: scheduleError,
    setError: setScheduleError,
    activate: activateScheduleEditor,
    close: closeScheduleEditor,
    guard: guardScheduleDraft,
    returnFocusRef: scheduleReturnFocusRef,
    restoreFocus,
    discardDialog: discardPrompt && (
      <DiscardChangesDialog
        message={discardPrompt.message}
        onKeep={keepScheduleDraft}
        onDiscard={discardScheduleDraft}
      />
    ),
  };
}

function DiscardChangesDialog({ message, onKeep, onDiscard }) {
  const { t } = useLocale();
  const safeActionRef = useRef(null);
  return (
    <Dialog
      onClose={onKeep}
      initialFocusRef={safeActionRef}
      overlayClassName={`${contributionsStyles["suggestion-overlay"]} discard-overlay`}
      aria-describedby="discard-dialog-copy"
    >
      <section className={scheduleEditorStyles["discard-dialog"]}>
        <DialogTitle asChild>
          <h2>{t("adminExtra.message230")}</h2>
        </DialogTitle>
        <DialogDescription asChild>
          <p id="discard-dialog-copy">
            {message} {t("adminExtra.message231")}
          </p>
        </DialogDescription>
        <div className={scheduleEditorStyles["discard-dialog-actions"]}>
          <Button
            type="button"
            variant="primary"
            onClick={onKeep}
            ref={safeActionRef}
          >
            {t("adminExtra.message232")}
          </Button>
          <Button type="button" variant="danger" onClick={onDiscard}>
            {t("adminExtra.message233")}
          </Button>
        </div>
      </section>
    </Dialog>
  );
}
