"use client";
import { useEffect, useRef, useState } from "react";
import Dialog, { DialogTitle } from "../ui/Dialog";
import { apiJson } from "./transport.mjs";
import styles from "./assistant.module.css";
import { localizeAssistantMessage } from "../../lib/i18n-assistant.mjs";
import { useLocale } from "../LocaleProvider";
export function ReferenceList({ items = [], onPin, onRemove, removeLabel, disabled = false, label }) {
  const { t } = useLocale();
  const effectiveRemoveLabel = removeLabel ?? t("assistantExtra.remove");
  const labels = { trip: t("context.trip"), activity: t("context.activity"), source: t("context.source"), contribution: t("context.contribution"), place: t("context.place"), google_place: "Google Maps" };
  if (!items.length) return null;
  return <ul className={styles.contextRefs} aria-label={label}>{items.map((item) => {
    const ref = item.ref || item;
    const title = item.label || `${labels[ref.kind] || ref.kind} · ${ref.id}`;
    return <li key={`${ref.kind}:${ref.id}`}>
      <span className={styles.contextName}>{item.href && item.available !== false ? <a href={item.href} target="_blank" rel="noreferrer">{title}</a> : <span>{title}</span>}
        <small>{labels[ref.kind] || ref.kind}{item.parent && ref.kind !== "trip" ? ` · ${item.parent.label}` : ""}{item.available === false ? ` · ${t("assistant.contextUnavailable")}` : item.omitted ? ` · ${t("assistant.unread")}` : ""}</small></span>
      {onPin && <button type="button" disabled={disabled || item.available === false} onClick={() => onPin(item)} aria-label={`${t("context.pin")} ${title}`}>{t("context.pin")}</button>}
      {onRemove && <button type="button" disabled={disabled} onClick={() => onRemove(item)} aria-label={`${effectiveRemoveLabel} ${title}`}>{effectiveRemoveLabel}</button>}
    </li>;
  })}</ul>;
}
export function ContextPicker({ onClose, onSelect }) {
  const { t } = useLocale();
  const searchRef = useRef(null), generation = useRef(0);
  const [query, setQuery] = useState(""), [kind, setKind] = useState("");
  const [results, setResults] = useState([]), [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const token = ++generation.current;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setError(""); setResults([]); setCursor(null);
      try {
        const params = new URLSearchParams({ q: query }); if (kind) params.set("kind", kind);
        const next = await apiJson(`/api/v1/assistant/context?${params}`, { signal: controller.signal });
        if (token !== generation.current || controller.signal.aborted) return;
        setResults(next.items); setCursor(next.nextCursor);
      } catch (failure) { if (!controller.signal.aborted) setError(failure.message); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 200);
    return () => { generation.current = token + 1; clearTimeout(timer); controller.abort(); };
  }, [query, kind, reload]);
  const more = async () => {
    const token = generation.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: query, cursor }); if (kind) params.set("kind", kind);
      const next = await apiJson(`/api/v1/assistant/context?${params}`);
      if (token !== generation.current) return;
      setResults((items) => [...items, ...next.items]); setCursor(next.nextCursor);
    } catch (failure) { if (token === generation.current) setError(failure.message); }
    finally { if (token === generation.current) setLoading(false); }
  };
  const labels = { trip: t("context.trip"), activity: t("context.activity"), source: t("context.source"), contribution: t("context.contribution"), place: t("context.place"), google_place: "Google Maps" };
  return <Dialog onClose={onClose} initialFocusRef={searchRef} overlayClassName={styles.overlay}><section className={styles.contextPicker}>
    <header><DialogTitle>{t("assistant.addContext")}</DialogTitle><button type="button" onClick={onClose}>{t("common.close")}</button></header>
    <label>{t("context.searchLabel")}<input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("context.searchPlaceholder")} /></label>
    <label>{t("context.kindLabel")}<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="">{t("context.all")}</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {loading && <p role="status">{t("context.searching")}</p>}
    {error && <p role="alert">{localizeAssistantMessage(t, error)} <button onClick={() => setReload((n) => n + 1)}>{t("common.retry")}</button></p>}
    {!loading && !error && !results.length && <p>{kind === "google_place" && !query ? t("context.googlePrompt") : t("context.noResults")}</p>}
    <ul className={styles.contextResults}>{results.map((item) => <li key={`${item.ref.kind}:${item.ref.id}`}><button type="button" onClick={() => { onSelect(item); onClose(); }}><strong>{item.label}</strong><small>{labels[item.ref.kind] || item.ref.kind}{item.parent ? ` · ${item.parent.label}` : ""}</small></button></li>)}</ul>
    {cursor && <button disabled={loading} onClick={more}>{t("common.next")}</button>}
  </section></Dialog>;
}
