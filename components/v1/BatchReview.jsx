import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "../LocaleProvider";
import { formatBatchSummary } from "../../lib/i18n-assistant.mjs";
import styles from "./assistant.module.css";

export const batchStatus = { pending: "assistantExtra.batch.pending", applied: "assistantExtra.batch.applied", rejected: "assistantExtra.batch.rejected", expired: "assistantExtra.batch.expired", conflicted: "assistantExtra.batch.conflicted", cancelled: "assistantExtra.status.cancelled", failed: "assistantExtra.batch.failed", superseded: "assistantExtra.batch.superseded" };

const labelsFor = (t) => ({ slug: t("assistantExtra.field.slug"), title: t("assistantExtra.field.title"), name: t("assistantExtra.field.name"), startDate: t("assistantExtra.field.startDate"), endDate: t("assistantExtra.field.endDate"), start: t("assistantExtra.field.start"), end: t("assistantExtra.field.end"), timezone: t("assistantExtra.field.timezone"), location: t("assistantExtra.field.location"), address: t("assistantExtra.field.address"), latitude: t("assistantExtra.field.latitude"), longitude: t("assistantExtra.field.longitude"), website: t("assistantExtra.field.website"), googlePlaceId: t("assistantExtra.field.googlePlaceId"), notes: t("assistantExtra.field.notes"), detail: t("assistantExtra.field.detail"), sources: t("assistantExtra.field.sources"), place: t("assistantExtra.field.place"), branchId: t("assistantExtra.field.branchId"), key: t("assistantExtra.field.key"), url: t("assistantExtra.field.url"), host: t("assistantExtra.field.host"), number: t("assistantExtra.field.number"), type: t("assistantExtra.field.type"), icon: t("assistantExtra.field.icon"), displayEnd: t("assistantExtra.field.displayEnd") });
const kindsFor = (t) => ({ trip: t("assistantExtra.kind.trip"), activity: t("assistantExtra.kind.activity"), source: t("assistantExtra.kind.source"), place: t("assistantExtra.kind.place") });
const display = (v, none) => Array.isArray(v) ? v.join(", ") || none : v == null || v === "" ? none : typeof v === "object" ? JSON.stringify(v) : String(v);
const numericField = (field) => field === "latitude" || field === "longitude";
const inputType = (field) => field === "startDate" || field === "endDate" ? "date" : field === "start" || field === "end" ? "time" : field === "latitude" || field === "longitude" ? "number" : field === "url" || field === "website" ? "url" : "text";

