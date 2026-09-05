import styles from "./assistant.module.css";
export default function ConversationHistory({ conversations, selectedId, allTrips, onFilter, onSelect, onNew, onMore, hasMore }) {
  return <div className={styles.history}>
    <div className={styles.historyActions}><button className={styles.primaryButton} onClick={onNew}>Cuộc trò chuyện mới</button>
      <label><input type="checkbox" checked={allTrips} onChange={(event) => onFilter(event.target.checked)} /> Tất cả chuyến đi</label></div>
    <nav aria-label="Lịch sử trò chuyện">{conversations.map((conversation) => <button key={conversation.id} type="button" aria-current={conversation.id === selectedId ? "page" : undefined} onClick={() => onSelect(conversation)}>
      <strong>{conversation.title}</strong><span>{conversation.tripTitle}</span><small>{conversation.status === "running" ? "Đang trả lời" : new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(conversation.updatedAt))}</small>
    </button>)}</nav>
    {!conversations.length && <p>Chưa có cuộc trò chuyện. Bắt đầu bằng một câu hỏi về chuyến đi.</p>}
    {hasMore && <button className={styles.secondaryButton} onClick={onMore}>Xem thêm cuộc trò chuyện</button>}
  </div>;
}
