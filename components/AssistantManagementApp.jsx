"use client";
import Link from "./AssistantManagementLink";
import {useRouter,usePathname} from "next/navigation";
import {useCallback,useEffect,useRef,useState} from "react";
import AdminNav from "./AdminNav";
import LanguageSwitcher from "./LanguageSwitcher";
import {apiJson} from "./v1/transport.mjs";
import {localizeAssistantMessage} from "../lib/i18n-assistant.mjs";
import {useManagementLocale,Usage,Badge,AccessSwitch,PolicySummary,PolicyEditor} from "./AssistantManagementControls";
import AssistantConversationReview from "./AssistantConversationReview";
import AssistantFailureLog,{FailureDetails} from "./AssistantFailureLog";
import {assistantRoot as root,userPath,historyPath,conversationPath} from "../lib/assistant-management-routes.mjs";
import shell from "../src/styles/admin-shell.module.css";
import styles from "./assistant-management.module.css";

function PageLinks({page,hasNext}) {
 const {t}=useManagementLocale(),path=usePathname();
 return <nav className={styles.routeActions} aria-label={t("assistantRoute.navigation")}>{page>1 && <Link prefetch={false} href={`${path}?page=${page-1}`}>{t("assistantRoute.previous")}</Link>}{hasNext && <Link prefetch={false} href={`${path}?page=${page+1}`}>{t("assistantRoute.next")}</Link>}</nav>;
}
function History({history}) {
 const {t,date,status}=useManagementLocale();
 if(!history.items.length)return <p className={styles.empty}>{t("assistantExtra.noAdminConversations")}</p>;
 return <table className={styles.history}><thead><tr><th>{t("assistantExtra.conversations")}</th><th>{t("assistantExtra.lastUpdated")}</th><th>{t("assistantExtra.status")}</th></tr></thead><tbody>{history.items.map(c=><tr key={c.id}><td><Link prefetch={false} className={styles.link} href={conversationPath(c.id)}>{c.title}</Link></td><td>{date(c.updatedAt)} JST</td><td>{status(c)}</td></tr>)}</tbody></table>;
}
export default function AssistantManagementApp({viewer,initial,view}) {
 const {t,date,effortLabel}=useManagementLocale(),router=useRouter(),path=usePathname();
 const [data,setData]=useState(initial),[error,setError]=useState("");
 const writes=useRef(0),epoch=useRef(0);
 const onPending=delta=>{writes.current+=delta;epoch.current++;};
 const refresh=useCallback(async()=>{if(writes.current)return;const current=++epoch.current;try{const result=await apiJson("/api/admin/assistant");if(current===epoch.current){setData(result);setError("");}}catch(e){if(current===epoch.current)setError(e.message);}},[]);
 useEffect(()=>{const update=()=>{if(document.visibilityState==="visible")void refresh();};window.addEventListener("focus",update);const timer=setInterval(update,30000);return()=>{window.removeEventListener("focus",update);clearInterval(timer);};},[refresh]);
 const mergeSaved=result=>setData(current=>({...result,defaults:current.defaults.version>result.defaults.version?current.defaults:result.defaults,admins:result.admins.map(person=>{const old=current.admins.find(p=>p.email===person.email);return old && old.policy.version>person.policy.version?old:person;})}));
 const person=data.admins.find(p=>p.email===view.email);
 const access=person=><AccessSwitch policy={person?.policy || data.defaults} email={person?.email} globallyEnabled={data.defaults.enabled} onSaved={mergeSaved} onPending={onPending} onRefresh={refresh}/>;
 const closeEditor=(saved=false)=>{sessionStorage.setItem("assistant-management-focus",path);router.replace(path+(saved ? "?saved=1" : ""),{scroll:false});};
 useEffect(()=>{if(!view.edit && sessionStorage.getItem("assistant-management-focus")===path){sessionStorage.removeItem("assistant-management-focus");[...document.querySelectorAll("#policy-edit")].find(node=>node.checkVisibility())?.focus({preventScroll:true});}},[view.edit,path]);
 const policy=person?.policy || data.defaults;
 const editing=view.edit && (view.kind==="settings" || view.kind==="user" && person?.role==="admin");
 const group=["failures","failure"].includes(view.kind)?"failures":view.kind==="settings"?"settings":"overview";
 const reviewEmail=view.review?.email || view.failure?.email;
 return <main className={shell["admin-shell"]}>
 <header className={styles.header}><Link prefetch={false} href="/">{t("common.backToSchedule")}</Link><div><h1>{t("nav.adminAssistant")}</h1><span>{viewer.email}</span></div><LanguageSwitcher/></header><AdminNav active="assistant"/>
 <div className={styles.console}><nav className={styles.tabs} aria-label={t("assistantExtra.management")}>{[["overview",root,t("assistantExtra.admins")],["settings",`${root}/settings`,t("assistantExtra.settings.shared")],["failures",`${root}/failures`,t("assistantLog.title")]].map(([id,href,label])=><Link prefetch={false} key={id} href={href} aria-current={group===id?"page":undefined}>{label}</Link>)}</nav>
 {!data.defaults.enabled && <p className={styles.warning}>{t("assistantExtra.access.globalWarning")}</p>}{error && <p role="alert" className={styles.warning}>{localizeAssistantMessage(t,error)} <button onClick={refresh}>{t("assistantExtra.retry")}</button></p>}
 <div className={styles.content}>{view.saved && <p role="status" className={styles.success}>{t("assistantExtra.settings.saved")}</p>}
 {view.kind!=="overview" && <nav className={styles.routeActions} aria-label={t("assistantRoute.navigation")}><Link prefetch={false} href={root} aria-label={t("assistantExtra.backAdmins")}>{t("assistantExtra.admins")}</Link>{reviewEmail && <Link prefetch={false} href={historyPath(reviewEmail)} aria-label={t("assistantExtra.backConversations")}>{t("assistantExtra.conversations")}</Link>}{view.kind==="failure" && <Link prefetch={false} href={`${root}/failures`}>{t("assistantLog.title")}</Link>}</nav>}
 {view.kind==="overview" && <section aria-label={t("assistantExtra.adminList")}>{!data.admins.length?<div className={styles.empty}><h2>{t("assistantExtra.noOtherAdmins")}</h2><p>{t("assistantExtra.adminsEmptyHelp")}</p><Link prefetch={false} href="/admin/users">{t("assistantExtra.manageUsers")}</Link></div>:<table className={styles.admins}><thead><tr>{["admins","status","today","thisWeek","model","conversations"].map(key=><th key={key}>{t(`assistantExtra.${key}`)}</th>)}</tr></thead><tbody>{data.admins.map(p=><tr key={p.email}><td><Link prefetch={false} id={`admin-${p.email}`} className={styles.link} href={userPath(p.email)}>{p.name}<small>{p.email}</small></Link></td><td>{p.role==="admin"?access(p):<Badge>{t("assistantExtra.formerAdmin")}</Badge>}</td><td data-label={t("assistantExtra.today")}><Usage used={p.access.dailyUsed} limit={p.access.daily}/></td><td data-label={t("assistantExtra.thisWeek")}><Usage used={p.access.weeklyUsed} limit={p.access.weekly}/></td><td className={styles.secondaryColumn}>{p.access.model}<small>{effortLabel[p.access.effort]}</small></td><td className={styles.historyAction}><Link prefetch={false} className={styles.link} href={historyPath(p.email)}>{t("assistantRoute.history")}</Link></td></tr>)}</tbody></table>}</section>}
 {view.kind==="settings" && <PolicySummary policy={data.defaults} effective={data.defaults} accessControl={access()} editHref={`${path}?edit=1`}/>}
 {["user","history"].includes(view.kind) && <section><h2>{person?.name || view.email}</h2><p className={styles.muted}>{view.email}</p><nav className={styles.tabs} aria-label={t("assistantExtra.administratorDetails")}>{person && <Link prefetch={false} href={userPath(view.email)} aria-current={view.kind==="user"?"page":undefined}>{t("assistantExtra.settings")}</Link>}<Link prefetch={false} href={historyPath(view.email)} aria-current={view.kind==="history"?"page":undefined}>{t("assistantExtra.conversations")}</Link></nav>{view.kind==="history"?<><History history={view.history}/><PageLinks page={view.page} hasNext={!!view.history.cursor}/></>:person && <><div className={styles.usageSummary}>{[["today","daily"],["thisWeek","weekly"]].map(([label,key])=><div key={key}><span>{t(`assistantExtra.${label}`)}</span><Usage used={person.access[`${key}Used`]} limit={person.access[key]}/><small>{t("assistantExtra.resetAt",{date:date(person.access[`${key}Reset`])})}</small></div>)}</div><PolicySummary policy={person.policy} effective={person.access} editable={person.role==="admin"} accessControl={person.role==="admin"?access(person):null} editHref={`${path}?edit=1`}/></>}</section>}
 {view.review && <><AssistantConversationReview review={view.review} single={view.kind==="request"} target={view.target}/>{view.kind==="conversation" && <PageLinks page={view.page} hasNext={!!view.review.cursor}/>}</>}
 {view.kind==="failures" && <><AssistantFailureLog data={view.failures}/><PageLinks page={view.page} hasNext={!!view.failures.cursor}/></>}
 {view.kind==="failure" && <FailureDetails item={view.failure}/>}
 </div></div>{editing && <PolicyEditor editor={{email:person?.email,policy}} defaults={data.defaults} onClose={()=>closeEditor()} onSaved={result=>{mergeSaved(result);closeEditor(true);}}/>}
 </main>;
}
