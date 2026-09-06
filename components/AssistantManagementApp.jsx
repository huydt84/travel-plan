"use client";
import { localizeAssistantMessage } from "../lib/i18n-assistant.mjs";
import AssistantFailureLog from "./AssistantFailureLog";
import BatchReview from "./v1/BatchReview";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import AdminNav from "./AdminNav";
import MessageContent from "./v1/MessageContent";
import { ReferenceList } from "./v1/ContextReferences";
import { EvidencePanel, ChangePanel } from "./v1/ProposalReview";
import { apiJson } from "./v1/transport.mjs";
import { ASSISTANT_MODELS, thinkingOptions } from "../lib/v1/assistant-policy.mjs";
import shell from "../src/styles/admin-shell.module.css";
import styles from "./assistant-management.module.css";
import LanguageSwitcher from "./LanguageSwitcher";
import { useLocale } from "./LocaleProvider";

function useManagementLocale() {
  const { t, intlLocale } = useLocale();
const effortLabel = { default: t("assistantExtra.effort.auto"), minimal: t("assistantExtra.effort.minimal"), low: t("assistantExtra.effort.low"), medium: t("assistantExtra.effort.medium"), high: t("assistantExtra.effort.high") };
const date = (value) => new Intl.DateTimeFormat(intlLocale, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tokyo", hour12: false }).format(new Date(value));
const quota = (value) => value === null ? t("assistantExtra.unlimited") : value;
const status = (turn) => turn.status === "awaiting_approval" ? t("assistantExtra.status.awaiting") : turn.status === "running" ? t("assistantExtra.status.running") : turn.status === "completed" ? t("assistantExtra.status.completed") : turn.status === "failed" ? turn.errorCode === "TURN_CANCELLED" ? t("assistantExtra.status.cancelled") : t("assistantExtra.status.failed") : t("assistantExtra.status.empty");
  return { t, effortLabel, date, quota, status };
}
const query = (cursor) => cursor ? `?cursor=${encodeURIComponent(JSON.stringify(cursor))}` : "";
const inherited = (policy) => policy.model === "inherit" && policy.daily === "inherit" && policy.weekly === "inherit" && policy.enabled;
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
function Tabs({ value, onChange, items, label }) {
  return <div className={styles.tabs} role="tablist" aria-label={label}>{items.map(([id,title]) => <button key={id} role="tab" aria-selected={value===id} tabIndex={value===id ? 0 : -1} onClick={() => onChange(id)} onKeyDown={(event) => {
    if (!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
    event.preventDefault(); const index=items.findIndex(([key])=>key===id);
    const next=event.key==="Home" ? 0 : event.key==="End" ? items.length-1 : (index+(event.key==="ArrowRight" ? 1 : -1)+items.length)%items.length;
    onChange(items[next][0]);event.currentTarget.parentElement.children[next].focus();
  }}>{title}</button>)}</div>;
}
function PolicySummary({ policy, effective, onEdit, editable=true, accessControl }) {
  const { t, effortLabel, quota } = useManagementLocale();

  const rows = [[t("assistantExtra.access"),accessControl || (effective.enabled ? t("assistantExtra.enabled") : t("assistantExtra.disabled")),false],
    [t("assistantExtra.daily"),quota(effective.daily),policy.daily==="inherit"], [t("assistantExtra.weekly"),quota(effective.weekly),policy.weekly==="inherit"],
    [t("assistantExtra.model"),effective.model,policy.model==="inherit"], [t("assistantExtra.effort"),effortLabel[effective.effort],policy.model==="inherit"]];
  return <section aria-label={t("assistantExtra.settings.assistant")}><div className={styles.sectionHead}><h2>{t(policy.model==="inherit" ? "assistantExtra.settings.admin" : "assistantExtra.settings.assistant")}</h2>{editable && <button className={styles.secondary} onClick={onEdit}>{t("assistantExtra.edit")}</button>}</div>
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
  return <Dialog.Root open onOpenChange={open=>{if(!open) close();}}><Dialog.Portal><Dialog.Overlay className={styles.overlay} /><Dialog.Content className={styles.editor} onCloseAutoFocus={e=>{e.preventDefault();editor.trigger?.focus();}} aria-describedby="policy-description">
    <header className={styles.editorHead}><Dialog.Title>{editor.email ? t("assistantExtra.settings.edit") : t("assistantExtra.settings.editShared")}</Dialog.Title><Dialog.Description id="policy-description">{editor.email || t("assistantExtra.settings.applies")}</Dialog.Description></header>
    <form onSubmit={save} className={styles.editorForm}><div className={styles.editorBody}>{editor.email && !defaults.enabled && <p className={styles.warning}>{t("assistantExtra.settings.disabledWarning")}</p>}
    <><fieldset disabled={saving} className={styles.group}><legend>{t("assistantExtra.limits")}</legend>{[["daily",t("assistantExtra.daily")],["weekly",t("assistantExtra.weekly")]].map(([key,label])=><div className={styles.field} key={key}><label htmlFor={`mode-${key}`}>{label}</label><div className={styles.quotaControl}><select id={`mode-${key}`} value={draft[key]==="inherit" ? "inherit" : draft[key]===null ? "unlimited" : "limited"} onChange={e=>update(key,e.target.value==="inherit" ? "inherit" : e.target.value==="unlimited" ? null : defaults[key] || (key==="daily" ? 50 : 250))}>{editor.email && <option value="inherit">{t("assistantExtra.settings.inherit")}</option>}<option value="limited">{t("assistantExtra.limited")}</option><option value="unlimited">{t("assistantExtra.unlimited")}</option></select>{typeof draft[key]==="number" && <input aria-label={t("assistantExtra.limitNumber", { label: label.toLowerCase() })} type="number" min="1" max="2147483647" required value={Number.isNaN(draft[key]) ? "" : draft[key]} onChange={e=>update(key,e.target.valueAsNumber)} />}</div>{draft[key]==="inherit" && <small>{quota(defaults[key])}{defaults[key]!==null ? t("assistantExtra.requestSuffix") : ""}</small>}</div>)}</fieldset>
    <fieldset disabled={saving} className={styles.group}><legend>{t("assistantExtra.modelAndEffort")}</legend><label className={styles.field}>{t("assistantExtra.model")}<select value={draft.model} onChange={e=>{const model=e.target.value;const effort=model!=="inherit" && thinkingOptions(model).includes(draft.effort) ? draft.effort : "default";setDraft(current=>({...current,model,effort}));setNotice(effort!==draft.effort ? t("assistantExtra.settings.effortReset") : "");}}>{editor.email && <option value="inherit">{t("assistantExtra.settings.inherit")}</option>}{ASSISTANT_MODELS.map(model=><option key={model}>{model}</option>)}</select></label>{draft.model==="inherit" ? <p className={styles.muted}>{defaults.model} · {effortLabel[defaults.effort]}</p> : <label className={styles.field}>{t("assistantExtra.effort")}<select aria-label={t("assistantExtra.effort")} aria-describedby="effort-help" value={draft.effort} onChange={e=>update("effort",e.target.value)}>{thinkingOptions(draft.model).map(effort=><option key={effort} value={effort}>{effortLabel[effort]}</option>)}</select><small id="effort-help">{t("assistantExtra.settings.effortHelp")}</small></label>}</fieldset>
    </>
    {notice && <p role="status" className={styles.success}>{localizeAssistantMessage(t, notice)}</p>}{error && <div role="alert" className={styles.warning}><p>{error.status===409 ? t("assistantExtra.settings.conflict") : localizeAssistantMessage(t, error.message)}</p>{error.status===409 && <button type="button" className={styles.secondary} disabled={saving} onClick={loadLatest}>{t("assistantExtra.settings.loadLatest")}</button>}</div>}<Rules /></div>
    <footer className={styles.editorFooter}><button type="button" className={styles.secondary} disabled={saving} onClick={close}>{t("assistantExtra.cancel")}</button><button className={styles.primary} disabled={saving || !dirty || !valid}>{saving ? t("assistantExtra.saving") : t("assistantExtra.saveChanges")}</button></footer></form>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
function Skeleton(){
  const { t } = useLocale();
return <div className={styles.skeleton} role="status" aria-label={t("assistantExtra.loading")}><span/><span/><span/></div>;}

export default function AssistantManagementApp({ viewer,initial }) {
  const { t, effortLabel, date, status } = useManagementLocale();
  const [data,setData]=useState(initial),[section,setSection]=useState("admins"),[email,setEmail]=useState(null),[detailTab,setDetailTab]=useState("settings");
  const [history,setHistory]=useState(null),[review,setReview]=useState(null),[editor,setEditor]=useState(null),[notice,setNotice]=useState("");
  const [loading,setLoading]=useState(false),[error,setError]=useState(null),[overviewError,setOverviewError]=useState(""),[stopping,setStopping]=useState(null);
  const generation=useRef(0),listScroll=useRef(0),heading=useRef(null);
  const admin=data.admins.find(person=>person.email===email);
  const accessWrites=useRef(0),refreshEpoch=useRef(0);
  const accessPending=(delta)=>{accessWrites.current+=delta;refreshEpoch.current++;};
  const mergeSaved=(result)=>setData(current=>({...result,defaults:current.defaults.version>result.defaults.version ? current.defaults : result.defaults,admins:result.admins.map(person=>{const old=current.admins.find(p=>p.email===person.email);return old && old.policy.version>person.policy.version ? old : person;})}));
  const refresh=useCallback(async()=>{if(accessWrites.current)return;const epoch=++refreshEpoch.current;try{const result=await apiJson("/api/admin/assistant");if(epoch===refreshEpoch.current){setData(result);setOverviewError("");}}catch(e){if(epoch===refreshEpoch.current)setOverviewError(e.message);}},[]);
  const accessControl=(person)=> <AccessSwitch policy={person ? person.policy : data.defaults} email={person?.email} globallyEnabled={data.defaults.enabled} onSaved={mergeSaved} onPending={accessPending} onRefresh={refresh} />;
  useEffect(()=>{const update=()=>{if(document.visibilityState==="visible") void refresh();};window.addEventListener("focus",update);const timer=setInterval(update,30000);return()=>{window.removeEventListener("focus",update);clearInterval(timer);};},[refresh]);
  const reviewId=review?.conversation.id;
  const running=review?.turns.some(turn=>turn.status==="running");
  useEffect(()=>{
    if(!reviewId || !running) return;
    let disposed=false,inFlight=false;
    const update=async()=>{if(document.visibilityState!=="visible" || inFlight) return;inFlight=true;try{const result=await apiJson(`/api/admin/assistant/conversations/${reviewId}`);if(!disposed){setReview(current=>{if(current?.conversation.id!==reviewId)return current;const turns=new Map(current.turns.map(turn=>[turn.id,turn]));result.turns.forEach(turn=>{const previous=turns.get(turn.id);if(!previous || previous.status==="running" || turn.status!=="running") turns.set(turn.id,turn);});return {...current,conversation:result.conversation,turns:[...turns.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))};});setError(null);}}catch(e){if(!disposed)setError({message:e.message,retry:update});}finally{inFlight=false;}};
    const timer=setInterval(update,3000);return()=>{disposed=true;clearInterval(timer);};
  },[reviewId,running]);
  const loadHistory=async(target,more=false)=>{
    const token=++generation.current;setLoading(true);setError(null);
    try{const result=await apiJson(`/api/admin/assistant/admins/${encodeURIComponent(target)}/conversations${query(more ? history?.cursor : null)}`);if(token===generation.current)setHistory(current=>({...result,items:more ? [...current.items,...result.items] : result.items}));}
    catch(e){if(token===generation.current)setError({message:e.message,retry:()=>loadHistory(target,more)});}finally{if(token===generation.current)setLoading(false);}
  };
  const openConversation=async(id,more=false)=>{
    const token=++generation.current;setLoading(true);setError(null);if(!more)setNotice("");
    try{const result=await apiJson(`/api/admin/assistant/conversations/${id}${query(more ? review?.cursor : null)}`);if(token===generation.current){setReview(current=>({...result,turns:more ? [...result.turns,...current.turns] : result.turns}));if(!more) requestAnimationFrame(()=>heading.current?.focus());}}
    catch(e){if(token===generation.current)setError({message:e.message,retry:()=>openConversation(id,more)});}finally{if(token===generation.current)setLoading(false);}
  };
  const selectAdmin=(person)=>{listScroll.current=window.scrollY;setEmail(person.email);setDetailTab(person.role==="admin" ? "settings" : "history");setHistory(null);setReview(null);setNotice("");void loadHistory(person.email);requestAnimationFrame(()=>heading.current?.focus());};
  const backToList=()=>{++generation.current;setEmail(null);setReview(null);setError(null);setLoading(false);requestAnimationFrame(()=>{window.scrollTo(0,listScroll.current);document.getElementById(`admin-${email}`)?.focus({preventScroll:true});});};
  const changeSection=(next)=>{++generation.current;setSection(next);setEmail(null);setReview(null);setLoading(false);setError(null);setNotice("");};
  const stop=async(turn)=>{setStopping(turn.id);try{await apiJson(`/api/admin/assistant/runs/${turn.id}/stop`,{method:"POST"});const result=await apiJson(`/api/admin/assistant/conversations/${reviewId}`);setReview(current=>current?.conversation.id===reviewId ? {...current,turns:current.turns.map(old=>result.turns.find(t=>t.id===old.id)||old)} : current);setNotice(t("assistantExtra.stopHandled"));}catch(e){setError({message:e.message,retry:()=>stop(turn)});}finally{setStopping(null);}};
  return <main className={shell["admin-shell"]}>
    <header className={styles.header}><Link href="/">{t("common.backToSchedule")}</Link><div><h1>{t("nav.adminAssistant")}</h1><span>{viewer.email}</span></div><LanguageSwitcher /></header><AdminNav active="assistant" />
    <div className={styles.console}>
    <Tabs value={section} onChange={changeSection} label={t("assistantExtra.management")} items={[["admins",t("assistantExtra.admins")],["defaults",t("assistantExtra.settings.shared")],["failures",t("assistantLog.title")]]} />
    {!data.defaults.enabled && <p className={styles.warning}>{t("assistantExtra.access.globalWarning")}</p>}
    {overviewError && <div role="alert" className={styles.warning}>{localizeAssistantMessage(t, overviewError)} <button className={styles.secondary} onClick={refresh}>{t("assistantExtra.retry")}</button></div>}
    {notice && <p role="status" className={styles.success}>{localizeAssistantMessage(t, notice)}</p>}
    {error && <div role="alert" className={styles.warning}>{localizeAssistantMessage(t, error.message)} <button className={styles.secondary} onClick={error.retry}>{t("assistantExtra.retry")}</button></div>}
    <div className={styles.content}>
    {section==="failures" ? <AssistantFailureLog /> : section==="defaults" ? <PolicySummary accessControl={accessControl()} policy={data.defaults} effective={data.defaults} onEdit={event=>setEditor({policy:data.defaults,trigger:event.currentTarget})} /> : review ? <section aria-label={t("assistantExtra.reviewConversation")}>
      <button className={styles.back} onClick={()=>{++generation.current;setReview(null);setDetailTab("history");setError(null);setLoading(false);requestAnimationFrame(()=>heading.current?.focus());}}>{t("assistantExtra.backConversations")}</button>
      <div className={styles.sectionHead}><div><h2 ref={heading} tabIndex={-1}>{review.conversation.title}</h2><p className={styles.muted}>{review.email} {t("assistantExtra.readOnlySuffix")}</p></div></div>
      {review.cursor && <button className={styles.secondary} disabled={loading} onClick={()=>openConversation(reviewId,true)}>{loading ? t("assistantExtra.loadingEllipsis") : t("assistantExtra.previousRequests")}</button>}
      <details className={styles.rules}><summary>{t("assistantExtra.conversationContext")}</summary><ReferenceList label={t("assistantExtra.pinnedContext")} items={review.conversation.pins.map(ref=>({ref}))} /></details><div className={styles.review}>{review.turns.map(turn=><article className={styles.turn} key={turn.id}><header><span>{date(turn.createdAt)} JST</span><Badge enabled={turn.status==="completed"}>{status(turn)}</Badge>{["running","awaiting_approval"].includes(turn.status) && <button className={styles.danger} disabled={stopping===turn.id} onClick={()=>stop(turn)}>{stopping===turn.id ? t("assistantExtra.stopping") : t("assistantExtra.stopRequest")}</button>}</header>
        <div className={styles.question}><h3>{t("assistantExtra.admins")}</h3><p>{turn.input}</p></div><div className={styles.answer}><h3>{t("assistantExtra.assistant")}</h3><MessageContent text={turn.output || (turn.status==="running" ? t("assistantExtra.preparing") : t("assistantExtra.noAnswer"))} citations={turn.citations} onCitation={id=>{const target=document.getElementById(`${turn.id}-evidence-${id}`);target?.scrollIntoView({block:"center"});target?.focus({preventScroll:true});}} />{!!turn.citations.length && <EvidencePanel citations={turn.citations} idPrefix={`${turn.id}-evidence`} />}{turn.actions?.map(action=><BatchReview key={action.id} action={action} readOnly />)}{turn.changeSet && <ChangePanel changeSet={turn.changeSet} readOnly />}</div>
        <details className={styles.rules}><summary>{t("assistantExtra.requestDetails")}</summary><p>{turn.executionSettings ? `${turn.executionSettings.model} · ${effortLabel[turn.executionSettings.effort]}` : t("assistantExtra.noModelData")}{turn.retryOfTurnId && t("assistantExtra.retrySuffix")}</p><ReferenceList label={t("assistantExtra.messageContext")} items={turn.resolvedContext} /><ReferenceList label={t("assistantExtra.usedContext")} items={turn.usedContext} /></details>
      </article>)}</div></section> : admin ? <section aria-label={t("assistantExtra.adminDetails")}><button className={styles.back} onClick={backToList}>{t("assistantExtra.backAdmins")}</button><div className={styles.sectionHead}><div><h2 ref={heading} tabIndex={-1}>{admin.name}</h2><p className={styles.muted}>{admin.email}</p></div><Badge enabled={admin.access.enabled}>{admin.role!=="admin" ? t("assistantExtra.formerAdmin") : admin.access.enabled ? t("assistantExtra.enabled") : t("assistantExtra.disabled")}</Badge></div>
      <Tabs value={detailTab} onChange={setDetailTab} label={t("assistantExtra.administratorDetails")} items={[["settings",t("assistantExtra.settings")],["history",t("assistantExtra.conversations")]]} />
      {detailTab==="settings" ? <><div className={styles.usageSummary}><div><span>{t("assistantExtra.today")}</span><Usage used={admin.access.dailyUsed} limit={admin.access.daily} /><small>{t("assistantExtra.resetAt", { date: date(admin.access.dailyReset) })}</small></div><div><span>{t("assistantExtra.thisWeek")}</span><Usage used={admin.access.weeklyUsed} limit={admin.access.weekly} /><small>{t("assistantExtra.resetAt", { date: date(admin.access.weeklyReset) })}</small></div></div><PolicySummary accessControl={admin.role==="admin" ? accessControl(admin) : null} policy={admin.policy} effective={admin.access} editable={admin.role==="admin"} onEdit={event=>setEditor({email:admin.email,policy:admin.policy,trigger:event.currentTarget})} /></> : <>{loading && !history ? <Skeleton /> : history?.items.length===0 ? <p className={styles.empty}>{t("assistantExtra.noAdminConversations")}</p> : <table className={styles.history}><thead><tr><th>{t("assistantExtra.conversations")}</th><th>{t("assistantExtra.lastUpdated")}</th><th>{t("assistantExtra.status")}</th></tr></thead><tbody>{history?.items.map(conversation=><tr key={conversation.id}><td><button className={styles.link} disabled={loading} onClick={()=>openConversation(conversation.id)}>{conversation.title}</button></td><td>{date(conversation.updatedAt)} JST</td><td>{conversation.status==="failed" ? t("assistantExtra.ended") : status(conversation)}</td></tr>)}</tbody></table>}{history?.cursor && <button className={styles.secondary} disabled={loading} onClick={()=>loadHistory(email,true)}>{loading ? t("assistantExtra.loadingEllipsis") : t("assistantExtra.moreConversations")}</button>}</>}
    </section> : <section aria-label={t("assistantExtra.adminList")}>{!data.admins.length ? <div className={styles.empty}><h2>{t("assistantExtra.noOtherAdmins")}</h2><p>{t("assistantExtra.adminsEmptyHelp")}</p><Link href="/admin/users">{t("assistantExtra.manageUsers")}</Link></div> : <table className={styles.admins}><thead><tr>{[t("assistantExtra.admins"),t("assistantExtra.status"),t("assistantExtra.today"),t("assistantExtra.thisWeek"),t("assistantExtra.model"),t("assistantExtra.settings")].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{data.admins.map(person=><tr key={person.email}><td><button id={`admin-${person.email}`} className={styles.link} onClick={()=>selectAdmin(person)}>{person.name}<small>{person.email}</small></button></td><td>{person.role==="admin" ? accessControl(person) : <Badge>{t("assistantExtra.formerAdmin")}</Badge>}</td><td data-label={t("assistantExtra.today")}><Usage used={person.access.dailyUsed} limit={person.access.daily} /></td><td data-label={t("assistantExtra.thisWeek")}><Usage used={person.access.weeklyUsed} limit={person.access.weekly} /></td><td className={styles.secondaryColumn}>{person.access.model}<small>{effortLabel[person.access.effort]}</small></td><td className={styles.secondaryColumn}>{inherited(person.policy) ? t("assistantExtra.settings.inherit") : t("assistantExtra.settings.custom")}</td></tr>)}</tbody></table>}</section>}
    </div></div>{editor && <PolicyEditor editor={editor} defaults={data.defaults} onClose={()=>setEditor(null)} onSaved={result=>{setData(result);setEditor(null);setNotice(t("assistantExtra.settings.saved"));}} />}
  </main>;
}
