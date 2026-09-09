import { localizeAssistantMessage } from "../../lib/i18n-assistant.mjs";
import styles from "./assistant.module.css";
import { useLocale } from "../LocaleProvider";
export default function ConversationHistory({ conversations, selectedId, onSelect, onMore, hasMore, loading, error, onRetry }) {
  const { t, intlLocale } = useLocale();
  return <div className={styles.history}>
    {error && <div role="alert"><p>{localizeAssistantMessage(t, error)}</p><button className={styles.secondaryButton} onClick={onRetry}>{t("common.retry")}</button></div>}
    {loading && <p role="status">{t("assistant.loadingConversations")}</p>}
    <nav aria-label={t("assistant.conversationHistory")}>{conversations.map((conversation) => <button key={conversation.id} type="button" aria-current={conversation.id === selectedId ? "page" : undefined} onClick={() => onSelect(conversation)}>
      <strong>{conversation.title}</strong><span>{conversation.pins?.length ? t("assistant.pinnedCount", { count: conversation.pins.length }) : ""}</span><small>{conversation.status === "handoff" ? t("assistantExtra.handoff.active") : conversation.status === "running" ? t("assistant.answering") : conversation.status === "awaiting_approval" ? t("assistant.approvalNeeded") : conversation.status === "awaiting_input" ? t("assistant.questionNeeded") : new Intl.DateTimeFormat(intlLocale, { dateStyle: "short", timeStyle: "short", hour12: false }).format(new Date(conversation.updatedAt))}</small>
    </button>)}</nav>
    {!loading && !error && !conversations.length && <p>{t("assistant.noConversations")}</p>}
    {hasMore && <button className={styles.secondaryButton} disabled={loading} onClick={onMore}>{t("assistant.moreConversations")}</button>}
  </div>;
}
