import { useLayoutEffect, useRef } from "react";
import AssistantIcon from "./AssistantIcon";
import styles from "./assistant.module.css";
import { useLocale } from "../LocaleProvider";
export default function Composer({ message, setMessage, onSubmit, onStop, running, disabled, onMention, context }) {
  const { t } = useLocale();
  const ref = useRef(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const resize = () => { element.style.height = "auto"; element.style.height = Math.min(180, element.scrollHeight) + "px"; };
    resize();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => { if (element.clientWidth !== width) { width = element.clientWidth; resize(); } });
    observer.observe(element);
    return () => observer.disconnect();
  }, [message]);
  return <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <label className="sr-only" htmlFor="assistant-message">{t("assistant.messageLabel")}</label>
    <div className={styles.composerField}>
      <textarea disabled={disabled} ref={ref} id="assistant-message" aria-label={t("assistant.request")} rows={1} maxLength={4000} value={message} onChange={(event) => setMessage(event.target.value)}
        placeholder={t("assistant.placeholder")} onKeyDown={(event) => {
          if (event.key === "@" && !event.nativeEvent.isComposing) { event.preventDefault(); onMention?.(); return; }
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); if (!running && !disabled && message.trim()) onSubmit(); }
        }} />
      <div className={styles.composerFooter}>
        <div className={styles.composerContext}>{context}</div>
        {running ? <button type="button" className={styles.secondaryButton} onClick={onStop} aria-label={t("assistant.stop")} title={t("assistant.stop")}><AssistantIcon name="stop" /></button>
          : <button className={styles.primaryButton} disabled={disabled || !message.trim()} type="submit" aria-label={t("assistant.send")} title={t("assistant.send")}><AssistantIcon name="send" /></button>}
      </div>
    </div>
    <small><span className={styles.keyboardHint}>{t("assistant.keyboardHint")} </span>{t("assistant.applyReminder")}</small>
  </form>;
}
