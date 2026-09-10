"use client";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useMemo, useState } from "react";
import AdminNav from "./AdminNav";
import LanguageSwitcher from "./LanguageSwitcher";
import Button from "./ui/Button";
import { useLocale } from "./LocaleProvider";
import { requestJson } from "../lib/request-json.mjs";
import { localizeCollectionError } from "../lib/i18n-collections.mjs";
import { ActionIcon } from "./Icons";
import shell from "../src/styles/admin-shell.module.css";
import styles from "./place-collections.module.css";

const changeKeys = ["added", "updated", "restored", "removed", "unchanged"];
const formatDate = (value, locale) => value ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "-";

export default function PlaceCollectionsApp({ viewer, initialCollections, initialSelected, pendingInvitationCount, pendingTripRequestCount }) {
  const { t, intlLocale } = useLocale();
  const [collections, setCollections] = useState(initialCollections);
  const [selected, setSelected] = useState(initialSelected);
  const [preview, setPreview] = useState(null);
  const [importing, setImporting] = useState(!initialCollections.length);
  const [url, setUrl] = useState(""); const [query, setQuery] = useState("");
  const [displayName, setDisplayName] = useState(initialSelected?.name || "");
  const [busy, setBusy] = useState(""); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const fail = (failure) => setError(localizeCollectionError(t, failure));

  const refreshList = async (preferredId) => {
    const result = await requestJson("/api/admin/place-collections"); setCollections(result.collections);
    const id = preferredId || selected?.id || result.collections[0]?.id;
    if (id) { const next = await requestJson(`/api/admin/place-collections/${id}`); setSelected(next); setDisplayName(next.name); } else setSelected(null);
  };
  const choose = async (collection) => {
    setBusy("load"); setError(""); setPreview(null); setImporting(false); setQuery("");
    try { const next = await requestJson(`/api/admin/place-collections/${collection.id}`); setSelected(next); setDisplayName(next.name); window.history.replaceState({}, "", `/admin/collections?collection=${collection.id}`); }
    catch (failure) { fail(failure); } finally { setBusy(""); }
  };
  const check = async ({ collectionId = null } = {}) => {
    setBusy("preview"); setError(""); setNotice("");
    try { setPreview(await requestJson("/api/admin/place-collections/sync-previews", { method: "POST", body: JSON.stringify(collectionId ? { collectionId } : { url }) })); setImporting(false); }
    catch (failure) { fail(failure); } finally { setBusy(""); }
  };
  const apply = async () => {
    setBusy("apply"); setError("");
    try { const receipt = await requestJson(`/api/admin/place-collections/sync-previews/${preview.id}/apply`, { method: "POST", body: JSON.stringify({ digest: preview.digest }) });
      await refreshList(receipt.collectionId); setPreview(null); setUrl(""); setNotice(`${t("collections.saved")} ${t("collections.revision")} ${receipt.revision}.`); }
    catch (failure) { fail(failure); } finally { setBusy(""); }
  };
  const archive = async (value) => {
    if (value && !window.confirm(t("collections.archive") + "?")) return;
    setBusy("archive"); setError("");
    try { await requestJson(`/api/admin/place-collections/${selected.id}`, { method: "PATCH", body: JSON.stringify({ archived: value }) }); await refreshList(selected.id); }
    catch (failure) { fail(failure); } finally { setBusy(""); }
  };
  const hide = async (item, hidden) => {
    setBusy(`place-${item.id}`); setError("");
    try { setSelected(await requestJson(`/api/admin/place-collections/${selected.id}/places/${item.id}`, { method: "PATCH", body: JSON.stringify({ hidden }) })); }
    catch (failure) { fail(failure); } finally { setBusy(""); }
  };
  const rename = async () => {
    setBusy("rename"); setError("");
    try { const next = await requestJson(`/api/admin/place-collections/${selected.id}`, { method: "PATCH", body: JSON.stringify({ displayName }) }); setSelected(next); await refreshList(next.id); setNotice(t("collections.renamed")); }
    catch (failure) { setError(failure.message); } finally { setBusy(""); }
  };
  const loadMore = async (type) => {
    const current = type === "preview" ? preview : selected;
    if (!current?.nextCursor) return;
    setBusy("more"); setError("");
    try {
      const path = type === "preview" ? `/api/admin/place-collections/sync-previews/${current.id}?cursor=${current.nextCursor}` : `/api/admin/place-collections/${current.id}?cursor=${current.nextCursor}`;
      const next = await requestJson(path);
      const merged = { ...current, ...next, items: [...current.items, ...next.items] };
      if (type === "preview") setPreview(merged); else setSelected(merged);
    } catch (failure) { fail(failure); } finally { setBusy(""); }
  };
  const visibleItems = useMemo(() => {
    const items = preview?.items || selected?.items || []; const needle = query.trim().toLowerCase();
    return needle ? items.filter((item) => `${item.name} ${item.address || ""} ${item.note || ""}`.toLowerCase().includes(needle)) : items;
  }, [preview, selected, query]);

  return <main className={`${shell["admin-shell"]} ${styles.page}`}>
    <header className={shell["admin-header"]}><div><Link href="/" className={shell["admin-back"]}>{t("common.backToSchedule")}</Link>
      <h1>{t("collections.title")}</h1><small className={shell["admin-user"]}>{viewer.email}</small></div><LanguageSwitcher />
      <Button variant="ghost" onClick={() => signOut({ redirectTo: "/" })}>{t("common.logout")}</Button></header>
    <AdminNav active="collections" pendingInvitationCount={pendingInvitationCount} pendingTripRequestCount={pendingTripRequestCount} />
    {error && <div className={shell["admin-alert"]} role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label={t("common.close")}><ActionIcon name="close" /></button></div>}
    {notice && <div className={shell["admin-notice"]} role="status"><span>{notice}</span><button onClick={() => setNotice("")} aria-label={t("common.close")}><ActionIcon name="close" /></button></div>}
    <div className={shell["admin-grid"]}>
      <aside className={shell["admin-sidebar"]}><div className={shell["admin-section-head"]}><h2>{t("nav.adminCollections")}</h2>
        <Button variant="primary" className="small" onClick={() => { setImporting(true); setPreview(null); setSelected(null); setError(""); }}>{t("collections.new")}</Button></div>
        <div className={shell["trip-list"]}>{collections.map((collection) => <button key={collection.id} disabled={busy === "load"}
          className={`${shell["trip-list-item"]}${selected?.id === collection.id && !importing ? " active" : ""}`} onClick={() => choose(collection)}>
          <strong>{collection.name}</strong><span>{collection.activeCount} {t("collections.active")} / {collection.removedCount} {t("collections.removed")}</span>
          {collection.archived && <code>{t("collections.archive")}</code>}</button>)}
          {!collections.length && <p className={styles.sidebarEmpty}>{t("collections.empty")}</p>}</div></aside>
      <section className={shell["admin-content"]}>
        {importing && !preview && <ImportForm t={t} url={url} setUrl={setUrl} busy={busy === "preview"} onSubmit={() => check()} />}
        {!importing && !preview && !selected && <div className={styles.empty}><h2>{t("collections.title")}</h2><p>{t("collections.choose")}</p></div>}
        {busy === "load" && <CollectionSkeleton />}
        {preview && <Preview preview={preview} items={visibleItems} query={query} setQuery={setQuery} t={t} busy={busy} onApply={apply} onCancel={() => { setPreview(null); setImporting(!selected); }} onMore={() => loadMore("preview")} />}
        {!preview && selected && busy !== "load" && <Collection collection={selected} items={visibleItems} query={query} setQuery={setQuery}
          t={t} locale={intlLocale} busy={busy} displayName={displayName} setDisplayName={setDisplayName} onRename={rename}
          onSync={() => check({ collectionId: selected.id })} onArchive={archive} onHide={hide} onMore={() => loadMore("collection")} />}
      </section>
    </div>
  </main>;
}

