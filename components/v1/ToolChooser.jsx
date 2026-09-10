"use client";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./assistant.module.css";
import { useLocale } from "../LocaleProvider";

const groups = [
  ["conversation", ["ask_question"]],
  ["trip", ["search_context", "read_context"]],
  ["research", ["search_web", "search_places", "get_place_details", "compute_route"]],
  ["changes", ["apply_changes"]],
];

export default function ToolChooser({ availableTools, allowedTools, onChange, disabled }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const root = useRef(null), trigger = useRef(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    const escape = (event) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const toggle = (name) => onChange(allowedTools.includes(name)
    ? allowedTools.filter((item) => item !== name)
    : availableTools.filter((item) => allowedTools.includes(item) || item === name));
  return <div className={styles.toolChooser} ref={root}>
    <button ref={trigger} className={styles.toolTrigger} type="button" disabled={disabled}
      aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
      {t("assistantTools.trigger", { selected: allowedTools.length, total: availableTools.length })}
    </button>
    {open && <section id={panelId} className={styles.toolPanel} aria-label={t("assistantTools.title")}>
      <header><strong>{t("assistantTools.title")}</strong><button type="button" onClick={() => onChange(availableTools)}>{t("assistantTools.enableAll")}</button></header>
      {groups.map(([group, names]) => {
        const visible = names.filter((name) => availableTools.includes(name));
        return visible.length ? <fieldset key={group}><legend>{t(`assistantTools.group.${group}`)}</legend>
          {visible.map((name) => <label key={name}><input type="checkbox" checked={allowedTools.includes(name)} onChange={() => toggle(name)} />
            <span><strong>{t(`assistantTools.${name}.label`)}</strong><small>{t(`assistantTools.${name}.description`)}</small></span>
          </label>)}
        </fieldset> : null;
      })}
      {!allowedTools.length && <p className={styles.noTools}>{t("assistantTools.none")}</p>}
      <footer><button type="button" className={styles.primaryButton} onClick={() => { setOpen(false); trigger.current?.focus(); }}>{t("assistantTools.done")}</button></footer>
    </section>}
  </div>;
}
