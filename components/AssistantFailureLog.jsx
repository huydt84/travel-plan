import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "./LocaleProvider";
import { apiJson } from "./v1/transport.mjs";
import styles from "./assistant-management.module.css";

export default function AssistantFailureLog() {
  const { t, intlLocale } = useLocale();
  const [data, setData] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const active = useRef(null);
  const load = useCallback(async (cursor = null) => {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(false);
    try {
      const result = await apiJson(`/api/admin/assistant/failures${cursor ? `?cursor=${encodeURIComponent(JSON.stringify(cursor))}` : ""}`, { signal: controller.signal });
      if (!controller.signal.aborted) setData(current => ({ ...result, items: cursor ? [...current.items, ...result.items.filter(item => !current.items.some(old => old.id === item.id))] : result.items }));
    } catch { if (!controller.signal.aborted) setError(true); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }, []);
  useEffect(() => { let mounted = true; queueMicrotask(() => { if (mounted) void load(); }); return () => { mounted = false; active.current?.abort(); }; }, [load]);
  const date = value => new Intl.DateTimeFormat(intlLocale, { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Tokyo", hour12: false }).format(new Date(value));
  return <section aria-label={t("assistantLog.title")}>
    <div className={styles.sectionHead}><h2>{t("assistantLog.title")}</h2><button className={styles.secondary} disabled={busy} onClick={() => load()}>{t("assistantLog.refresh")}</button></div>
    <p className={styles.muted}>{t("assistantLog.description")}</p>
    {busy && <p role="status">{t("assistantExtra.loadingEllipsis")}</p>}
    {error && <p role="alert">{t("assistantLog.loadError")} <button className={styles.link} disabled={busy} onClick={() => load()}>{t("assistantExtra.retry")}</button></p>}
    {!busy && !error && data?.items.length === 0 && <p>{t("assistantLog.empty")}</p>}
    {data?.items.map(item => <article className={styles.failureEntry} key={item.id}>
      <h3>{item.title}</h3><p className={styles.muted}>{item.email} · {date(item.completedAt)} JST</p>
      <span>{item.code || "UNKNOWN"} · {t(`assistantExtra.status.${item.status === "awaiting_approval" ? "awaiting" : item.status}`)}</span>
      <details className={styles.failureDetails}><summary>{t("assistantLog.details")}</summary>
        <dl className={styles.settings}>
          {[["reference", item.id], ["conversation", item.conversationId], ["time", `${date(item.completedAt)} JST`], ["code", item.code], ["model", item.settings?.model], ["phase", item.diagnostics?.phase], ["type", item.diagnostics?.errorType], ["upstream", item.diagnostics?.upstreamStatus], ["system", item.diagnostics?.systemCode], ["retry", item.retryOfTurnId], ["deadline", item.diagnostics?.deadlineMs]].filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => <div key={key}><dt>{t(`assistantLog.${key}`)}</dt><dd>{value}</dd></div>)}
        </dl>
        {!item.diagnostics && !item.tools?.some(tool => tool.diagnostics) && <p className={styles.muted}>{t("assistantLog.legacy")}</p>}
        {item.diagnostics?.cause && <pre>{JSON.stringify(item.diagnostics.cause, null, 2)}</pre>}
        {!!item.tools?.length && <><h3>{t("assistantLog.tools")}</h3>{item.tools.map(tool => <div key={tool.id} className={styles.failureStep}><strong>{tool.name}</strong><p>{tool.status} · {tool.code || "—"} · {tool.durationMs ?? "—"} ms</p>{tool.diagnostics && <pre>{JSON.stringify(tool.diagnostics, null, 2)}</pre>}</div>)}</>}
      </details>
    </article>)}
    {data?.cursor && <button className={styles.secondary} disabled={busy} onClick={() => load(data.cursor)}>{t("assistantLog.more")}</button>}
  </section>;
}
