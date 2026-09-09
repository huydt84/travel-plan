"use client";
import { useEffect, useRef, useState } from "react";
import Link from "./AssistantManagementLink";
import { apiJson } from "./v1/transport.mjs";
import { handoffPath } from "../lib/assistant-management-routes.mjs";
import { useManagementLocale } from "./AssistantManagementControls";
import styles from "./assistant-management.module.css";

export function AssistantHandoffInbox({ items=[] }) {
  const { t,date }=useManagementLocale();
  if(!items.length)return <section className={styles.handoffInbox} aria-label={t("assistantHandoff.inbox")}><div className={styles.sectionHead}><h2>{t("assistantHandoff.inbox")}</h2></div><p className={styles.handoffEmpty}>{t("assistantHandoff.empty")}</p></section>;
  return <section className={styles.handoffInbox} aria-label={t("assistantHandoff.inbox")}><div className={styles.sectionHead}><h2>{t("assistantHandoff.inbox")}</h2><span className={styles.handoffCount}>{items.reduce((sum,item)=>sum+item.unreadCount,0)}</span></div><div className={styles.handoffList}>{items.map(item=><Link prefetch={false} key={item.id} href={handoffPath(item.id)} className={styles.handoffRow}><div><strong>{item.participant.name}</strong><small>{item.participant.email}</small></div><p>{item.latestMessage}</p><div><time>{date(item.latestAt)} JST</time>{item.unreadCount>0&&<b>{t("assistantHandoff.unread",{count:item.unreadCount})}</b>}</div></Link>)}</div></section>;
}

export function AssistantHandoffThread({ initial }) {
  const { t,date }=useManagementLocale();
  const [handoff,setHandoff]=useState(initial),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const endRef=useRef(null),requestRef=useRef(null),closeRef=useRef(null);
  useEffect(()=>{let disposed=false;const refresh=async()=>{try{const next=await apiJson(`/api/admin/assistant/handoffs/${handoff.id}`);if(!disposed)setHandoff(next);}catch{/* Keep the transcript visible. */}};
    void apiJson(`/api/admin/assistant/handoffs/${handoff.id}/seen`,{method:"POST"}).then(next=>{if(!disposed)setHandoff(next);}).catch(()=>{});
    const timer=setInterval(refresh,3000);window.addEventListener("focus",refresh);return()=>{disposed=true;clearInterval(timer);window.removeEventListener("focus",refresh);};},[handoff.id]);
  useEffect(()=>{endRef.current?.scrollIntoView({block:"nearest"});},[handoff.messages.length]);
  const timeline=[...(handoff.turns||[]).flatMap(turn=>[
    {id:`${turn.id}-input`,role:"participant",name:handoff.participant.name,body:turn.input,createdAt:turn.createdAt},
    ...(turn.output?[{id:`${turn.id}-output`,role:"assistant",name:t("assistantExtra.assistant"),body:turn.output,createdAt:turn.completedAt||turn.createdAt}]:[]),
  ]),...handoff.messages.map(item=>({id:item.id,role:item.author.role,name:item.author.name,body:item.body,createdAt:item.createdAt,ordinal:item.ordinal}))]
    .sort((a,b)=>a.ordinal&&b.ordinal?a.ordinal-b.ordinal:new Date(a.createdAt)-new Date(b.createdAt)||a.id.localeCompare(b.id));
  const send=async(event)=>{event.preventDefault();const body=message.trim();if(!body||busy||handoff.status!=="active")return;setBusy(true);setError("");const pending=requestRef.current?.body===body?requestRef.current:{body,id:crypto.randomUUID()};requestRef.current=pending;try{const result=await apiJson(`/api/admin/assistant/handoffs/${handoff.id}/messages`,{method:"POST",body:JSON.stringify({clientMessageId:pending.id,message:body})});setHandoff(current=>({...current,messages:[...current.messages.filter(item=>item.id!==result.message.id),result.message]}));requestRef.current=null;setMessage("");}catch(failure){setError(failure.message);}finally{setBusy(false);}};
  const close=async()=>{if(busy||handoff.status!=="active"||!window.confirm(t("assistantHandoff.closeConfirm")))return;setBusy(true);setError("");try{const result=await apiJson(`/api/admin/assistant/handoffs/${handoff.id}/close`,{method:"POST"});setHandoff(current=>({...current,status:"closed",closedAt:result.closedAt}));requestAnimationFrame(()=>closeRef.current?.focus());}catch(failure){setError(failure.message);}finally{setBusy(false);}};
  return <section className={styles.handoffThread}><div className={styles.handoffHead}><div><h2>{handoff.conversationTitle}</h2><p>{handoff.participant.name}</p><small>{handoff.participant.email}</small></div><button ref={closeRef} className={styles.danger} type="button" onClick={close} disabled={busy||handoff.status!=="active"}>{handoff.status==="active"?t("assistantHandoff.close"):t("assistantHandoff.closed")}</button></div>
    <p className={styles.handoffDelivery}>{t(`assistantHandoff.email.${handoff.emailStatus || "pending"}`)}{handoff.emailError?` (${handoff.emailError})`:""}</p>
    <div className={styles.handoffTranscript} aria-live="polite">{timeline.map(item=><article key={item.id} data-role={item.role}><header><strong>{item.role==="owner"?t("assistantHandoff.owner"):item.name}</strong><time>{date(item.createdAt)} JST</time></header><p>{item.body}</p></article>)}<span ref={endRef}/></div>
    {error&&<p role="alert" className={styles.warning}>{error}</p>}
    <form className={styles.handoffComposer} onSubmit={send}><label htmlFor="handoff-reply">{t("assistantHandoff.reply")}</label><textarea id="handoff-reply" rows="3" maxLength="4000" value={message} onChange={event=>{setMessage(event.target.value);if(requestRef.current?.body!==event.target.value.trim())requestRef.current=null;}} disabled={busy||handoff.status!=="active"}/><button className={styles.primary} disabled={busy||handoff.status!=="active"||!message.trim()}>{busy?t("assistantExtra.saving"):t("assistantHandoff.send")}</button></form>
  </section>;
}
