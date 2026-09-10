"use client";
import Link from "./AssistantManagementLink";
import {useRouter} from "next/navigation";
import {useManagementLocale} from "./AssistantManagementControls";
import {failurePath,conversationPath,requestPath,historyPath} from "../lib/assistant-management-routes.mjs";
import styles from "./assistant-management.module.css";
import AssistantExecutionTrace from "./AssistantExecutionTrace";
export function FailureDetails({item}) {
 const {t,date}=useManagementLocale();
 return <section><h2>{item.title}</h2><p><Link prefetch={false} href={historyPath(item.email)}>{item.email}</Link> · {date(item.completedAt)} JST</p><nav className={styles.routeActions}><Link prefetch={false} href={requestPath(item.conversationId,item.id)}>{t("assistantRoute.request")}</Link><Link prefetch={false} href={conversationPath(item.conversationId)}>{t("assistantRoute.full")}</Link></nav><div className={styles.failureDetails}>
<dl className={styles.settings}>
          {[["reference", item.id], ["conversation", item.conversationId], ["time", `${date(item.completedAt)} JST`], ["code", item.code], ["model", item.settings?.model], ["phase", item.diagnostics?.phase], ["type", item.diagnostics?.errorType], ["upstream", item.diagnostics?.upstreamStatus], ["system", item.diagnostics?.systemCode], ["retry", item.retryOfTurnId], ["deadline", item.diagnostics?.deadlineMs]].filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => <div key={key}><dt>{t(`assistantLog.${key}`)}</dt><dd>{value}</dd></div>)}
        </dl>
        {!item.diagnostics && !item.trace?.length && <p className={styles.muted}>{t("assistantLog.legacy")}</p>}
        {item.diagnostics?.cause && <pre>{JSON.stringify(item.diagnostics.cause, null, 2)}</pre>}
        <AssistantExecutionTrace allowedTools={item.allowedTools} trace={item.trace} summary={item.traceSummary} errorCode={item.code} />
      </div></section>;
}
export default function AssistantFailureLog({data}) {
 const {t,date}=useManagementLocale(), router=useRouter();
 return <section aria-label={t("assistantLog.title")}><div className={styles.sectionHead}><h2>{t("assistantLog.title")}</h2><button className={styles.secondary} onClick={()=>router.refresh()}>{t("assistantLog.refresh")}</button></div><p className={styles.muted}>{t("assistantLog.description")}</p>{!data.items.length && <p>{t("assistantLog.empty")}</p>}{data.items.map(item=><article className={styles.failureEntry} key={item.id}><h3><Link prefetch={false} href={failurePath(item.id)}>{item.title}</Link></h3><p><Link prefetch={false} href={historyPath(item.email)}>{item.email}</Link> · {date(item.completedAt)} JST</p><p>{item.code}</p><nav className={styles.routeActions}><Link prefetch={false} href={failurePath(item.id)}>{t("assistantLog.details")}</Link><Link prefetch={false} href={requestPath(item.conversationId,item.id)}>{t("assistantRoute.request")}</Link></nav></article>)}</section>;
}
