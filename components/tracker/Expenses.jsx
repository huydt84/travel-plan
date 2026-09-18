"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { requestJson as api } from "../../lib/request-json.mjs";
import { useLocale } from "../LocaleProvider";
import Button from "../ui/Button";
import ConfirmDialog from "../ConfirmDialog";
import styles from "../../src/styles/expenses.module.css";

const money = (amount, currency, locale) => new Intl.NumberFormat(locale, {
  style: "currency",
  currency,
  minimumFractionDigits: currency === "USD" ? 2 : 0,
  maximumFractionDigits: 2,
}).format(Number(amount));

export function useExpenseLedger(tripSlug) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const next = await api(`/api/trips/${encodeURIComponent(tripSlug)}/expenses`);
      setData(next); setError(""); return next;
    } catch (requestError) { setError(requestError.message); throw requestError; }
    finally { setLoading(false); }
  }, [tripSlug]);
  useEffect(() => {
    if (!tripSlug) return undefined;
    let active = true;
    api(`/api/trips/${encodeURIComponent(tripSlug)}/expenses`)
      .then((next) => { if (active) { setData(next); setError(""); } })
      .catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tripSlug]);
  const save = useCallback(async ({ activityId, payerEmail, amount, expenseId }) => {
    const endpoint = expenseId
      ? `/api/trips/${encodeURIComponent(tripSlug)}/expenses/${expenseId}`
      : `/api/trips/${encodeURIComponent(tripSlug)}/expenses`;
    await api(endpoint, {
      method: expenseId ? "PATCH" : "POST",
      body: JSON.stringify(expenseId ? { payerEmail, amount } : { activityId, payerEmail, amount }),
    });
    return refresh();
  }, [refresh, tripSlug]);
  const remove = useCallback(async (expenseId) => {
    await api(`/api/trips/${encodeURIComponent(tripSlug)}/expenses/${expenseId}`, { method: "DELETE" });
    return refresh();
  }, [refresh, tripSlug]);
  return useMemo(() => ({ data, loading, error, refresh, save, remove }), [data, loading, error, refresh, save, remove]);
}

export function ExpenseSummary({ ledger, placement = "default" }) {
  const { t, intlLocale } = useLocale();
  if (ledger.loading) return <p className={styles.status}>{t("expenses.loading")}</p>;
  if (!ledger.data) return <p className={styles.error} role="alert">{t("expenses.loadError")}</p>;
  const { summary, currency } = ledger.data;
  const summaryClassName = placement === "admin"
    ? `${styles.summary} ${styles.adminSummary}`
    : styles.summary;
  return <section className={summaryClassName} aria-labelledby="expense-summary-title">
    <header><div><h2 id="expense-summary-title">{t("expenses.summary")}</h2><p>{currency} · {t("expenses.people", { count: summary.participantCount })}</p></div></header>
    <div className={styles.totals}>
      <div><span>{t("expenses.total")}</span><strong>{money(summary.totalAmount, currency, intlLocale)}</strong></div>
      <div><span>{t("expenses.average")}</span><strong>{money(summary.averageAmount, currency, intlLocale)}</strong></div>
    </div>
    <ol className={styles.people}>
      {summary.members.map((member, index) => <li key={member.email || `${member.displayName}-${index}`}>
        <div><strong>{member.displayName}</strong><span>{member.role === "leader" ? "Leader" : "Member"}</span></div>
        <div><strong>{money(member.totalAmount, currency, intlLocale)}</strong><span data-comparison={member.comparison}>{member.comparison === "equal" ? t("expenses.equal") : `${money(member.differenceAmount.replace("-", ""), currency, intlLocale)} ${t(`expenses.${member.comparison}`)}`}</span></div>
      </li>)}
    </ol>
  </section>;
}

