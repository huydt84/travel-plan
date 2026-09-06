"use client";
import { useEffect, useRef, useState } from "react";
import Dialog, { DialogTitle } from "../ui/Dialog";
import { apiJson } from "./transport.mjs";
import styles from "./assistant.module.css";
export const contextLabels = { trip: "Chuyến đi", activity: "Hoạt động", source: "Nguồn", contribution: "Góp ý", place: "Địa điểm" };
export function ReferenceList({ items = [], onPin, onRemove, removeLabel = "Bỏ", disabled = false, label }) {
  if (!items.length) return null;
  return <ul className={styles.contextRefs} aria-label={label}>{items.map((item) => {
    const ref = item.ref || item;
    const title = item.label || `${contextLabels[ref.kind]} · ${ref.id}`;
    return <li key={`${ref.kind}:${ref.id}`}>
      <span className={styles.contextName}>{item.href && item.available !== false ? <a href={item.href} target="_blank" rel="noreferrer">{title}</a> : <span>{title}</span>}
        <small>{contextLabels[ref.kind]}{item.parent && ref.kind !== "trip" ? ` · ${item.parent.label}` : ""}{item.available === false ? " · Không khả dụng" : item.omitted ? " · Chưa đọc" : ""}</small></span>
      {onPin && <button type="button" disabled={disabled || item.available === false} onClick={() => onPin(item)} aria-label={`Ghim ${title}`}>Ghim</button>}
      {onRemove && <button type="button" disabled={disabled} onClick={() => onRemove(item)} aria-label={`${removeLabel} ${title}`}>{removeLabel}</button>}
    </li>;
  })}</ul>;
}
export function ContextPicker({ onClose, onSelect }) {
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
  return <Dialog onClose={onClose} initialFocusRef={searchRef} overlayClassName={styles.overlay}><section className={styles.contextPicker}>
    <header><DialogTitle>Thêm ngữ cảnh</DialogTitle><button type="button" onClick={onClose}>Đóng</button></header>
    <label>Tìm trong chuyến đi và tài liệu<input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tên chuyến đi, hoạt động, địa điểm…" /></label>
    <label>Loại ngữ cảnh<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="">Tất cả tài liệu</option>{Object.entries(contextLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {loading && <p role="status">Đang tìm…</p>}
    {error && <p role="alert">{error} <button onClick={() => setReload((n) => n + 1)}>Thử lại</button></p>}
    {!loading && !error && !results.length && <p>{kind === "place" && !query ? "Nhập tên địa điểm để tìm trên Google Maps." : "Không tìm thấy ngữ cảnh phù hợp."}</p>}
    <ul className={styles.contextResults}>{results.map((item) => <li key={`${item.ref.kind}:${item.ref.id}`}><button type="button" onClick={() => { onSelect(item); onClose(); }}><strong>{item.label}</strong><small>{contextLabels[item.ref.kind]}{item.parent ? ` · ${item.parent.label}` : ""}</small></button></li>)}</ul>
    {cursor && <button disabled={loading} onClick={more}>Xem thêm</button>}
  </section></Dialog>;
}
