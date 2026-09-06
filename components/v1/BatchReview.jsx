import { useLocale } from "../LocaleProvider";
import { formatBatchSummary } from "../../lib/i18n-assistant.mjs";
import styles from "./assistant.module.css";

export const batchStatus = { pending: "assistantExtra.batch.pending", applied: "assistantExtra.batch.applied", rejected: "assistantExtra.batch.rejected", expired: "assistantExtra.batch.expired", conflicted: "assistantExtra.batch.conflicted", cancelled: "assistantExtra.status.cancelled", failed: "assistantExtra.batch.failed" };

export default function BatchReview({ action, busy = false, readOnly = false, onApprove, onReject, onRevise }) {
  const { t, intlLocale } = useLocale();
const labels = { slug: t("assistantExtra.field.slug"), title: t("assistantExtra.field.title"), name: t("assistantExtra.field.name"), startDate: t("assistantExtra.field.startDate"), endDate: t("assistantExtra.field.endDate"), start: t("assistantExtra.field.start"), end: t("assistantExtra.field.end"), timezone: t("assistantExtra.field.timezone"), location: t("assistantExtra.field.location"), address: t("assistantExtra.field.address"), latitude: t("assistantExtra.field.latitude"), longitude: t("assistantExtra.field.longitude"), website: t("assistantExtra.field.website"), googlePlaceId: t("assistantExtra.field.googlePlaceId"), notes: t("assistantExtra.field.notes"), detail: t("assistantExtra.field.detail"), sources: t("assistantExtra.field.sources"), place: t("assistantExtra.field.place"), branchId: t("assistantExtra.field.branchId"), key: t("assistantExtra.field.key"), url: t("assistantExtra.field.url"), host: t("assistantExtra.field.host"), number: t("assistantExtra.field.number"), type: t("assistantExtra.field.type"), icon: t("assistantExtra.field.icon"), displayEnd: t("assistantExtra.field.displayEnd") };
const kinds = { trip: t("assistantExtra.kind.trip"), activity: t("assistantExtra.kind.activity"), source: t("assistantExtra.kind.source"), place: t("assistantExtra.kind.place") };
const display = (v) => Array.isArray(v) ? v.join(", ") || t("assistantExtra.none") : v == null || v === "" ? t("assistantExtra.none") : typeof v === "object" ? JSON.stringify(v) : String(v);

  const pending = action.status === "pending";
  return <section className={styles.batchReview} aria-label={t("assistantExtra.batch.region")} data-status={action.status} aria-busy={busy}>
    <div className={styles.batchSummary} role="status"><h3>{busy ? t("assistantExtra.processing") : t(batchStatus[action.status])}</h3><p>{formatBatchSummary(t, action.preview)}</p>
      {pending && <p>{t("assistantExtra.batch.pendingHelp")}</p>}
      {action.status === "failed" && <p>{t("assistantExtra.batch.failedHelp")}</p>}
    </div>
    <details className={styles.batchDetails}><summary>{t("assistantExtra.batch.details", { count: action.preview.changes.length })}</summary>
    {action.preview.groups.map((group) => <section className={styles.batchGroup} key={group.tripKey} aria-label={group.title}>
      <h3>{group.title}</h3>
      {Object.entries(kinds).map(([kind, label]) => {
        const changes = action.preview.changes.filter((c) => c.tripKey === group.tripKey && c.kind.startsWith(kind + "."));
        return changes.length ? <details open key={kind}><summary>{label} ({changes.length})</summary>
          {changes.map((change) => <article key={change.targetKey} className={styles.batchChange}>
            <h4>{change.before ? t("assistantExtra.update") : t("assistantExtra.create")}: {change.title}</h4>
            <dl>{Object.keys(labels).filter((field) => Object.hasOwn(change.after, field)).map((field) => [field, change.after[field]]).filter(([field, value]) => !change.before || display(change.before[field]) !== display(value)).map(([field, value]) => <div className={styles.batchField} key={field}>
              <dt>{labels[field] || field}</dt><dd>{change.before && <div><span>{t("assistantExtra.before")}</span><del>{display(change.before[field])}</del></div>}<div>{change.before && <span>{t("assistantExtra.after")}</span>}<ins>{display(value)}</ins></div></dd>
            </div>)}</dl>
          </article>)}
        </details> : null;
      })}
    </section>)}
    </details>
    {action.receipt && <div className={styles.batchReceipt}><h3>{t("assistantExtra.batch.resources")}</h3><ul>{action.receipt.resources.map((resource) => <li key={`${resource.kind}:${resource.id}`}><a href={resource.href}>{resource.title}</a><span>{kinds[resource.kind]}</span></li>)}</ul></div>}
    {readOnly ? <p>{t("assistantExtra.batch.readOnly")}</p> : pending ? <div className={styles.batchApproval}>
      <p>{t("assistantExtra.batch.expires", { date: new Date(action.expiresAt).toLocaleString(intlLocale, { hour12: false }) })}</p>
      <div><button className={styles.applyButton} disabled={busy || !action.confirmationToken} onClick={onApprove}>{busy ? t("assistantExtra.processing") : t("assistantExtra.batch.approve")}</button><button className={styles.secondaryButton} disabled={busy} onClick={onReject}>{t("assistantExtra.batch.reject")}</button></div>
    </div> : action.status !== "applied" && onRevise ? <button className={styles.secondaryButton} onClick={onRevise}>{t("assistantExtra.batch.regenerate")}</button> : null}
  </section>;
}
