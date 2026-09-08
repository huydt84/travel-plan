"use client";
import { localizeAssistantMessage } from "../lib/i18n-assistant.mjs";
import Link from "./AssistantManagementLink";
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { apiJson } from "./v1/transport.mjs";
import { ASSISTANT_MODELS, thinkingOptions } from "../lib/v1/assistant-policy.mjs";
import styles from "./assistant-management.module.css";
import { useLocale } from "./LocaleProvider";

function useManagementLocale() {
  const { t, intlLocale } = useLocale();
const effortLabel = { default: t("assistantExtra.effort.auto"), minimal: t("assistantExtra.effort.minimal"), low: t("assistantExtra.effort.low"), medium: t("assistantExtra.effort.medium"), high: t("assistantExtra.effort.high") };
const date = (value) => new Intl.DateTimeFormat(intlLocale, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tokyo", hour12: false }).format(new Date(value));
const quota = (value) => value === null ? t("assistantExtra.unlimited") : value;
const status = (turn) => turn.status === "awaiting_approval" ? t("assistantExtra.status.awaiting") : turn.status === "awaiting_input" ? t("assistantExtra.status.awaitingInput") : turn.status === "running" ? t("assistantExtra.status.running") : turn.status === "completed" ? t("assistantExtra.status.completed") : turn.status === "failed" ? turn.errorCode === "TURN_CANCELLED" ? t("assistantExtra.status.cancelled") : t("assistantExtra.status.failed") : t("assistantExtra.status.empty");
  return { t, effortLabel, date, quota, status };
}
function Rules() {
  const { t } = useLocale();

  return <details className={styles.rules}><summary>{t("assistantExtra.rules.title")}</summary><p>{t("assistantExtra.rules.description")}</p><p>{t("assistantExtra.rules.owner")}</p></details>;
}
function Usage({ used, limit }) {
  const { t, quota } = useManagementLocale();

  return <div className={styles.usage}><span>{used} <span className={styles.muted}>/ {quota(limit)}</span></span>{limit !== null && <progress aria-label={t("assistantExtra.usage", { used, limit })} max={limit} value={Math.min(used,limit)} />}</div>;
}
function Badge({ enabled, children }) { return <span className={`${styles.badge} ${enabled ? styles.enabled : ""}`}>{children}</span>; }
function AccessSwitch({ policy, email, globallyEnabled=true, onSaved, onPending, onRefresh }) {
  const { t } = useLocale();

  const [pending,setPending]=useState(null),[error,setError]=useState("");
  const lock=useRef(false);
  const checked=pending ?? policy.enabled;
  const toggle=async()=>{
    if(lock.current) return;
    lock.current=true;const next=!policy.enabled;setPending(next);setError("");onPending(1);
    try {onSaved(await apiJson(`/api/admin/assistant/${email ? `admins/${encodeURIComponent(email)}` : "defaults"}`,{method:"PATCH",body:JSON.stringify({...policy,enabled:next})}));}
    catch(e){setError(e.status===409 ? t("assistantExtra.error.settingsChanged") : t("assistantExtra.error.save"));}
    finally{lock.current=false;setPending(null);onPending(-1);void onRefresh();}
  };
  return <div className={styles.accessControl}><button type="button" role="switch" aria-checked={checked} aria-label={email ? t("assistantExtra.access.allowPerson", { email }) : t("assistantExtra.access.allowAll")} aria-busy={pending!==null} disabled={pending!==null} className={styles.switchButton} onClick={toggle}><span className={styles.switchTrack} aria-hidden="true"><span /></span><span>{pending!==null ? t("assistantExtra.saving") : checked ? t("assistantExtra.on") : t("assistantExtra.off")}</span></button>{email && !globallyEnabled && <small>{t("assistantExtra.access.globallyDisabled")}</small>}{error && <small role="alert" className={styles.switchError}>{localizeAssistantMessage(t, error)}</small>}</div>;
}
function PolicySummary({ policy, effective, editHref, editable=true, accessControl }) {
  const { t, effortLabel, quota } = useManagementLocale();

  const rows = [[t("assistantExtra.access"),accessControl || (effective.enabled ? t("assistantExtra.enabled") : t("assistantExtra.disabled")),false],
    [t("assistantExtra.daily"),quota(effective.daily),policy.daily==="inherit"], [t("assistantExtra.weekly"),quota(effective.weekly),policy.weekly==="inherit"],
    [t("assistantExtra.model"),effective.model,policy.model==="inherit"], [t("assistantExtra.effort"),effortLabel[effective.effort],policy.model==="inherit"]];
  return <section aria-label={t("assistantExtra.settings.assistant")}><div className={styles.sectionHead}><h2>{t(policy.model==="inherit" ? "assistantExtra.settings.admin" : "assistantExtra.settings.assistant")}</h2>{editable && <Link prefetch={false} id="policy-edit" className={styles.secondary} href={editHref}>{t("assistantExtra.edit")}</Link>}</div>
    <dl className={styles.settings}>{rows.map(([label,value,usesDefault]) => <div key={label}><dt>{label}</dt><dd>{value}{usesDefault && <small>{t("assistantExtra.settings.inherit")}</small>}</dd></div>)}</dl><Rules /></section>;
}
function PolicyEditor({ editor, defaults, onSaved, onClose }) {
  const { t, effortLabel, quota } = useManagementLocale();

  const [base,setBase]=useState(editor.policy),[draft,setDraft]=useState(editor.policy);
  const [saving,setSaving]=useState(false),[error,setError]=useState(null),[notice,setNotice]=useState("");
  const dirty=JSON.stringify(draft)!==JSON.stringify(base);
  const valid=[draft.daily,draft.weekly].every(v=>v===null || v==="inherit" || Number.isInteger(v) && v>0 && v<=2147483647);
  useEffect(()=>{ const warn=(event)=>{if(dirty){event.preventDefault();event.returnValue="";}};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn); },[dirty]);
  const close=()=>{if(!saving && (!dirty || window.confirm(t("assistantExtra.settings.discard")))) onClose();};
  const update=(key,value)=>setDraft(current=>({...current,[key]:value}));
  const save=async(event)=>{
    event.preventDefault();if(!dirty || !valid || saving) return;setSaving(true);setError(null);
    try { onSaved(await apiJson(`/api/admin/assistant/${editor.email ? `admins/${encodeURIComponent(editor.email)}` : "defaults"}`,{method:"PATCH",body:JSON.stringify(draft)})); }
    catch(e){setError(e);}finally{setSaving(false);}
  };
  const loadLatest=async()=>{
    if(dirty && !window.confirm(t("assistantExtra.settings.replace"))) return;
    setSaving(true);try {const data=await apiJson("/api/admin/assistant");const latest=editor.email ? data.admins.find(p=>p.email===editor.email)?.policy : data.defaults;if(!latest) throw new Error(t("assistantExtra.error.adminUnavailable"));setBase(latest);setDraft(latest);setError(null);setNotice(t("assistantExtra.settings.latestLoaded"));}catch(e){setError(e);}finally{setSaving(false);}
  };
  return <Dialog.Root open onOpenChange={open=>{if(!open) close();}}><Dialog.Portal><Dialog.Overlay className={styles.overlay} /><Dialog.Content className={styles.editor} onCloseAutoFocus={e=>{e.preventDefault();[...document.querySelectorAll("#policy-edit")].find(node=>node.checkVisibility())?.focus();}} aria-describedby="policy-description">
    <header className={styles.editorHead}><Dialog.Title>{editor.email ? t("assistantExtra.settings.edit") : t("assistantExtra.settings.editShared")}</Dialog.Title><Dialog.Description id="policy-description">{editor.email || t("assistantExtra.settings.applies")}</Dialog.Description></header>
    <form onSubmit={save} className={styles.editorForm}><div className={styles.editorBody}>{editor.email && !defaults.enabled && <p className={styles.warning}>{t("assistantExtra.settings.disabledWarning")}</p>}
    <><fieldset disabled={saving} className={styles.group}><legend>{t("assistantExtra.limits")}</legend>{[["daily",t("assistantExtra.daily")],["weekly",t("assistantExtra.weekly")]].map(([key,label])=><div className={styles.field} key={key}><label htmlFor={`mode-${key}`}>{label}</label><div className={styles.quotaControl}><select id={`mode-${key}`} value={draft[key]==="inherit" ? "inherit" : draft[key]===null ? "unlimited" : "limited"} onChange={e=>update(key,e.target.value==="inherit" ? "inherit" : e.target.value==="unlimited" ? null : defaults[key] || (key==="daily" ? 50 : 250))}>{editor.email && <option value="inherit">{t("assistantExtra.settings.inherit")}</option>}<option value="limited">{t("assistantExtra.limited")}</option><option value="unlimited">{t("assistantExtra.unlimited")}</option></select>{typeof draft[key]==="number" && <input aria-label={t("assistantExtra.limitNumber", { label: label.toLowerCase() })} type="number" min="1" max="2147483647" required value={Number.isNaN(draft[key]) ? "" : draft[key]} onChange={e=>update(key,e.target.valueAsNumber)} />}</div>{draft[key]==="inherit" && <small>{quota(defaults[key])}{defaults[key]!==null ? t("assistantExtra.requestSuffix") : ""}</small>}</div>)}</fieldset>
    <fieldset disabled={saving} className={styles.group}><legend>{t("assistantExtra.modelAndEffort")}</legend><label className={styles.field}>{t("assistantExtra.model")}<select value={draft.model} onChange={e=>{const model=e.target.value;const effort=model!=="inherit" && thinkingOptions(model).includes(draft.effort) ? draft.effort : "default";setDraft(current=>({...current,model,effort}));setNotice(effort!==draft.effort ? t("assistantExtra.settings.effortReset") : "");}}>{editor.email && <option value="inherit">{t("assistantExtra.settings.inherit")}</option>}{ASSISTANT_MODELS.map(model=><option key={model}>{model}</option>)}</select></label>{draft.model==="inherit" ? <p className={styles.muted}>{defaults.model} · {effortLabel[defaults.effort]}</p> : <label className={styles.field}>{t("assistantExtra.effort")}<select aria-label={t("assistantExtra.effort")} aria-describedby="effort-help" value={draft.effort} onChange={e=>update("effort",e.target.value)}>{thinkingOptions(draft.model).map(effort=><option key={effort} value={effort}>{effortLabel[effort]}</option>)}</select><small id="effort-help">{t("assistantExtra.settings.effortHelp")}</small></label>}</fieldset>
    </>
    {notice && <p role="status" className={styles.success}>{localizeAssistantMessage(t, notice)}</p>}{error && <div role="alert" className={styles.warning}><p>{error.status===409 ? t("assistantExtra.settings.conflict") : localizeAssistantMessage(t, error.message)}</p>{error.status===409 && <button type="button" className={styles.secondary} disabled={saving} onClick={loadLatest}>{t("assistantExtra.settings.loadLatest")}</button>}</div>}<Rules /></div>
    <footer className={styles.editorFooter}><button type="button" className={styles.secondary} disabled={saving} onClick={close}>{t("assistantExtra.cancel")}</button><button className={styles.primary} disabled={saving || !dirty || !valid}>{saving ? t("assistantExtra.saving") : t("assistantExtra.saveChanges")}</button></footer></form>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}

export { useManagementLocale, Usage, Badge, AccessSwitch, PolicySummary, PolicyEditor };
