"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { localizeAssistantMessage } from "../../lib/i18n-assistant.mjs";
import { useLocale } from "../LocaleProvider";
import styles from "./assistant.module.css";

const customValue = "__custom__";

function answerText(question, answer, customLabel) {
  if (!answer) return "";
  if ("text" in answer) return `${customLabel}: ${answer.text}`;
  return question.options.find((option) => option.id === answer.optionId)?.label || answer.optionId;
}

export default function QuestionPrompt({ prompt, readOnly = false, onSubmit }) {
  const { t } = useLocale();
  const initialAnswers = useMemo(() => new Map((prompt.answers || []).map((answer) => [answer.questionId, answer])), [prompt.answers]);
  const [selected, setSelected] = useState(() => Object.fromEntries(prompt.questions.map((question) => {
    const answer = initialAnswers.get(question.id);
    return [question.id, answer ? ("text" in answer ? customValue : answer.optionId) : ""];
  })));
  const [custom, setCustom] = useState(() => Object.fromEntries(prompt.questions.map((question) => [question.id, initialAnswers.get(question.id)?.text || ""])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submission = useRef(null);
  const heading = useRef(null);
  const previousStatus = useRef(prompt.status);
  const pending = prompt.status === "pending";
  const interactive = pending && !readOnly && Boolean(onSubmit);
  const answers = prompt.questions.map((question) => selected[question.id] === customValue
    ? { questionId: question.id, text: custom[question.id]?.trim() || "" }
    : { questionId: question.id, optionId: selected[question.id] || "" });
  const complete = answers.every((answer) => "text" in answer ? Boolean(answer.text) : Boolean(answer.optionId));

  useEffect(() => {
    if (previousStatus.current === "pending" && prompt.status !== "pending") heading.current?.focus({ preventScroll: true });
    previousStatus.current = prompt.status;
  }, [prompt.status]);

  const changed = (questionId, value) => {
    submission.current = null;
    setError("");
    setSelected((current) => ({ ...current, [questionId]: value }));
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!interactive || !complete || busy) return;
    submission.current ||= crypto.randomUUID();
    setBusy(true);
    setError("");
    try {
      await onSubmit(prompt, { submissionId: submission.current, answers });
    } catch (failure) {
      setError(failure.message || "assistantExtra.question.submitError");
    } finally {
      setBusy(false);
    }
  };

  return <form className={styles.questionPrompt} data-question-id={prompt.id} data-status={prompt.status} aria-label={t("assistantExtra.question.region")} aria-busy={busy} onSubmit={submit}>
    <div className={styles.questionPromptHeading} role="status" aria-live="polite">
      <h3 ref={heading} tabIndex={-1}>{pending ? t("assistantExtra.question.heading") : prompt.status === "answered" ? t("assistantExtra.question.answered") : t("assistantExtra.question.cancelled")}</h3>
      {pending && <p>{readOnly ? t("assistantExtra.question.readOnly") : t("assistantExtra.question.help")}</p>}
    </div>
    <div className={styles.questionPromptList}>
      {prompt.questions.map((question) => {
        const stored = initialAnswers.get(question.id);
        if (!pending) return <section className={styles.questionReceipt} key={question.id}>
          <h4>{question.header}</h4><p>{question.question}</p>
          {stored && <strong>{answerText(question, stored, t("assistantExtra.question.custom"))}</strong>}
        </section>;
        return <fieldset key={question.id} disabled={!interactive || busy}>
          <legend><span>{question.header}</span>{question.question}</legend>
          <div className={styles.questionOptions}>
            {question.options.map((option) => <label key={option.id} data-selected={selected[question.id] === option.id || undefined}>
              <input type="radio" name={`${prompt.id}-${question.id}`} value={option.id} checked={selected[question.id] === option.id} onChange={() => changed(question.id, option.id)} />
              <span><strong>{option.label}</strong>{option.recommended && <small>{t("assistantExtra.question.recommended")}</small>}{option.description && <em>{option.description}</em>}</span>
            </label>)}
            <label data-selected={selected[question.id] === customValue || undefined}>
              <input type="radio" name={`${prompt.id}-${question.id}`} value={customValue} checked={selected[question.id] === customValue} onChange={() => changed(question.id, customValue)} />
              <span><strong>{t("assistantExtra.question.custom")}</strong><em>{t("assistantExtra.question.customHelp")}</em></span>
            </label>
          </div>
          {selected[question.id] === customValue && <div className={styles.questionCustom}>
            <label htmlFor={`${prompt.id}-${question.id}-custom`}>{t("assistantExtra.question.yourAnswer")}</label>
            <textarea id={`${prompt.id}-${question.id}-custom`} rows={3} maxLength={1000} value={custom[question.id] || ""} onChange={(event) => {
              submission.current = null; setError(""); setCustom((current) => ({ ...current, [question.id]: event.target.value }));
            }} />
            <small>{t("assistantExtra.question.characterCount", { count: (custom[question.id] || "").length })}</small>
          </div>}
        </fieldset>;
      })}
    </div>
    {error && <p className={styles.questionError} role="alert">{localizeAssistantMessage(t, error)}</p>}
    {interactive && <div className={styles.questionActions}>
      <button className={styles.applyButton} type="submit" disabled={!complete || busy}>{busy ? t("assistantExtra.question.submitting") : t("assistantExtra.question.submit")}</button>
    </div>}
  </form>;
}
