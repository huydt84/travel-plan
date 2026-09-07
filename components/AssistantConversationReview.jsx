"use client";
import Link from "./AssistantManagementLink";
import {useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {useManagementLocale,Badge} from "./AssistantManagementControls";
import {requestPath,conversationPath,historyPath} from "../lib/assistant-management-routes.mjs";
import BatchReview from "./v1/BatchReview";
import MessageContent from "./v1/MessageContent";
import {ReferenceList} from "./v1/ContextReferences";
import {EvidencePanel,ChangePanel} from "./v1/ProposalReview";
import {apiJson} from "./v1/transport.mjs";
import styles from "./assistant-management.module.css";
export default function AssistantConversationReview({review,single,target}) {
 const {t,date,status,effortLabel}=useManagementLocale(), router=useRouter();
 const [stopping,setStopping]=useState(null),[error,setError]=useState(false);
 const running=review.turns.some(turn=>["running","awaiting_approval"].includes(turn.status));
 useEffect(()=>{if(!running)return;const timer=setInterval(()=>{if(document.visibilityState==="visible")router.refresh();},3000);return()=>clearInterval(timer);},[running,router]);
 useEffect(()=>{if(target){const node=[...document.querySelectorAll(`[id="turn-${target}"]`)].find(node=>node.checkVisibility());node?.scrollIntoView({block:"center"});node?.focus({preventScroll:true});}},[target]);
 const stop=async(turn)=>{setStopping(turn.id);setError(false);try{await apiJson(`/api/admin/assistant/runs/${turn.id}/stop`,{method:"POST"});router.refresh();}catch{setError(true);}finally{setStopping(null);}};
 return <section aria-label={t("assistantExtra.reviewConversation")}><h2>{review.conversation.title}</h2><p><Link prefetch={false} href={historyPath(review.email)}>{review.email}</Link> {t("assistantExtra.readOnlySuffix")}</p>
 {single && <nav className={styles.routeActions}><Link prefetch={false} href={`${conversationPath(review.conversation.id)}?target=${review.turns[0].id}#turn-${review.turns[0].id}`}>{t("assistantRoute.full")}</Link>{review.previous && <Link prefetch={false} href={requestPath(review.conversation.id,review.previous)}>{t("assistantRoute.previousRequest")}</Link>}{review.next && <Link prefetch={false} href={requestPath(review.conversation.id,review.next)}>{t("assistantRoute.nextRequest")}</Link>}</nav>}
 {error && <p role="alert">{t("assistantExtra.error.load")}</p>}
<details className={styles.rules}><summary>{t("assistantExtra.conversationContext")}</summary><ReferenceList label={t("assistantExtra.pinnedContext")} items={review.conversation.pins.map(ref=>({ref}))} /></details><div className={styles.review}>{review.turns.map(turn=><article id={`turn-${turn.id}`} tabIndex={-1} className={styles.turn} key={turn.id}><header><Link prefetch={false} href={requestPath(review.conversation.id,turn.id)}>{t("assistantRoute.request")}</Link><span>{date(turn.createdAt)} JST</span><Badge enabled={turn.status==="completed"}>{status(turn)}</Badge>{["running","awaiting_approval"].includes(turn.status) && <button className={styles.danger} disabled={stopping===turn.id} onClick={()=>stop(turn)}>{stopping===turn.id ? t("assistantExtra.stopping") : t("assistantExtra.stopRequest")}</button>}</header>
        <div className={styles.question}><h3>{t("assistantRoute.user")}</h3><p>{turn.input}</p></div><div className={styles.answer}><h3>{t("assistantExtra.assistant")}</h3><MessageContent text={turn.output || (turn.status==="running" ? t("assistantExtra.preparing") : t("assistantExtra.noAnswer"))} citations={turn.citations} onCitation={id=>{const target=document.getElementById(`${turn.id}-evidence-${id}`);target?.scrollIntoView({block:"center"});target?.focus({preventScroll:true});}} />{!!turn.citations.length && <EvidencePanel citations={turn.citations} idPrefix={`${turn.id}-evidence`} />}{turn.actions?.map(action=><BatchReview key={action.id} action={action} readOnly />)}{turn.changeSet && <ChangePanel changeSet={turn.changeSet} readOnly />}</div>
        <details className={styles.rules}><summary>{t("assistantExtra.requestDetails")}</summary><p>{turn.executionSettings ? `${turn.executionSettings.model} · ${effortLabel[turn.executionSettings.effort]}` : t("assistantExtra.noModelData")}{turn.retryOfTurnId && t("assistantExtra.retrySuffix")}</p><ReferenceList label={t("assistantExtra.messageContext")} items={turn.resolvedContext} /><ReferenceList label={t("assistantExtra.usedContext")} items={turn.usedContext} /></details>
      </article>)}</div></section>;
}