function ImportForm({ t, url, setUrl, busy, onSubmit }) {
  return <form className={styles.importForm} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}><h2>{t("collections.new")}</h2><p>{t("collections.description")}</p>
    <label>{t("collections.url")}<input type="url" required autoFocus value={url} onChange={(event) => setUrl(event.target.value)} placeholder={t("collections.urlPlaceholder")} />
      <small>{t("collections.urlHelp")}</small></label><Button variant="primary" disabled={busy}>{busy ? t("collections.checking") : t("collections.check")}</Button></form>;
}
function Search({ t, value, onChange }) { return <label className={styles.search}>{t("collections.search")}<input type="search" value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
function Preview({ preview, items, query, setQuery, t, busy, onApply, onCancel, onMore }) {
  return <section className={styles.preview} aria-labelledby="collection-preview-title"><div className={styles.heading}><div><h2 id="collection-preview-title">{preview.title}</h2><p>{preview.summary.total} {t("collections.totalPlaces")}</p><p>{t("collections.notSaved")}</p></div><a href={preview.publicUrl} target="_blank" rel="noreferrer">{t("collections.openMaps")}</a></div>
    <dl className={styles.counts}>{changeKeys.map((key) => <div key={key} data-change={key}><dt>{t(`collections.${key}`)}</dt><dd>{preview.summary[key]}</dd></div>)}</dl>
    {preview.summary.warnings?.length > 0 && <div className={styles.warnings} role="status"><strong>{t("collections.warnings")}</strong><ul>{preview.summary.warnings.map((warning,index) => <li key={`${warning.code}-${index}`}>{warning.code === "DUPLICATE_PLACES" ? t("collections.warningDuplicates", { count: warning.count }) : warning.code}</li>)}</ul></div>}
    <div className={styles.toolbar}><Search t={t} value={query} onChange={setQuery} /><div><Button variant="ghost" onClick={onCancel}>{t("collections.cancel")}</Button><Button variant="primary" disabled={Boolean(busy)} onClick={onApply}>{busy === "apply" ? t("collections.applying") : t("collections.apply")}</Button></div></div>
    <PlaceRows items={items} t={t} preview />
    {preview.nextCursor && !query && <Button variant="ghost" className={styles.loadMore} disabled={busy === "more"} onClick={onMore}>{t("collections.loadMore")}</Button>}
  </section>;
}
function Collection({ collection, items, query, setQuery, t, locale, busy, displayName, setDisplayName, onRename, onSync, onArchive, onHide, onMore }) {
  return <section aria-labelledby="collection-title"><div className={styles.heading}><div><h2 id="collection-title">{collection.name}</h2><p>{collection.description}</p>
    {collection.name !== collection.sourceTitle && <p className={styles.meta}>{t("collections.sourceTitle")}: {collection.sourceTitle}</p>}
    <p className={styles.meta}>{collection.activeCount} {t("collections.active")} / {collection.removedCount} {t("collections.removed")} / {collection.hiddenCount} {t("collections.hidden")}</p>
    <p className={styles.meta}>{t("collections.lastSync")}: {formatDate(collection.lastSyncedAt, locale)} / {t("collections.parser")}: {collection.parserVersion}</p></div>
    <a href={collection.publicUrl} target="_blank" rel="noreferrer">{t("collections.openMaps")}</a></div>
    <form className={styles.rename} onSubmit={(event) => { event.preventDefault(); onRename(); }}><label>{t("collections.localName")}<input value={displayName} maxLength={160} onChange={(event) => setDisplayName(event.target.value)} /></label><Button variant="ghost" disabled={Boolean(busy) || displayName === collection.name}>{t("collections.saveName")}</Button></form>
    <div className={styles.toolbar}><Search t={t} value={query} onChange={setQuery} /><div><Button variant="ghost" disabled={Boolean(busy) || collection.archived} onClick={onSync}>{busy === "preview" ? t("collections.checking") : t("collections.resync")}</Button>
      <Button variant={collection.archived ? "primary" : "danger"} disabled={Boolean(busy)} onClick={() => onArchive(!collection.archived)}>{collection.archived ? t("collections.restore") : t("collections.archive")}</Button></div></div>
    <PlaceRows items={items} t={t} busy={busy} onHide={onHide} />
    {collection.nextCursor && !query && <Button variant="ghost" className={styles.loadMore} disabled={busy === "more"} onClick={onMore}>{t("collections.loadMore")}</Button>}
  </section>;
}
function PlaceRows({ items, t, preview = false, busy, onHide }) {
  if (!items.length) return <p className={styles.emptyRows}>{t("collections.noPlaces")}</p>;
  return <ol className={styles.places}>{items.map((item) => <li key={`${item.id || item.position}-${item.change || "saved"}`} data-change={item.change} data-removed={Boolean(item.sourceRemovedAt)} data-hidden={Boolean(item.hiddenAt)}>
    <div className={styles.placeIndex}>{String(item.position + 1).padStart(2,"0")}</div><div className={styles.placeBody}><div><h3>{item.name}</h3>
      {preview && item.change && <strong className={styles.change}>{t(`collections.${item.change}`)}</strong>}</div>{item.address && <p>{item.address}</p>}{item.note && <p><strong>{t("collections.note")}:</strong> {item.note}</p>}
      <details><summary>{t("collections.identifiers")}</summary><code>{(item.externalIds || []).map((id) => `${id.kind}: ${id.value}`).join(" / ") || item.id}</code></details></div>
    <div className={styles.placeActions}><a href={item.mapsUrl} target="_blank" rel="noreferrer">{t("collections.openMaps")}</a>
      {!preview && !item.sourceRemovedAt && <Button variant="ghost" disabled={busy === `place-${item.id}`} onClick={() => onHide(item,!item.hiddenAt)}>{item.hiddenAt ? t("collections.show") : t("collections.hide")}</Button>}</div>
  </li>)}</ol>;
}
function CollectionSkeleton() { return <div className={styles.skeleton} role="status"><span /><span /><span /><span /></div>; }
