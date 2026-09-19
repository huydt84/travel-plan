"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { requestJson as api } from "../../lib/request-json.mjs";
import { useLocale } from "../LocaleProvider";
import Button from "../ui/Button";
import FormFieldLabel from "../ui/FormFieldLabel";
import ConfirmDialog from "../ConfirmDialog";
import { ActionIcon } from "../Icons";
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
  const dialogTriggerRef = useRef(null);
  const toggleRef = useRef(null);
  const [open, setOpen] = useState(defaultOpen);
  const [editor, setEditor] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  if (!ledger.data) return null;
  const { currency, canManage, payers, summary } = ledger.data;
  const expenses = ledger.data.expenses.filter((expense) => expense.activityId === String(activity.id));
  const total = summary.activityTotals[String(activity.id)] || "0";
  if (!canManage && !expenses.length) return null;
  const restoreDialogFocus = () => requestAnimationFrame(() => {
    const trigger = dialogTriggerRef.current;
    (trigger?.isConnected ? trigger : toggleRef.current)?.focus();
  });
  const startCreate = (event) => {
    setError(""); setNotice("");
    dialogTriggerRef.current = event.currentTarget;
    setEditor({ expenseId: null, payerEmail: payers[0]?.email || "", amount: "" });
  };
  const activityClassName = placement === "schedule"
    ? `${styles.activity} ${styles.scheduleActivity}`
    : styles.activity;
  return <section className={activityClassName} aria-labelledby={headingId}>
    <header className={styles.activityHeader}>
      <button ref={toggleRef} className={styles.activityToggle} type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((value) => !value)} aria-label={t(open ? "expenses.closeFor" : "expenses.openFor", { title: activity.title })}>
        <ActionIcon name="down" />
        <span id={headingId} className={styles.activityLabel}>{t("expenses.title")}</span>
        <span className={styles.activityMeta}>{t("expenses.activityTotal", { amount: money(total, currency, intlLocale) })} · {new Intl.NumberFormat(intlLocale).format(expenses.length)}</span>
      </button>
      {canManage && <button className={styles.addExpense} type="button" onClick={startCreate} aria-label={t("expenses.addFor", { title: activity.title })}>
        <ActionIcon name="add" /><span>{t("expenses.add")}</span>
      </button>}
    </header>
    <div className={styles.activityBody} id={bodyId} data-empty={!expenses.length} hidden={!open}>
      {!expenses.length && <p className={styles.empty}>{t("expenses.empty")}</p>}
      {expenses.map((expense) => <article className={styles.expenseRow} key={expense.id}>
        <div className={styles.expenseDetails}><span className={styles.expenseName}>{expense.payer.displayName}</span><small>{t("expenses.recordedBy", { name: expense.createdBy.displayName })} · <time dateTime={expense.createdAt}>{new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(expense.createdAt))}</time></small></div>
        <strong className={styles.expenseAmount}>{money(expense.amount, currency, intlLocale)}</strong>
        {canManage && <ExpenseActions expense={expense} onEdit={(trigger) => { setError(""); dialogTriggerRef.current = trigger; setEditor({ expenseId: expense.id, payerEmail: expense.payer.email, amount: expense.amount }); }} onDelete={(trigger) => { setError(""); dialogTriggerRef.current = trigger; setDeleting(expense); }} />}
      </article>)}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
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
      onCancel={() => { if (!busy) { setDeleting(null); setError(""); restoreDialogFocus(); } }} onConfirm={async () => {
        setBusy(true); setError("");
        try { await ledger.remove(deleting.id); setDeleting(null); setNotice(t("expenses.deleted")); restoreDialogFocus(); }
        catch (requestError) { setError(requestError.message || t("expenses.deleteError")); }
        finally { setBusy(false); }
      }} />}
    {notice && <p className={styles.notice} role="status" aria-live="polite">{notice}</p>}
  </section>;
}

function ExpenseActions({ expense, onEdit, onDelete }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const firstItemRef = useRef(null);
  const lastItemRef = useRef(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (!menuRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  const closeAndFocus = () => { setOpen(false); triggerRef.current?.focus(); };
  const openAndFocus = (last = false) => {
    setOpen(true);
    requestAnimationFrame(() => (last ? lastItemRef : firstItemRef).current?.focus());
  };
  return <div className={styles.rowActions} ref={menuRef}>
    <button ref={triggerRef} className={styles.moreTrigger} type="button" aria-label={t("trackerExtra.moreActionsFor", { kind: t("expenses.title"), name: expense.payer.displayName })} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => open ? closeAndFocus() : openAndFocus()} onKeyDown={(event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); openAndFocus(event.key === "ArrowUp"); }
    }}><ActionIcon name="more" /></button>
    {open && <div className={styles.moreMenu} id={menuId} role="menu" onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); closeAndFocus(); }
      if (event.key === "Tab") setOpen(false);
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
        event.preventDefault();
        const first = document.activeElement === firstItemRef.current;
        (event.key === "Home" || event.key === "ArrowDown" && !first || event.key === "ArrowUp" && !first ? firstItemRef : lastItemRef).current?.focus();
      }
    }}>
      <button ref={firstItemRef} type="button" role="menuitem" onClick={() => { setOpen(false); onEdit(triggerRef.current); }}>{t("common.edit")}</button>
      <button ref={lastItemRef} className={styles.destructive} type="button" role="menuitem" onClick={() => { setOpen(false); onDelete(triggerRef.current); }}>{t("common.delete")}</button>
    </div>}
  </div>;
}

function ExpenseDialog({ editor, payers, currency, busy, error, onClose, onSave }) {
  const { t } = useLocale();
  const [values, setValues] = useState({ payerEmail: editor.payerEmail, amount: editor.amount });
  return <Dialog.Root open onOpenChange={(next) => { if (!next) onClose(); }}>
    <Dialog.Portal><Dialog.Overlay className={styles.overlay} /><Dialog.Content className={styles.dialog} aria-describedby={undefined}>
      <Dialog.Title>{editor.expenseId ? t("expenses.edit") : t("expenses.add")}</Dialog.Title>
      <form onSubmit={(event) => { event.preventDefault(); onSave(values); }}>
        <label><FormFieldLabel required>{t("expenses.payer")}</FormFieldLabel><select autoFocus value={values.payerEmail} onChange={(event) => setValues({ ...values, payerEmail: event.target.value })} required>
          {payers.map((payer) => <option key={payer.email} value={payer.email}>{payer.displayName}</option>)}
        </select></label>
        <label><FormFieldLabel required>{t("expenses.amount")} · {currency}</FormFieldLabel><input type="number" inputMode="decimal" min={currency === "USD" ? "0.01" : "1"} step={currency === "USD" ? "0.01" : "1"} value={values.amount} onChange={(event) => setValues({ ...values, amount: event.target.value })} required /></label>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.dialogActions}><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" disabled={busy}>{busy ? t("common.saving") : t("common.save")}</Button></div>
      </form>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
