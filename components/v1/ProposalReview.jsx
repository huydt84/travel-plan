import { useLocale } from "../LocaleProvider";
import Link from "next/link";
import styles from "./assistant.module.css";
function useReviewLocale() {
  const { t, intlLocale } = useLocale();
const formatCheckedAt = (value) => value
  ? new Intl.DateTimeFormat(intlLocale, { dateStyle: "short", timeStyle: "short", hour12: false }).format(new Date(value))
  : t("assistantExtra.unknown");

const fieldLabels = {
  startDate: t("assistantExtra.field.startDate"), endDate: t("assistantExtra.field.endDate"),
  start: t("assistantExtra.proposal.field.start"), end: t("assistantExtra.proposal.field.end"), displayEnd: t("assistantExtra.proposal.field.displayEnd"), type: t("assistantExtra.field.type"),
  icon: t("assistantExtra.field.icon"), title: t("assistantExtra.field.title"), detail: t("assistantExtra.field.detail"), refs: t("assistantExtra.kind.source"), branchId: t("assistantExtra.field.branchId"), key: t("assistantExtra.proposal.field.key"),
};

const displayValue = (value) => {
  if (Array.isArray(value)) return value.length ? value.join(", ") : t("assistantExtra.none");
  if (value == null || value === "") return "—";
  return String(value);
};

  return { t, formatCheckedAt, fieldLabels, displayValue };
}

export function EvidencePanel({ citations, focusId, focusRef, idPrefix = "evidence" }) {
  const { t, formatCheckedAt } = useReviewLocale();
  if (!citations.length) return <div className={styles.inspectorEmpty}><h3>{t("assistantExtra.evidence.emptyTitle")}</h3><p>{t("assistantExtra.evidence.emptyHelp")}</p></div>;
  return <div className={styles.evidenceList}>{citations.map((citation) => (
    <article ref={citation.id === focusId ? focusRef : undefined} tabIndex={-1} key={citation.id} id={`${idPrefix}-${citation.id}`}>
      <span>{citation.id} · {citation.kind === "route" ? t("assistantExtra.evidence.route") : citation.kind === "place" ? "GOOGLE MAPS" : t("assistantExtra.evidence.source")}</span>
      <h3>{citation.title}</h3>
      <p>{citation.publisher || citation.host || t("assistantExtra.evidence.external")}</p>
      <time>{t("assistantExtra.evidence.checked", { date: formatCheckedAt(citation.checkedAt) })}</time>
      <a href={citation.url} target="_blank" rel="noreferrer">{t("assistantExtra.evidence.open")}</a>
    </article>
  ))}</div>;
}

export function ChangePanel({ changeSet, busy, onConfirm, onRegenerate, readOnly = false }) {
  const { t, formatCheckedAt } = useReviewLocale();
  if (!changeSet) return <div className={styles.inspectorEmpty}><h3>{t("assistantExtra.proposal.emptyTitle")}</h3><p>{t("assistantExtra.proposal.emptyHelp")}</p></div>;
  const applicable = changeSet.status === "staged" && changeSet.confirmationToken;
  const statusTitle = changeSet.status === "applied"
    ? t("assistantExtra.proposal.applied", { count: changeSet.preview.changes.length })
    : ["conflicted", "expired"].includes(changeSet.status)
      ? t("assistantExtra.proposal.stale")
      : changeSet.preview.summary === `${changeSet.preview.changes.length} thay đổi được đề xuất`
        ? t("assistantExtra.proposal.summary", { count: changeSet.preview.changes.length })
        : changeSet.preview.summary;
  return (
    <div className={styles.changePanel}>
      <div className={styles.changeSummary} data-status={changeSet.status}>
        <h3>{statusTitle}</h3>
        <p>{t("assistantExtra.proposal.trip")} <Link href={`/?trip=${encodeURIComponent(changeSet.tripSlug)}`}>{changeSet.tripTitle || changeSet.tripSlug}</Link></p>
        <p>{t("assistantExtra.proposal.version", { revision: changeSet.baseRevision, date: formatCheckedAt(changeSet.expiresAt) })}</p>
      </div>
      {changeSet.preview.warnings?.map((warning) => <p className={styles.warning} key={warning}>{warning}</p>)}
      <div className={styles.changeList}>
        {changeSet.preview.changes.map((change, index) => <Change key={`${change.targetKey}-${index}`} change={change} />)}
      </div>
      {readOnly ? <p>{t("assistantExtra.proposal.readOnly")}</p> : changeSet.receipt ? (
        <div className={styles.receipt} role="status"><strong>{t("assistantExtra.proposal.updated")}</strong><span>{t("assistantExtra.proposal.receipt", { from: changeSet.receipt.fromRevision, to: changeSet.receipt.toRevision })}</span><Link href={`/?trip=${encodeURIComponent(changeSet.receipt.tripSlug)}`}>{t("assistantExtra.proposal.openSchedule")}</Link></div>
      ) : applicable ? (
        <button className={styles.applyButton} type="button" disabled={busy} onClick={onConfirm}>{t("assistantExtra.proposal.applyChanges", { count: changeSet.preview.changes.length })}</button>
      ) : (
        <div className={styles.staleAction}><p>{t("assistantExtra.proposal.staleHelp")}</p><button type="button" onClick={onRegenerate}>{t("assistantExtra.proposal.regenerate")}</button></div>
      )}
      <p className={styles.digest}>{t("assistantExtra.proposal.digest", { digest: changeSet.digest.slice(0, 12) })}</p>
    </div>
  );
}

function Change({ change }) {
  const { t, fieldLabels, displayValue } = useReviewLocale();
  const fields = [...new Set([...Object.keys(change.before || {}), ...Object.keys(change.after || {})])]
    .filter((field) => displayValue(change.before?.[field]) !== displayValue(change.after?.[field]));
  return (
    <article className={change.destructive ? styles.destructiveChange : ""}>
      <header><span>{change.kind === "activity.add" ? t("assistantExtra.proposal.add") : change.kind === "activity.remove" ? t("assistantExtra.proposal.remove") : change.kind === "source.add" ? t("assistantExtra.proposal.sourceAdd") : t("assistantExtra.proposal.update")}</span><h4>{change.title}</h4></header>
      {fields.map((field) => (
        <dl key={field}><dt>{fieldLabels[field] || field}</dt><dd><del>{displayValue(change.before?.[field])}</del><ins>{displayValue(change.after?.[field])}</ins></dd></dl>
      ))}
    </article>
  );
}