export default function BatchReview({ action, busy = false, readOnly = false, onApprove, onReject, onRevise }) {
  const { t, intlLocale } = useLocale();
  const labels = labelsFor(t);
  const kinds = kindsFor(t);
  const headingRef = useRef(null);
  const editButtonRef = useRef(null);
  const [now, setNow] = useState(Date.now);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [editError, setEditError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const status = action.status === "pending" && Date.parse(action.expiresAt) <= now ? "expired" : action.status;
  const pending = status === "pending";
  const canEdit = pending && !readOnly && Boolean(action.confirmationToken);
  const editableEntries = useMemo(() => (action.preview?.changes || []).flatMap((change) => (change.editableFields || []).map((field) => ({
    key: `${change.targetKey}:${field}`, targetKey: change.targetKey, field, change,
  }))), [action.preview]);

  useEffect(() => {
    if (action.status !== "pending") return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, Date.parse(action.expiresAt) - Date.now()) + 1);
    return () => clearTimeout(timer);
  }, [action.status, action.expiresAt]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (pending && action.revision > 0) headingRef.current?.querySelector("h3")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [action.id, action.revision, pending]);

  useEffect(() => {
    if (!editing || !canEdit) return;
    const frame = requestAnimationFrame(() => headingRef.current?.querySelector("input, textarea")?.focus());
    return () => cancelAnimationFrame(frame);
  }, [editing, canEdit]);

  const beginEdit = () => {
    if (!canEdit || busy) return;
    setDraft(Object.fromEntries(editableEntries.map(({ key, field, change }) => [key, change.after?.[field] ?? ""])));
    setEditError(""); setFieldErrors({}); setEditing(true);
  };
  const cancelEdit = () => { setEditing(false); setEditError(""); setFieldErrors({}); requestAnimationFrame(() => editButtonRef.current?.focus()); };
  const saveEdit = async () => {
    if (!canEdit || busy || saving) return;
    const edits = editableEntries.filter(({ key, field, change }) => String(draft[key] ?? "") !== String(change.after?.[field] ?? ""))
      .map(({ key, targetKey, field }) => ({ targetKey, field, value: draft[key] === "" ? (numericField(field) || ["displayEnd", "googlePlaceId", "website"].includes(field) ? null : "") : draft[key] }));
    if (!edits.length) { cancelEdit(); return; }
    if (!onRevise) return;
    setSaving(true); setEditError(""); setFieldErrors({});
    try { await onRevise(action, edits); setEditing(false); }
    catch (error) {
      const mapped = Object.fromEntries((error.details?.fieldErrors || []).filter((item) => item?.targetKey && item?.field).map((item) => [`${item.targetKey}:${item.field}`, item.message || error.message]));
      setFieldErrors(mapped);
      setEditError(Object.keys(mapped).length ? "" : error.message || t("assistantExtra.batch.reviseError"));
    }
    finally { setSaving(false); }
  };

  return <section ref={headingRef} className={styles.batchReview} aria-label={t("assistantExtra.batch.region")} data-status={status} aria-busy={busy || saving}>
    <div className={styles.batchSummary} role="status" aria-live="polite"><h3 tabIndex={-1}>{busy ? t("assistantExtra.processing") : pending && action.revision > 0 ? t("assistantExtra.batch.revised") : t(batchStatus[status])}</h3><p>{formatBatchSummary(t, action.preview)}</p>
      {pending && <p>{t("assistantExtra.batch.pendingHelp")}</p>}
      {action.status === "failed" && <p>{t("assistantExtra.batch.failedHelp")}</p>}
    </div>
    {editing && canEdit ? <div className={styles.batchEditor} aria-label={t("assistantExtra.batch.editing")}>
      <p className={styles.batchEditHelp}>{t("assistantExtra.batch.editHelp")}</p>
      {action.preview.changes.map((change) => <fieldset className={styles.batchEditGroup} key={change.targetKey}>
        <legend>{kinds[change.kind.split(".")[0]]}: {change.title}</legend>
        <dl>{Object.keys(labels).filter((field) => Object.hasOwn(change.after, field) && !(change.editableFields || []).includes(field)).map((field) => <div className={styles.batchField} key={field}><dt>{labels[field]}</dt><dd>{display(change.after[field], t("assistantExtra.none"))}</dd></div>)}</dl>
        {editableEntries.filter((entry) => entry.targetKey === change.targetKey).map(({ key, field }) => {
        const controlId = `batch-edit-${action.id}-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
        const value = draft[key] == null ? "" : draft[key];
        const multiline = field === "detail" || field === "notes";
        const errorId = `${controlId}-error`;
        const fieldError = fieldErrors[key];
        return <div className={styles.batchEditField} key={key}>
          <label htmlFor={controlId}>{labels[field] || field}</label>
          {change.before && <div className={styles.batchEditBefore}><span>{t("assistantExtra.before")}</span><span>{display(change.before[field], t("assistantExtra.none"))}</span></div>}
          <span className={styles.batchEditAfter}>{change.before ? t("assistantExtra.after") : ""}</span>
          {multiline ? <textarea id={controlId} rows={3} value={value} aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? errorId : undefined} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} disabled={busy || saving} /> : <input id={controlId} type={inputType(field)} min={field === "latitude" ? -90 : field === "longitude" ? -180 : undefined} max={field === "latitude" ? 90 : field === "longitude" ? 180 : undefined} step={numericField(field) ? "any" : undefined} value={value} aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? errorId : undefined} onChange={(event) => setDraft((current) => ({ ...current, [key]: numericField(field) ? (event.target.value === "" ? "" : Number(event.target.value)) : event.target.value }))} disabled={busy || saving} />}
          {fieldError && <p id={errorId} role="alert" className={styles.batchFieldError}>{fieldError}</p>}
        </div>;
      })}</fieldset>)}
      {editError && <p role="alert" className={styles.batchEditError}>{editError}</p>}
      <div className={styles.batchEditActions}><button className={styles.applyButton} type="button" disabled={busy || saving} onClick={saveEdit}>{saving ? t("assistantExtra.processing") : t("assistantExtra.batch.saveEdit")}</button><button className={styles.secondaryButton} type="button" disabled={busy || saving} onClick={cancelEdit}>{t("assistantExtra.batch.cancelEdit")}</button></div>
    </div> : <details className={styles.batchDetails}><summary>{t("assistantExtra.batch.details", { count: action.preview.changes.length })}</summary>
      {action.preview.groups.map((group) => <section className={styles.batchGroup} key={group.tripKey} aria-label={group.title}>
        <h3>{group.title}</h3>
        {Object.entries(kinds).map(([kind, label]) => {
          const changes = action.preview.changes.filter((c) => c.tripKey === group.tripKey && c.kind.startsWith(kind + "."));
          return changes.length ? <details open key={kind}><summary>{label} ({changes.length})</summary>
            {changes.map((change) => <article key={change.targetKey} className={styles.batchChange}>
              <h4>{change.before ? t("assistantExtra.update") : t("assistantExtra.create")}: {change.title}</h4>
              <dl>{Object.keys(labels).filter((field) => Object.hasOwn(change.after, field)).map((field) => [field, change.after[field]]).filter(([field, value]) => !change.before || display(change.before[field], t("assistantExtra.none")) !== display(value, t("assistantExtra.none"))).map(([field, value]) => <div className={styles.batchField} key={field}>
                <dt>{labels[field] || field}</dt><dd>{change.before && <div><span>{t("assistantExtra.before")}</span><del>{display(change.before[field], t("assistantExtra.none"))}</del></div>}<div>{change.before && <span>{t("assistantExtra.after")}</span>}<ins>{display(value, t("assistantExtra.none"))}</ins></div></dd>
              </div>)}</dl>
            </article>)}
          </details> : null;
        })}
      </section>)}
    </details>}
    {action.receipt && <div className={styles.batchReceipt}><h3>{t("assistantExtra.batch.resources")}</h3><ul>{action.receipt.resources.map((resource) => <li key={`${resource.kind}:${resource.id}`}><a href={resource.href}>{resource.title}</a><span>{kinds[resource.kind]}</span></li>)}</ul></div>}
    {readOnly ? <p>{t("assistantExtra.batch.readOnly")}</p> : pending && !(editing && canEdit) ? <div className={styles.batchApproval}>
      <p>{t("assistantExtra.batch.expires", { date: new Date(action.expiresAt).toLocaleString(intlLocale, { hour12: false }) })}</p>
      <div>{editableEntries.length > 0 && <button ref={editButtonRef} className={styles.secondaryButton} type="button" disabled={busy || !canEdit} onClick={beginEdit}>{t("assistantExtra.batch.edit")}</button>}<button className={styles.applyButton} disabled={busy || !action.confirmationToken} onClick={onApprove}>{busy ? t("assistantExtra.processing") : t("assistantExtra.batch.approve")}</button><button className={styles.secondaryButton} disabled={busy} onClick={onReject}>{t("assistantExtra.batch.reject")}</button></div>
    </div> : !pending && action.status !== "applied" && onRevise ? <button className={styles.secondaryButton} onClick={() => onRevise(action)}>{t("assistantExtra.batch.regenerate")}</button> : null}
  </section>;
}