export function ActivityExpenses({ activity, ledger, defaultOpen = false, placement = "default" }) {
  const { t, intlLocale } = useLocale();
  const headingId = useId();
  const bodyId = useId();
  const addButtonRef = useRef(null);
  const dialogTriggerRef = useRef(null);
  const [open, setOpen] = useState(defaultOpen);
  const [editor, setEditor] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  if (!ledger.data) return null;
  const { currency, canManage, payers, summary } = ledger.data;
  const expenses = ledger.data.expenses.filter((expense) => expense.activityId === String(activity.id));
  const total = summary.activityTotals[String(activity.id)] || "0";
  if (!canManage && !expenses.length) return null;
  const restoreDialogFocus = () => requestAnimationFrame(() => dialogTriggerRef.current?.focus());
  const startCreate = (event) => {
    setError(""); setNotice("");
    dialogTriggerRef.current = event.currentTarget;
    setEditor({ expenseId: null, payerEmail: payers[0]?.email || "", amount: "" });
  };
  const activityClassName = placement === "schedule"
    ? `${styles.activity} ${styles.scheduleActivity}`
    : styles.activity;
  return <section className={activityClassName} aria-labelledby={headingId}>
    <button className={styles.activityToggle} type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((value) => !value)} aria-label={t("expenses.openFor", { title: activity.title })}>
      <span><strong id={headingId}>{t("expenses.title")}</strong><small>{expenses.length ? t("expenses.activityTotal", { amount: money(total, currency, intlLocale) }) : t("expenses.empty")}</small></span>
      <span aria-hidden="true">{open ? "−" : "+"}</span>
    </button>
    {open && <div className={styles.activityBody} id={bodyId}>
      {expenses.map((expense) => <article className={styles.expenseRow} key={expense.id}>
        <div><strong>{expense.payer.displayName}</strong><small>{t("expenses.recordedBy", { name: expense.createdBy.displayName })} · <time dateTime={expense.createdAt}>{new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(expense.createdAt))}</time></small></div>
        <strong>{money(expense.amount, currency, intlLocale)}</strong>
        {canManage && <div className={styles.rowActions}>
          <button type="button" onClick={(event) => { setError(""); dialogTriggerRef.current = event.currentTarget; setEditor({ expenseId: expense.id, payerEmail: expense.payer.email, amount: expense.amount }); }}>{t("common.edit")}</button>
          <button type="button" onClick={() => { setError(""); setDeleting(expense); }}>{t("common.delete")}</button>
        </div>}
      </article>)}
      {canManage && <Button ref={addButtonRef} type="button" variant="ghost" onClick={startCreate}>{t("expenses.add")}</Button>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>}
    {editor && <ExpenseDialog editor={editor} payers={payers} currency={currency} busy={busy} error={error}
      onClose={() => { if (!busy) { setEditor(null); setError(""); restoreDialogFocus(); } }}
      onSave={async (values) => {
        setBusy(true); setError("");
        try { await ledger.save({ activityId: activity.id, ...values, expenseId: editor.expenseId }); setEditor(null); setOpen(true); setNotice(t("expenses.saved")); restoreDialogFocus(); }
        catch (requestError) { setError(requestError.message || t("expenses.saveError")); }
        finally { setBusy(false); }
      }} />}
    {deleting && <ConfirmDialog title={t("expenses.deleteTitle")} description={t("expenses.deleteDescription", { name: deleting.payer.displayName, amount: money(deleting.amount, currency, intlLocale) })}
      preview={`${deleting.payer.displayName} · ${money(deleting.amount, currency, intlLocale)}`} confirmLabel={t("common.delete")} pendingLabel={t("common.loading")} pending={busy} error={error}
      onCancel={() => { if (!busy) { setDeleting(null); setError(""); } }} onConfirm={async () => {
        setBusy(true); setError("");
        try { await ledger.remove(deleting.id); setDeleting(null); setNotice(t("expenses.deleted")); }
        catch (requestError) { setError(requestError.message || t("expenses.deleteError")); }
        finally { setBusy(false); }
      }} />}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
  </section>;
}

function ExpenseDialog({ editor, payers, currency, busy, error, onClose, onSave }) {
  const { t } = useLocale();
  const [values, setValues] = useState({ payerEmail: editor.payerEmail, amount: editor.amount });
  return <Dialog.Root open onOpenChange={(next) => { if (!next) onClose(); }}>
    <Dialog.Portal><Dialog.Overlay className={styles.overlay} /><Dialog.Content className={styles.dialog} aria-describedby={undefined}>
      <Dialog.Title>{editor.expenseId ? t("expenses.edit") : t("expenses.add")}</Dialog.Title>
      <form onSubmit={(event) => { event.preventDefault(); onSave(values); }}>
        <label><span>{t("expenses.payer")}</span><select autoFocus value={values.payerEmail} onChange={(event) => setValues({ ...values, payerEmail: event.target.value })} required>
          {payers.map((payer) => <option key={payer.email} value={payer.email}>{payer.displayName}</option>)}
        </select></label>
        <label><span>{t("expenses.amount")} · {currency}</span><input type="number" inputMode="decimal" min={currency === "USD" ? "0.01" : "1"} step={currency === "USD" ? "0.01" : "1"} value={values.amount} onChange={(event) => setValues({ ...values, amount: event.target.value })} required /></label>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.dialogActions}><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" disabled={busy}>{busy ? t("common.saving") : t("common.save")}</Button></div>
      </form>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
